import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT_DIR = path.resolve('.');
const OUTPUT_DIR = path.join(ROOT_DIR, 'exports', 'metadata');
const DOCS_DATA_DIR = path.join(ROOT_DIR, 'docs', 'data');
const COMBINED_OUTPUT_PATH = path.join(OUTPUT_DIR, 'metadata-db.json');
const DOCS_OUTPUT_PATH = path.join(DOCS_DATA_DIR, 'metadata-db.json');
const INDEX_OUTPUT_PATH = path.join(OUTPUT_DIR, 'metadata-index.json');
const DOCS_INDEX_OUTPUT_PATH = path.join(DOCS_DATA_DIR, 'metadata-index.json');
const ENV_PATH = path.join(ROOT_DIR, '.env');

const ALPHA_CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function parseEnv(text) {
  return Object.fromEntries(
    String(text ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const idx = line.indexOf('=');
        return idx >= 0
          ? [line.slice(0, idx).trim(), line.slice(idx + 1).trim()]
          : [line, ''];
      }),
  );
}

async function loadEnv() {
  try {
    const text = await fs.readFile(ENV_PATH, 'utf8');
    return { ...parseEnv(text), ...process.env };
  } catch {
    return { ...process.env };
  }
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 300)}`);
  }
  return text;
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  return JSON.parse(text);
}

function uniqBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    map.set(keyFn(item), item);
  }
  return [...map.values()];
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJson(filePath, payload) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readExistingJson(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stripTags(value) {
  return String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function buildFisisMetadata(env) {
  const auth = env.FISIS_API_KEY;
  if (!auth) {
    return {
      status: 'skipped',
      reason: 'FISIS_API_KEY missing',
      statistics: [],
      accounts: [],
      companies: [],
    };
  }

  const statisticBuckets = [];
  for (const lrgDiv of ALPHA_CODES) {
    const url = `http://fisis.fss.or.kr/openapi/statisticsListSearch.json?lang=kr&auth=${encodeURIComponent(auth)}&lrgDiv=${lrgDiv}`;
    const payload = await fetchJson(url).catch(() => null);
    const rows = payload?.result?.list ?? [];
    if (rows.length > 0) {
      statisticBuckets.push(...rows.map((row) => ({ ...row, lrg_div: lrgDiv })));
    }
  }

  const statistics = uniqBy(statisticBuckets, (item) => item.list_no);
  const accountsNested = await mapWithConcurrency(statistics, 6, async (stat) => {
    const url = `http://fisis.fss.or.kr/openapi/accountListSearch.json?lang=kr&auth=${encodeURIComponent(auth)}&listNo=${encodeURIComponent(stat.list_no)}`;
    const payload = await fetchJson(url).catch(() => null);
    return (payload?.result?.list ?? []).map((account) => ({
      ...account,
      lrg_div_nm: stat.lrg_div_nm,
      sml_div_nm: stat.sml_div_nm,
    }));
  });
  const accounts = uniqBy(accountsNested.flat(), (item) => `${item.list_no}:${item.account_cd}`);

  const companyBuckets = [];
  for (const partDiv of ALPHA_CODES) {
    const url = `http://fisis.fss.or.kr/openapi/companySearch.json?lang=kr&auth=${encodeURIComponent(auth)}&partDiv=${partDiv}`;
    const payload = await fetchJson(url).catch(() => null);
    const rows = payload?.result?.list ?? [];
    if (rows.length > 0) {
      companyBuckets.push(...rows.map((row) => ({ ...row, part_div: partDiv })));
    }
  }

  const companies = uniqBy(companyBuckets, (item) => item.finance_cd);
  return {
    status: 'ok',
    fetchedAt: new Date().toISOString(),
    categories: {
      lrgDiv: uniqBy(statistics.map((item) => ({ code: item.lrg_div, name: item.lrg_div_nm })), (item) => item.code),
      partDiv: uniqBy(companies.map((item) => ({ code: item.part_div, path: item.finance_path?.split('\\')[0] ?? item.part_div })), (item) => item.code),
    },
    statistics,
    accounts,
    companies,
  };
}

async function buildEcosMetadata(env) {
  const auth = env.ECOS_API_KEY;
  const existingPath = path.join(OUTPUT_DIR, 'ecos-metadata.json');
  if (!auth) {
    return {
      status: 'skipped',
      reason: 'ECOS_API_KEY missing',
      tables: [],
      items: [],
    };
  }

  const firstPage = await fetchJson(`https://ecos.bok.or.kr/api/StatisticTableList/${encodeURIComponent(auth)}/json/kr/1/1000/`);
  if (firstPage?.RESULT?.CODE === 'ERROR-602') {
    const cached = await readExistingJson(existingPath);
    if (cached?.tables?.length) {
      return { ...cached, status: 'cached-after-rate-limit' };
    }
    throw new Error(firstPage.RESULT.MESSAGE);
  }
  const totalCount = Number(firstPage?.StatisticTableList?.list_total_count ?? 0);
  const tables = [...(firstPage?.StatisticTableList?.row ?? [])];

  for (let start = 1001; start <= totalCount; start += 1000) {
    const end = Math.min(start + 999, totalCount);
    const page = await fetchJson(`https://ecos.bok.or.kr/api/StatisticTableList/${encodeURIComponent(auth)}/json/kr/${start}/${end}/`);
    tables.push(...(page?.StatisticTableList?.row ?? []));
  }

  const searchableTables = tables.filter((table) => table.SRCH_YN === 'Y');
  const itemsNested = [];
  for (let index = 0; index < searchableTables.length; index += 1) {
    const table = searchableTables[index];
    const payload = await fetchJson(`https://ecos.bok.or.kr/api/StatisticItemList/${encodeURIComponent(auth)}/json/kr/1/1000/${encodeURIComponent(table.STAT_CODE)}`).catch(() => null);
    if (payload?.RESULT?.CODE === 'ERROR-602') {
      const cached = await readExistingJson(existingPath);
      if (cached?.items?.length) {
        return { ...cached, status: 'cached-after-rate-limit' };
      }
      throw new Error(payload.RESULT.MESSAGE);
    }
    const rows = payload?.StatisticItemList?.row ?? [];
    itemsNested.push(rows.map((item) => ({
      ...item,
      TABLE_CYCLE: table.CYCLE,
      TABLE_SRCH_YN: table.SRCH_YN,
    })));
    if ((index + 1) % 25 === 0) {
      console.log(`ECOS items fetched: ${index + 1}/${searchableTables.length}`);
    }
    await sleep(750);
  }

  const items = uniqBy(itemsNested.flat(), (item) => [item.STAT_CODE, item.GRP_CODE, item.ITEM_CODE, item.CYCLE].join(':'));
  return {
    status: 'ok',
    fetchedAt: new Date().toISOString(),
    tables,
    searchableTables,
    items,
  };
}

async function findKrxLatestDate(auth) {
  const baseDate = new Date();
  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() - offset);
    const basDd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    const payload = await fetchJson(`https://data-dbg.krx.co.kr/svc/apis/idx/krx_dd_trd?basDd=${basDd}`, {
      headers: { AUTH_KEY: auth },
    }).catch(() => null);
    const rows = payload?.OutBlock_1 ?? [];
    if (rows.length > 0) {
      return { basDd, rows };
    }
  }
  throw new Error('Could not find a recent KRX trading date with index data.');
}

async function buildKrxMetadata(env) {
  const auth = env.KRX_API_KEY;
  if (!auth) {
    return {
      status: 'skipped',
      reason: 'KRX_API_KEY missing',
      indices: [],
    };
  }

  const { basDd, rows } = await findKrxLatestDate(auth);
  const indices = uniqBy(rows.map((row) => ({
    date: basDd,
    indexClass: row.IDX_CLSS,
    indexName: row.IDX_NM,
    close: row.CLSPRC_IDX,
    change: row.CMPPREVDD_IDX,
    changeRate: row.FLUC_RT,
    marketCap: row.MKTCAP,
  })), (item) => `${item.indexClass}:${item.indexName}`);

  return {
    status: 'ok',
    fetchedAt: new Date().toISOString(),
    latestDate: basDd,
    indices,
    fields: ['BAS_DD', 'IDX_CLSS', 'IDX_NM', 'CLSPRC_IDX', 'CMPPREVDD_IDX', 'FLUC_RT', 'OPNPRC_IDX', 'HGPRC_IDX', 'LWPRC_IDX', 'ACC_TRDVOL', 'ACC_TRDVAL', 'MKTCAP'],
  };
}

async function buildIncosMetadata() {
  const listHtml = await fetchText('https://incos.kidi.or.kr:5443/insMonth/selMonthbookDeList.do');
  const tables = [...listHtml.matchAll(/goInsisDetail\('([^']*)','([^']*)','([^']*)','([^']*)','([^']*)'\);">([^<]+)</g)].map((match) => ({
    statiType: match[1],
    compLn: match[2],
    statiSheet: match[3],
    gubun: match[4],
    tableId: match[5],
    title: stripTags(match[6]),
  }));

  const companyPayload = await fetchJson('https://incos.kidi.or.kr:5443/insMonth/getQueryResult.do', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: 'https://incos.kidi.or.kr:5443/insMonth/selMonthbookDeList.do',
      Origin: 'https://incos.kidi.or.kr:5443',
    },
    body: 'queryId=getNCompanyInfo',
  });
  const companies = (companyPayload?.result?.result ?? []).map((item) => ({
    code: item.DATA,
    name: item.LABEL,
  }));

  return {
    status: 'ok',
    fetchedAt: new Date().toISOString(),
    tables,
    companies,
  };
}

async function buildKofiaMetadata() {
  const landingHtml = await fetchText('http://freesis.kofia.or.kr/index.jsp');
  const services = uniqBy(
    [...landingHtml.matchAll(/href="\/stat\/FreeSIS\.do\?parentDivId=([^"&]+)&amp;serviceId=([^"&]+)"/gi)].map((match) => ({
      parentDivId: match[1],
      serviceId: match[2],
      pageUrl: `http://freesis.kofia.or.kr/stat/FreeSIS.do?parentDivId=${match[1]}&serviceId=${match[2]}`,
    })),
    (item) => `${item.parentDivId}:${item.serviceId}`,
  );

  const enriched = await mapWithConcurrency(services, 4, async (service, index) => {
    const html = await fetchText(service.pageUrl).catch(() => '');
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const subtitleMatch = html.match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/i);
    const title = stripTags(titleMatch?.[1] ?? subtitleMatch?.[1] ?? service.serviceId);
    if ((index + 1) % 10 === 0) {
      console.log(`KOFIA pages fetched: ${index + 1}/${services.length}`);
    }
    return {
      ...service,
      title,
    };
  });

  return {
    status: 'ok',
    fetchedAt: new Date().toISOString(),
    services: enriched,
  };
}

function buildSearchIndex(raw) {
  const rows = [];
  const pushRow = (source, kind, code, name, category, terms) => {
    rows.push({
      source,
      kind,
      code,
      name,
      category,
      searchText: terms.filter(Boolean).join(' ').toLowerCase(),
    });
  };

  for (const item of raw.FISIS.statistics ?? []) {
    pushRow('FISIS', 'statistics', item.list_no, item.list_nm, `${item.lrg_div_nm} / ${item.sml_div_nm}`, [item.list_nm, item.lrg_div_nm, item.sml_div_nm, item.list_no]);
  }

  for (const item of raw.FISIS.accounts ?? []) {
    pushRow('FISIS', 'account', `${item.list_no}:${item.account_cd}`, item.account_nm, item.list_nm, [item.account_nm, item.list_nm, item.lrg_div_nm, item.sml_div_nm, item.account_cd]);
  }

  for (const item of raw.FISIS.companies ?? []) {
    pushRow('FISIS', 'company', item.finance_cd, item.finance_nm, item.finance_path, [item.finance_nm, item.finance_path, item.finance_cd]);
  }

  for (const item of raw.ECOS.searchableTables ?? []) {
    pushRow('ECOS', 'table', item.STAT_CODE, item.STAT_NAME, item.CYCLE, [item.STAT_NAME, item.STAT_CODE, item.CYCLE]);
  }

  for (const item of raw.ECOS.items ?? []) {
    pushRow('ECOS', 'item', `${item.STAT_CODE}:${item.ITEM_CODE}:${item.CYCLE}`, item.ITEM_NAME, item.STAT_NAME, [item.ITEM_NAME, item.STAT_NAME, item.UNIT_NAME, item.CYCLE, item.ITEM_CODE]);
  }

  for (const item of raw.KRX.indices ?? []) {
    pushRow('KRX', 'index', `${item.indexClass}:${item.indexName}`, item.indexName, item.indexClass, [item.indexName, item.indexClass]);
  }

  for (const item of raw.INCOS.tables ?? []) {
    pushRow('INCOS', 'table', item.tableId, item.title, item.gubun, [item.title, item.tableId, item.gubun]);
  }

  for (const item of raw.INCOS.companies ?? []) {
    pushRow('INCOS', 'company', item.code, item.name, '손해보험 회사', [item.name, item.code]);
  }

  for (const item of raw.KOFIA.services ?? []) {
    pushRow('KOFIA', 'service', item.serviceId, item.title, item.parentDivId, [item.title, item.serviceId, item.parentDivId]);
  }

  return rows;
}

function buildIndexPayload(combined) {
  const countsBySource = {};
  const countsByKind = {};

  for (const row of combined.searchIndex) {
    countsBySource[row.source] = (countsBySource[row.source] ?? 0) + 1;
    const compoundKey = `${row.source}:${row.kind}`;
    countsByKind[compoundKey] = (countsByKind[compoundKey] ?? 0) + 1;
  }

  return {
    generatedAt: combined.generatedAt,
    summary: combined.summary,
    sourceCounts: countsBySource,
    kindCounts: countsByKind,
    searchIndex: combined.searchIndex,
  };
}

async function loadRawMetadataFromCache() {
  const [FISIS, ECOS, KRX, INCOS, KOFIA] = await Promise.all([
    readExistingJson(path.join(OUTPUT_DIR, 'fisis-metadata.json')),
    readExistingJson(path.join(OUTPUT_DIR, 'ecos-metadata.json')),
    readExistingJson(path.join(OUTPUT_DIR, 'krx-metadata.json')),
    readExistingJson(path.join(OUTPUT_DIR, 'incos-metadata.json')),
    readExistingJson(path.join(OUTPUT_DIR, 'kofia-metadata.json')),
  ]);

  return { FISIS, ECOS, KRX, INCOS, KOFIA };
}

async function writeCombinedOutputs(raw) {
  const combined = {
    generatedAt: new Date().toISOString(),
    summary: {
      fisisStatistics: raw.FISIS.statistics?.length ?? 0,
      fisisAccounts: raw.FISIS.accounts?.length ?? 0,
      fisisCompanies: raw.FISIS.companies?.length ?? 0,
      ecosTables: raw.ECOS.tables?.length ?? 0,
      ecosSearchableTables: raw.ECOS.searchableTables?.length ?? 0,
      ecosItems: raw.ECOS.items?.length ?? 0,
      krxIndices: raw.KRX.indices?.length ?? 0,
      incosTables: raw.INCOS.tables?.length ?? 0,
      incosCompanies: raw.INCOS.companies?.length ?? 0,
      kofiaServices: raw.KOFIA.services?.length ?? 0,
    },
    sources: raw,
    searchIndex: buildSearchIndex(raw),
  };

  await ensureDir(OUTPUT_DIR);
  await ensureDir(DOCS_DATA_DIR);
  await writeJson(COMBINED_OUTPUT_PATH, combined);
  await writeJson(DOCS_OUTPUT_PATH, combined);
  const indexPayload = buildIndexPayload(combined);
  await writeJson(INDEX_OUTPUT_PATH, indexPayload);
  await writeJson(DOCS_INDEX_OUTPUT_PATH, indexPayload);

  return combined;
}

export async function buildMetadataDb() {
  const env = await loadEnv();
  const [FISIS, ECOS, KRX, INCOS, KOFIA] = await Promise.all([
    buildFisisMetadata(env),
    buildEcosMetadata(env),
    buildKrxMetadata(env),
    buildIncosMetadata(),
    buildKofiaMetadata(),
  ]);

  const raw = { FISIS, ECOS, KRX, INCOS, KOFIA };
  await writeJson(path.join(OUTPUT_DIR, 'fisis-metadata.json'), FISIS);
  await writeJson(path.join(OUTPUT_DIR, 'ecos-metadata.json'), ECOS);
  await writeJson(path.join(OUTPUT_DIR, 'krx-metadata.json'), KRX);
  await writeJson(path.join(OUTPUT_DIR, 'incos-metadata.json'), INCOS);
  await writeJson(path.join(OUTPUT_DIR, 'kofia-metadata.json'), KOFIA);
  return writeCombinedOutputs(raw);
}

async function main() {
  const metadata = process.argv.includes('--from-cache')
    ? await writeCombinedOutputs(await loadRawMetadataFromCache())
    : await buildMetadataDb();
  console.log(`Metadata DB built -> ${path.relative(ROOT_DIR, COMBINED_OUTPUT_PATH)}`);
  console.log(JSON.stringify(metadata.summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
