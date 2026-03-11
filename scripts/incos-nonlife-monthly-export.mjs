import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BASE_URL = 'https://incos.kidi.or.kr:5443';
const LIST_PATH = '/insMonth/selMonthbookDeList.do';
const OUTPUT_DIR = 'exports';

const NON_LIFE_LINES = [
  { code: '00000', label: '손해보험 합계' },
  { code: '10000', label: '화재' },
  { code: '20000', label: '해상' },
  { code: 'Car', label: '자동차' },
  { code: '30000', label: '보증' },
  { code: '40000', label: '기술' },
  { code: '50000', label: '책임' },
  { code: '60000', label: '상해' },
  { code: '70000', label: '종합' },
  { code: '80000', label: '기타특종' },
  { code: '90000', label: '권원' },
  { code: '100000', label: '해외원보험' },
  { code: '110000', label: '일반보험 계' },
  { code: '120000', label: '장기보험' },
  { code: '130000', label: '개인연금' },
  { code: '140000', label: '퇴직보험' },
  { code: '150000', label: '부수사업' },
  { code: '160000', label: '해외수재보험' },
  { code: '170000', label: '자산연계형' },
  { code: '99999', label: '합계' },
];

const ITEMS = [
  { id: '070b01', title: '계약 및 손해상황표 (년도별)', type: 'generic', gubun: 'N01' },
  { id: '070b02', title: '종목별 실적대비표', type: 'generic', gubun: 'N02' },
  { id: '070b03', title: '회사별 실적대비표', type: 'generic', gubun: 'N03' },
  { id: '070b04', title: '계약 및 손해상황표 (종목별)', type: 'generic', gubun: 'N04' },
  { id: '070b05', title: '계약 및 손해상황표 (회사별)', type: 'generic', gubun: 'N05' },
  { id: '070b06', title: '계약 및 손해상황표 (회사/종목별)', type: 'generic', gubun: 'N06' },
  { id: '070b07', title: '장기보험 원수보험료 현황표', type: 'special', gubun: 'N07', detailPath: '/insMonth/detail/MN07.do' },
  { id: '070b08', title: '모집방법별 초회보험료 명세표 Ⅰ', type: 'special', gubun: 'N08', detailPath: '/insMonth/detail/MN08.do' },
  { id: '070b08_2', title: '모집방법별 초회보험료 명세표 Ⅱ', type: 'special', gubun: 'N08_2', detailPath: '/insMonth/detail/MN08_2.do' },
  { id: '070b09', title: '장기보험 보험금환급금배당금 명세표', type: 'special', gubun: 'N09', detailPath: '/insMonth/detail/MN09.do' },
  { id: '070b10', title: '장기보험계약성적표', type: 'special', gubun: 'N10', detailPath: '/insMonth/detail/MN10.do' },
];

function parseArgs(argv) {
  const args = {
    from: '202301',
    to: null,
    company: 'N00',
    line: '00000',
    items: 'all',
    output: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    switch (current) {
      case '--from':
        args.from = next;
        index += 1;
        break;
      case '--to':
        args.to = next;
        index += 1;
        break;
      case '--company':
        args.company = next;
        index += 1;
        break;
      case '--line':
        args.line = next;
        index += 1;
        break;
      case '--items':
        args.items = next;
        index += 1;
        break;
      case '--output':
        args.output = next;
        index += 1;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        if (current.startsWith('--')) {
          throw new Error(`Unknown option: ${current}`);
        }
        break;
    }
  }

  return args;
}

function printHelp() {
  console.log(`INCOS 손해보험 월보 시계열 수집기

Usage:
  node scripts/incos-nonlife-monthly-export.mjs [options]

Options:
  --from YYYYMM      시작 월. 기본값: 202301
  --to YYYYMM        종료 월. 기본값: 사이트 최신월
  --company CODE     회사 코드. 기본값: N00 (보험회사 합계)
  --line CODE        보험종목 코드. 기본값: 00000 (손해보험 합계)
                     N04(종목별) 통계에만 적용됩니다.
  --items IDS        all 또는 쉼표 구분 통계 ID 목록
                     예: 070b02,070b04,070b07
  --output PATH      출력 파일 경로. 기본값: exports/*.xml
  --help             도움말 출력

예시:
  node scripts/incos-nonlife-monthly-export.mjs --from 202401 --to 202512
  node scripts/incos-nonlife-monthly-export.mjs --items 070b02,070b07 --company N08
  node scripts/incos-nonlife-monthly-export.mjs --items 070b04 --line Car
`);
}

function ensureYYYYMM(value, label) {
  if (!/^\d{6}$/.test(value ?? '')) {
    throw new Error(`${label} must be in YYYYMM format.`);
  }
  const month = Number(value.slice(4, 6));
  if (month < 1 || month > 12) {
    throw new Error(`${label} month must be between 01 and 12.`);
  }
}

function monthRange(start, end) {
  ensureYYYYMM(start, 'from');
  ensureYYYYMM(end, 'to');
  const months = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(4, 6));
  const endYear = Number(end.slice(0, 4));
  const endMonth = Number(end.slice(4, 6));

  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${String(year).padStart(4, '0')}${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function trimHtml(text) {
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeSpace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseScalar(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : '';
  }
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.replace(/\u00a0/g, ' ').trim();
  if (trimmed === '' || trimmed === '-') {
    return '';
  }
  const compact = trimmed.replace(/,/g, '');
  if (/^[+-]?\d+(?:\.\d+)?$/.test(compact)) {
    return Number(compact);
  }
  return trimmed;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function sheetName(label, fallback) {
  const safe = normalizeSpace(label).replace(/[\\/?*:[\]]/g, ' ').slice(0, 31).trim();
  return safe || fallback;
}

function fileTimestamp() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ];
  return parts.join('');
}

function getItemSelection(spec) {
  if (!spec || spec === 'all') {
    return ITEMS;
  }
  const wanted = new Set(spec.split(',').map((entry) => entry.trim()).filter(Boolean));
  const selected = ITEMS.filter((item) => wanted.has(item.id));
  const missing = [...wanted].filter((id) => !selected.some((item) => item.id === id));
  if (missing.length > 0) {
    throw new Error(`Unknown item id(s): ${missing.join(', ')}`);
  }
  return selected;
}

function lineLabel(code) {
  return NON_LIFE_LINES.find((line) => line.code === code)?.label ?? code;
}

function buildHierarchyPath(rows, nameKey, levelKey) {
  const stack = [];
  for (const row of rows) {
    const rawLevel = Number(row[levelKey] ?? 0);
    const level = Number.isFinite(rawLevel) && rawLevel > 0 ? rawLevel : 1;
    const name = normalizeSpace(row[nameKey] ?? '');
    stack[level - 1] = name;
    stack.length = level;
    row.__level = level;
    row.__itemPath = stack.filter(Boolean).join(' > ');
  }
}

function extractGenericColumns(headers) {
  return headers
    .filter((header) => header.small !== 'Class')
    .map((header) => {
      const parts = [header.large, header.middle, header.small]
        .map((value) => normalizeSpace(value))
        .filter((value) => value && value !== 'Class');
      const suffix = normalizeSpace(header.eng);
      if (suffix) {
        parts[parts.length - 1] = `${parts.at(-1)} ${suffix}`.trim();
      }
      return {
        key: header.colid,
        label: parts.join(' / '),
      };
    });
}

function extractSpecialMeta(html, fallbackTitle) {
  const titleMatch = html.match(/<h3 class="topTitle" id="titleBox">([\s\S]*?)<\/h3>/);
  const title = normalizeSpace(trimHtml(titleMatch?.[1] ?? fallbackTitle));

  const queryIds = [...html.matchAll(/queryId:\s*'([^']+)'/g)].map((match) => match[1]);
  const uniqueQueryIds = [...new Set(queryIds)];
  if (uniqueQueryIds.length < 2) {
    throw new Error(`Failed to parse special query ids for ${fallbackTitle}`);
  }
  const [lastYmQueryId] = uniqueQueryIds;
  const listQueryId = uniqueQueryIds.find((queryId) => /List/i.test(queryId));
  if (!listQueryId) {
    throw new Error(`Failed to find list query id for ${fallbackTitle}`);
  }

  const headerBlockMatch = html.match(/InitHeaders\(\s*\[(.*?)\]\s*,/s);
  if (!headerBlockMatch) {
    throw new Error(`Failed to parse grid headers for ${fallbackTitle}`);
  }
  const headerRows = [...headerBlockMatch[1].matchAll(/'Text':'([^']+)'/g)].map((match) => match[1].split('|'));

  const columnsBlockMatch = html.match(/InitColumns\(\s*\[(.*?)\]\s*\);/s);
  if (!columnsBlockMatch) {
    throw new Error(`Failed to parse grid columns for ${fallbackTitle}`);
  }
  const columnNames = [...columnsBlockMatch[1].matchAll(/'SaveName':'([^']+)'/g)].map((match) => match[1]);
  const columns = [];
  for (let index = 0; index < columnNames.length; index += 1) {
    const key = columnNames[index];
    if (key === 'Level') {
      continue;
    }
    const parts = headerRows
      .map((row) => normalizeSpace(row[index] ?? ''))
      .filter((value, partIndex, array) => value && (partIndex === 0 || value !== array[partIndex - 1]));
    columns.push({
      key,
      label: parts.join(' / '),
    });
  }

  return { title, lastYmQueryId, listQueryId, columns };
}

function toWorkbookXml(sheets) {
  const sheetXml = sheets.map((sheet) => {
    const headerCells = sheet.columns
      .map((column) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${xmlEscape(column.label)}</Data></Cell>`)
      .join('');
    const rowsXml = sheet.rows.map((row) => {
      const cells = sheet.columns.map((column) => {
        const value = row[column.key];
        if (typeof value === 'number') {
          return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
        }
        return `<Cell><Data ss:Type="String">${xmlEscape(value ?? '')}</Data></Cell>`;
      }).join('');
      return `<Row>${cells}</Row>`;
    }).join('');

    return `<Worksheet ss:Name="${xmlEscape(sheetName(sheet.name, sheet.fallbackName))}"><Table><Row>${headerCells}</Row>${rowsXml}</Table></Worksheet>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
<Styles>
  <Style ss:ID="Default" ss:Name="Normal">
    <Alignment ss:Vertical="Bottom"/>
    <Borders/>
    <Font ss:FontName="Malgun Gothic" ss:Size="10"/>
    <Interior/>
    <NumberFormat/>
    <Protection/>
  </Style>
  <Style ss:ID="Header">
    <Font ss:Bold="1"/>
    <Interior ss:Color="#D9E2F3" ss:Pattern="Solid"/>
  </Style>
</Styles>
${sheetXml}
</Workbook>`;
}

class IncosSession {
  constructor() {
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  storeCookies(response) {
    const cookieValues = response.headers.getSetCookie?.() ?? [];
    for (const cookieValue of cookieValues) {
      const [pair] = cookieValue.split(';');
      const [key, value] = pair.split('=');
      if (key && value) {
        this.cookies.set(key.trim(), value.trim());
      }
    }
  }

  async request(pathname, options = {}) {
    const url = pathname.startsWith('http') ? pathname : `${BASE_URL}${pathname}`;
    const method = options.method ?? 'GET';
    const form = options.form ?? null;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': options.referer ?? `${BASE_URL}${LIST_PATH}`,
      'Origin': BASE_URL,
      ...options.headers,
    };
    const cookie = this.cookieHeader();
    if (cookie) {
      headers.Cookie = cookie;
    }

    let body;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      body = new URLSearchParams(form).toString();
    }

    const response = await fetch(url, {
      method,
      headers,
      body,
      redirect: 'follow',
    });
    this.storeCookies(response);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status} for ${pathname}: ${text.slice(0, 200)}`);
    }
    return response;
  }

  async text(pathname, options = {}) {
    const response = await this.request(pathname, options);
    const buffer = Buffer.from(await response.arrayBuffer());
    return decodeResponseBody(buffer, response.headers.get('content-type'));
  }

  async json(pathname, options = {}) {
    const response = await this.request(pathname, {
      ...options,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        ...(options.headers ?? {}),
      },
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    return JSON.parse(decodeResponseBody(buffer, response.headers.get('content-type')));
  }
}

function decodeResponseBody(buffer, contentType) {
  const charsetMatch = contentType?.match(/charset=([^;]+)/i);
  const charset = charsetMatch?.[1]?.trim().toLowerCase() ?? 'utf-8';
  const decoder = new TextDecoder(charset);
  return decoder.decode(buffer);
}

async function openListPage(session) {
  await session.text(LIST_PATH, {
    referer: `${BASE_URL}${LIST_PATH}`,
  });
}

async function fetchGenericMeta(session, item) {
  await session.text('/insMonth/selMonthbookDetail.do', {
    method: 'POST',
    form: {
      stati_type: '3',
      comp_ln: '3',
      stati_sheet: 'N01',
      gubun: item.gubun,
      stattbl_id: item.id,
    },
    referer: `${BASE_URL}${LIST_PATH}`,
  });

  const result = await session.json('/insMonth/getInitInfo.do', {
    method: 'POST',
    form: {
      stati_type: '3',
      comp_ln: '3',
      stati_sheet: 'N01',
      gubun: item.gubun,
      data_year: '',
      userId: '',
    },
    referer: `${BASE_URL}/insMonth/selMonthbookDetail.do`,
  });

  const payload = result?.result?.result;
  if (!result?.success || !payload?.init?.last_year) {
    throw new Error(`Failed to load metadata for ${item.id}`);
  }

  const companies = (payload.initlist ?? []).map((entry) => ({
    code: entry.data,
    label: normalizeSpace(entry.label),
  }));

  return {
    title: normalizeSpace(payload.init.title || item.title),
    lastYear: payload.init.last_year,
    columns: extractGenericColumns(payload.headers ?? []),
    companies,
    headers: payload.headers ?? [],
  };
}

async function fetchGenericN60Columns(session) {
  const result = await session.json('/insMonth/getN60InitInfo.do', {
    method: 'POST',
    form: {
      stati_type: '4',
      comp_ln: '3',
      stati_sheet: 'N01',
      gubun: 'N60',
      data_year: '',
      userId: '',
    },
    referer: `${BASE_URL}/insMonth/selMonthbookDetail.do`,
  });
  const payload = result?.result?.result;
  if (!result?.success || !payload?.headers) {
    throw new Error('Failed to load N60 metadata.');
  }
  return extractGenericColumns(payload.headers);
}

async function fetchGenericData(session, item, month, filters, meta, cache) {
  const isN04 = item.gubun === 'N04';
  const isCar = isN04 && filters.line === 'Car';
  const form = {
    stati_type: isCar ? '4' : '3',
    comp_ln: '3',
    stati_sheet: 'N01',
    gubun: isCar ? 'N60' : item.gubun,
    data_year: month,
    comp_type: meta.companies.length > 0 ? filters.company : '',
    userId: '',
  };
  if (isN04) {
    form.line = filters.line;
  }

  const endpoint = isN04 ? '/insMonth/getN04Info.do' : '/insMonth/getN01Info.do';
  const result = await session.json(endpoint, {
    method: 'POST',
    form,
    referer: `${BASE_URL}/insMonth/selMonthbookDetail.do`,
  });
  const rows = result?.result?.result?.l01list ?? [];
  buildHierarchyPath(rows, 'type', 'seq');

  let columns = meta.columns;
  if (isCar) {
    if (!cache.n60Columns) {
      cache.n60Columns = await fetchGenericN60Columns(session);
    }
    columns = cache.n60Columns;
  }

  return {
    rows,
    columns,
    rangeLabel: result?.result?.result?.days
      ? `${result.result.result.days.from_day} ~ ${result.result.result.days.to_day}`
      : '',
  };
}

async function fetchSpecialMeta(session, item) {
  const html = await session.text(item.detailPath, {
    method: 'POST',
    form: {
      stati_type: '3',
      comp_ln: '3',
      stati_sheet: 'N01',
      gubun: item.gubun,
      stattbl_id: item.id,
    },
    referer: `${BASE_URL}${LIST_PATH}`,
  });
  const parsed = extractSpecialMeta(html, item.title);

  const lastYm = await session.json('/insMonth/getQueryResult.do', {
    method: 'POST',
    form: {
      queryId: parsed.lastYmQueryId,
    },
    referer: `${BASE_URL}${item.detailPath}`,
  });

  const companyData = await session.json('/insMonth/getQueryResult.do', {
    method: 'POST',
    form: {
      queryId: 'getNCompanyInfo',
    },
    referer: `${BASE_URL}${item.detailPath}`,
  });

  const lastYear = lastYm?.result?.result?.[0]?.DATA_YEAR;
  if (!lastYear) {
    throw new Error(`Failed to load last year-month for ${item.id}`);
  }

  return {
    ...parsed,
    lastYear,
    companies: (companyData?.result?.result ?? []).map((entry) => ({
      code: entry.DATA,
      label: normalizeSpace(entry.LABEL),
    })),
  };
}

async function fetchSpecialData(session, item, month, filters, meta) {
  const result = await session.json('/insMonth/getQueryResult.do', {
    method: 'POST',
    form: {
      queryId: meta.listQueryId,
      comp_type: filters.company,
      data_year: month,
    },
    referer: `${BASE_URL}${item.detailPath}`,
  });

  const rows = result?.result?.result ?? [];
  buildHierarchyPath(rows, 'ITEM_NM', 'LVL');
  return { rows, columns: meta.columns, rangeLabel: '' };
}

function normalizeRowBundle(item, month, data, filters) {
  return data.rows.map((row) => {
    const base = {
      data_year: month,
      company_code: filters.company,
      company_name: filters.companyName,
      line_code: item.gubun === 'N04' ? filters.line : '',
      line_name: item.gubun === 'N04' ? filters.lineName : '',
      level: row.__level ?? (Number(row.seq ?? row.LVL ?? 1) || 1),
      row_code: row.LINE ?? '',
      item_name: normalizeSpace(row.type ?? row.korname ?? row.ITEM_NM ?? ''),
      item_path: row.__itemPath ?? normalizeSpace(row.type ?? row.korname ?? row.ITEM_NM ?? ''),
    };

    for (const column of data.columns) {
      base[column.label] = parseScalar(row[column.key]);
    }
    return base;
  });
}

function createSheetColumns(rows) {
  const fixed = [
    { key: 'data_year', label: 'data_year' },
    { key: 'company_code', label: 'company_code' },
    { key: 'company_name', label: 'company_name' },
    { key: 'line_code', label: 'line_code' },
    { key: 'line_name', label: 'line_name' },
    { key: 'level', label: 'level' },
    { key: 'row_code', label: 'row_code' },
    { key: 'item_name', label: 'item_name' },
    { key: 'item_path', label: 'item_path' },
  ];

  const metricKeys = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!fixed.some((column) => column.key === key)) {
        metricKeys.add(key);
      }
    }
  }

  return [
    ...fixed,
    ...[...metricKeys].map((key) => ({ key, label: key })),
  ];
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  ensureYYYYMM(args.from, 'from');
  if (args.to) {
    ensureYYYYMM(args.to, 'to');
  }

  const selectedItems = getItemSelection(args.items);
  const filters = {
    company: args.company,
    line: args.line,
    lineName: lineLabel(args.line),
  };

  const session = new IncosSession();
  await openListPage(session);

  const cache = {};
  const summaryRows = [];
  const workbookSheets = [];

  for (const item of selectedItems) {
    console.log(`Collecting ${item.id} ${item.title} ...`);
    const meta = item.type === 'generic'
      ? await fetchGenericMeta(session, item)
      : await fetchSpecialMeta(session, item);

    const companyName = meta.companies.find((entry) => entry.code === filters.company)?.label ?? filters.company;
    const effectiveTo = args.to ?? meta.lastYear;
    const from = args.from > '202301' ? args.from : '202301';
    const to = effectiveTo < from ? from : effectiveTo;
    const months = monthRange(from, to);

    const normalizedRows = [];
    let rangeLabel = '';
    for (const month of months) {
      const data = item.type === 'generic'
        ? await fetchGenericData(session, item, month, { ...filters, companyName }, meta, cache)
        : await fetchSpecialData(session, item, month, { ...filters, companyName }, meta);
      rangeLabel = data.rangeLabel || rangeLabel;
      normalizedRows.push(...normalizeRowBundle(item, month, data, { ...filters, companyName }));
    }

    workbookSheets.push({
      name: `${item.id} ${meta.title}`,
      fallbackName: item.id,
      columns: createSheetColumns(normalizedRows),
      rows: normalizedRows,
    });

    summaryRows.push({
      item_id: item.id,
      title: meta.title,
      kind: item.type,
      from,
      to,
      months: months.length,
      company: companyName,
      line: item.gubun === 'N04' ? filters.lineName : '',
      last_available: meta.lastYear,
      data_rows: normalizedRows.length,
      range_label: rangeLabel,
    });
  }

  const summarySheet = {
    name: 'Summary',
    fallbackName: 'Summary',
    columns: [
      { key: 'item_id', label: 'item_id' },
      { key: 'title', label: 'title' },
      { key: 'kind', label: 'kind' },
      { key: 'from', label: 'from' },
      { key: 'to', label: 'to' },
      { key: 'months', label: 'months' },
      { key: 'company', label: 'company' },
      { key: 'line', label: 'line' },
      { key: 'last_available', label: 'last_available' },
      { key: 'data_rows', label: 'data_rows' },
      { key: 'range_label', label: 'last_range_label' },
    ],
    rows: summaryRows,
  };

  const workbookXml = toWorkbookXml([summarySheet, ...workbookSheets]);
  const outputPath = args.output
    ? path.resolve(args.output)
    : path.resolve(OUTPUT_DIR, `incos-nonlife-monthly-23plus-${fileTimestamp()}.xml`);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, workbookXml, 'utf8');

  console.log(`Saved workbook: ${outputPath}`);
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entryPath) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

export {
  createSheetColumns,
  extractGenericColumns,
  extractSpecialMeta,
  monthRange,
  normalizeRowBundle,
  parseScalar,
  sheetName,
};
