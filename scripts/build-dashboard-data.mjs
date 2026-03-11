import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROUTER_CATALOG } from '../src/metadata/router-catalog.mjs';

const ROOT_DIR = path.resolve('.');
const CORE_DIR = path.join(ROOT_DIR, 'exports', 'core-db');
const CONFIG_PATH = path.join(ROOT_DIR, 'config', 'data-sources.example.json');
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs', 'data');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'dashboard-data.json');
const IMPORT_TEMPLATE_PATH = path.join(OUTPUT_DIR, 'import-template.json');

const DATASET_CONFIGS = [
  {
    fileName: 'industry_monthly_core.csv',
    source: 'INCOS',
    datasetId: 'incos-industry-core',
    datasetName: 'INCOS 업권 요약',
    category: '손해보험 업권',
    entityField: 'item_name_std',
    entityLabel: '보험 종목',
    titlePrefix: '업권',
    hiddenFields: ['month', 'item_name_std'],
    description: '손해보험 업권별 원수보험료, 손해율, 보유보험료 흐름을 월 기준으로 비교하는 핵심 집계다.',
    metadataDescription: 'INCOS 월보에서 추출한 업권 수준 시계열이며 period는 YYYY-MM, frequency는 M으로 정규화한다.',
    featureSummary: ['업권 수준 비교', '월간 손해율 추이', '원수/보유보험료 동시 비교'],
  },
  {
    fileName: 'company_monthly_core.csv',
    source: 'INCOS',
    datasetId: 'incos-company-core',
    datasetName: 'INCOS 회사 비교',
    category: '손해보험 회사',
    entityField: 'company_name',
    entityLabel: '보험사',
    titlePrefix: '회사',
    hiddenFields: ['month', 'company_name_short', 'company_name'],
    description: '주요 손해보험사별 원수보험료와 손해율을 같은 시계열 축에서 비교하기 위한 데이터셋이다.',
    metadataDescription: '회사명 기준으로 그룹핑한 월별 비교 데이터이며, 대형사와 중소형사 간 성과 차이를 파악하는 데 적합하다.',
    featureSummary: ['보험사 비교', '손해율 추세', '원수보험료 증감'],
  },
  {
    fileName: 'longterm_monthly_core.csv',
    source: 'INCOS',
    datasetId: 'incos-longterm-core',
    datasetName: 'INCOS 장기보험',
    category: '장기보험',
    entityField: 'product_group',
    entityLabel: '상품군',
    titlePrefix: '장기보험',
    hiddenFields: ['month', 'product_group'],
    description: '장기손해보험의 초회보험료, 갱신보험료, 총 유입액을 상품군별로 비교하는 데이터셋이다.',
    metadataDescription: '상품군 메타데이터와 월간 유입액 지표를 함께 보존해 장기보험 성장성과 구조 변화를 설명할 수 있다.',
    featureSummary: ['상품군 비교', '초회/갱신보험료 분리', '총유입액 추세'],
  },
  {
    fileName: 'channel_monthly_core.csv',
    source: 'INCOS',
    datasetId: 'incos-channel-core',
    datasetName: 'INCOS 채널 비교',
    category: '모집채널',
    entityField: 'focus_group',
    entityLabel: '집계군',
    titlePrefix: '채널',
    hiddenFields: ['month', 'focus_group'],
    description: '전속, GA, 방카슈랑스, 온라인 등 모집채널별 초회보험료와 점유율을 비교하는 데이터셋이다.',
    metadataDescription: '채널별 점유율과 YoY 변화율을 함께 제공해 판매 믹스 변화를 설명할 수 있다.',
    featureSummary: ['모집채널 비교', '점유율 분석', 'YoY 변화 추적'],
  },
];

const PERIOD_REGEX = /^\d{4}-\d{2}$/;

export function parseCsv(text) {
  const rows = [];
  const input = String(text ?? '').replace(/^\uFEFF/, '');
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
        continue;
      }
      if (char === '"') {
        quoted = false;
        continue;
      }
      current += char;
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

  const [header = [], ...dataRows] = rows.filter((entry) => entry.length > 1 || entry[0] !== '');
  return dataRows.map((cells) => Object.fromEntries(header.map((column, index) => [column, cells[index] ?? ''])));
}

export function toNumber(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const number = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(number) ? number : null;
}

function startCase(value) {
  return String(value ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function metricLabel(metric) {
  return startCase(metric)
    .replaceAll('Ma3', '3M MA')
    .replaceAll('Mom', 'MoM')
    .replaceAll('Yoy', 'YoY')
    .replaceAll('Pp', 'p.p.');
}

export function guessUnit(metric, values = []) {
  if (/diff_pp/i.test(metric)) {
    return 'p.p.';
  }
  if (/share_pct|reported_pct|loss_ratio/i.test(metric)) {
    return '%';
  }
  if (/_yoy$|_mom$/i.test(metric) || /_yoy_/i.test(metric)) {
    return 'ratio';
  }
  const nonNull = values.filter((value) => value !== null);
  if (nonNull.length > 0 && nonNull.every((value) => Math.abs(value) <= 1.5)) {
    return 'ratio';
  }
  return 'KRW';
}

function formatPeriod(period) {
  if (!PERIOD_REGEX.test(period)) {
    return period;
  }
  const [year, month] = period.split('-');
  return `${year}.${month}`;
}

function computeStats(points) {
  const sorted = [...points].sort((left, right) => left.period.localeCompare(right.period));
  const numericValues = sorted.map((point) => point.value).filter((value) => value !== null);
  const latest = sorted.at(-1) ?? null;
  const previous = sorted.at(-2) ?? null;
  const start = sorted[0] ?? null;

  return {
    latestPeriod: latest?.period ?? null,
    latestValue: latest?.value ?? null,
    previousValue: previous?.value ?? null,
    startValue: start?.value ?? null,
    delta: latest && previous ? latest.value - previous.value : null,
    deltaPct: latest && previous && previous.value !== 0
      ? (latest.value - previous.value) / Math.abs(previous.value)
      : null,
    min: numericValues.length ? Math.min(...numericValues) : null,
    max: numericValues.length ? Math.max(...numericValues) : null,
    average: numericValues.length
      ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
      : null,
    pointCount: sorted.length,
    startLabel: start ? formatPeriod(start.period) : null,
    endLabel: latest ? formatPeriod(latest.period) : null,
  };
}

function discoverMetrics(rows, hiddenFields) {
  const columns = new Set(rows.flatMap((row) => Object.keys(row)));
  return [...columns]
    .filter((column) => !hiddenFields.includes(column))
    .filter((column) => rows.some((row) => toNumber(row[column]) !== null));
}

function inferMetricDescription(metric, unit) {
  if (/gross_written/i.test(metric)) {
    return '원수보험료 흐름을 보여주는 지표다.';
  }
  if (/retained_premium/i.test(metric)) {
    return '보유보험료 흐름을 보여주는 지표다.';
  }
  if (/loss_ratio/i.test(metric)) {
    return '손해율 수준 또는 손해율 변화폭을 보여주는 지표다.';
  }
  if (/share_pct/i.test(metric)) {
    return '전체 대비 채널 또는 항목의 점유율을 뜻한다.';
  }
  if (/first_premium/i.test(metric)) {
    return '초회보험료 유입 흐름을 보여주는 지표다.';
  }
  if (/renewal_premium/i.test(metric)) {
    return '갱신보험료 흐름을 보여주는 지표다.';
  }
  if (/total_amount/i.test(metric)) {
    return '총 유입 금액의 규모를 보여주는 지표다.';
  }
  if (unit === 'ratio') {
    return '전기 대비 증감률 계열 지표다.';
  }
  return '정규화된 금융 시계열 지표다.';
}

function inferCharacteristics(metric, unit) {
  const tags = [];
  if (/yoy/i.test(metric)) {
    tags.push('YoY 비교 가능');
  }
  if (/ma3/i.test(metric)) {
    tags.push('3개월 이동평균');
  }
  if (/loss_ratio/i.test(metric)) {
    tags.push('수익성/위험성 해석 가능');
  }
  if (/share_pct/i.test(metric)) {
    tags.push('구성비 분석 가능');
  }
  if (/first_premium|renewal_premium|gross_written|retained_premium|total_amount/i.test(metric)) {
    tags.push('규모 비교 가능');
  }
  if (unit === 'ratio') {
    tags.push('성장률 해석');
  }
  return tags;
}

function buildTags(series, config) {
  return [
    series.source,
    series.datasetName,
    series.entity,
    series.metricLabel,
    config.category,
    config.entityLabel,
  ].filter(Boolean);
}

export function buildDatasetSeries(rows, config) {
  const metrics = discoverMetrics(rows, config.hiddenFields);
  const groups = new Map();

  for (const row of rows) {
    const period = row.month;
    if (!PERIOD_REGEX.test(period)) {
      continue;
    }
    const entity = String(row[config.entityField] ?? '').trim() || '미분류';

    for (const metric of metrics) {
      const numericValue = toNumber(row[metric]);
      if (numericValue === null) {
        continue;
      }

      const groupKey = [config.source, config.datasetId, entity, metric].join('::');
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          key: groupKey,
          source: config.source,
          dataset: config.datasetId,
          datasetName: config.datasetName,
          category: config.category,
          seriesId: `${config.datasetId}/${entity}/${metric}`,
          title: `${config.titlePrefix} · ${entity} · ${metricLabel(metric)}`,
          entityCode: entity,
          entity,
          entityName: entity,
          entityLabel: config.entityLabel,
          metric,
          metricLabel: metricLabel(metric),
          frequency: 'M',
          unit: 'raw',
          description: config.description,
          metadataDescription: config.metadataDescription,
          featureSummary: config.featureSummary,
          tags: [],
          points: [],
          metadata: {
            source: config.source,
            datasetId: config.datasetId,
            datasetName: config.datasetName,
            entityField: config.entityField,
            metric,
          },
        });
      }

      groups.get(groupKey).points.push({
        period,
        label: formatPeriod(period),
        value: numericValue,
      });
    }
  }

  return [...groups.values()]
    .map((series) => {
      series.points.sort((left, right) => left.period.localeCompare(right.period));
      series.unit = guessUnit(series.metric, series.points.map((point) => point.value));
      series.stats = computeStats(series.points);
      series.metricDescription = inferMetricDescription(series.metric, series.unit);
      series.characteristics = inferCharacteristics(series.metric, series.unit);
      series.tags = buildTags(series, config);
      return series;
    })
    .sort((left, right) => left.title.localeCompare(right.title, 'ko-KR'));
}

function summarizeSourceStatuses(sourceConfig, allSeries) {
  return Object.entries(sourceConfig.sources).map(([sourceKey, source]) => {
    const sourceSeries = allSeries.filter((series) => series.source === sourceKey);
    const periods = sourceSeries.flatMap((series) => series.points.map((point) => point.period)).sort();
    const datasets = [...new Set(sourceSeries.map((series) => series.datasetName))];

    return {
      id: sourceKey,
      name: source.name ?? sourceKey,
      enabled: Boolean(source.enabled),
      authType: source.auth?.type ?? 'unknown',
      envKey: source.auth?.envKey ?? '',
      baseUrl: source.baseUrl ?? '',
      datasets: source.datasets ?? [],
      notes: source.notes ?? '',
      coverage: source.coverage ?? '',
      status: sourceSeries.length > 0 ? 'built-in' : (source.enabled ? 'ready-for-import' : 'pending-setup'),
      seriesCount: sourceSeries.length,
      datasetCount: datasets.length,
      latestPeriod: periods.at(-1) ?? null,
      features: source.features ?? [],
      metadataAvailable: source.metadataAvailable ?? false,
    };
  });
}

function buildSummary(allSeries) {
  const periods = allSeries.flatMap((series) => series.points.map((point) => point.period)).sort();
  const sources = [...new Set(allSeries.map((series) => series.source))];
  const datasets = [...new Set(allSeries.map((series) => series.datasetName))];
  const pointCount = allSeries.reduce((sum, series) => sum + series.points.length, 0);

  return {
    generatedAt: new Date().toISOString(),
    sourceCount: sources.length,
    datasetCount: datasets.length,
    seriesCount: allSeries.length,
    pointCount,
    latestPeriod: periods.at(-1) ?? null,
    earliestPeriod: periods[0] ?? null,
    supportedDownloads: ['csv', 'excel', 'json'],
  };
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

async function readCsvFile(fileName) {
  const text = await fs.readFile(path.join(CORE_DIR, fileName), 'utf8');
  return parseCsv(text);
}

function buildImportTemplate(sourceStatuses) {
  return {
    generatedAt: new Date().toISOString(),
    description: '브라우저 업로드용 통합 시계열 템플릿이다. docs/data/dashboard-data.json 의 series 스키마와 호환된다.',
    supportedSources: sourceStatuses.map((source) => ({
      id: source.id,
      status: source.status,
      authType: source.authType,
      notes: source.notes,
    })),
    series: [
      {
        source: 'ECOS',
        dataset: 'ecos-statistics',
        datasetName: 'ECOS 예시',
        category: '경제지표',
        seriesId: 'ecos/example/base-rate',
        title: '예시 · 한국은행 기준금리',
        entityCode: 'BOK',
        entity: '한국은행',
        entityName: '한국은행',
        entityLabel: '기관',
        metric: 'base_rate',
        metricLabel: 'Base Rate',
        frequency: 'M',
        unit: '%',
        description: '기준금리 예시 시계열이다.',
        metadataDescription: 'ECOS 통계표 예시 구조를 보여주는 샘플이다.',
        featureSummary: ['월간 금리 추세', '정책금리 비교'],
        metricDescription: '기준금리 수준을 보여주는 지표다.',
        characteristics: ['정책금리', '월간 비교 가능'],
        tags: ['ECOS', '기준금리'],
        points: [
          { period: '2025-01', label: '2025.01', value: 3.5 },
          { period: '2025-02', label: '2025.02', value: 3.5 },
        ],
      },
    ],
  };
}

export async function buildDashboardData() {
  const sourceConfig = await readJson(CONFIG_PATH);
  const datasets = await Promise.all(DATASET_CONFIGS.map(async (config) => ({
    config,
    rows: await readCsvFile(config.fileName),
  })));

  const incosSeries = datasets.flatMap(({ config, rows }) => buildDatasetSeries(rows, config));
  const sourceStatuses = summarizeSourceStatuses(sourceConfig, incosSeries);
  const payload = {
    summary: buildSummary(incosSeries),
    sources: sourceStatuses,
    routerCatalog: ROUTER_CATALOG,
    series: incosSeries,
  };
  const template = buildImportTemplate(sourceStatuses);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  await fs.writeFile(IMPORT_TEMPLATE_PATH, JSON.stringify(template, null, 2), 'utf8');

  return payload;
}

async function main() {
  const payload = await buildDashboardData();
  console.log(`Dashboard data built: ${payload.summary.seriesCount} series / ${payload.summary.pointCount} points -> ${path.relative(ROOT_DIR, OUTPUT_PATH)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
