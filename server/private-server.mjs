import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT_DIR, 'private-app');
const METADATA_DIR = path.join(ROOT_DIR, 'exports', 'metadata');
const DOCS_DATA_DIR = path.join(ROOT_DIR, 'docs', 'data');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4317);
const SESSION_COOKIE = 'finance_private_session';
const sessions = new Map();

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const KOFIA_OPERATIONS = {
  getTrustScaleInfo: {
    label: '업권별신탁규모',
    dateField: 'basYm',
    dateMode: 'M',
    endpoint: 'getTrustScaleInfo',
    selectors: ['bzds', 'tstCtg', 'kind', 'iqBs'],
    valueFields: ['val'],
  },
  getFundTotalNetEssetInfo: {
    label: '펀드순자산총액',
    dateField: 'basDt',
    dateMode: 'D',
    endpoint: 'getFundTotalNetEssetInfo',
    selectors: ['ctg', 'tstMthdCtg'],
    valueFields: ['nPptTotAmt'],
  },
  getCMAStatus: {
    label: '일자별 CMA 현황',
    dateField: 'basDt',
    dateMode: 'D',
    endpoint: 'getCMAStatus',
    selectors: ['mngInvTgt', 'invrCtg'],
    valueFields: ['scrtCmpyCnt', 'actCnt', 'actBal'],
  },
  getGrantingOfCreditBalanceInfo: {
    label: '신용공여잔고추이',
    dateField: 'basDt',
    dateMode: 'D',
    endpoint: 'getGrantingOfCreditBalanceInfo',
    selectors: [],
    valueFields: ['crdTrFingWhl', 'crdTrFingScrs', 'crdTrFingKosdaq', 'crdTrLndrWhl', 'crdTrLndrScrs', 'crdTrLndrKosdaq', 'sbscCapLn', 'dpsgScrtMogFing'],
  },
  getSecuritiesMarketTotalCapitalInfo: {
    label: '증시자금추이',
    dateField: 'basDt',
    dateMode: 'D',
    endpoint: 'getSecuritiesMarketTotalCapitalInfo',
    selectors: [],
    valueFields: ['invrDpsgAmt', 'onbdDrvPrdTrRcAdvAmt', 'toCstRpchCndBndSlgBal', 'brkTrdUcolMny', 'brkTrdUcolMnyVsOppsTrdAmt', 'ucolMnyVsOppsTrdRlImpt'],
  },
  getDLSAndDLBInfo: {
    label: 'DLS/DLB 발행동향',
    dateField: 'basDt',
    dateMode: 'M',
    endpoint: 'getDLSAndDLBInfo',
    selectors: ['ctgDlbDls', 'ctgPrplcPsub', 'presCtg'],
    valueFields: ['amt', 'ccnt'],
  },
  getELSAndELBInfo: {
    label: 'ELS/ELB 발행동향',
    dateField: 'basDt',
    dateMode: 'M',
    endpoint: 'getELSAndELBInfo',
    selectors: ['ctgElbEls', 'ctgPrplcPsub', 'presCtg'],
    valueFields: ['amt', 'ccnt'],
  },
  getDerivationProductTradingInfo: {
    label: '국내투자자의 해외파생상품거래동향',
    dateField: 'basDt',
    dateMode: 'M',
    endpoint: 'getDerivationProductTradingInfo',
    selectors: ['byPrdGrp', 'actCtg', 'ctgBsonCntrForm', 'prdNm', 'brkPn', 'xchNm', 'byNtnl', 'prdGrp'],
    valueFields: ['trqu', 'trPrcUsd'],
  },
};

const KRX_SERVICE_CATALOG = {
  지수: [{ code: 'krx-index-daily', name: '지수 일별 시계열', wired: true }],
  증권상품: [
    { code: 'krx-etf-daily', name: 'ETF 일별매매정보', wired: false },
    { code: 'krx-etn-daily', name: 'ETN 일별매매정보', wired: false },
    { code: 'krx-elw-daily', name: 'ELW 일별매매정보', wired: false },
  ],
  채권: [
    { code: 'krx-gov-bond-daily', name: '국채전문유통시장 일별매매정보', wired: false },
    { code: 'krx-general-bond-daily', name: '일반채권시장 일별매매정보', wired: false },
    { code: 'krx-retail-bond-daily', name: '소액채권시장 일별매매정보', wired: false },
  ],
  파생상품: [
    { code: 'krx-futures-daily', name: '선물 일별매매정보', wired: false },
    { code: 'krx-options-daily', name: '옵션 일별매매정보', wired: false },
    { code: 'krx-stock-futures-kospi', name: '주식선물(유가) 일별매매정보', wired: false },
    { code: 'krx-stock-futures-kosdaq', name: '주식선물(코스닥) 일별매매정보', wired: false },
  ],
  일반상품: [
    { code: 'krx-oil-daily', name: '석유시장 일별매매정보', wired: false },
    { code: 'krx-gold-daily', name: '금시장 일별매매정보', wired: false },
    { code: 'krx-carbon-daily', name: '배출권 시장 일별매매정보', wired: false },
  ],
  ESG: [
    { code: 'krx-esg-bond', name: '사회책임투자채권 정보', wired: false },
    { code: 'krx-esg-security-product', name: 'ESG 증권상품 정보', wired: false },
    { code: 'krx-esg-index', name: 'ESG 지수 정보', wired: false },
  ],
};

function parseEnv(text) {
  return Object.fromEntries(
    String(text ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return index >= 0 ? [line.slice(0, index), line.slice(index + 1)] : [line, ''];
      }),
  );
}

async function loadEnv() {
  try {
    const text = await fs.readFile(path.join(ROOT_DIR, '.env'), 'utf8');
    return { ...parseEnv(text), ...process.env };
  } catch {
    return { ...process.env };
  }
}

function parseCookies(header) {
  return Object.fromEntries(
    String(header ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return index >= 0 ? [part.slice(0, index), decodeURIComponent(part.slice(index + 1))] : [part, ''];
      }),
  );
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 240)}`);
  }
  return JSON.parse(text);
}

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(payload));
}

function formatMonth(value) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}`;
}

function formatDay(value) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function formatPeriod(value, mode) {
  if (!value) {
    return '';
  }
  if (mode === 'D' && value.length >= 8) {
    return formatDay(value);
  }
  if (mode === 'M' && value.length >= 6) {
    return formatMonth(value);
  }
  return value;
}

function roundValue(value, digits) {
  if (!Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeUnit(value, unitMode) {
  if (!Number.isFinite(value)) {
    return value;
  }
  if (unitMode === 'million') {
    return value / 1_000_000;
  }
  if (unitMode === 'billion') {
    return value / 1_000_000_000;
  }
  return value;
}

function dedupeBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    map.set(keyFn(item), item);
  }
  return [...map.values()];
}

function buildQueryResult(source, rows, seriesDefinitions, digits, unitMode) {
  const normalizedRows = rows.map((row) => ({
    ...row,
    value: roundValue(normalizeUnit(row.value, unitMode), digits),
  }));
  const periods = [...new Set(normalizedRows.map((row) => row.period))].sort();
  const bySeries = new Map();

  for (const row of normalizedRows) {
    if (!bySeries.has(row.seriesKey)) {
      bySeries.set(row.seriesKey, new Map());
    }
    bySeries.get(row.seriesKey).set(row.period, row.value);
  }

  return {
    source,
    series: seriesDefinitions.map((series) => ({
      key: series.key,
      label: series.label,
      points: normalizedRows.filter((row) => row.seriesKey === series.key).map((row) => ({ period: row.period, value: row.value })),
    })),
    table: {
      columns: [
        { key: 'period', label: '기간' },
        ...seriesDefinitions.map((series) => ({ key: series.key, label: series.label })),
      ],
      rows: periods.map((period) => {
        const record = { period };
        for (const series of seriesDefinitions) {
          record[series.key] = bySeries.get(series.key)?.get(period) ?? null;
        }
        return record;
      }),
    },
  };
}

const env = await loadEnv();
const metadata = {
  fisis: await readJson(path.join(METADATA_DIR, 'fisis-metadata.json')),
  ecos: await readJson(path.join(METADATA_DIR, 'ecos-metadata.json')),
  krx: await readJson(path.join(METADATA_DIR, 'krx-metadata.json')),
  incos: await readJson(path.join(METADATA_DIR, 'incos-metadata.json')),
  kofia: await readJson(path.join(METADATA_DIR, 'kofia-metadata.json')),
};
const dashboardData = await readJson(path.join(DOCS_DATA_DIR, 'dashboard-data.json'));

function getSession(request) {
  const cookies = parseCookies(request.headers.cookie);
  return cookies[SESSION_COOKIE] ? sessions.get(cookies[SESSION_COOKIE]) : null;
}

function requireAuth(request, response) {
  const session = getSession(request);
  if (!session) {
    sendJson(response, 401, { error: 'Unauthorized' });
    return null;
  }
  return session;
}

function getFisisIndustries() {
  return [...new Set(metadata.fisis.statistics.map((item) => item.lrg_div_nm).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko-KR'));
}

async function getFisisCompanies(industry) {
  const partDivMap = [
    { match: '국내은행', partDivs: ['A', 'B'] },
    { match: '신용카드', partDivs: ['C'] },
    { match: '증권', partDivs: ['R'] },
    { match: '보험', partDivs: ['H', 'I', 'J'] },
  ];

  const mapped = partDivMap.find((item) => industry && industry.includes(item.match));
  if (mapped) {
    const collected = [];
    for (const partDiv of mapped.partDivs) {
      const url = `${env.FISIS_BASE_URL}/companySearch.json?lang=kr&auth=${encodeURIComponent(env.FISIS_API_KEY)}&partDiv=${encodeURIComponent(partDiv)}`;
      const payload = await fetchJson(url).catch(() => null);
      collected.push(...(payload?.result?.list ?? []).map((company) => ({
        code: company.finance_cd,
        name: company.finance_nm,
        path: company.finance_path,
      })));
    }
    const live = collected
      .filter((company) => !/\[폐\]/.test(company.name))
      .filter((company) => !industry || industry === 'ALL' || (company.path ?? '').includes(industry) || company.name.includes('은행'));
    if (live.length > 0) {
      return dedupeBy(live, (item) => `${item.code}:${item.name}`);
    }
  }

  const filtered = metadata.fisis.companies
    .filter((company) => !industry || industry === 'ALL' || (company.finance_path ?? '').includes(industry))
    .filter((company) => !/\[폐\]/.test(company.finance_nm))
    .map((company) => ({ code: company.finance_cd, name: company.finance_nm, path: company.finance_path }))
    .slice(0, 600);
  if (filtered.length > 0 || !industry || industry === 'ALL') {
    return dedupeBy(filtered, (item) => `${item.code}:${item.name}`);
  }
  const fallback = metadata.fisis.companies
    .filter((company) => !/\[폐\]/.test(company.finance_nm))
    .filter((company) => {
      if (industry.includes('은행')) return /은행/.test(company.finance_nm);
      if (industry.includes('증권')) return /(증권|투자)/.test(company.finance_nm);
      if (industry.includes('보험')) return /(보험|화재|생명)/.test(company.finance_nm);
      if (industry.includes('카드')) return /카드/.test(company.finance_nm);
      return false;
    })
    .map((company) => ({ code: company.finance_cd, name: company.finance_nm, path: company.finance_path }))
    .slice(0, 300);
  return dedupeBy(fallback, (item) => `${item.code}:${item.name}`);
}

function getFisisStatistics(industry, keyword = '') {
  return metadata.fisis.statistics
    .filter((stat) => !industry || industry === 'ALL' || stat.lrg_div_nm === industry)
    .filter((stat) => !keyword || `${stat.list_no} ${stat.list_nm}`.includes(keyword))
    .map((stat) => ({ code: stat.list_no, name: stat.list_nm, group: `${stat.lrg_div_nm} / ${stat.sml_div_nm}` }))
    .slice(0, 600);
}

function getFisisAccounts(listNo) {
  return metadata.fisis.accounts
    .filter((item) => item.list_no === listNo)
    .map((item) => ({ code: item.account_cd, name: item.account_nm }));
}

function getEcosTables(keyword = '') {
  return metadata.ecos.searchableTables
    .filter((table) => !keyword || `${table.STAT_CODE} ${table.STAT_NAME}`.includes(keyword))
    .map((table) => ({ code: table.STAT_CODE, name: table.STAT_NAME, cycle: table.CYCLE, org: table.ORG_NAME }))
    .slice(0, 500);
}

function getEcosItems(statCode) {
  return metadata.ecos.items
    .filter((item) => item.STAT_CODE === statCode)
    .map((item) => ({ code: item.ITEM_CODE, name: item.ITEM_NAME, cycle: item.CYCLE, unit: item.UNIT_NAME, group: item.GRP_NAME }))
    .slice(0, 1000);
}

function getKrxIndices() {
  return metadata.krx.indices.map((item) => ({ code: item.indexName, name: item.indexName, group: item.indexClass }));
}

function getIncosDatasets() {
  return [...new Set(dashboardData.series.map((item) => item.datasetName))].map((name) => ({ code: name, name }));
}

function getIncosEntities(datasetName) {
  return [...new Set(dashboardData.series
    .filter((item) => !datasetName || datasetName === 'ALL' || item.datasetName === datasetName)
    .map((item) => item.entity))].map((name) => ({ code: name, name }));
}

function getIncosMetrics(datasetName, entity) {
  return dashboardData.series
    .filter((item) => !datasetName || datasetName === 'ALL' || item.datasetName === datasetName)
    .filter((item) => !entity || entity === 'ALL' || item.entity === entity)
    .map((item) => ({ code: item.key, name: item.metricLabel, title: item.title }));
}

async function fetchKofiaRows(operation, params = {}, pageNo = 1, numOfRows = 1000) {
  const search = new URLSearchParams({
    serviceKey: env.KOFIA_API_KEY,
    pageNo: String(pageNo),
    numOfRows: String(numOfRows),
    resultType: 'json',
  });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '' && value !== 'ALL') {
      search.set(key, value);
    }
  }
  const url = `https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService/${operation}?${search.toString()}`;
  const payload = await fetchJson(url);
  const body = payload?.response?.body ?? {};
  const items = body?.items?.item ?? [];
  return Array.isArray(items) ? items : [items];
}

async function getKofiaOperationOptions(operation, dateHint = '') {
  const definition = KOFIA_OPERATIONS[operation];
  if (!definition) {
    return null;
  }
  const params = {};
  if (dateHint) {
    params[definition.dateField] = dateHint;
  }
  const rows = await fetchKofiaRows(definition.endpoint, params, 1, 600);
  const selectors = {};
  for (const selector of definition.selectors) {
    selectors[selector] = [...new Set(rows.map((row) => row[selector]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'ko-KR'));
  }
  return {
    operation,
    label: definition.label,
    dateField: definition.dateField,
    dateMode: definition.dateMode,
    selectors,
    valueFields: definition.valueFields,
  };
}

async function queryFisis(body) {
  const rows = [];
  const seriesDefinitions = [];
  for (const company of body.companies ?? []) {
    for (const account of body.accounts ?? []) {
      const url = `${env.FISIS_BASE_URL}/statisticsInfoSearch.json?lang=kr&auth=${encodeURIComponent(env.FISIS_API_KEY)}&financeCd=${encodeURIComponent(company.code)}&listNo=${encodeURIComponent(body.statistic.code)}&accountCd=${encodeURIComponent(account.code)}&term=${encodeURIComponent(body.term)}&startBaseMm=${encodeURIComponent(body.start)}&endBaseMm=${encodeURIComponent(body.end)}`;
      const payload = await fetchJson(url);
      const list = payload?.result?.list ?? [];
      const key = `${company.code}:${account.code}`;
      seriesDefinitions.push({ key, label: `${company.name} · ${account.name}` });
      for (const item of list) {
        rows.push({ seriesKey: key, period: formatMonth(item.base_month), value: Number(item.a) });
      }
    }
  }
  return buildQueryResult('FISIS', rows, seriesDefinitions, Number(body.precision ?? 2), body.unitMode ?? 'raw');
}

async function queryEcos(body) {
  const rows = [];
  const seriesDefinitions = [];
  for (const item of body.items ?? []) {
    const url = `${env.ECOS_BASE_URL}/${encodeURIComponent(env.ECOS_API_KEY)}/json/kr/1/1000/${encodeURIComponent(body.table.code)}/${encodeURIComponent(body.cycle)}/${encodeURIComponent(body.start)}/${encodeURIComponent(body.end)}/${encodeURIComponent(item.code)}`;
    const payload = await fetchJson(url);
    const list = payload?.StatisticSearch?.row ?? [];
    const key = `${body.table.code}:${item.code}`;
    seriesDefinitions.push({ key, label: item.name });
    for (const row of list) {
      rows.push({ seriesKey: key, period: formatPeriod(row.TIME, body.cycle), value: Number(row.DATA_VALUE) });
    }
  }
  return buildQueryResult('ECOS', rows, seriesDefinitions, Number(body.precision ?? 2), body.unitMode ?? 'raw');
}

async function queryKrx(body) {
  const rows = [];
  const selected = new Set((body.indices ?? []).map((item) => item.code));
  const seriesDefinitions = [...selected].map((code) => ({ key: code, label: code }));
  const start = new Date(`${body.start.slice(0, 4)}-${body.start.slice(4, 6)}-${body.start.slice(6, 8)}T00:00:00Z`);
  const end = new Date(`${body.end.slice(0, 4)}-${body.end.slice(4, 6)}-${body.end.slice(6, 8)}T00:00:00Z`);

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const basDd = `${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, '0')}${String(cursor.getUTCDate()).padStart(2, '0')}`;
    const payload = await fetchJson(`${env.KRX_BASE_URL}?basDd=${basDd}`, { headers: { AUTH_KEY: env.KRX_API_KEY } }).catch(() => null);
    for (const item of payload?.OutBlock_1 ?? []) {
      if (selected.has(item.IDX_NM)) {
        rows.push({ seriesKey: item.IDX_NM, period: formatDay(item.BAS_DD), value: Number(item.CLSPRC_IDX) });
      }
    }
  }

  return buildQueryResult('KRX', rows, seriesDefinitions, Number(body.precision ?? 2), body.unitMode ?? 'raw');
}

async function queryIncos(body) {
  const selected = body.seriesKeys ?? [];
  const chosenSeries = dashboardData.series.filter((series) => selected.includes(series.key));
  const seriesDefinitions = chosenSeries.map((series) => ({ key: series.key, label: series.title }));
  const rows = [];

  for (const series of chosenSeries) {
    for (const point of series.points) {
      if (body.start && point.period < body.start) continue;
      if (body.end && point.period > body.end) continue;
      rows.push({ seriesKey: series.key, period: point.period, value: Number(point.value) });
    }
  }

  return buildQueryResult('INCOS', rows, seriesDefinitions, Number(body.precision ?? 2), body.unitMode ?? 'raw');
}

async function queryKofia(body) {
  const def = KOFIA_OPERATIONS[body.operation];
  if (!def) {
    throw new Error('Unknown KOFIA operation');
  }
  const params = {};
  if (body.exactDate) {
    params[def.dateField] = body.exactDate;
  } else {
    const baseField = def.dateField[0].toUpperCase() + def.dateField.slice(1);
    if (body.start) params[`begin${baseField}`] = body.start;
    if (body.end) params[`end${baseField}`] = body.end;
  }
  for (const selector of def.selectors) {
    if (body.filters?.[selector]) {
      params[selector] = body.filters[selector];
    }
  }
  const sourceRows = await fetchKofiaRows(def.endpoint, params, 1, 5000);
  const metrics = body.metrics?.length ? body.metrics : def.valueFields;
  const seriesDefinitions = [];
  const rows = [];

  for (const row of sourceRows) {
    const selectorLabel = def.selectors.map((selector) => row[selector]).filter(Boolean).join(' · ') || def.label;
    const period = formatPeriod(row[def.dateField], def.dateMode);
    for (const metric of metrics) {
      const value = Number(row[metric]);
      if (!Number.isFinite(value)) continue;
      const key = `${selectorLabel}:${metric}`;
      if (!seriesDefinitions.some((item) => item.key === key)) {
        seriesDefinitions.push({ key, label: `${selectorLabel} · ${metric}` });
      }
      rows.push({ seriesKey: key, period, value });
    }
  }

  return buildQueryResult('KOFIA', rows, seriesDefinitions, Number(body.precision ?? 2), body.unitMode ?? 'raw');
}

function privateWorkflowDefinition() {
  return {
    sources: [
      { id: 'FISIS', title: 'FISIS' },
      { id: 'ECOS', title: 'ECOS' },
      { id: 'KOFIA', title: 'KOFIA' },
      { id: 'KRX', title: 'KRX' },
      { id: 'INCOS', title: 'INCOS' },
    ],
  };
}

async function handleApi(request, response, url) {
  if (url.pathname === '/api/session' && request.method === 'GET') {
    const session = getSession(request);
    sendJson(response, 200, { authenticated: Boolean(session), username: session?.username ?? null });
    return;
  }

  if (url.pathname === '/api/login' && request.method === 'POST') {
    const body = JSON.parse(await readBody(request) || '{}');
    const username = env.APP_USERNAME || 'admin';
    const password = env.APP_PASSWORD || 'change-me';
    if (body.username !== username || body.password !== password) {
      sendJson(response, 401, { error: 'Invalid credentials' });
      return;
    }
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { username });
    sendJson(response, 200, { ok: true }, { 'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax` });
    return;
  }

  if (url.pathname === '/api/logout' && request.method === 'POST') {
    const cookies = parseCookies(request.headers.cookie);
    sessions.delete(cookies[SESSION_COOKIE]);
    sendJson(response, 200, { ok: true }, { 'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax` });
    return;
  }

  if (!requireAuth(request, response)) {
    return;
  }

  if (url.pathname === '/api/workflows' && request.method === 'GET') {
    sendJson(response, 200, privateWorkflowDefinition());
    return;
  }

  if (url.pathname === '/api/options' && request.method === 'GET') {
    const source = url.searchParams.get('source');

    if (source === 'FISIS') {
      const industry = url.searchParams.get('industry') ?? 'ALL';
      const statistic = url.searchParams.get('statistic') ?? '';
      sendJson(response, 200, {
        industries: getFisisIndustries(),
        companies: await getFisisCompanies(industry),
        statistics: getFisisStatistics(industry, url.searchParams.get('keyword') ?? ''),
        accounts: statistic ? getFisisAccounts(statistic) : [],
      });
      return;
    }

    if (source === 'ECOS') {
      const statCode = url.searchParams.get('statCode') ?? '';
      sendJson(response, 200, {
        tables: getEcosTables(url.searchParams.get('keyword') ?? ''),
        items: statCode ? getEcosItems(statCode) : [],
      });
      return;
    }

    if (source === 'KOFIA') {
      const operation = url.searchParams.get('operation') ?? '';
      const dateHint = url.searchParams.get('dateHint') ?? '';
      sendJson(response, 200, {
        operations: Object.entries(KOFIA_OPERATIONS).map(([code, item]) => ({
          code,
          name: item.label,
          dateField: item.dateField,
          dateMode: item.dateMode,
        })),
        operationOptions: operation ? await getKofiaOperationOptions(operation, dateHint) : null,
      });
      return;
    }

    if (source === 'KRX') {
      sendJson(response, 200, { indices: getKrxIndices(), serviceCatalog: KRX_SERVICE_CATALOG });
      return;
    }

    if (source === 'INCOS') {
      const dataset = url.searchParams.get('dataset') ?? 'ALL';
      const entity = url.searchParams.get('entity') ?? 'ALL';
      sendJson(response, 200, {
        datasets: getIncosDatasets(),
        entities: getIncosEntities(dataset),
        metrics: getIncosMetrics(dataset, entity),
      });
      return;
    }

    sendJson(response, 404, { error: 'Unknown source' });
    return;
  }

  if (url.pathname === '/api/query' && request.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(request) || '{}');
      if (body.source === 'FISIS') return sendJson(response, 200, await queryFisis(body));
      if (body.source === 'ECOS') return sendJson(response, 200, await queryEcos(body));
      if (body.source === 'KOFIA') return sendJson(response, 200, await queryKofia(body));
      if (body.source === 'KRX') return sendJson(response, 200, await queryKrx(body));
      if (body.source === 'INCOS') return sendJson(response, 200, await queryIncos(body));
      sendJson(response, 404, { error: 'Unknown source' });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  sendJson(response, 404, { error: 'Not found' });
}

async function serveStatic(response, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.resolve(path.join(APP_DIR, safePath));
  if (!resolved.startsWith(APP_DIR)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  try {
    const stat = await fs.stat(resolved);
    const targetPath = stat.isDirectory() ? path.join(resolved, 'index.html') : resolved;
    const content = await fs.readFile(targetPath);
    response.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(targetPath)] ?? 'application/octet-stream' });
    response.end(content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    await handleApi(request, response, url);
    return;
  }
  await serveStatic(response, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Private dashboard: http://${HOST}:${PORT}`);
});
