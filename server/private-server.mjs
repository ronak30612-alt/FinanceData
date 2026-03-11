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
const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_COOKIE = 'finance_private_session';
const sessions = new Map();

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
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

function sendJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(payload));
}

function unauthorized(response) {
  sendJson(response, 401, { error: 'Unauthorized' });
}

function notFound(response) {
  sendJson(response, 404, { error: 'Not found' });
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

function formatMonth(value) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}`;
}

function formatDay(value) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function roundValue(value, digits) {
  if (!Number.isFinite(value)) {
    return value;
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

function buildTable(rows, seriesDefinitions, digits, unitMode) {
  const periods = [...new Set(rows.map((row) => row.period))].sort();
  const bySeries = new Map();
  for (const row of rows) {
    const key = row.seriesKey;
    if (!bySeries.has(key)) {
      bySeries.set(key, new Map());
    }
    bySeries.get(key).set(row.period, row.value);
  }

  const tableRows = periods.map((period) => {
    const record = { period };
    for (const series of seriesDefinitions) {
      const raw = bySeries.get(series.key)?.get(period) ?? null;
      record[series.key] = raw === null ? null : roundValue(normalizeUnit(raw, unitMode), digits);
    }
    return record;
  });

  return {
    columns: [
      { key: 'period', label: '기간' },
      ...seriesDefinitions.map((series) => ({ key: series.key, label: series.label })),
    ],
    rows: tableRows,
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

const env = await loadEnv();
const metadata = {
  fisis: await readJson(path.join(METADATA_DIR, 'fisis-metadata.json')),
  ecos: await readJson(path.join(METADATA_DIR, 'ecos-metadata.json')),
  krx: await readJson(path.join(METADATA_DIR, 'krx-metadata.json')),
  incos: await readJson(path.join(METADATA_DIR, 'incos-metadata.json')),
  kofia: await readJson(path.join(METADATA_DIR, 'kofia-metadata.json')),
};
const remoteSeries = await readJson(path.join(DOCS_DATA_DIR, 'remote-series.json'));
const dashboardData = await readJson(path.join(DOCS_DATA_DIR, 'dashboard-data.json'));

function getSession(request) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  return token ? sessions.get(token) : null;
}

function requireAuth(request, response) {
  const session = getSession(request);
  if (!session) {
    unauthorized(response);
    return null;
  }
  return session;
}

function getFisisIndustries() {
  const companyBuckets = metadata.fisis.companies
    .map((company) => company.finance_path?.split('\\')?.[0] ?? company.part_div)
    .filter(Boolean);
  return [...new Set(companyBuckets)].sort((a, b) => a.localeCompare(b, 'ko-KR'));
}

function getFisisCompanies(industry) {
  const rows = metadata.fisis.companies
    .filter((company) => !industry || industry === 'ALL' || (company.finance_path ?? '').includes(industry))
    .filter((company) => !/\[폐\]/.test(company.finance_nm))
    .slice(0, 500)
    .map((company) => ({
      code: company.finance_cd,
      name: company.finance_nm,
      path: company.finance_path,
    }));
  return dedupeBy(rows, (item) => `${item.code}:${item.name}`);
}

function getFisisStatistics(industry, keyword = '') {
  return metadata.fisis.statistics
    .filter((stat) => !industry || industry === 'ALL' || (stat.lrg_div_nm ?? '').includes(industry) || (industry.includes('은행') && (stat.lrg_div_nm ?? '').includes('은행')))
    .filter((stat) => !keyword || `${stat.list_no} ${stat.list_nm}`.includes(keyword))
    .map((stat) => ({
      code: stat.list_no,
      name: stat.list_nm,
      group: `${stat.lrg_div_nm} / ${stat.sml_div_nm}`,
    }))
    .slice(0, 500);
}

function getFisisAccounts(listNo) {
  return metadata.fisis.accounts
    .filter((account) => account.list_no === listNo)
    .map((account) => ({
      code: account.account_cd,
      name: account.account_nm,
    }));
}

function getEcosTables(keyword = '') {
  return metadata.ecos.searchableTables
    .filter((table) => !keyword || `${table.STAT_CODE} ${table.STAT_NAME}`.includes(keyword))
    .map((table) => ({
      code: table.STAT_CODE,
      name: table.STAT_NAME,
      cycle: table.CYCLE,
      org: table.ORG_NAME,
    }))
    .slice(0, 400);
}

function getEcosItems(statCode) {
  return metadata.ecos.items
    .filter((item) => item.STAT_CODE === statCode)
    .map((item) => ({
      code: item.ITEM_CODE,
      name: item.ITEM_NAME,
      cycle: item.CYCLE,
      unit: item.UNIT_NAME,
      group: item.GRP_NAME,
    }))
    .slice(0, 800);
}

function getKrxIndices() {
  return metadata.krx.indices.map((item) => ({
    code: item.indexName,
    name: item.indexName,
    group: item.indexClass,
  }));
}

function getIncosDatasets() {
  return [...new Set(dashboardData.series.map((series) => series.datasetName))]
    .map((name) => ({ code: name, name }));
}

function getIncosEntities(datasetName) {
  return [...new Set(dashboardData.series
    .filter((series) => !datasetName || datasetName === 'ALL' || series.datasetName === datasetName)
    .map((series) => series.entity))]
    .map((name) => ({ code: name, name }));
}

function getIncosMetrics(datasetName, entity) {
  return dashboardData.series
    .filter((series) => (!datasetName || datasetName === 'ALL' || series.datasetName === datasetName))
    .filter((series) => (!entity || entity === 'ALL' || series.entity === entity))
    .map((series) => ({
      code: series.key,
      name: series.metricLabel,
      title: series.title,
    }));
}

function getKofiaServices(keyword = '') {
  return metadata.kofia.services
    .filter((service) => !keyword || `${service.serviceId} ${service.title}`.includes(keyword))
    .map((service) => ({
      code: service.serviceId,
      name: service.title,
      group: service.parentDivId,
    }));
}

function dedupeBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    map.set(keyFn(item), item);
  }
  return [...map.values()];
}

async function queryFisis(body) {
  const companies = body.companies ?? [];
  const accounts = body.accounts ?? [];
  const digits = Number(body.precision ?? 2);
  const unitMode = body.unitMode ?? 'raw';
  const rows = [];
  const seriesDefinitions = [];

  for (const company of companies) {
    for (const account of accounts) {
      const url = `${env.FISIS_BASE_URL}/statisticsInfoSearch.json?lang=kr&auth=${encodeURIComponent(env.FISIS_API_KEY)}&financeCd=${encodeURIComponent(company.code)}&listNo=${encodeURIComponent(body.statistic.code)}&accountCd=${encodeURIComponent(account.code)}&term=${encodeURIComponent(body.term)}&startBaseMm=${encodeURIComponent(body.start)}&endBaseMm=${encodeURIComponent(body.end)}`;
      const payload = await fetchJson(url);
      const list = payload?.result?.list ?? [];
      const seriesKey = `${company.code}:${account.code}`;
      seriesDefinitions.push({ key: seriesKey, label: `${company.name} · ${account.name}` });
      for (const item of list) {
        rows.push({
          seriesKey,
          period: formatMonth(item.base_month),
          value: Number(item.a),
        });
      }
    }
  }

  return {
    source: 'FISIS',
    table: buildTable(rows, seriesDefinitions, digits, unitMode),
  };
}

async function queryEcos(body) {
  const items = body.items ?? [];
  const digits = Number(body.precision ?? 2);
  const unitMode = body.unitMode ?? 'raw';
  const rows = [];
  const seriesDefinitions = [];

  for (const item of items) {
    const url = `${env.ECOS_BASE_URL}/${encodeURIComponent(env.ECOS_API_KEY)}/json/kr/1/1000/${encodeURIComponent(body.table.code)}/${encodeURIComponent(body.cycle)}/${encodeURIComponent(body.start)}/${encodeURIComponent(body.end)}/${encodeURIComponent(item.code)}`;
    const payload = await fetchJson(url);
    const list = payload?.StatisticSearch?.row ?? [];
    const seriesKey = `${body.table.code}:${item.code}`;
    seriesDefinitions.push({ key: seriesKey, label: item.name });
    for (const row of list) {
      rows.push({
        seriesKey,
        period: body.cycle === 'D' ? formatDay(row.TIME) : formatMonth(row.TIME),
        value: Number(row.DATA_VALUE),
      });
    }
  }

  return {
    source: 'ECOS',
    table: buildTable(rows, seriesDefinitions, digits, unitMode),
  };
}

async function queryKrx(body) {
  const digits = Number(body.precision ?? 2);
  const unitMode = body.unitMode ?? 'raw';
  const selected = new Set((body.indices ?? []).map((item) => item.code));
  const start = new Date(`${body.start.slice(0, 4)}-${body.start.slice(4, 6)}-${body.start.slice(6, 8)}T00:00:00Z`);
  const end = new Date(`${body.end.slice(0, 4)}-${body.end.slice(4, 6)}-${body.end.slice(6, 8)}T00:00:00Z`);
  const rows = [];
  const seriesDefinitions = [...selected].map((code) => ({ key: code, label: code }));

  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const basDd = `${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, '0')}${String(cursor.getUTCDate()).padStart(2, '0')}`;
    const payload = await fetchJson(`${env.KRX_BASE_URL}?basDd=${basDd}`, {
      headers: { AUTH_KEY: env.KRX_API_KEY },
    }).catch(() => null);
    const list = payload?.OutBlock_1 ?? [];
    for (const item of list) {
      if (!selected.has(item.IDX_NM)) {
        continue;
      }
      rows.push({
        seriesKey: item.IDX_NM,
        period: formatDay(item.BAS_DD),
        value: Number(item.CLSPRC_IDX),
      });
    }
  }

  return {
    source: 'KRX',
    table: buildTable(rows, seriesDefinitions, digits, unitMode),
  };
}

async function queryIncos(body) {
  const digits = Number(body.precision ?? 2);
  const unitMode = body.unitMode ?? 'raw';
  const selected = body.seriesKeys ?? [];
  const chosenSeries = dashboardData.series.filter((series) => selected.includes(series.key));
  const rows = [];
  const seriesDefinitions = chosenSeries.map((series) => ({ key: series.key, label: series.title }));

  for (const series of chosenSeries) {
    for (const point of series.points) {
      if (body.start && point.period < body.start) {
        continue;
      }
      if (body.end && point.period > body.end) {
        continue;
      }
      rows.push({
        seriesKey: series.key,
        period: point.period,
        value: Number(point.value),
      });
    }
  }

  return {
    source: 'INCOS',
    table: buildTable(rows, seriesDefinitions, digits, unitMode),
  };
}

function privateWorkflowDefinition() {
  return {
    sources: [
      {
        id: 'FISIS',
        title: 'FISIS',
        steps: ['industry', 'companies', 'statistics', 'accounts', 'options'],
      },
      {
        id: 'ECOS',
        title: 'ECOS',
        steps: ['table', 'items', 'options'],
      },
      {
        id: 'KRX',
        title: 'KRX',
        steps: ['indices', 'options'],
      },
      {
        id: 'INCOS',
        title: 'INCOS',
        steps: ['dataset', 'entity', 'metrics', 'options'],
      },
      {
        id: 'KOFIA',
        title: 'KOFIA',
        steps: ['serviceCatalog'],
      },
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
    sendJson(response, 200, { ok: true }, {
      'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax`,
    });
    return;
  }

  if (url.pathname === '/api/logout' && request.method === 'POST') {
    const cookies = parseCookies(request.headers.cookie);
    sessions.delete(cookies[SESSION_COOKIE]);
    sendJson(response, 200, { ok: true }, {
      'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`,
    });
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
      const statistic = url.searchParams.get('statistic');
      sendJson(response, 200, {
        industries: getFisisIndustries(),
        companies: getFisisCompanies(industry),
        statistics: getFisisStatistics(industry, url.searchParams.get('keyword') ?? ''),
        accounts: statistic ? getFisisAccounts(statistic) : [],
      });
      return;
    }
    if (source === 'ECOS') {
      const statCode = url.searchParams.get('statCode');
      sendJson(response, 200, {
        tables: getEcosTables(url.searchParams.get('keyword') ?? ''),
        items: statCode ? getEcosItems(statCode) : [],
      });
      return;
    }
    if (source === 'KRX') {
      sendJson(response, 200, { indices: getKrxIndices() });
      return;
    }
    if (source === 'INCOS') {
      const datasetName = url.searchParams.get('dataset') ?? 'ALL';
      const entity = url.searchParams.get('entity') ?? 'ALL';
      sendJson(response, 200, {
        datasets: getIncosDatasets(),
        entities: getIncosEntities(datasetName),
        metrics: getIncosMetrics(datasetName, entity),
      });
      return;
    }
    if (source === 'KOFIA') {
      sendJson(response, 200, {
        services: getKofiaServices(url.searchParams.get('keyword') ?? ''),
        note: 'KOFIA 실데이터 호출은 내부 서비스 분석이 추가로 필요합니다.',
      });
      return;
    }
    notFound(response);
    return;
  }

  if (url.pathname === '/api/query' && request.method === 'POST') {
    const body = JSON.parse(await readBody(request) || '{}');
    try {
      if (body.source === 'FISIS') {
        sendJson(response, 200, await queryFisis(body));
        return;
      }
      if (body.source === 'ECOS') {
        sendJson(response, 200, await queryEcos(body));
        return;
      }
      if (body.source === 'KRX') {
        sendJson(response, 200, await queryKrx(body));
        return;
      }
      if (body.source === 'INCOS') {
        sendJson(response, 200, await queryIncos(body));
        return;
      }
      if (body.source === 'KOFIA') {
        sendJson(response, 501, { error: 'KOFIA live query is not yet wired. Service catalog is available, but the backend data call path still needs reverse engineering.' });
        return;
      }
      notFound(response);
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
    return;
  }

  notFound(response);
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
