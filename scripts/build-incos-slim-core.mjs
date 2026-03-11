import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCE_XML = path.resolve('exports', 'incos-nonlife-monthly-23plus-20260310-193039.xml');
const DB_DIR = path.resolve('exports', 'db');
const CORE_DIR = path.resolve('exports', 'core-db');
const OUTPUT_XLSX = path.resolve('exports', 'incos-slim-core-timeseries-2023-01_2025-11.xlsx');

const CORE_COMPANIES = ['삼성', 'DB', '현대', '메리츠', 'KB', '한화', '롯데', '흥국', '서울보증', '농협', '캐롯'];
const CORE_LINES = ['합계', '장기', '자동차', '화재', '해상', '보증', '기술', '책임', '상해', '종합', '기타특종', '권원', '해외원보험'];
const INDUSTRY_ORDER = ['합계', '일반보험', '장기보험', '자동차보험', '화재', '해상', '보증', '기술', '책임', '상해', '종합', '기타특종', '권원', '해외원보험'];
const LONGTERM_ORDER = [
  '원리금보장형장기손해보험합계',
  '개인보험',
  '보장성보험',
  '저축성보험',
  '단체보험',
  '표준형',
  '무저해지환급형',
  '표준형_질병보험',
  '표준형_상해',
  '표준형_실손의료',
  '표준형_운전자',
  '표준형_어린이',
  '표준형_치매간병',
  '무저해지형_질병보험',
  '무저해지형_상해',
  '무저해지형_어린이',
  '무저해지형_치매간병',
];
const CHANNEL_ORDER = ['전체', '보장성보험'];

const COMPANY_FULL_NAMES = {
  삼성: '삼성화재',
  DB: 'DB손해보험',
  현대: '현대해상',
  메리츠: '메리츠화재',
  KB: 'KB손해보험',
  한화: '한화손해보험',
  롯데: '롯데손해보험',
  흥국: '흥국화재',
  서울보증: '서울보증보험',
  농협: '농협손해보험',
  캐롯: '캐롯손해보험',
};

function parseCsv(text) {
  const rows = [];
  const input = text.replace(/^\uFEFF/, '');
  let current = '';
  let row = [];
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ',') {
      row.push(current);
      current = '';
      continue;
    }
    if (char === '\n') {
      row.push(current.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      current = '';
      continue;
    }
    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current.replace(/\r$/, ''));
    rows.push(row);
  }

  const [header, ...dataRows] = rows.filter((entry) => entry.length > 1 || entry[0] !== '');
  return dataRows.map((cells) => {
    const record = {};
    header.forEach((column, index) => {
      record[column] = cells[index] ?? '';
    });
    return record;
  });
}

async function readCsv(fileName) {
  const text = await fs.readFile(path.join(DB_DIR, fileName), 'utf8');
  return parseCsv(text);
}

function decodeXml(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function parseSpreadsheetMlSheet(xml, prefix) {
  const sheet = [...xml.matchAll(/<Worksheet ss:Name="([^"]+)">([\s\S]*?)<\/Worksheet>/g)]
    .find((entry) => entry[1].startsWith(prefix));
  if (!sheet) {
    throw new Error(`Worksheet not found: ${prefix}`);
  }
  const rows = [...sheet[2].matchAll(/<Row>([\s\S]*?)<\/Row>/g)].map((rowMatch) => {
    return [...rowMatch[1].matchAll(/<Data ss:Type="(?:String|Number)">([\s\S]*?)<\/Data>/g)].map((cell) => decodeXml(cell[1]));
  });
  const [header, ...dataRows] = rows;
  return dataRows.map((cells) => {
    const record = {};
    header.forEach((column, index) => {
      record[column] = cells[index] ?? '';
    });
    return record;
  });
}

function normalizeSpace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function toNumber(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toMonth(value) {
  const text = String(value ?? '');
  if (!/^\d{6}$/.test(text)) {
    return '';
  }
  return `${text.slice(0, 4)}-${text.slice(4, 6)}`;
}

function standardizeName(value) {
  return normalizeSpace(value)
    .normalize('NFKC')
    .replace(/[(){}\[\].,·/*+~!@#$%^&_=:'"?<>|-]/g, ' ')
    .replace(/\s+/g, '')
    .replaceAll('장기간병', '간병');
}

function cleanSegment(segment) {
  return standardizeName(
    normalizeSpace(segment)
      .replace(/^[가-힣]\.\s*/, '')
      .replace(/^[가-힣]\)\s*/, '')
      .replace(/^\d+\)\s*/, '')
      .replace(/^\(\d+\)\s*/, ''),
  );
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function toCsv(rows, columns) {
  return [columns.join(','), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(','))].join('\n');
}

function writeCsvWithBom(filePath, rows) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return fs.writeFile(filePath, `\uFEFF${toCsv(rows, columns)}`, 'utf8');
}

function movingAverage(values, windowSize) {
  const result = [];
  for (let index = 0; index < values.length; index += 1) {
    const start = Math.max(0, index - windowSize + 1);
    const slice = values.slice(start, index + 1).filter((value) => value !== null);
    result.push(slice.length === 0 ? null : slice.reduce((sum, value) => sum + value, 0) / slice.length);
  }
  return result;
}

function safeDivide(numerator, denominator, scale = 1) {
  if (numerator === null || denominator === null || denominator === 0) {
    return null;
  }
  return (numerator / denominator) * scale;
}

function addSeriesMetrics(rows, groupKey, valueKeys) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row[groupKey];
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(row);
  }

  for (const items of grouped.values()) {
    items.sort((left, right) => left.month.localeCompare(right.month));
    for (const valueKey of valueKeys) {
      const series = items.map((item) => item[valueKey]);
      const ma3 = movingAverage(series, 3);
      for (let index = 0; index < items.length; index += 1) {
        const current = series[index];
        const lastYear = index >= 12 ? series[index - 12] : null;
        items[index][`${valueKey}_yoy_calc`] = current === null || lastYear === null ? null : safeDivide(current - lastYear, lastYear);
        items[index][`${valueKey}_ma3`] = ma3[index];
      }
    }
  }
}

function applyMonthlyFlow(rows, groupKey, valueKeys) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row[groupKey];
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(row);
  }

  for (const items of grouped.values()) {
    items.sort((left, right) => left.month.localeCompare(right.month));
    const previousByYear = new Map();
    for (const row of items) {
      const year = row.month.slice(0, 4);
      const previous = previousByYear.get(year);
      for (const key of valueKeys) {
        const current = row[key];
        if (current === null) {
          row[`${key}_flow`] = null;
        } else if (!previous || previous[key] === null || row.month.endsWith('-01')) {
          row[`${key}_flow`] = current;
        } else {
          row[`${key}_flow`] = current - previous[key];
        }
      }
      previousByYear.set(year, row);
    }
  }
}

function buildIndustryCore(lineRows, compareRows) {
  const displayMap = { 자동차: '자동차보험', 장기: '장기보험', 합계: '합계' };
  const selected = lineRows
    .filter((row) => CORE_LINES.includes(row.line_group))
    .map((row) => ({
      month: row.data_month,
      item_name_std: displayMap[row.line_group] ?? row.line_group,
      gross_written_current: toNumber(row.gross_written_current),
      gross_written_yoy_reported_pct: toNumber(row.gross_written_yoy_reported),
      gross_loss_ratio_current: toNumber(row.gross_loss_ratio_current),
      gross_loss_ratio_diff_pp: toNumber(row.gross_loss_ratio_diff),
      gross_loss_ratio_ma3: toNumber(row.gross_loss_ratio_current_ma3),
      retained_premium_current: toNumber(row.retained_premium_current),
      retained_loss_ratio_current: toNumber(row.retained_loss_ratio_current),
    }));

  const generalRows = compareRows.map((row) => ({
    month: row.data_month,
    item_name_std: '일반보험',
    gross_written_current: toNumber(row['일반보험_원수수입보험료']),
    gross_written_yoy_reported_pct: null,
    gross_loss_ratio_current: toNumber(row['일반보험_원수손해율']),
    gross_loss_ratio_diff_pp: null,
    gross_loss_ratio_ma3: null,
    retained_premium_current: null,
    retained_loss_ratio_current: null,
  }));

  const result = [...selected, ...generalRows].sort((left, right) => {
    if (left.month !== right.month) {
      return left.month.localeCompare(right.month);
    }
    return INDUSTRY_ORDER.indexOf(left.item_name_std) - INDUSTRY_ORDER.indexOf(right.item_name_std);
  });
  addSeriesMetrics(result, 'item_name_std', ['gross_written_current', 'gross_loss_ratio_current', 'retained_premium_current', 'retained_loss_ratio_current']);
  return result;
}

function buildLongtermCore(sourceRows) {
  const mapped = [];
  const columnNames = {
    monthly_first_premium: '보험계약 / 월납 / 초회보험료 / 금액',
    monthly_renewal_premium: '보험계약 / 월납 / 계속보험료 / 금액',
    lump_sum_first_premium: '보험계약 / 일시납 / 초회보험료 / 금액',
    total_amount: '합계 / 금액',
  };

  for (const row of sourceRows) {
    const month = toMonth(row.data_year);
    const pathSegments = normalizeSpace(row.item_path).split('>').map((entry) => cleanSegment(entry));
    const last = pathSegments.at(-1);
    let productGroup = null;

    if (pathSegments.length === 1 && last === '원리금보장형장기손해보험합계') productGroup = '원리금보장형장기손해보험합계';
    else if (pathSegments.length === 2 && last === '개인보험') productGroup = '개인보험';
    else if (pathSegments.includes('개인보험') && last === '보장성보험') productGroup = '보장성보험';
    else if (pathSegments.includes('개인보험') && last === '저축성보험') productGroup = '저축성보험';
    else if (pathSegments.length === 2 && last === '단체보험') productGroup = '단체보험';
    else if (pathSegments.includes('보장성보험') && last === '표준형') productGroup = '표준형';
    else if (pathSegments.includes('보장성보험') && last === '무저해지환급형') productGroup = '무저해지환급형';
    else if (pathSegments.includes('표준형') && last === '질병보험') productGroup = '표준형_질병보험';
    else if (pathSegments.includes('표준형') && last === '상해') productGroup = '표준형_상해';
    else if (pathSegments.includes('표준형') && last === '실손의료') productGroup = '표준형_실손의료';
    else if (pathSegments.includes('표준형') && last === '운전자') productGroup = '표준형_운전자';
    else if (pathSegments.includes('표준형') && last === '어린이') productGroup = '표준형_어린이';
    else if (pathSegments.includes('표준형') && last === '치매간병') productGroup = '표준형_치매간병';
    else if (pathSegments.includes('무저해지환급형') && last === '질병보험') productGroup = '무저해지형_질병보험';
    else if (pathSegments.includes('무저해지환급형') && last === '상해') productGroup = '무저해지형_상해';
    else if (pathSegments.includes('무저해지환급형') && last === '어린이') productGroup = '무저해지형_어린이';
    else if (pathSegments.includes('무저해지환급형') && last === '치매간병') productGroup = '무저해지형_치매간병';

    if (!month || !productGroup) {
      continue;
    }

    mapped.push({
      month,
      product_group: productGroup,
      monthly_first_premium: toNumber(row[columnNames.monthly_first_premium]),
      monthly_renewal_premium: toNumber(row[columnNames.monthly_renewal_premium]),
      lump_sum_first_premium: toNumber(row[columnNames.lump_sum_first_premium]),
      total_amount: toNumber(row[columnNames.total_amount]),
    });
  }

  applyMonthlyFlow(mapped, 'product_group', ['monthly_first_premium', 'monthly_renewal_premium', 'lump_sum_first_premium', 'total_amount']);
  addSeriesMetrics(mapped, 'product_group', ['monthly_first_premium_flow', 'monthly_renewal_premium_flow', 'lump_sum_first_premium_flow', 'total_amount_flow']);

  return mapped.map((row) => ({
    month: row.month,
    product_group: row.product_group,
    monthly_first_premium_flow: row.monthly_first_premium_flow,
    monthly_first_premium_yoy: row.monthly_first_premium_flow_yoy_calc,
    monthly_first_premium_ma3: row.monthly_first_premium_flow_ma3,
    monthly_renewal_premium_flow: row.monthly_renewal_premium_flow,
    monthly_renewal_premium_yoy: row.monthly_renewal_premium_flow_yoy_calc,
    monthly_renewal_premium_ma3: row.monthly_renewal_premium_flow_ma3,
    lump_sum_first_premium_flow: row.lump_sum_first_premium_flow,
    lump_sum_first_premium_yoy: row.lump_sum_first_premium_flow_yoy_calc,
    total_amount_flow: row.total_amount_flow,
    total_amount_yoy: row.total_amount_flow_yoy_calc,
    total_amount_ma3: row.total_amount_flow_ma3,
  })).sort((left, right) => {
    if (left.month !== right.month) {
      return left.month.localeCompare(right.month);
    }
    return LONGTERM_ORDER.indexOf(left.product_group) - LONGTERM_ORDER.indexOf(right.product_group);
  });
}

function buildChannelCore(channelRows) {
  return channelRows
    .filter((row) => row.source_sheet === '070b08' && ['전체', '보장성보험'].includes(row.focus_group))
    .map((row) => ({
      month: row.data_month,
      focus_group: row.focus_group,
      전속_monthly_first_premium: toNumber(row['전속_monthly_first_premium']),
      전속_share_pct: toNumber(row['전속_share']),
      전속_yoy: toNumber(row['전속_yoy']),
      GA_대리점_monthly_first_premium: toNumber(row['GA_대리점_monthly_first_premium']),
      GA_대리점_share_pct: toNumber(row['GA_대리점_share']),
      GA_대리점_yoy: toNumber(row['GA_대리점_yoy']),
      방카슈랑스_monthly_first_premium: toNumber(row['방카_monthly_first_premium']),
      방카슈랑스_share_pct: toNumber(row['방카_share']),
      방카슈랑스_yoy: toNumber(row['방카_yoy']),
      CM_온라인_monthly_first_premium: toNumber(row['CM_온라인_monthly_first_premium']),
      CM_온라인_share_pct: toNumber(row['CM_온라인_share']),
      CM_온라인_yoy: toNumber(row['CM_온라인_yoy']),
      기타_monthly_first_premium: toNumber(row['기타_monthly_first_premium']),
      기타_share_pct: toNumber(row['기타_share']),
      기타_yoy: toNumber(row['기타_yoy']),
    }))
    .sort((left, right) => {
      if (left.month !== right.month) {
        return left.month.localeCompare(right.month);
      }
      return CHANNEL_ORDER.indexOf(left.focus_group) - CHANNEL_ORDER.indexOf(right.focus_group);
    });
}

function buildCompanyCore(companyRows) {
  return companyRows
    .filter((row) => CORE_COMPANIES.includes(row.company_group))
    .map((row) => ({
      month: row.data_month,
      company_name_short: row.company_group,
      company_name: COMPANY_FULL_NAMES[row.company_group] ?? row.company_group,
      gross_written_current: toNumber(row.gross_written_current),
      gross_written_yoy_reported_pct: toNumber(row.gross_written_yoy_reported),
      gross_loss_ratio_current: toNumber(row.gross_loss_ratio_current),
      gross_loss_ratio_diff_pp: toNumber(row.gross_loss_ratio_diff),
      gross_loss_ratio_ma3: toNumber(row.gross_loss_ratio_current_ma3),
      retained_premium_current: toNumber(row.retained_premium_current),
      retained_loss_ratio_current: toNumber(row.retained_loss_ratio_current),
      retained_loss_ratio_ma3: toNumber(row.retained_loss_ratio_current_ma3),
    }))
    .sort((left, right) => {
      if (left.month !== right.month) {
        return left.month.localeCompare(right.month);
      }
      return CORE_COMPANIES.indexOf(left.company_name_short) - CORE_COMPANIES.indexOf(right.company_name_short);
    });
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function columnName(index) {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function buildWorksheetXml(sheet) {
  const headerCells = sheet.columns.map((column, index) => {
    const ref = `${columnName(index)}1`;
    return `<c r="${ref}" s="1" t="inlineStr"><is><t>${escapeXml(column)}</t></is></c>`;
  }).join('');
  const rowXml = [`<row r="1">${headerCells}</row>`];

  sheet.rows.forEach((row, rowIndex) => {
    const excelRow = rowIndex + 2;
    const cells = sheet.columns.map((column, index) => {
      const ref = `${columnName(index)}${excelRow}`;
      const value = row[column];
      if (typeof value === 'number') {
        return `<c r="${ref}"><v>${value}</v></c>`;
      }
      if (value === null || value === undefined || value === '') {
        return `<c r="${ref}" t="inlineStr"><is><t></t></is></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join('');
    rowXml.push(`<row r="${excelRow}">${cells}</row>`);
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml.join('')}</sheetData></worksheet>`;
}

function buildWorkbookXml(sheets) {
  const tags = sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${tags}</sheets></workbook>`;
}

function buildWorkbookRelsXml(sheets) {
  const rels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function buildRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Malgun Gothic"/></font><font><b/><sz val="10"/><name val="Malgun Gothic"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function buildContentTypesXml(sheetCount) {
  const overrides = Array.from({ length: sheetCount }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${overrides}</Types>`;
}

function buildCoreXml() {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>INCOS Slim Core Timeseries</dc:title><dc:creator>Codex</dc:creator><cp:lastModifiedBy>Codex</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

function buildAppXml(sheetNames) {
  const titles = sheetNames.map((name) => `<vt:lpstr>${escapeXml(name)}</vt:lpstr>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Codex</Application><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${sheetNames.length}" baseType="lpstr">${titles}</vt:vector></TitlesOfParts></Properties>`;
}

function crc32(buffer) {
  let value = -1;
  for (const byte of buffer) {
    value = (value >>> 8) ^ CRC32_TABLE[(value ^ byte) & 0xFF];
  }
  return (value ^ -1) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = (((year - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0x0F) << 5) | (date.getDate() & 0x1F);
  return { dosTime, dosDate };
}

function makeZip(entries) {
  const localChunks = [];
  const centralChunks = [];
  const now = new Date();
  const { dosTime, dosDate } = dosDateTime(now);
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const checksum = crc32(dataBuffer);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(dataBuffer.length, 18);
    local.writeUInt32LE(dataBuffer.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, nameBuffer, dataBuffer);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(dataBuffer.length, 20);
    central.writeUInt32LE(dataBuffer.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + dataBuffer.length;
  }

  const centralBuffer = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localChunks, centralBuffer, end]);
}

function buildReadmeSheet() {
  return {
    name: 'README',
    rows: [
      { section: 'period', detail: '2023-01 ~ 2025-11' },
      { section: 'purpose', detail: 'slim core tables for non-life initiation report' },
      { section: 'sheets', detail: 'industry_monthly_core, longterm_monthly_core, channel_monthly_core, company_monthly_core' },
      { section: 'excluded', detail: 'industry_profitability, industry_compare, company_compare are kept out of slim workbook' },
      { section: 'null', detail: 'all empty numeric fields are blank cells, not the string null' },
    ],
    columns: ['section', 'detail'],
  };
}

async function main() {
  const xml = await fs.readFile(SOURCE_XML, 'utf8');
  const [
    lineRows,
    compareRows,
    channelRows,
    companyRows,
  ] = await Promise.all([
    readCsv('070b02_line_performance_wide.csv'),
    readCsv('070b02_auto_long_general_compare.csv'),
    readCsv('070b08_channel_first_premium_wide.csv'),
    readCsv('070b03_company_performance_wide.csv'),
  ]);

  const rows070b07 = parseSpreadsheetMlSheet(xml, '070b07');
  const industryCore = buildIndustryCore(lineRows, compareRows);
  const longtermCore = buildLongtermCore(rows070b07);
  const channelCore = buildChannelCore(channelRows);
  const companyCore = buildCompanyCore(companyRows);

  await fs.mkdir(CORE_DIR, { recursive: true });
  await Promise.all([
    writeCsvWithBom(path.join(CORE_DIR, 'industry_monthly_core.csv'), industryCore),
    writeCsvWithBom(path.join(CORE_DIR, 'longterm_monthly_core.csv'), longtermCore),
    writeCsvWithBom(path.join(CORE_DIR, 'channel_monthly_core.csv'), channelCore),
    writeCsvWithBom(path.join(CORE_DIR, 'company_monthly_core.csv'), companyCore),
  ]);

  const sheets = [
    buildReadmeSheet(),
    { name: 'industry_monthly_core', rows: industryCore, columns: Object.keys(industryCore[0] ?? {}) },
    { name: 'longterm_monthly_core', rows: longtermCore, columns: Object.keys(longtermCore[0] ?? {}) },
    { name: 'channel_monthly_core', rows: channelCore, columns: Object.keys(channelCore[0] ?? {}) },
    { name: 'company_monthly_core', rows: companyCore, columns: Object.keys(companyCore[0] ?? {}) },
  ];

  const entries = [
    { name: '[Content_Types].xml', data: buildContentTypesXml(sheets.length) },
    { name: '_rels/.rels', data: buildRootRelsXml() },
    { name: 'docProps/core.xml', data: buildCoreXml() },
    { name: 'docProps/app.xml', data: buildAppXml(sheets.map((sheet) => sheet.name)) },
    { name: 'xl/workbook.xml', data: buildWorkbookXml(sheets) },
    { name: 'xl/_rels/workbook.xml.rels', data: buildWorkbookRelsXml(sheets) },
    { name: 'xl/styles.xml', data: buildStylesXml() },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: buildWorksheetXml(sheet) })),
  ];

  await fs.writeFile(OUTPUT_XLSX, makeZip(entries));
  console.log(`Saved slim CSVs to ${CORE_DIR}`);
  console.log(`Saved workbook: ${OUTPUT_XLSX}`);
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
