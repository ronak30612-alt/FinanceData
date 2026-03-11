import assert from 'node:assert/strict';

import {
  createSheetColumns,
  extractGenericColumns,
  extractSpecialMeta,
  monthRange,
  normalizeRowBundle,
  parseScalar,
  sheetName,
} from '../scripts/incos-nonlife-monthly-export.mjs';

function runCase(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runCase('monthRange builds inclusive monthly sequence', () => {
  assert.deepEqual(monthRange('202311', '202402'), ['202311', '202312', '202401', '202402']);
});

runCase('parseScalar trims strings and converts numbers', () => {
  assert.equal(parseScalar('         -2.2'), -2.2);
  assert.equal(parseScalar('-'), '');
  assert.equal(parseScalar('  text  '), 'text');
});

runCase('extractGenericColumns flattens header hierarchy', () => {
  const headers = [
    { small: 'Class', large: 'Class', middle: 'Class', eng: '', colid: 'korname' },
    { small: 'Current', large: 'Gross', middle: 'Written premium', eng: '', colid: 'amt1' },
    { small: 'Diff', large: 'Gross', middle: 'Loss ratio', eng: '(%)', colid: 'rate2' },
  ];
  assert.deepEqual(extractGenericColumns(headers), [
    { key: 'amt1', label: 'Gross / Written premium / Current' },
    { key: 'rate2', label: 'Gross / Loss ratio / Diff (%)' },
  ]);
});

runCase('extractSpecialMeta parses query ids and grid labels', () => {
  const html = `
    <h3 class="topTitle" id="titleBox">Sample title</h3>
    <script>
      insisAjaxCall('/insMonth/getQueryResult.do', { queryId: 'getMN07LastYM' }, function() {}, { async: false });
      dg1.InitHeaders([
        {'Text':'Level|Group|Contract|Contract','Align':'Center'},
        {'Text':'Level|Group|Lump sum|Lump sum','Align':'Center'},
        {'Text':'Level|Group|First premium|First premium','Align':'Center'},
        {'Text':'Level|Group|Count|Amount','Align':'Center'}
      ], {Sort:0});
      dg1.InitColumns([
        {'SaveName':'Level'},
        {'SaveName':'ITEM_NM'},
        {'SaveName':'ITEM_VAL1'},
        {'SaveName':'ITEM_VAL2'}
      ]);
      insisAjaxCall('/insMonth/getQueryResult.do', { queryId: 'getMN07List' }, function() {});
    </script>
  `;
  assert.deepEqual(extractSpecialMeta(html, 'fallback'), {
    title: 'Sample title',
    lastYmQueryId: 'getMN07LastYM',
    listQueryId: 'getMN07List',
    columns: [
      { key: 'ITEM_NM', label: 'Group' },
      { key: 'ITEM_VAL1', label: 'Contract / Lump sum / First premium / Count' },
      { key: 'ITEM_VAL2', label: 'Contract / Lump sum / First premium / Amount' },
    ],
  });
});

runCase('normalizeRowBundle adds hierarchy and fixed columns', () => {
  const rows = [
    { type: 'Total', seq: 1, amt1: '100' },
    { type: 'Child', seq: 2, amt1: '50' },
  ];
  rows[0].__level = 1;
  rows[0].__itemPath = 'Total';
  rows[1].__level = 2;
  rows[1].__itemPath = 'Total > Child';

  const normalized = normalizeRowBundle(
    { gubun: 'N02' },
    '202511',
    { rows, columns: [{ key: 'amt1', label: 'Gross / Written premium / Current' }] },
    { company: 'N00', companyName: 'All companies', line: '00000', lineName: 'All lines' },
  );

  assert.equal(normalized[1].item_path, 'Total > Child');
  assert.equal(normalized[0]['Gross / Written premium / Current'], 100);
});

runCase('createSheetColumns keeps fixed columns first', () => {
  const columns = createSheetColumns([
    { data_year: '202511', item_name: 'Total', item_path: 'Total', level: 1, row_code: '', company_code: 'N00', company_name: 'All companies', line_code: '', line_name: '', metric_a: 10 },
  ]);
  assert.equal(columns[0].key, 'data_year');
  assert.equal(columns.at(-1).key, 'metric_a');
});

runCase('sheetName strips invalid worksheet characters', () => {
  assert.equal(sheetName('070b02: monthly/stats*sheet?', 'fallback'), '070b02  monthly stats sheet');
});
