import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT_DIR = path.resolve('.');
const OUTPUT_PATH = path.join(ROOT_DIR, 'docs', 'data', 'remote-series.json');
const ENV_PATH = path.join(ROOT_DIR, '.env');

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
    const text = await fs.readFile(ENV_PATH, 'utf8');
    return { ...parseEnv(text), ...process.env };
  } catch {
    return { ...process.env };
  }
}

function formatMonthPeriod(value) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}`;
}

function formatDayPeriod(value) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

function buildStats(points) {
  const latest = points.at(-1);
  const previous = points.at(-2);
  const values = points.map((point) => point.value);
  return {
    latestPeriod: latest?.period ?? null,
    latestValue: latest?.value ?? null,
    previousValue: previous?.value ?? null,
    delta: latest && previous ? latest.value - previous.value : null,
    deltaPct: latest && previous && previous.value !== 0 ? (latest.value - previous.value) / Math.abs(previous.value) : null,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    pointCount: points.length,
  };
}

async function buildFisisSeries(env) {
  const companies = [
    { code: '0010927', name: '국민은행' },
    { code: '0011625', name: '신한은행' },
    { code: '0010001', name: '우리은행' },
    { code: '0011228', name: '하나은행' },
    { code: '0010026', name: '중소기업은행' },
  ];
  const metrics = [
    { dataset: 'fisis-bank-bis', listNo: 'SA053', accountCd: 'A', title: 'BIS비율', metric: 'bis_ratio', unit: '%' },
    { dataset: 'fisis-bank-assets', listNo: 'SA003', accountCd: 'A', title: '자산총계', metric: 'assets_total', unit: 'KRW' },
    { dataset: 'fisis-bank-loans', listNo: 'SA003', accountCd: 'A33', title: '원화대출금', metric: 'krw_loans', unit: 'KRW' },
  ];

  const series = [];
  for (const company of companies) {
    for (const metric of metrics) {
      const url = `${env.FISIS_BASE_URL}/statisticsInfoSearch.json?lang=kr&auth=${encodeURIComponent(env.FISIS_API_KEY)}&financeCd=${company.code}&listNo=${metric.listNo}&accountCd=${metric.accountCd}&term=Q&startBaseMm=202303&endBaseMm=202512`;
      const payload = await fetchJson(url);
      const rows = payload?.result?.list ?? [];
      const points = rows
        .map((row) => ({
          period: formatMonthPeriod(row.base_month),
          label: formatMonthPeriod(row.base_month).replace('-', '.'),
          value: Number(row.a),
        }))
        .filter((point) => Number.isFinite(point.value));

      series.push({
        source: 'FISIS',
        dataset: metric.dataset,
        datasetName: `FISIS ${metric.title}`,
        category: '국내은행',
        seriesId: `${metric.dataset}/${company.code}/${metric.metric}`,
        title: `FISIS · ${company.name} · ${metric.title}`,
        entityCode: company.code,
        entity: company.name,
        entityName: company.name,
        entityLabel: '금융회사',
        metric: metric.metric,
        metricLabel: metric.title,
        frequency: 'Q',
        unit: metric.unit,
        description: `${company.name}의 ${metric.title} 시계열이다.`,
        metadataDescription: `FISIS statisticsInfoSearch (${metric.listNo}/${metric.accountCd}) 호출 결과를 정규화했다.`,
        featureSummary: ['분기 시계열', '은행 비교'],
        metricDescription: `${metric.title} 추이를 보여준다.`,
        characteristics: ['FISIS 실데이터', '출처 선택 가능'],
        tags: ['FISIS', company.name, metric.title],
        points,
        stats: buildStats(points),
      });
    }
  }
  return series;
}

async function buildEcosSeries(env) {
  const definitions = [
    {
      dataset: 'ecos-base-rate',
      title: '한국은행 기준금리',
      statCode: '722Y001',
      cycle: 'M',
      start: '202301',
      end: '202602',
      itemCode: '0101000',
      unit: '%',
      metric: 'base_rate',
    },
    {
      dataset: 'ecos-cpi-total',
      title: '소비자물가지수 총지수',
      statCode: '901Y009',
      cycle: 'M',
      start: '202301',
      end: '202602',
      itemCode: '0',
      unit: 'index',
      metric: 'cpi_total',
    },
    {
      dataset: 'ecos-usdkrw',
      title: '원/미국달러 환율',
      statCode: '731Y001',
      cycle: 'D',
      start: '20250101',
      end: '20260310',
      itemCode: '0000001',
      unit: 'KRW',
      metric: 'usdkrw',
    },
  ];

  const series = [];
  for (const definition of definitions) {
    const url = `${env.ECOS_BASE_URL}/${encodeURIComponent(env.ECOS_API_KEY)}/json/kr/1/1000/${definition.statCode}/${definition.cycle}/${definition.start}/${definition.end}/${definition.itemCode}`;
    const payload = await fetchJson(url);
    const rows = payload?.StatisticSearch?.row ?? [];
    const points = rows
      .map((row) => ({
        period: definition.cycle === 'D' ? formatDayPeriod(row.TIME) : formatMonthPeriod(row.TIME),
        label: definition.cycle === 'D' ? formatDayPeriod(row.TIME) : formatMonthPeriod(row.TIME).replace('-', '.'),
        value: Number(row.DATA_VALUE),
      }))
      .filter((point) => Number.isFinite(point.value));

    series.push({
      source: 'ECOS',
      dataset: definition.dataset,
      datasetName: `ECOS ${definition.title}`,
      category: '거시경제',
      seriesId: `${definition.statCode}/${definition.itemCode}/${definition.metric}`,
      title: `ECOS · ${definition.title}`,
      entityCode: 'BOK',
      entity: '한국은행',
      entityName: '한국은행',
      entityLabel: '기관',
      metric: definition.metric,
      metricLabel: definition.title,
      frequency: definition.cycle,
      unit: definition.unit,
      description: `${definition.title} 시계열이다.`,
      metadataDescription: `ECOS StatisticSearch (${definition.statCode}/${definition.itemCode}) 호출 결과다.`,
      featureSummary: ['공식 통계', definition.cycle === 'D' ? '일간' : '월간'],
      metricDescription: `${definition.title} 흐름을 비교한다.`,
      characteristics: ['ECOS 실데이터', '출처 선택 가능'],
      tags: ['ECOS', definition.title],
      points,
      stats: buildStats(points),
    });
  }
  return series;
}

async function buildKrxSeries(env) {
  const targetNames = new Set(['KRX 100', 'KRX 300', 'KRX 반도체']);
  const startDate = new Date('2025-12-01T00:00:00Z');
  const endDate = new Date('2026-03-10T00:00:00Z');
  const seriesMap = new Map();

  for (let date = new Date(startDate); date <= endDate; date.setUTCDate(date.getUTCDate() + 1)) {
    const basDd = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
    const payload = await fetchJson(`${env.KRX_BASE_URL}?basDd=${basDd}`, {
      headers: { AUTH_KEY: env.KRX_API_KEY },
    }).catch(() => null);
    const rows = payload?.OutBlock_1 ?? [];
    for (const row of rows) {
      if (!targetNames.has(row.IDX_NM)) {
        continue;
      }
      if (!seriesMap.has(row.IDX_NM)) {
        seriesMap.set(row.IDX_NM, []);
      }
      seriesMap.get(row.IDX_NM).push({
        period: formatDayPeriod(row.BAS_DD),
        label: formatDayPeriod(row.BAS_DD),
        value: Number(row.CLSPRC_IDX),
      });
    }
  }

  return [...seriesMap.entries()].map(([name, points]) => ({
    source: 'KRX',
    dataset: 'krx-index-daily',
    datasetName: 'KRX 지수 일별',
    category: '지수',
    seriesId: `krx-index-daily/${name}`,
    title: `KRX · ${name}`,
    entityCode: name,
    entity: name,
    entityName: name,
    entityLabel: '지수',
    metric: 'close_index',
    metricLabel: '종가 지수',
    frequency: 'D',
    unit: 'index',
    description: `${name} 일별 종가 지수 시계열이다.`,
    metadataDescription: 'KRX krx_dd_trd AUTH_KEY 호출 결과를 일자별로 누적했다.',
    featureSummary: ['일별 지수', '시장 비교'],
    metricDescription: '종가 기준 지수 레벨이다.',
    characteristics: ['KRX 실데이터', '출처 선택 가능'],
    tags: ['KRX', name],
    points,
    stats: buildStats(points),
  }));
}

export async function buildRemoteSeries() {
  const env = await loadEnv();
  const [fisis, ecos, krx] = await Promise.all([
    buildFisisSeries(env),
    buildEcosSeries(env),
    buildKrxSeries(env),
  ]);

  const payload = {
    generatedAt: new Date().toISOString(),
    series: [...fisis, ...ecos, ...krx],
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

async function main() {
  const payload = await buildRemoteSeries();
  console.log(`Remote series built: ${payload.series.length} series -> ${path.relative(ROOT_DIR, OUTPUT_PATH)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
