import assert from 'node:assert/strict';

import { analyzeNaturalLanguageQuery } from '../src/router/agentic-router.mjs';

function runCase(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runCase('routes bank interest income query to FISIS and KRX', () => {
  const result = analyzeNaturalLanguageQuery('국내 은행 이자수익과 KOSPI 지수 추이 비교해줘');
  assert.equal(result.intent, 'compare');
  assert.equal(result.rankedSources[0]?.source, 'FISIS');
  assert.ok(result.rankedSources.some((entry) => entry.source === 'KRX'));
});

runCase('detects ECOS rate query', () => {
  const result = analyzeNaturalLanguageQuery('한국은행 기준금리 흐름을 보여줘');
  assert.equal(result.intent, 'trend');
  assert.equal(result.rankedSources[0]?.source, 'ECOS');
});

runCase('detects KOFIA bond query and daily hint', () => {
  const result = analyzeNaturalLanguageQuery('회사채 수익률 일간 추이 보여줘');
  assert.ok(result.rankedSources.some((entry) => entry.source === 'KOFIA'));
  assert.ok(result.period.hints.includes('일간'));
});
