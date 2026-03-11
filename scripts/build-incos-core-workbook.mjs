import fs from 'node:fs/promises';
import path from 'node:path';

const DB_DIR = path.resolve('exports', 'db');
const OUTPUT_PATH = path.resolve('exports', 'incos-core-timeseries-2023-01_2025-11.xlsx');

const COMPANY_NAME_MAP = {
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
  let current = '';
  let row = [];
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');

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

function toNumber(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toCellValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value);
  if (text === '') {
    return '';
  }
  const number = Number(text);
  return Number.isFinite(number) && /^-?\d+(\.\d+)?$/.test(text) ? number : text;
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
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function makeSheet(name, rows, columns) {
  return { name: name.slice(0, 31), rows, columns };
}

function buildWorksheetXml(sheet) {
  const rowsXml = [];
  const headerCells = sheet.columns.map((column, index) => {
    const ref = `${columnName(index)}1`;
    return `<c r="${ref}" s="1" t="inlineStr"><is><t>${escapeXml(column.header)}</t></is></c>`;
  }).join('');
  rowsXml.push(`<row r="1">${headerCells}</row>`);

  sheet.rows.forEach((row, rowIndex) => {
    const excelRowIndex = rowIndex + 2;
    const cells = sheet.columns.map((column, cellIndex) => {
      const ref = `${columnName(cellIndex)}${excelRowIndex}`;
      const value = row[column.key];
      if (typeof value === 'number') {
        return `<c r="${ref}"><v>${value}</v></c>`;
      }
      if (value === '') {
        return `<c r="${ref}" t="inlineStr"><is><t></t></is></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }).join('');
    rowsXml.push(`<row r="${excelRowIndex}">${cells}</row>`);
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${rowsXml.join('')}
  </sheetData>
</worksheet>`;
}

function buildWorkbookXml(sheets) {
  const items = sheets.map((sheet, index) => {
    return `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${items}</sheets>
</workbook>`;
}

function buildWorkbookRelsXml(sheets) {
  const items = sheets.map((_, index) => {
    return `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${items}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="10"/><name val="Malgun Gothic"/></font>
    <font><b/><sz val="10"/><name val="Malgun Gothic"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`;
}

function buildContentTypesXml(sheetCount) {
  const overrides = [];
  for (let index = 0; index < sheetCount; index += 1) {
    overrides.push(`<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${overrides.join('')}
</Types>`;
}

function buildCoreXml() {
  const created = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:dcmitype="http://purl.org/dc/dcmitype/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>INCOS Core Timeseries</dc:title>
  <dc:creator>Codex</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>
</cp:coreProperties>`;
}

function buildAppXml(sheetNames) {
  const titles = sheetNames.map((name) => `<vt:lpstr>${escapeXml(name)}</vt:lpstr>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Codex</Application>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant>
      <vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="${sheetNames.length}" baseType="lpstr">${titles}</vt:vector>
  </TitlesOfParts>
</Properties>`;
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
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;
  const now = new Date();
  const { dosTime, dosDate } = dosDateTime(now);

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const checksum = crc32(dataBuffer);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    chunks.push(localHeader, nameBuffer, dataBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralDirectory.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  }

  const centralDirectoryBuffer = Buffer.concat(centralDirectory);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectoryBuffer.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralDirectoryBuffer, endRecord]);
}

function makeReadmeSheet() {
  const rows = [
    { section: '파일명', detail: path.basename(OUTPUT_PATH) },
    { section: '기간', detail: '2023-01 ~ 2025-11' },
    { section: '구성', detail: 'industry_line_monthly, longterm_product_monthly, channel_newbiz_monthly, company_monthly, industry_profitability, industry_compare, company_compare' },
    { section: '원천', detail: 'INCOS 손해보험 월보 070b02, 070b03, 070b04, 070b07, 070b08, 070b08_2' },
    { section: '주의', detail: '070b07, 070b08 계열은 연내 누적값을 전월 차감해 월 flow로 변환한 값 중심으로 정리함' },
    { section: '주의', detail: '070b04는 현재 추출본 기준 일반보험/장기보험 보강용 시계열만 포함함' },
  ];
  return makeSheet('README', rows, [
    { key: 'section', header: 'section' },
    { key: 'detail', header: 'detail' },
  ]);
}

function buildIndustryLineSheet(lineRows, profitabilityRows) {
  const supportByKey = new Map();
  for (const row of profitabilityRows) {
    supportByKey.set(`${row.data_month}||${row.item_group}`, row);
  }

  const displayRows = lineRows.map((row) => {
    const lineMap = { 자동차: '자동차보험', 장기: '장기보험' };
    const supportName = row.line_group === '장기'
      ? '장기보험'
      : row.line_group === '합계' ? '합계' : row.line_group;
    const support = supportByKey.get(`${row.data_month}||${supportName}`) ?? {};
    return {
      data_month: row.data_month,
      line_group: lineMap[row.line_group] ?? row.line_group,
      item_name: row.item_name,
      item_name_std: row.item_name_std,
      gross_written_current: toNumber(row.gross_written_current),
      gross_written_prev_year: toNumber(row.gross_written_prev_year),
      gross_written_yoy_reported: toNumber(row.gross_written_yoy_reported),
      gross_loss_ratio_current: toNumber(row.gross_loss_ratio_current),
      gross_loss_ratio_prev_year: toNumber(row.gross_loss_ratio_prev_year),
      gross_loss_ratio_diff: toNumber(row.gross_loss_ratio_diff),
      retained_premium_current: toNumber(row.retained_premium_current),
      retained_loss_ratio_current: toNumber(row.retained_loss_ratio_current),
      gross_written_current_yoy: toNumber(row.gross_written_current_yoy),
      gross_loss_ratio_current_ma3: toNumber(row.gross_loss_ratio_current_ma3),
      earned_premium_flow: toNumber(support.earned_premium_flow),
      incurred_losses_flow: toNumber(support.incurred_losses_flow),
      loss_ratio_reported_support: toNumber(support.loss_ratio_reported),
      incurred_over_earned: toNumber(support.incurred_over_earned),
      loss_ratio_bridge: toNumber(support.loss_ratio_bridge),
    };
  });

  return makeSheet('industry_line_monthly', displayRows, [
    { key: 'data_month', header: 'month' },
    { key: 'line_group', header: 'line_group' },
    { key: 'item_name', header: 'item_name' },
    { key: 'item_name_std', header: 'item_name_std' },
    { key: 'gross_written_current', header: 'gross_written_current' },
    { key: 'gross_written_prev_year', header: 'gross_written_prev_year' },
    { key: 'gross_written_yoy_reported', header: 'gross_written_yoy_reported_pct' },
    { key: 'gross_written_current_yoy', header: 'gross_written_calc_yoy' },
    { key: 'gross_loss_ratio_current', header: 'gross_loss_ratio_current' },
    { key: 'gross_loss_ratio_prev_year', header: 'gross_loss_ratio_prev_year' },
    { key: 'gross_loss_ratio_diff', header: 'gross_loss_ratio_diff_pp' },
    { key: 'gross_loss_ratio_current_ma3', header: 'gross_loss_ratio_ma3' },
    { key: 'retained_premium_current', header: 'retained_premium_current' },
    { key: 'retained_loss_ratio_current', header: 'retained_loss_ratio_current' },
    { key: 'earned_premium_flow', header: 'earned_premium_flow_070b04' },
    { key: 'incurred_losses_flow', header: 'incurred_losses_flow_070b04' },
    { key: 'loss_ratio_reported_support', header: 'loss_ratio_070b04' },
    { key: 'incurred_over_earned', header: 'incurred_over_earned_pct' },
    { key: 'loss_ratio_bridge', header: 'loss_ratio_bridge_pct' },
  ]);
}

function buildLongtermSheet(rows) {
  const displayRows = rows.map((row) => ({
    data_month: row.data_month,
    item_group: row.item_group,
    item_name: row.item_name,
    item_name_std: row.item_name_std,
    item_path: row.item_path,
    monthly_first_premium: toNumber(row.monthly_first_amount_flow),
    monthly_first_premium_yoy: toNumber(row.monthly_first_amount_flow_yoy),
    monthly_first_premium_ma3: toNumber(row.monthly_first_amount_flow_ma3),
    monthly_renewal_premium: toNumber(row.monthly_renewal_amount_flow),
    monthly_renewal_premium_yoy: toNumber(row.monthly_renewal_amount_flow_yoy),
    monthly_renewal_premium_ma3: toNumber(row.monthly_renewal_amount_flow_ma3),
    lump_sum_first_premium: toNumber(row.lump_sum_first_amount_flow),
    lump_sum_first_premium_yoy: toNumber(row.lump_sum_first_amount_flow_yoy),
    total_amount: toNumber(row.total_amount_flow),
    total_amount_yoy: toNumber(row.total_amount_flow_yoy),
    total_amount_ma3: toNumber(row.total_amount_flow_ma3),
    share_protection_of_personal: toNumber(row.share_protection_of_personal),
    share_low_surrender_of_protection: toNumber(row.share_low_surrender_of_protection),
  }));

  return makeSheet('longterm_product_monthly', displayRows, [
    { key: 'data_month', header: 'month' },
    { key: 'item_group', header: 'product_group' },
    { key: 'item_name', header: 'item_name' },
    { key: 'item_name_std', header: 'item_name_std' },
    { key: 'item_path', header: 'item_path' },
    { key: 'monthly_first_premium', header: 'monthly_first_premium_flow' },
    { key: 'monthly_first_premium_yoy', header: 'monthly_first_premium_yoy' },
    { key: 'monthly_first_premium_ma3', header: 'monthly_first_premium_ma3' },
    { key: 'monthly_renewal_premium', header: 'monthly_renewal_premium_flow' },
    { key: 'monthly_renewal_premium_yoy', header: 'monthly_renewal_premium_yoy' },
    { key: 'monthly_renewal_premium_ma3', header: 'monthly_renewal_premium_ma3' },
    { key: 'lump_sum_first_premium', header: 'lump_sum_first_premium_flow' },
    { key: 'lump_sum_first_premium_yoy', header: 'lump_sum_first_premium_yoy' },
    { key: 'total_amount', header: 'total_amount_flow' },
    { key: 'total_amount_yoy', header: 'total_amount_yoy' },
    { key: 'total_amount_ma3', header: 'total_amount_ma3' },
    { key: 'share_protection_of_personal', header: 'share_protection_of_personal_pct' },
    { key: 'share_low_surrender_of_protection', header: 'share_low_surrender_of_protection_pct' },
  ]);
}

function buildChannelSheet(rows) {
  const typeMap = {
    '070b08': '보험계약',
    '070b08_2': '투자계약',
  };
  const displayRows = rows.map((row) => ({
    contract_type: typeMap[row.source_sheet] ?? row.source_sheet,
    focus_group: row.focus_group,
    data_month: row.data_month,
    direct_amount: toNumber(row['전속_monthly_first_premium']),
    direct_share: toNumber(row['전속_share']),
    direct_yoy: toNumber(row['전속_yoy']),
    ga_amount: toNumber(row['GA_대리점_monthly_first_premium']),
    ga_share: toNumber(row['GA_대리점_share']),
    ga_yoy: toNumber(row['GA_대리점_yoy']),
    banca_amount: toNumber(row['방카_monthly_first_premium']),
    banca_share: toNumber(row['방카_share']),
    banca_yoy: toNumber(row['방카_yoy']),
    cm_amount: toNumber(row['CM_온라인_monthly_first_premium']),
    cm_share: toNumber(row['CM_온라인_share']),
    cm_yoy: toNumber(row['CM_온라인_yoy']),
    other_amount: toNumber(row['기타_monthly_first_premium']),
    other_share: toNumber(row['기타_share']),
    other_yoy: toNumber(row['기타_yoy']),
  }));

  return makeSheet('channel_newbiz_monthly', displayRows, [
    { key: 'contract_type', header: 'contract_type' },
    { key: 'focus_group', header: 'focus_group' },
    { key: 'data_month', header: 'month' },
    { key: 'direct_amount', header: '전속_monthly_first_premium' },
    { key: 'direct_share', header: '전속_share_pct' },
    { key: 'direct_yoy', header: '전속_yoy' },
    { key: 'ga_amount', header: 'GA_대리점_monthly_first_premium' },
    { key: 'ga_share', header: 'GA_대리점_share_pct' },
    { key: 'ga_yoy', header: 'GA_대리점_yoy' },
    { key: 'banca_amount', header: '방카슈랑스_monthly_first_premium' },
    { key: 'banca_share', header: '방카슈랑스_share_pct' },
    { key: 'banca_yoy', header: '방카슈랑스_yoy' },
    { key: 'cm_amount', header: 'CM_온라인_monthly_first_premium' },
    { key: 'cm_share', header: 'CM_온라인_share_pct' },
    { key: 'cm_yoy', header: 'CM_온라인_yoy' },
    { key: 'other_amount', header: '기타_monthly_first_premium' },
    { key: 'other_share', header: '기타_share_pct' },
    { key: 'other_yoy', header: '기타_yoy' },
  ]);
}

function buildCompanySheet(rows) {
  const displayRows = rows.map((row) => ({
    data_month: row.data_month,
    company_name: COMPANY_NAME_MAP[row.company_group] ?? row.company_group,
    company_name_short: row.company_group,
    company_name_std: row.company_group_std,
    gross_written_current: toNumber(row.gross_written_current),
    gross_written_yoy_reported: toNumber(row.gross_written_yoy_reported),
    gross_written_current_yoy: toNumber(row.gross_written_current_yoy),
    gross_loss_ratio_current: toNumber(row.gross_loss_ratio_current),
    gross_loss_ratio_diff: toNumber(row.gross_loss_ratio_diff),
    gross_loss_ratio_ma3: toNumber(row.gross_loss_ratio_current_ma3),
    retained_premium_current: toNumber(row.retained_premium_current),
    retained_loss_ratio_current: toNumber(row.retained_loss_ratio_current),
    retained_loss_ratio_ma3: toNumber(row.retained_loss_ratio_current_ma3),
  }));

  return makeSheet('company_monthly', displayRows, [
    { key: 'data_month', header: 'month' },
    { key: 'company_name', header: 'company_name' },
    { key: 'company_name_short', header: 'company_name_short' },
    { key: 'company_name_std', header: 'company_name_std' },
    { key: 'gross_written_current', header: 'gross_written_current' },
    { key: 'gross_written_yoy_reported', header: 'gross_written_yoy_reported_pct' },
    { key: 'gross_written_current_yoy', header: 'gross_written_calc_yoy' },
    { key: 'gross_loss_ratio_current', header: 'gross_loss_ratio_current' },
    { key: 'gross_loss_ratio_diff', header: 'gross_loss_ratio_diff_pp' },
    { key: 'gross_loss_ratio_ma3', header: 'gross_loss_ratio_ma3' },
    { key: 'retained_premium_current', header: 'retained_premium_current' },
    { key: 'retained_loss_ratio_current', header: 'retained_loss_ratio_current' },
    { key: 'retained_loss_ratio_ma3', header: 'retained_loss_ratio_ma3' },
  ]);
}

function buildProfitabilitySheet(rows) {
  const displayRows = rows.map((row) => ({
    data_month: row.data_month,
    item_group: row.item_group,
    item_group_std: row.item_group_std,
    written_premium_flow: toNumber(row.written_premium_flow),
    earned_premium_flow: toNumber(row.earned_premium_flow),
    incurred_losses_flow: toNumber(row.incurred_losses_flow),
    incurred_over_earned: toNumber(row.incurred_over_earned),
    loss_ratio_reported: toNumber(row.loss_ratio_reported),
    loss_ratio_bridge: toNumber(row.loss_ratio_bridge),
  }));
  return makeSheet('industry_profitability', displayRows, [
    { key: 'data_month', header: 'month' },
    { key: 'item_group', header: 'item_group' },
    { key: 'item_group_std', header: 'item_group_std' },
    { key: 'written_premium_flow', header: 'written_premium_flow' },
    { key: 'earned_premium_flow', header: 'earned_premium_flow' },
    { key: 'incurred_losses_flow', header: 'incurred_losses_flow' },
    { key: 'incurred_over_earned', header: 'incurred_over_earned_pct' },
    { key: 'loss_ratio_reported', header: 'loss_ratio_reported' },
    { key: 'loss_ratio_bridge', header: 'loss_ratio_bridge_pct' },
  ]);
}

function buildSimpleSheet(name, rows) {
  const columns = Object.keys(rows[0] ?? {}).map((key) => ({ key, header: key }));
  return makeSheet(name, rows.map((row) => {
    const normalized = {};
    columns.forEach((column) => {
      normalized[column.key] = toCellValue(row[column.key]);
    });
    return normalized;
  }), columns);
}

async function main() {
  const [
    lineRows,
    companyRows,
    profitabilityRows,
    longtermRows,
    channelRows,
    industryCompareRows,
    companyCompareRows,
  ] = await Promise.all([
    readCsv('070b02_line_performance_wide.csv'),
    readCsv('070b03_company_performance_wide.csv'),
    readCsv('070b04_profitability_check.csv'),
    readCsv('070b07_long_term_premium_wide.csv'),
    readCsv('070b08_channel_first_premium_wide.csv'),
    readCsv('070b02_auto_long_general_compare.csv'),
    readCsv('070b03_large_vs_other_compare.csv'),
  ]);

  const sheets = [
    makeReadmeSheet(),
    buildIndustryLineSheet(lineRows, profitabilityRows),
    buildLongtermSheet(longtermRows),
    buildChannelSheet(channelRows),
    buildCompanySheet(companyRows),
    buildProfitabilitySheet(profitabilityRows),
    buildSimpleSheet('industry_compare', industryCompareRows),
    buildSimpleSheet('company_compare', companyCompareRows),
  ];

  const entries = [
    { name: '[Content_Types].xml', data: buildContentTypesXml(sheets.length) },
    { name: '_rels/.rels', data: buildRootRelsXml() },
    { name: 'docProps/core.xml', data: buildCoreXml() },
    { name: 'docProps/app.xml', data: buildAppXml(sheets.map((sheet) => sheet.name)) },
    { name: 'xl/workbook.xml', data: buildWorkbookXml(sheets) },
    { name: 'xl/_rels/workbook.xml.rels', data: buildWorkbookRelsXml(sheets) },
    { name: 'xl/styles.xml', data: buildStylesXml() },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: buildWorksheetXml(sheet),
    })),
  ];

  const xlsxBuffer = makeZip(entries);
  await fs.writeFile(OUTPUT_PATH, xlsxBuffer);
  console.log(`Saved workbook: ${OUTPUT_PATH}`);
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
