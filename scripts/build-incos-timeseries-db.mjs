import fs from 'node:fs/promises';
import path from 'node:path';

const SOURCE_FILE = path.resolve('exports', 'incos-nonlife-monthly-23plus-20260310-193039.xml');
const OUTPUT_DIR = path.resolve('exports', 'db');

const SHEET_PREFIXES = {
  S070B02: '070b02',
  S070B03: '070b03',
  S070B04: '070b04',
  S070B07: '070b07',
  S070B08: '070b08 모집방법별 초회보험료 명세표 Ⅰ',
  S070B08_2: '070b08_2',
};

const RANGE_START = '2023-01';
const RANGE_END = '2025-11';

function decodeXml(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function normalizeSpace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function standardizeName(value) {
  return normalizeSpace(value)
    .normalize('NFKC')
    .replace(/[(){}\[\].,·/*+~!@#$%^&_=:'"?<>|-]/g, ' ')
    .replace(/\s+/g, '')
    .replaceAll('가', '')
    .replaceAll('나', '')
    .replaceAll('다', '')
    .replaceAll('라', '')
    .replaceAll('마', '');
}

function toMonth(value) {
  const text = String(value ?? '');
  if (!/^\d{6}$/.test(text)) {
    return '';
  }
  return `${text.slice(0, 4)}-${text.slice(4, 6)}`;
}

function toYear(value) {
  return String(value ?? '').slice(0, 4);
}

function parseNumber(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const text = String(value).replace(/,/g, '').trim();
  if (text === '') {
    return null;
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
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
  const header = columns.join(',');
  const lines = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(','));
  return [header, ...lines].join('\n');
}

function writeUtf8BomFile(filePath, text) {
  return fs.writeFile(filePath, `\uFEFF${text}`, 'utf8');
}

function monthSort(a, b) {
  return a.localeCompare(b);
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

function applyMonthlyFlow(rows, groupKeys, valueKeys) {
  const grouped = new Map();
  for (const row of rows) {
    const key = groupKeys.map((groupKey) => row[groupKey]).join('||');
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(row);
  }

  for (const items of grouped.values()) {
    items.sort((left, right) => left.data_month.localeCompare(right.data_month));
    let previousByYear = new Map();
    for (const row of items) {
      const year = row.data_month.slice(0, 4);
      const previous = previousByYear.get(year);
      for (const key of valueKeys) {
        const current = row[key];
        const flowKey = `${key}_flow`;
        if (current === null) {
          row[flowKey] = null;
        } else if (!previous || previous[key] === null || row.data_month.endsWith('-01')) {
          row[flowKey] = current;
        } else {
          row[flowKey] = current - previous[key];
        }
      }
      previousByYear.set(year, row);
    }
  }
}

function addSeriesMetrics(rows, groupKeys, valueKeys) {
  const grouped = new Map();
  for (const row of rows) {
    const key = groupKeys.map((groupKey) => row[groupKey]).join('||');
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(row);
  }

  for (const items of grouped.values()) {
    items.sort((left, right) => left.data_month.localeCompare(right.data_month));
    for (const valueKey of valueKeys) {
      const series = items.map((item) => item[valueKey]);
      const ma3 = movingAverage(series, 3);
      for (let index = 0; index < items.length; index += 1) {
        const current = series[index];
        const previous = index > 0 ? series[index - 1] : null;
        const lastYear = index >= 12 ? series[index - 12] : null;
        items[index][`${valueKey}_mom`] = safeDivide(current - previous, previous);
        items[index][`${valueKey}_yoy`] = safeDivide(current - lastYear, lastYear);
        items[index][`${valueKey}_ma3`] = ma3[index];
      }
    }
  }
}

function pickSheet(xml, prefix) {
  const match = [...xml.matchAll(/<Worksheet ss:Name="([^"]+)">([\s\S]*?)<\/Worksheet>/g)]
    .find((entry) => entry[1].startsWith(prefix));
  if (!match) {
    throw new Error(`Worksheet not found for prefix: ${prefix}`);
  }
  return { name: match[1], body: match[2] };
}

function parseSheet(xml, prefix) {
  const sheet = pickSheet(xml, prefix);
  const rows = [...sheet.body.matchAll(/<Row>([\s\S]*?)<\/Row>/g)].map((rowMatch) => {
    return [...rowMatch[1].matchAll(/<Data ss:Type="(?:String|Number)">([\s\S]*?)<\/Data>/g)]
      .map((cell) => decodeXml(cell[1]));
  });
  const [header, ...dataRows] = rows;
  return dataRows.map((cells) => {
    const record = {};
    header.forEach((column, index) => {
      record[column] = cells[index] ?? '';
    });
    record.sheet_name = sheet.name;
    record.data_month = toMonth(record.data_year);
    record.year = toYear(record.data_year);
    record.company_name_std = standardizeName(record.company_name);
    record.line_name_std = standardizeName(record.line_name);
    record.item_name_std = standardizeName(record.item_name);
    record.item_path_std = standardizeName(record.item_path);
    return record;
  }).filter((record) => record.data_month >= RANGE_START && record.data_month <= RANGE_END);
}

function writeDataset(baseName, wideRows, longRows) {
  const wideColumns = [...new Set(wideRows.flatMap((row) => Object.keys(row)))];
  const longColumns = [...new Set(longRows.flatMap((row) => Object.keys(row)))];
  return Promise.all([
    writeUtf8BomFile(path.join(OUTPUT_DIR, `${baseName}_wide.csv`), toCsv(wideRows, wideColumns)),
    writeUtf8BomFile(path.join(OUTPUT_DIR, `${baseName}_long.csv`), toCsv(longRows, longColumns)),
  ]);
}

function melt(rows, idKeys, valueKeys, extraFields = []) {
  const longRows = [];
  for (const row of rows) {
    for (const valueKey of valueKeys) {
      longRows.push({
        ...Object.fromEntries(idKeys.map((key) => [key, row[key]])),
        metric: valueKey,
        value: row[valueKey],
        ...Object.fromEntries(extraFields.map((key) => [key, row[key]])),
      });
    }
  }
  return longRows;
}

function process070b07(rows) {
  const columnMap = {
    lump_sum_first_amount: '보험계약 / 일시납 / 초회보험료 / 금액',
    monthly_first_amount: '보험계약 / 월납 / 초회보험료 / 금액',
    monthly_renewal_amount: '보험계약 / 월납 / 계속보험료 / 금액',
    total_amount: '합계 / 금액',
  };

  const selectors = [
    { item_group: '원리금보장형장기손해보험합계', match: (row) => row.item_path_std === '원리금보장형장기손해보험합계' },
    { item_group: '개인보험', match: (row) => row.item_path_std.endsWith('개인보험') && row.level === '2' },
    { item_group: '보장성보험', match: (row) => row.item_path_std.endsWith('보장성보험') && row.item_path_std.includes('개인보험') },
    { item_group: '저축성보험', match: (row) => row.item_path_std.endsWith('저축성보험') && row.item_path_std.includes('개인보험') },
    { item_group: '단체보험', match: (row) => row.item_path_std.endsWith('단체보험') },
    { item_group: '표준형', match: (row) => row.item_path_std.endsWith('표준형') && row.item_path_std.includes('보장성보험') },
    { item_group: '무저해지환급형', match: (row) => row.item_path_std.includes('무저해지환급형') && !row.item_path_std.endsWith('질병보험') && row.level === '4' },
    { item_group: '표준형_질병보험', match: (row) => row.item_path_std.endsWith('질병보험') && row.item_path_std.includes('표준형') },
    { item_group: '표준형_상해', match: (row) => row.item_path_std.endsWith('상해') && row.item_path_std.includes('표준형') },
    { item_group: '표준형_실손의료', match: (row) => row.item_path_std.endsWith('실손의료') && row.item_path_std.includes('표준형') },
    { item_group: '표준형_운전자', match: (row) => row.item_path_std.endsWith('운전자') && row.item_path_std.includes('표준형') },
    { item_group: '표준형_어린이', match: (row) => row.item_path_std.endsWith('어린이') && row.item_path_std.includes('표준형') },
    { item_group: '표준형_치매장기간병', match: (row) => row.item_path_std.endsWith('치매장기간병') && row.item_path_std.includes('표준형') },
    { item_group: '표준형_재물', match: (row) => row.item_path_std.endsWith('재물') && row.item_path_std.includes('표준형') },
    { item_group: '표준형_통합', match: (row) => row.item_path_std.endsWith('통합') && row.item_path_std.includes('표준형') },
    { item_group: '무저해지형_질병보험', match: (row) => row.item_path_std.endsWith('질병보험') && row.item_path_std.includes('무저해지환급형') },
    { item_group: '무저해지형_상해', match: (row) => row.item_path_std.endsWith('상해') && row.item_path_std.includes('무저해지환급형') },
    { item_group: '무저해지형_어린이', match: (row) => row.item_path_std.endsWith('어린이') && row.item_path_std.includes('무저해지환급형') },
    { item_group: '무저해지형_치매장기간병', match: (row) => row.item_path_std.endsWith('치매장기간병') && row.item_path_std.includes('무저해지환급형') },
  ];

  const selected = [];
  for (const row of rows) {
    const selector = selectors.find((entry) => entry.match(row));
    if (!selector) {
      continue;
    }
    selected.push({
      data_month: row.data_month,
      item_group: selector.item_group,
      item_name: row.item_name,
      item_name_std: row.item_name_std,
      item_path: row.item_path,
      item_path_std: row.item_path_std,
      monthly_first_amount: parseNumber(row[columnMap.monthly_first_amount]),
      monthly_renewal_amount: parseNumber(row[columnMap.monthly_renewal_amount]),
      lump_sum_first_amount: parseNumber(row[columnMap.lump_sum_first_amount]),
      total_amount: parseNumber(row[columnMap.total_amount]),
    });
  }

  applyMonthlyFlow(selected, ['item_group'], ['monthly_first_amount', 'monthly_renewal_amount', 'lump_sum_first_amount', 'total_amount']);
  addSeriesMetrics(selected, ['item_group'], ['monthly_first_amount_flow', 'monthly_renewal_amount_flow', 'lump_sum_first_amount_flow', 'total_amount_flow']);

  const byMonth = new Map();
  for (const row of selected) {
    if (!byMonth.has(row.data_month)) {
      byMonth.set(row.data_month, {});
    }
    byMonth.get(row.data_month)[row.item_group] = row;
  }

  for (const row of selected) {
    const month = byMonth.get(row.data_month);
    row.share_protection_of_personal = safeDivide(
      month['보장성보험']?.total_amount_flow ?? null,
      month['개인보험']?.total_amount_flow ?? null,
      100,
    );
    row.share_low_surrender_of_protection = safeDivide(
      month['무저해지환급형']?.total_amount_flow ?? null,
      month['보장성보험']?.total_amount_flow ?? null,
      100,
    );
  }

  const longRows = melt(
    selected,
    ['data_month', 'item_group', 'item_name', 'item_path', 'item_name_std', 'item_path_std'],
    [
      'monthly_first_amount_flow',
      'monthly_renewal_amount_flow',
      'lump_sum_first_amount_flow',
      'total_amount_flow',
      'monthly_first_amount_flow_yoy',
      'monthly_renewal_amount_flow_yoy',
      'lump_sum_first_amount_flow_yoy',
      'total_amount_flow_yoy',
      'monthly_first_amount_flow_ma3',
      'monthly_renewal_amount_flow_ma3',
      'lump_sum_first_amount_flow_ma3',
      'total_amount_flow_ma3',
      'share_protection_of_personal',
      'share_low_surrender_of_protection',
    ],
  );

  return { wide: selected, long: longRows };
}

function classifyChannel(columnName) {
  if (columnName.includes('/ C/M /') || columnName.endsWith('/ 홈쇼핑')) {
    return 'CM/온라인';
  }
  if (columnName.endsWith('/ 금융기관보험대리점')) {
    return '방카';
  }
  if (columnName.endsWith('/ 중개사') || columnName.endsWith('/ 대리점')) {
    return 'GA/대리점';
  }
  if (columnName.endsWith('/ 설계사')) {
    return '전속';
  }
  return '기타';
}

function process070b08Family(rows08, rows082) {
  const focusRules = [
    { focus_group: '전체', match: (row) => row.item_path_std === '원리금보장형장기손해보험합계' || row.item_path_std === '합계' },
    { focus_group: '보장성보험', match: (row) => row.item_path_std.endsWith('보장성보험') || row.item_path_std.endsWith('보장성') },
    { focus_group: '질병보험', match: (row) => row.item_path_std.endsWith('질병보험') },
    { focus_group: '상해', match: (row) => row.item_path_std.endsWith('상해') },
  ];

  const buildChannelRows = (rows, sourceLabel, valueColumns) => {
    const channelRows = [];
    for (const row of rows) {
      const focusRule = focusRules.find((entry) => entry.match(row));
      if (!focusRule) {
        continue;
      }
      const buckets = new Map();
      for (const column of valueColumns) {
        const amount = parseNumber(row[column]);
        const bucket = classifyChannel(column);
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + (amount ?? 0));
      }
      const total = [...buckets.values()].reduce((sum, value) => sum + value, 0);
      for (const [channel_group, value] of buckets.entries()) {
        channelRows.push({
          source_sheet: sourceLabel,
          data_month: row.data_month,
          focus_group: focusRule.focus_group,
          item_name: row.item_name,
          item_path: row.item_path,
          item_name_std: row.item_name_std,
          item_path_std: row.item_path_std,
          channel_group,
          monthly_first_premium: value,
          channel_share: safeDivide(value, total, 100),
        });
      }
    }
    return channelRows;
  };

  const valueColumns08 = Object.keys(rows08[0]).filter((column) => column.startsWith('보험계약 / 초회보험료 /') && column !== '합계');
  const valueColumns082 = Object.keys(rows082[0]).filter((column) => column.startsWith('투자계약 / 초회보험료 /') && column !== '합계');
  const combined = [
    ...buildChannelRows(rows08, '070b08', valueColumns08),
    ...buildChannelRows(rows082, '070b08_2', valueColumns082),
  ];

  applyMonthlyFlow(combined, ['source_sheet', 'focus_group', 'channel_group'], ['monthly_first_premium']);
  addSeriesMetrics(combined, ['source_sheet', 'focus_group', 'channel_group'], ['monthly_first_premium_flow']);

  const wideRows = [];
  const grouped = new Map();
  for (const row of combined) {
    const key = `${row.source_sheet}||${row.focus_group}||${row.data_month}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        source_sheet: row.source_sheet,
        focus_group: row.focus_group,
        data_month: row.data_month,
      });
    }
    const target = grouped.get(key);
    const slug = row.channel_group.replace('/', '_');
    target[`${slug}_monthly_first_premium`] = row.monthly_first_premium_flow;
    target[`${slug}_share`] = row.channel_share;
    target[`${slug}_yoy`] = row.monthly_first_premium_flow_yoy;
  }
  wideRows.push(...grouped.values());

  const longRows = melt(
    combined,
    ['source_sheet', 'data_month', 'focus_group', 'channel_group', 'item_name', 'item_path', 'item_name_std', 'item_path_std'],
    ['monthly_first_premium_flow', 'channel_share', 'monthly_first_premium_flow_yoy'],
  );

  return { wide: wideRows, long: longRows };
}

function process070b02(rows) {
  const targets = new Map([
    ['합계', '합계'],
    ['장기', '장기'],
    ['자동차', '자동차'],
    ['화재', '화재'],
    ['해상', '해상'],
    ['보증', '보증'],
    ['기술', '기술'],
    ['책임', '책임'],
    ['상해', '상해'],
    ['종합', '종합'],
    ['기타특종', '기타특종'],
    ['권원', '권원'],
    ['해외원보험', '해외원보험'],
  ]);

  const selected = rows
    .map((row) => ({
      data_month: row.data_month,
      line_group: targets.get(row.item_name_std),
      item_name: row.item_name,
      item_name_std: row.item_name_std,
      gross_written_current: parseNumber(row['원수 / 수입보험료 / 당월']),
      gross_written_prev_year: parseNumber(row['원수 / 수입보험료 / 전년동월']),
      gross_written_yoy_reported: parseNumber(row['원수 / 수입보험료 / 대비 (%)']),
      gross_loss_ratio_current: parseNumber(row['원수 / 손해율 / 당월 (%)']),
      gross_loss_ratio_prev_year: parseNumber(row['원수 / 손해율 / 전년동월 (%)']),
      gross_loss_ratio_diff: parseNumber(row['원수 / 손해율 / 대비 (%p)']),
      retained_premium_current: parseNumber(row['보유 / 보유보험료 / 당월']),
      retained_loss_ratio_current: parseNumber(row['보유 / 손해율 / 당월 (%)']),
    }))
    .filter((row) => row.line_group);

  addSeriesMetrics(selected, ['line_group'], ['gross_written_current', 'retained_premium_current', 'gross_loss_ratio_current', 'retained_loss_ratio_current']);

  const compareRows = [];
  const monthly = new Map();
  for (const row of selected) {
    if (!monthly.has(row.data_month)) {
      monthly.set(row.data_month, []);
    }
    monthly.get(row.data_month).push(row);
  }

  for (const [data_month, items] of [...monthly.entries()].sort(([left], [right]) => monthSort(left, right))) {
    const lookup = Object.fromEntries(items.map((item) => [item.line_group, item]));
    const generalItems = items.filter((item) => !['합계', '장기', '자동차'].includes(item.line_group));
    const generalGrossPremium = generalItems.reduce((sum, item) => sum + (item.gross_written_current ?? 0), 0);
    const generalWeightedLoss = safeDivide(
      generalItems.reduce((sum, item) => sum + ((item.gross_written_current ?? 0) * (item.gross_loss_ratio_current ?? 0)), 0),
      generalGrossPremium,
    );
    compareRows.push({
      data_month,
      자동차_원수수입보험료: lookup['자동차']?.gross_written_current ?? null,
      자동차_원수손해율: lookup['자동차']?.gross_loss_ratio_current ?? null,
      장기_원수수입보험료: lookup['장기']?.gross_written_current ?? null,
      장기_원수손해율: lookup['장기']?.gross_loss_ratio_current ?? null,
      일반보험_원수수입보험료: generalGrossPremium,
      일반보험_원수손해율: generalWeightedLoss,
    });
  }

  const longRows = melt(
    selected,
    ['data_month', 'line_group', 'item_name', 'item_name_std'],
    [
      'gross_written_current',
      'gross_written_prev_year',
      'gross_written_yoy_reported',
      'gross_loss_ratio_current',
      'gross_loss_ratio_prev_year',
      'gross_loss_ratio_diff',
      'retained_premium_current',
      'retained_loss_ratio_current',
      'gross_written_current_mom',
      'retained_premium_current_mom',
      'gross_loss_ratio_current_ma3',
      'retained_loss_ratio_current_ma3',
    ],
  );

  return { wide: selected, long: longRows, compare: compareRows };
}

function process070b03(rows) {
  const selectedCompanies = new Set(['삼성', 'DB', '현대', '메리츠', 'KB', '한화', '롯데', '흥국', '서울보증', '농협', '캐롯']);

  const prepared = rows.map((row) => ({
    data_month: row.data_month,
    company_group: row.item_name,
    company_group_std: row.item_name_std,
    gross_written_current: parseNumber(row['원수 / 수입보험료 / 당월']),
    gross_written_yoy_reported: parseNumber(row['원수 / 수입보험료 / 대비 (%)']),
    gross_loss_ratio_current: parseNumber(row['원수 / 손해율 / 당월 (%)']),
    gross_loss_ratio_diff: parseNumber(row['원수 / 손해율 / 대비 (%p)']),
    retained_premium_current: parseNumber(row['보유 / 보유보험료 / 당월']),
    retained_loss_ratio_current: parseNumber(row['보유 / 손해율 / 당월 (%)']),
  }));

  const selected = prepared.filter((row) => selectedCompanies.has(row.company_group));
  addSeriesMetrics(selected, ['company_group'], ['gross_written_current', 'gross_loss_ratio_current', 'retained_premium_current', 'retained_loss_ratio_current']);

  const compareRows = [];
  const monthly = new Map();
  for (const row of prepared) {
    if (!monthly.has(row.data_month)) {
      monthly.set(row.data_month, []);
    }
    monthly.get(row.data_month).push(row);
  }

  const largeSet = new Set(['삼성', 'DB', '현대', '메리츠', 'KB', '한화']);
  for (const [data_month, items] of [...monthly.entries()].sort(([left], [right]) => monthSort(left, right))) {
    const large = items.filter((item) => largeSet.has(item.company_group));
    const other = items.filter((item) => !largeSet.has(item.company_group));
    const aggregate = (subset, label) => ({
      [`${label}_원수수입보험료`]: subset.reduce((sum, item) => sum + (item.gross_written_current ?? 0), 0),
      [`${label}_보유보험료`]: subset.reduce((sum, item) => sum + (item.retained_premium_current ?? 0), 0),
      [`${label}_원수손해율`]: safeDivide(
        subset.reduce((sum, item) => sum + ((item.gross_written_current ?? 0) * (item.gross_loss_ratio_current ?? 0)), 0),
        subset.reduce((sum, item) => sum + (item.gross_written_current ?? 0), 0),
      ),
      [`${label}_보유손해율`]: safeDivide(
        subset.reduce((sum, item) => sum + ((item.retained_premium_current ?? 0) * (item.retained_loss_ratio_current ?? 0)), 0),
        subset.reduce((sum, item) => sum + (item.retained_premium_current ?? 0), 0),
      ),
    });
    compareRows.push({
      data_month,
      ...aggregate(large, '대형사'),
      ...aggregate(other, '기타사'),
    });
  }

  const longRows = melt(
    selected,
    ['data_month', 'company_group', 'company_group_std'],
    [
      'gross_written_current',
      'gross_written_yoy_reported',
      'gross_loss_ratio_current',
      'gross_loss_ratio_diff',
      'retained_premium_current',
      'retained_loss_ratio_current',
      'gross_written_current_mom',
      'gross_loss_ratio_current_ma3',
      'retained_loss_ratio_current_ma3',
    ],
  );

  return { wide: selected, long: longRows, compare: compareRows };
}

function process070b04(rows) {
  const selected = rows
    .map((row) => ({
      data_month: row.data_month,
      item_group: row.item_name,
      item_group_std: row.item_name_std,
      item_path: row.item_path,
      item_path_std: row.item_path_std,
      written_premium: parseNumber(row['계약상황 / 수입보험료 / 수입보험료 Direct Prem.']),
      earned_premium: parseNumber(row['계약상황 / 경과보험료 / 경과보험료 Earned Prem.']),
      claims_paid: parseNumber(row['손해상황 / 지급보험금 / 지급보험금 Claims Paid']),
      reserve_release: parseNumber(row['손해상황 / 지급준비금환입액 / 지급준비금환입액 Reserve b/f']),
      reserve_addition: parseNumber(row['손해상황 / 지급준비금적립액 / 지급준비금적립액 Reserve c/f']),
      incurred_losses: parseNumber(row['손해상황 / 발생손해액 / 발생손해액 Incurred Losses']),
      loss_ratio_reported: parseNumber(row['손해상황 / 손해율 / 손해율 (%)']),
    }))
    .filter((row) => ['합계(a~f)', '일반보험', '장기보험'].includes(row.item_group_std) || row.level === '1');

  applyMonthlyFlow(selected, ['item_group'], ['written_premium', 'earned_premium', 'claims_paid', 'reserve_release', 'reserve_addition', 'incurred_losses']);
  addSeriesMetrics(selected, ['item_group'], ['earned_premium_flow', 'incurred_losses_flow', 'loss_ratio_reported']);

  for (const row of selected) {
    row.incurred_over_earned = safeDivide(row.incurred_losses_flow, row.earned_premium_flow, 100);
    row.loss_ratio_bridge = safeDivide(
      (row.claims_paid_flow ?? 0) - (row.reserve_release_flow ?? 0) + (row.reserve_addition_flow ?? 0),
      row.earned_premium_flow,
      100,
    );
  }

  const profitabilityRows = selected.map((row) => ({
    data_month: row.data_month,
    item_group: row.item_group,
    item_group_std: row.item_group_std,
    written_premium_flow: row.written_premium_flow,
    earned_premium_flow: row.earned_premium_flow,
    incurred_losses_flow: row.incurred_losses_flow,
    incurred_over_earned: row.incurred_over_earned,
    loss_ratio_reported: row.loss_ratio_reported,
    loss_ratio_bridge: row.loss_ratio_bridge,
  }));

  const longRows = melt(
    selected,
    ['data_month', 'item_group', 'item_group_std', 'item_path', 'item_path_std'],
    [
      'written_premium_flow',
      'earned_premium_flow',
      'claims_paid_flow',
      'reserve_release_flow',
      'reserve_addition_flow',
      'incurred_losses_flow',
      'loss_ratio_reported',
      'incurred_over_earned',
      'loss_ratio_bridge',
    ],
  );

  return { wide: selected, long: longRows, compare: profitabilityRows };
}

async function main() {
  const xml = await fs.readFile(SOURCE_FILE, 'utf8');
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const rows070b07 = parseSheet(xml, SHEET_PREFIXES.S070B07);
  const rows070b08 = parseSheet(xml, SHEET_PREFIXES.S070B08);
  const rows070b082 = parseSheet(xml, SHEET_PREFIXES.S070B08_2);
  const rows070b02 = parseSheet(xml, SHEET_PREFIXES.S070B02);
  const rows070b03 = parseSheet(xml, SHEET_PREFIXES.S070B03);
  const rows070b04 = parseSheet(xml, SHEET_PREFIXES.S070B04);

  const result070b07 = process070b07(rows070b07);
  const result070b08 = process070b08Family(rows070b08, rows070b082);
  const result070b02 = process070b02(rows070b02);
  const result070b03 = process070b03(rows070b03);
  const result070b04 = process070b04(rows070b04);

  await writeDataset('070b07_long_term_premium', result070b07.wide, result070b07.long);
  await writeDataset('070b08_channel_first_premium', result070b08.wide, result070b08.long);
  await writeDataset('070b02_line_performance', result070b02.wide, result070b02.long);
  await writeDataset('070b03_company_performance', result070b03.wide, result070b03.long);
  await writeDataset('070b04_contract_loss_status', result070b04.wide, result070b04.long);

  await writeUtf8BomFile(path.join(OUTPUT_DIR, '070b02_auto_long_general_compare.csv'), toCsv(result070b02.compare, Object.keys(result070b02.compare[0] ?? {})));
  await writeUtf8BomFile(path.join(OUTPUT_DIR, '070b03_large_vs_other_compare.csv'), toCsv(result070b03.compare, Object.keys(result070b03.compare[0] ?? {})));
  await writeUtf8BomFile(path.join(OUTPUT_DIR, '070b04_profitability_check.csv'), toCsv(result070b04.compare, Object.keys(result070b04.compare[0] ?? {})));

  const runSummary = [
    { dataset: '070b07', wide_rows: result070b07.wide.length, long_rows: result070b07.long.length, note: 'selected hierarchical long-term premium rows' },
    { dataset: '070b08+070b08_2', wide_rows: result070b08.wide.length, long_rows: result070b08.long.length, note: 'channel buckets are mutually exclusive best-effort mapping' },
    { dataset: '070b02', wide_rows: result070b02.wide.length, long_rows: result070b02.long.length, note: 'includes auto/long/general comparison table' },
    { dataset: '070b03', wide_rows: result070b03.wide.length, long_rows: result070b03.long.length, note: 'includes large-vs-other comparison table' },
    { dataset: '070b04', wide_rows: result070b04.wide.length, long_rows: result070b04.long.length, note: 'car-specific detail not present in source XML export' },
  ];
  await writeUtf8BomFile(path.join(OUTPUT_DIR, 'run_summary.csv'), toCsv(runSummary, Object.keys(runSummary[0])));

  console.log(`Saved datasets to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
