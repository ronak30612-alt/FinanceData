import { ROUTER_CATALOG } from '../metadata/router-catalog.mjs';

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function includesKeyword(text, keyword) {
  return text.includes(normalizeText(keyword));
}

function detectIntent(text) {
  const matched = ROUTER_CATALOG.intents
    .map((intent) => ({
      ...intent,
      score: intent.keywords.filter((keyword) => includesKeyword(text, keyword)).length,
    }))
    .filter((intent) => intent.score > 0)
    .sort((left, right) => right.score - left.score);

  return matched[0]?.id ?? 'search';
}

function detectPeriodHints(text) {
  const hints = ROUTER_CATALOG.periodHints
    .filter((hint) => hint.keywords.some((keyword) => includesKeyword(text, keyword)))
    .map((hint) => hint.label);

  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((match) => match[1]);
  return {
    hints,
    explicitYears: [...new Set(years)],
  };
}

function scoreConcept(text, concept) {
  const matchedTerms = concept.synonyms.filter((term) => includesKeyword(text, term));
  const score = matchedTerms.length;
  return {
    score,
    matchedTerms,
  };
}

export function analyzeNaturalLanguageQuery(query, catalog = ROUTER_CATALOG) {
  const normalizedQuery = normalizeText(query);
  const intent = detectIntent(normalizedQuery);
  const period = detectPeriodHints(normalizedQuery);

  const candidates = catalog.concepts
    .map((concept) => {
      const { score, matchedTerms } = scoreConcept(normalizedQuery, concept);
      return {
        source: concept.source,
        dataset: concept.dataset,
        label: concept.label,
        conceptId: concept.id,
        frequency: concept.frequency,
        score,
        matchedTerms,
        reason: concept.description,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label, 'ko-KR'));

  const sourceScores = new Map();
  for (const candidate of candidates) {
    sourceScores.set(candidate.source, (sourceScores.get(candidate.source) ?? 0) + candidate.score);
  }

  const rankedSources = [...sourceScores.entries()]
    .map(([source, score]) => ({ source, score }))
    .sort((left, right) => right.score - left.score || left.source.localeCompare(right.source));

  return {
    query,
    normalizedQuery,
    intent,
    period,
    rankedSources,
    candidates,
  };
}
