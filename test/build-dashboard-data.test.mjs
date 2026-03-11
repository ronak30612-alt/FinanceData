import assert from 'node:assert/strict';

import {
  buildDatasetSeries,
  buildDashboardData,
  guessUnit,
  metricLabel,
  parseCsv,
} from '../scripts/build-dashboard-data.mjs';

function runCase(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        console.log(`PASS ${name}`);
      });
    }
    console.log(`PASS ${name}`);
    return result;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

await runCase('parseCsv parses quoted cells', () => {
  const rows = parseCsv('month,name,value\n2025-01,"A, B",10\n');
  assert.deepEqual(rows, [{ month: '2025-01', name: 'A, B', value: '10' }]);
});

await runCase('metricLabel prettifies snake_case metrics', () => {
  assert.equal(metricLabel('gross_loss_ratio_ma3'), 'Gross Loss Ratio 3M MA');
});

await runCase('guessUnit infers pct and ratio units', () => {
  assert.equal(guessUnit('share_pct', [12.3, 10.1]), '%');
  assert.equal(guessUnit('growth_yoy', [0.2, 0.1]), 'ratio');
  assert.equal(guessUnit('gross_written_current', [100, 200]), 'KRW');
});

await runCase('buildDatasetSeries groups rows into time series with descriptive metadata', () => {
  const series = buildDatasetSeries(
    [
      { month: '2025-01', item_name_std: '합계', gross_written_current: '100', gross_loss_ratio_current: '80' },
      { month: '2025-02', item_name_std: '합계', gross_written_current: '110', gross_loss_ratio_current: '81' },
    ],
    {
      source: 'INCOS',
      datasetId: 'incos-industry-core',
      datasetName: 'INCOS 업권 요약',
      category: '손해보험 업권',
      entityField: 'item_name_std',
      entityLabel: '보험 종목',
      titlePrefix: '업권',
      hiddenFields: ['month', 'item_name_std'],
      description: '설명',
      metadataDescription: '메타데이터 설명',
      featureSummary: ['요약'],
    },
  );

  assert.equal(series.length, 2);
  assert.equal(series[0].points.length, 2);
  assert.equal(series[0].stats.latestPeriod, '2025-02');
  assert.equal(series[0].description, '설명');
  assert.ok(Array.isArray(series[0].characteristics));
});

await runCase('buildDashboardData emits source summary and router catalog', async () => {
  const payload = await buildDashboardData();
  assert.ok(payload.summary.seriesCount > 0);
  assert.ok(payload.sources.some((source) => source.id === 'INCOS' && source.seriesCount > 0));
  assert.ok(payload.routerCatalog?.concepts?.length > 0);
  assert.ok(payload.series[0]?.metadataDescription);
});
