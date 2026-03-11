const STORAGE_KEY = 'k-finance-dashboard-imports-v1';
const MAX_SELECTION = 6;
const COLORS = ['#0d6b5d', '#b85c38', '#1f487e', '#987200', '#8b3757', '#4f6b2a'];

const state = {
  baseData: null,
  metadataIndex: null,
  importedSeries: loadImportedSeries(),
  selectedKeys: [],
  routerResult: null,
  metadataSearchQuery: '',
  metadataSearchResults: [],
  filters: {
    search: '',
    source: 'ALL',
    dataset: 'ALL',
    compareMode: 'raw',
  },
};

const elements = {
  summaryGrid: document.querySelector('#summaryGrid'),
  sourceGrid: document.querySelector('#sourceGrid'),
  seriesList: document.querySelector('#seriesList'),
  resultMeta: document.querySelector('#resultMeta'),
  sourceFilter: document.querySelector('#sourceFilter'),
  datasetFilter: document.querySelector('#datasetFilter'),
  compareMode: document.querySelector('#compareMode'),
  searchInput: document.querySelector('#searchInput'),
  importInput: document.querySelector('#importInput'),
  clearImportsButton: document.querySelector('#clearImportsButton'),
  selectTopButton: document.querySelector('#selectTopButton'),
  clearSelectionButton: document.querySelector('#clearSelectionButton'),
  chartSvg: document.querySelector('#chartSvg'),
  chartLegend: document.querySelector('#chartLegend'),
  chartEmpty: document.querySelector('#chartEmpty'),
  insightGrid: document.querySelector('#insightGrid'),
  metadataGrid: document.querySelector('#metadataGrid'),
  compareTableHead: document.querySelector('#compareTable thead'),
  compareTableBody: document.querySelector('#compareTable tbody'),
  seriesCardTemplate: document.querySelector('#seriesCardTemplate'),
  queryInput: document.querySelector('#queryInput'),
  analyzeQueryButton: document.querySelector('#analyzeQueryButton'),
  useSuggestedSeriesButton: document.querySelector('#useSuggestedSeriesButton'),
  routerResult: document.querySelector('#routerResult'),
  sampleQueries: document.querySelector('#sampleQueries'),
  downloadCsvButton: document.querySelector('#downloadCsvButton'),
  downloadExcelButton: document.querySelector('#downloadExcelButton'),
  downloadJsonButton: document.querySelector('#downloadJsonButton'),
  metadataSearchInput: document.querySelector('#metadataSearchInput'),
  metadataSearchButton: document.querySelector('#metadataSearchButton'),
  metadataSearchResults: document.querySelector('#metadataSearchResults'),
  metadataStatus: document.querySelector('#metadataStatus'),
};

init().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<main class="shell"><section class="panel"><h1>대시보드를 불러오지 못했습니다.</h1><p>${escapeHtml(error.message)}</p></section></main>`;
});

async function init() {
  const response = await fetch('./data/dashboard-data.json');
  if (!response.ok) {
    throw new Error('dashboard-data.json 을 불러오지 못했습니다. 먼저 npm run build:dashboard 를 실행해 주세요.');
  }
  state.baseData = await response.json();
  state.metadataIndex = await loadMetadataIndex();

  wireEvents();
  renderSampleQueries();
  syncFilterOptions();
  render();
}

async function loadMetadataIndex() {
  try {
    const response = await fetch('./data/metadata-index.json');
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

function wireEvents() {
  elements.searchInput.addEventListener('input', (event) => {
    state.filters.search = normalizeText(event.target.value);
    render();
  });

  elements.sourceFilter.addEventListener('change', (event) => {
    state.filters.source = event.target.value;
    syncFilterOptions();
    render();
  });

  elements.datasetFilter.addEventListener('change', (event) => {
    state.filters.dataset = event.target.value;
    render();
  });

  elements.compareMode.addEventListener('change', (event) => {
    state.filters.compareMode = event.target.value;
    renderChartAndTable();
  });

  elements.importInput.addEventListener('change', async (event) => {
    const [file] = event.target.files ?? [];
    if (!file) {
      return;
    }
    const text = await file.text();
    const parsed = JSON.parse(text);
    const series = normalizeImportedPayload(parsed);
    state.importedSeries = dedupeSeries([...state.importedSeries, ...series]);
    persistImportedSeries();
    syncFilterOptions();
    render();
    event.target.value = '';
  });

  elements.clearImportsButton.addEventListener('click', () => {
    state.importedSeries = [];
    persistImportedSeries();
    state.selectedKeys = state.selectedKeys.filter((key) => findSeriesByKey(key));
    syncFilterOptions();
    render();
  });

  elements.selectTopButton.addEventListener('click', () => {
    state.selectedKeys = filteredSeries().slice(0, 3).map((series) => series.key);
    renderSeriesList();
    renderChartAndTable();
  });

  elements.clearSelectionButton.addEventListener('click', () => {
    state.selectedKeys = [];
    renderSeriesList();
    renderChartAndTable();
  });

  elements.analyzeQueryButton.addEventListener('click', () => {
    state.routerResult = analyzeQuery(elements.queryInput.value);
    renderRouterResult();
  });

  elements.useSuggestedSeriesButton.addEventListener('click', () => {
    applyRouterSuggestions();
  });

  elements.metadataSearchInput.addEventListener('input', (event) => {
    state.metadataSearchQuery = event.target.value;
    if (normalizeText(state.metadataSearchQuery).length >= 2) {
      state.metadataSearchResults = searchMetadata(state.metadataSearchQuery, 20);
      renderMetadataSearchResults();
    }
  });

  elements.metadataSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runMetadataSearch();
    }
  });

  elements.metadataSearchButton.addEventListener('click', () => {
    runMetadataSearch();
  });

  elements.downloadCsvButton.addEventListener('click', () => {
    downloadCurrentSelectionAsCsv();
  });

  elements.downloadExcelButton.addEventListener('click', () => {
    downloadCurrentSelectionAsExcel();
  });

  elements.downloadJsonButton.addEventListener('click', () => {
    downloadCurrentSelectionAsJson();
  });
}

function runMetadataSearch() {
  state.metadataSearchQuery = elements.metadataSearchInput.value;
  state.metadataSearchResults = searchMetadata(state.metadataSearchQuery, 20);
  renderMetadataSearchResults();
}

function loadImportedSeries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    return normalizeImportedPayload(JSON.parse(raw));
  } catch {
    return [];
  }
}

function persistImportedSeries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ series: state.importedSeries }));
}

function normalizeImportedPayload(payload) {
  const series = Array.isArray(payload) ? payload : payload.series;
  if (!Array.isArray(series)) {
    throw new Error('업로드 JSON 은 { "series": [...] } 구조여야 합니다.');
  }

  return dedupeSeries(series.map((item, index) => {
    if (!item.source || !item.dataset || !item.seriesId || !Array.isArray(item.points)) {
      throw new Error(`업로드 데이터 ${index + 1}번 항목에 필수 필드가 없습니다.`);
    }
    const key = item.key || [item.source, item.dataset, item.seriesId].join('::');
    const sortedPoints = [...item.points]
      .filter((point) => point && typeof point.period === 'string' && Number.isFinite(Number(point.value)))
      .map((point) => ({
        period: point.period,
        label: point.label || point.period.replace('-', '.'),
        value: Number(point.value),
      }))
      .sort((left, right) => left.period.localeCompare(right.period));

    return {
      key,
      source: item.source,
      dataset: item.dataset,
      datasetName: item.datasetName || item.dataset,
      category: item.category || '',
      seriesId: item.seriesId,
      title: item.title || item.seriesId,
      entityCode: item.entityCode || item.entity || '',
      entity: item.entity || '',
      entityName: item.entityName || item.entity || '',
      entityLabel: item.entityLabel || '',
      metric: item.metric || 'value',
      metricLabel: item.metricLabel || item.metric || 'Value',
      frequency: item.frequency || 'M',
      unit: item.unit || 'raw',
      description: item.description || '외부 업로드 시계열이다.',
      metadataDescription: item.metadataDescription || '업로드 JSON 에 포함된 메타데이터 설명이 없다.',
      featureSummary: Array.isArray(item.featureSummary) ? item.featureSummary : [],
      metricDescription: item.metricDescription || '업로드 지표 설명이 없다.',
      characteristics: Array.isArray(item.characteristics) ? item.characteristics : [],
      tags: Array.isArray(item.tags) ? item.tags : [],
      metadata: item.metadata || {},
      stats: computeStats(sortedPoints),
      points: sortedPoints,
    };
  }));
}

function computeStats(points) {
  const latest = points.at(-1);
  const previous = points.at(-2);
  const numericValues = points.map((point) => point.value);
  return {
    latestPeriod: latest?.period ?? null,
    latestValue: latest?.value ?? null,
    previousValue: previous?.value ?? null,
    delta: latest && previous ? latest.value - previous.value : null,
    deltaPct: latest && previous && previous.value !== 0 ? (latest.value - previous.value) / Math.abs(previous.value) : null,
    min: numericValues.length ? Math.min(...numericValues) : null,
    max: numericValues.length ? Math.max(...numericValues) : null,
    pointCount: points.length,
  };
}

function allSeries() {
  return dedupeSeries([...(state.baseData?.series ?? []), ...state.importedSeries]);
}

function dedupeSeries(series) {
  const byKey = new Map();
  for (const item of series) {
    byKey.set(item.key, item);
  }
  return [...byKey.values()];
}

function syncFilterOptions() {
  const series = allSeries();
  const sources = ['ALL', ...new Set(series.map((item) => item.source))];
  const datasets = ['ALL', ...new Set(series
    .filter((item) => state.filters.source === 'ALL' || item.source === state.filters.source)
    .map((item) => item.datasetName))];

  renderSelect(elements.sourceFilter, sources, state.filters.source);
  if (!datasets.includes(state.filters.dataset)) {
    state.filters.dataset = 'ALL';
  }
  renderSelect(elements.datasetFilter, datasets, state.filters.dataset);
}

function renderSelect(selectElement, options, selectedValue) {
  selectElement.innerHTML = '';
  for (const option of options) {
    const element = document.createElement('option');
    element.value = option;
    element.textContent = option === 'ALL' ? '전체' : option;
    element.selected = option === selectedValue;
    selectElement.append(element);
  }
}

function filteredSeries() {
  return allSeries()
    .filter((series) => state.filters.source === 'ALL' || series.source === state.filters.source)
    .filter((series) => state.filters.dataset === 'ALL' || series.datasetName === state.filters.dataset)
    .filter((series) => {
      const haystack = [
        series.title,
        series.entity,
        series.metricLabel,
        series.description,
        series.metadataDescription,
        ...(series.tags ?? []),
      ].join(' ').toLowerCase();
      return !state.filters.search || haystack.includes(state.filters.search);
    })
    .sort((left, right) => (right.stats.latestValue ?? -Infinity) - (left.stats.latestValue ?? -Infinity));
}

function render() {
  renderSummary();
  renderSourceGrid();
  renderMetadataStatus();
  renderMetadataSearchResults();
  renderRouterResult();
  renderSeriesList();
  renderChartAndTable();
}

function renderSummary() {
  const all = allSeries();
  const filtered = filteredSeries();
  const pointCount = filtered.reduce((sum, series) => sum + series.points.length, 0);
  const metadataCount = state.metadataIndex?.searchIndex?.length ?? 0;
  const cards = [
    { label: '전체 시리즈', value: numberFormat(all.length) },
    { label: '현재 결과', value: numberFormat(filtered.length) },
    { label: '총 포인트', value: numberFormat(pointCount) },
    { label: '메타 항목', value: numberFormat(metadataCount) },
    { label: '최신 period', value: state.baseData?.summary?.latestPeriod ?? '-' },
  ];

  elements.summaryGrid.innerHTML = cards.map((card) => `
    <article class="summary-card">
      <span>${card.label}</span>
      <strong>${card.value}</strong>
    </article>
  `).join('');
}

function renderSourceGrid() {
  const builtInSources = state.baseData?.sources ?? [];
  const importedBySource = new Map();
  for (const series of state.importedSeries) {
    importedBySource.set(series.source, (importedBySource.get(series.source) ?? 0) + 1);
  }

  elements.sourceGrid.innerHTML = builtInSources.map((source) => `
    <article class="source-card ${source.status}">
      <div class="source-head">
        <h3>${source.name}</h3>
        <span class="badge">${statusLabel(source.status)}</span>
      </div>
      <dl>
        <div><dt>내장 시리즈</dt><dd>${numberFormat(source.seriesCount)}</dd></div>
        <div><dt>업로드 시리즈</dt><dd>${numberFormat(importedBySource.get(source.id) ?? 0)}</dd></div>
        <div><dt>메타 항목</dt><dd>${numberFormat(state.metadataIndex?.sourceCounts?.[source.id] ?? 0)}</dd></div>
        <div><dt>인증</dt><dd>${source.authType}</dd></div>
        <div><dt>환경변수</dt><dd>${source.envKey || '-'}</dd></div>
      </dl>
      <p>${source.coverage || ''}</p>
      <p>${source.notes || '설명 없음'}</p>
      <div class="metadata-pills">
        ${(source.features ?? []).map((feature) => `<span class="tag">${feature}</span>`).join('')}
      </div>
      ${source.baseUrl ? `<a href="${source.baseUrl}" target="_blank" rel="noreferrer">원본 소스</a>` : '<span class="muted">엔드포인트 미확정</span>'}
    </article>
  `).join('');
}

function renderMetadataStatus() {
  if (!state.metadataIndex) {
    elements.metadataStatus.innerHTML = '<span class="router-chip">메타데이터 인덱스 없음</span>';
    return;
  }

  const chips = [
    `전체 ${numberFormat(state.metadataIndex.searchIndex.length)}건`,
    ...Object.entries(state.metadataIndex.sourceCounts ?? {}).map(([source, count]) => `${source} ${numberFormat(count)}`),
  ];

  elements.metadataStatus.innerHTML = chips.map((chip) => `<span class="router-chip">${chip}</span>`).join('');
}

function renderMetadataSearchResults() {
  if (!state.metadataIndex) {
    elements.metadataSearchResults.innerHTML = '<div class="empty-inline">metadata-index.json 을 찾지 못했다.</div>';
    return;
  }

  if (!normalizeText(state.metadataSearchQuery)) {
    elements.metadataSearchResults.innerHTML = '<div class="empty-inline">메타데이터 DB를 불러온 뒤 검색 결과가 여기에 표시된다.</div>';
    return;
  }

  if (state.metadataSearchResults.length === 0) {
    elements.metadataSearchResults.innerHTML = '<div class="empty-inline">일치하는 메타 항목이 없다.</div>';
    return;
  }

  elements.metadataSearchResults.innerHTML = state.metadataSearchResults.map((result, index) => `
    <article class="router-item">
      <h3>${result.entry.name}</h3>
      <p><strong>소스:</strong> ${result.entry.source} / <strong>종류:</strong> ${result.entry.kind}</p>
      <p><strong>코드:</strong> ${result.entry.code}</p>
      <p><strong>분류:</strong> ${result.entry.category || '-'}</p>
      <p><strong>일치 키워드:</strong> ${result.matchedTerms.join(', ') || '-'}</p>
      <div class="router-actions">
        <button class="button subtle" type="button" data-metadata-apply="${index}">이 조건으로 찾기</button>
      </div>
    </article>
  `).join('');

  for (const button of elements.metadataSearchResults.querySelectorAll('[data-metadata-apply]')) {
    button.addEventListener('click', () => {
      const result = state.metadataSearchResults[Number(button.dataset.metadataApply)];
      if (!result) {
        return;
      }
      elements.searchInput.value = result.entry.name;
      state.filters.search = normalizeText(result.entry.name);
      if ([...elements.sourceFilter.options].some((option) => option.value === result.entry.source)) {
        state.filters.source = result.entry.source;
      }
      syncFilterOptions();
      render();
    });
  }
}

function statusLabel(status) {
  if (status === 'built-in') {
    return '내장';
  }
  if (status === 'ready-for-import') {
    return '연결 준비';
  }
  if (status === 'pending-setup') {
    return '사전 준비 필요';
  }
  return status;
}

function renderSampleQueries() {
  const samples = state.baseData?.routerCatalog?.sampleQueries ?? [];
  elements.sampleQueries.innerHTML = samples.map((sample) => `
    <button class="button chip router-chip" type="button" data-sample-query="${escapeHtml(sample)}">${sample}</button>
  `).join('');

  for (const button of elements.sampleQueries.querySelectorAll('[data-sample-query]')) {
    button.addEventListener('click', () => {
      elements.queryInput.value = button.getAttribute('data-sample-query') ?? '';
      state.routerResult = analyzeQuery(elements.queryInput.value);
      renderRouterResult();
    });
  }
}

function renderSeriesList() {
  const results = filteredSeries();
  elements.resultMeta.textContent = `${numberFormat(results.length)}개 시리즈`;
  elements.seriesList.innerHTML = '';

  for (const series of results.slice(0, 120)) {
    const fragment = elements.seriesCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector('.series-card');
    const button = fragment.querySelector('.button.chip');
    fragment.querySelector('.series-source').textContent = `${series.source} · ${series.datasetName}`;
    fragment.querySelector('.series-title').textContent = series.title;
    fragment.querySelector('.series-meta').textContent = `${series.entityLabel || '엔터티'}: ${series.entity || '-'} · ${series.frequency} · ${series.stats.pointCount}포인트`;
    fragment.querySelector('.latest-value').textContent = formatValue(series.stats.latestValue, series.unit);
    fragment.querySelector('.delta-value').textContent = formatDelta(series.stats.delta, series.unit, series.stats.deltaPct);

    const tagList = fragment.querySelector('.tag-list');
    [...(series.tags ?? []), ...(series.characteristics ?? [])].slice(0, 6).forEach((tag) => {
      const tagElement = document.createElement('span');
      tagElement.className = 'tag';
      tagElement.textContent = tag;
      tagList.append(tagElement);
    });

    const selected = state.selectedKeys.includes(series.key);
    button.textContent = selected ? '선택 해제' : '비교 추가';
    button.addEventListener('click', () => toggleSelection(series.key));
    card.classList.toggle('selected', selected);
    elements.seriesList.append(fragment);
  }
}

function toggleSelection(key) {
  if (state.selectedKeys.includes(key)) {
    state.selectedKeys = state.selectedKeys.filter((entry) => entry !== key);
  } else {
    state.selectedKeys = [...state.selectedKeys.slice(-(MAX_SELECTION - 1)), key];
  }
  renderSeriesList();
  renderChartAndTable();
}

function selectedSeries() {
  return state.selectedKeys
    .map((key) => findSeriesByKey(key))
    .filter(Boolean);
}

function renderChartAndTable() {
  const selected = selectedSeries();

  if (selected.length === 0) {
    elements.chartEmpty.style.display = 'grid';
    elements.chartSvg.style.display = 'none';
    elements.chartLegend.innerHTML = '';
    elements.insightGrid.innerHTML = '';
    elements.metadataGrid.innerHTML = '<div class="empty-inline">시리즈를 선택하면 메타데이터 설명이 여기에 표시된다.</div>';
    elements.compareTableHead.innerHTML = '';
    elements.compareTableBody.innerHTML = '';
    return;
  }

  elements.chartEmpty.style.display = 'none';
  elements.chartSvg.style.display = 'block';
  renderChart(selected);
  renderInsights(selected);
  renderMetadata(selected);
  renderTable(selected);
}

function findSeriesByKey(key) {
  return allSeries().find((series) => series.key === key) ?? null;
}

function renderChart(selected) {
  const periods = [...new Set(selected.flatMap((series) => series.points.map((point) => point.period)))].sort();
  const chartSeries = selected.map((series, index) => ({
    ...series,
    color: COLORS[index % COLORS.length],
    mappedPoints: mapSeriesPoints(series, periods),
  }));

  const allValues = chartSeries.flatMap((series) => series.mappedPoints.map((point) => point.value).filter((value) => value !== null));
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const padding = { top: 24, right: 28, bottom: 44, left: 70 };
  const width = 920;
  const height = 420;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const range = maxValue - minValue || 1;
  const xStep = periods.length > 1 ? innerWidth / (periods.length - 1) : innerWidth / 2;
  const svgParts = [];

  Array.from({ length: 5 }, (_, index) => {
    const value = maxValue - (range / 4) * index;
    const y = padding.top + (innerHeight / 4) * index;
    svgParts.push(`<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="grid-line" />`);
    svgParts.push(`<text x="${padding.left - 12}" y="${y + 4}" class="axis-label">${escapeHtml(formatValue(value, unitForChart(selected)))}</text>`);
  });

  periods.forEach((period, index) => {
    const x = padding.left + (periods.length === 1 ? innerWidth / 2 : xStep * index);
    svgParts.push(`<text x="${x}" y="${height - 14}" class="axis-label axis-label-x">${escapeHtml(period.replace('-', '.'))}</text>`);
  });

  chartSeries.forEach((series) => {
    const coordinates = series.mappedPoints
      .map((point, index) => {
        if (point.value === null) {
          return null;
        }
        const x = padding.left + (periods.length === 1 ? innerWidth / 2 : xStep * index);
        const y = padding.top + ((maxValue - point.value) / range) * innerHeight;
        return { x, y, label: point.label, value: point.value };
      })
      .filter(Boolean);

    if (!coordinates.length) {
      return;
    }

    svgParts.push(`<polyline fill="none" stroke="${series.color}" stroke-width="3" points="${coordinates.map((point) => `${point.x},${point.y}`).join(' ')}" />`);
    coordinates.forEach((point) => {
      svgParts.push(`<circle cx="${point.x}" cy="${point.y}" r="4.5" fill="${series.color}">
        <title>${escapeHtml(series.title)}&#10;${escapeHtml(point.label)}&#10;${escapeHtml(formatValue(point.value, unitForChart([series])))}</title>
      </circle>`);
    });
  });

  elements.chartSvg.innerHTML = svgParts.join('');
  elements.chartLegend.innerHTML = chartSeries.map((series) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${series.color};width:10px;height:10px;border-radius:50%;display:inline-block;"></span>
      <span>${series.title}</span>
    </div>
  `).join('');
}

function renderInsights(selected) {
  elements.insightGrid.innerHTML = selected.map((series) => `
    <article class="insight-card">
      <h3>${series.title}</h3>
      <p>최신 ${series.stats.latestPeriod ?? '-'} · ${formatValue(series.stats.latestValue, series.unit)}</p>
      <p>변화 ${formatDelta(series.stats.delta, series.unit, series.stats.deltaPct)}</p>
      <p>범위 ${formatValue(series.stats.min, series.unit)} ~ ${formatValue(series.stats.max, series.unit)}</p>
    </article>
  `).join('');
}

function renderMetadata(selected) {
  elements.metadataGrid.innerHTML = selected.map((series) => `
    <article class="metadata-card">
      <h3>${series.title}</h3>
      <p><strong>데이터 설명:</strong> ${series.description || '-'}</p>
      <p><strong>메타데이터 설명:</strong> ${series.metadataDescription || '-'}</p>
      <p><strong>지표 특징:</strong> ${series.metricDescription || '-'}</p>
      <p><strong>엔터티:</strong> ${series.entityLabel || '엔터티'} / ${series.entity || '-'}</p>
      <p><strong>주기:</strong> ${series.frequency || '-'} / <strong>단위:</strong> ${series.unit || '-'}</p>
      <div class="metadata-pills">
        ${(series.featureSummary ?? []).map((item) => `<span class="tag">${item}</span>`).join('')}
        ${(series.characteristics ?? []).map((item) => `<span class="tag">${item}</span>`).join('')}
      </div>
    </article>
  `).join('');
}

function buildTableModel(selected) {
  const periods = [...new Set(selected.flatMap((series) => series.points.map((point) => point.period)))].sort();
  const mappedSeries = selected.map((series) => ({
    series,
    points: mapSeriesPoints(series, periods),
  }));

  const rows = periods.map((period) => {
    const row = { period };
    mappedSeries.forEach(({ series, points }) => {
      const point = points.find((entry) => entry.period === period);
      row[series.key] = point?.value ?? null;
    });
    return row;
  });

  return { rows };
}

function renderTable(selected) {
  const { rows } = buildTableModel(selected);

  elements.compareTableHead.innerHTML = `
    <tr>
      <th>기간</th>
      ${selected.map((series) => `<th>${series.title}</th>`).join('')}
    </tr>
  `;

  elements.compareTableBody.innerHTML = rows.map((row) => `
    <tr>
      <td>${row.period}</td>
      ${selected.map((series) => `<td>${row[series.key] !== null ? formatValue(row[series.key], unitForChart([series])) : '-'}</td>`).join('')}
    </tr>
  `).join('');
}

function renderRouterResult() {
  const result = state.routerResult;
  if (!result) {
    elements.routerResult.innerHTML = '<div class="empty-inline">질의를 분석하면 추천 소스와 후보 지표가 여기에 표시된다.</div>';
    return;
  }

  const sourceList = result.rankedSources.length
    ? result.rankedSources.map((entry) => `<li>${entry.source} · 점수 ${entry.score}</li>`).join('')
    : '<li>일치하는 소스를 찾지 못했다.</li>';

  const candidateList = result.candidates.length
    ? result.candidates.slice(0, 8).map((candidate) => `
      <article class="router-item">
        <h3>${candidate.label}</h3>
        <p><strong>소스:</strong> ${candidate.source} / <strong>분류:</strong> ${candidate.dataset}</p>
        <p><strong>일치 키워드:</strong> ${candidate.matchedTerms.join(', ') || '-'}</p>
        <p>${candidate.reason}</p>
      </article>
    `).join('')
    : '<div class="empty-inline">현재 메타데이터 기준으로 추천 후보가 없다.</div>';

  elements.routerResult.innerHTML = `
    <div class="router-result-grid">
      <section class="router-block">
        <div class="router-item">
          <h3>질의 해석</h3>
          <p><strong>의도:</strong> ${result.intent}</p>
          <p><strong>기간 힌트:</strong> ${[...result.period.hints, ...result.period.explicitYears].join(', ') || '-'}</p>
          <p><strong>원문:</strong> ${escapeHtml(result.query)}</p>
        </div>
        <div class="router-item">
          <h3>추천 소스</h3>
          <ul class="compact-list">${sourceList}</ul>
        </div>
      </section>
      <section class="router-block">
        <div class="router-list">${candidateList}</div>
      </section>
    </div>
  `;
}

function analyzeQuery(query) {
  const normalizedQuery = normalizeText(query);
  const catalog = state.baseData?.routerCatalog ?? { intents: [], periodHints: [], concepts: [] };
  const metadataCandidates = searchMetadata(query, 12).map((result) => ({
    source: result.entry.source,
    dataset: result.entry.kind,
    label: result.entry.name,
    matchedTerms: result.matchedTerms,
    reason: `${result.entry.code}${result.entry.category ? ` · ${result.entry.category}` : ''}`,
    score: result.score,
  }));

  const catalogCandidates = (catalog.concepts ?? [])
    .map((concept) => {
      const matchedTerms = (concept.synonyms ?? []).filter((term) => normalizedQuery.includes(normalizeText(term)));
      return {
        source: concept.source,
        dataset: concept.dataset,
        label: concept.label,
        matchedTerms,
        reason: concept.description,
        score: matchedTerms.length ? matchedTerms.length * 2 : 0,
      };
    })
    .filter((candidate) => candidate.score > 0);

  const candidates = [...metadataCandidates, ...catalogCandidates]
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label, 'ko-KR'));

  const sourceMap = new Map();
  for (const candidate of candidates) {
    sourceMap.set(candidate.source, (sourceMap.get(candidate.source) ?? 0) + candidate.score);
  }

  return {
    query,
    intent: detectIntent(normalizedQuery, catalog),
    period: detectPeriodHints(normalizedQuery, catalog),
    candidates,
    rankedSources: [...sourceMap.entries()]
      .map(([source, score]) => ({ source, score }))
      .sort((left, right) => right.score - left.score || left.source.localeCompare(right.source)),
  };
}

function detectIntent(text, catalog) {
  const matched = (catalog.intents ?? [])
    .map((intent) => ({
      id: intent.id,
      score: (intent.keywords ?? []).filter((keyword) => text.includes(normalizeText(keyword))).length,
    }))
    .filter((intent) => intent.score > 0)
    .sort((left, right) => right.score - left.score);

  return matched[0]?.id ?? 'search';
}

function detectPeriodHints(text, catalog) {
  const hints = (catalog.periodHints ?? [])
    .filter((hint) => (hint.keywords ?? []).some((keyword) => text.includes(normalizeText(keyword))))
    .map((hint) => hint.label);
  const explicitYears = [...text.matchAll(/\b(20\d{2})\b/g)].map((match) => match[1]);
  return {
    hints,
    explicitYears: [...new Set(explicitYears)],
  };
}

function searchMetadata(query, limit = 20) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery || !state.metadataIndex?.searchIndex?.length) {
    return [];
  }

  const tokens = tokenize(normalizedQuery);
  return state.metadataIndex.searchIndex
    .map((entry) => {
      const haystack = entry.searchText || normalizeText([entry.name, entry.category, entry.code, entry.source, entry.kind].join(' '));
      let score = 0;
      const matchedTerms = [];

      if (haystack.includes(normalizedQuery)) {
        score += 8;
      }

      for (const token of tokens) {
        if (haystack.includes(token)) {
          score += token.length >= 2 ? 2 : 1;
          matchedTerms.push(token);
        }
      }

      if (normalizedQuery.includes(normalizeText(entry.source))) {
        score += 1;
      }

      if (score === 0) {
        return null;
      }

      return {
        entry,
        score,
        matchedTerms: [...new Set(matchedTerms)],
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.entry.source.localeCompare(right.entry.source) || left.entry.name.localeCompare(right.entry.name, 'ko-KR'))
    .slice(0, limit);
}

function applyRouterSuggestions() {
  const result = state.routerResult;
  if (!result?.candidates?.length) {
    return;
  }

  const suggestionTerms = [...new Set(result.candidates.flatMap((candidate) => [candidate.label, ...(candidate.matchedTerms ?? [])]))]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  const suggestions = filteredSeries()
    .map((series) => {
      const haystack = normalizeText([
        series.source,
        series.datasetName,
        series.title,
        series.entity,
        series.metricLabel,
        series.description,
        ...(series.tags ?? []),
        ...(series.characteristics ?? []),
      ].join(' '));

      const score = suggestionTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { series, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((entry) => entry.series.key);

  if (suggestions.length > 0) {
    state.selectedKeys = [...new Set([...state.selectedKeys, ...suggestions])].slice(-MAX_SELECTION);
    renderSeriesList();
    renderChartAndTable();
  }
}

function tokenize(value) {
  return normalizeText(value)
    .split(/[\s,/|()+-]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function unitForChart(seriesList) {
  if (state.filters.compareMode === 'indexed') {
    return 'index';
  }
  const units = [...new Set(seriesList.map((series) => series.unit))];
  return units.length === 1 ? units[0] : 'mixed';
}

function mapSeriesPoints(series, periods) {
  const byPeriod = new Map(series.points.map((point) => [point.period, point]));
  const firstPoint = series.points.find((point) => point.value !== null);
  return periods.map((period) => {
    const point = byPeriod.get(period);
    if (!point) {
      return { period, label: period.replace('-', '.'), value: null };
    }
    if (state.filters.compareMode === 'indexed') {
      return {
        period,
        label: point.label,
        value: firstPoint && firstPoint.value !== 0 ? (point.value / firstPoint.value) * 100 : null,
      };
    }
    return point;
  });
}

function downloadCurrentSelectionAsCsv() {
  const selected = selectedSeries();
  if (selected.length === 0) {
    return;
  }
  const { rows } = buildTableModel(selected);
  const header = ['period', ...selected.map((series) => series.title)];
  const lines = [
    header.join(','),
    ...rows.map((row) => [
      row.period,
      ...selected.map((series) => row[series.key] === null ? '' : String(row[series.key])),
    ].map(csvEscape).join(',')),
  ];
  downloadBlob(`${downloadBaseName(selected)}.csv`, new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }));
}

function downloadCurrentSelectionAsExcel() {
  const selected = selectedSeries();
  if (selected.length === 0) {
    return;
  }
  const { rows } = buildTableModel(selected);
  const tableRows = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.period)}</td>
      ${selected.map((series) => `<td>${row[series.key] ?? ''}</td>`).join('')}
    </tr>
  `).join('');
  const html = `
    <html>
      <head><meta charset="utf-8"></head>
      <body>
        <table>
          <thead>
            <tr><th>period</th>${selected.map((series) => `<th>${escapeHtml(series.title)}</th>`).join('')}</tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>
  `;
  downloadBlob(`${downloadBaseName(selected)}.xls`, new Blob([html], { type: 'application/vnd.ms-excel' }));
}

function downloadCurrentSelectionAsJson() {
  const selected = selectedSeries();
  if (selected.length === 0) {
    return;
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    compareMode: state.filters.compareMode,
    series: selected,
  };
  downloadBlob(`${downloadBaseName(selected)}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }));
}

function downloadBlob(fileName, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadBaseName(selected) {
  return `k-finance-compare-${selected.length}series-${new Date().toISOString().slice(0, 10)}`;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function formatValue(value, unit) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }
  if (unit === '%') {
    return `${numberFormat(value, 2)}%`;
  }
  if (unit === 'p.p.') {
    return `${numberFormat(value, 2)}p`;
  }
  if (unit === 'ratio') {
    return `${numberFormat(value * 100, 2)}%`;
  }
  if (unit === 'index') {
    return numberFormat(value, 1);
  }
  if (unit === 'mixed') {
    return numberFormat(value, 2);
  }
  if (Math.abs(value) >= 1_000_000_000) {
    return `${numberFormat(value / 1_000_000_000, 2)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `${numberFormat(value / 1_000_000, 2)}M`;
  }
  return numberFormat(value, 2);
}

function formatDelta(delta, unit, deltaPct) {
  if (delta === null || delta === undefined) {
    return '-';
  }
  const sign = delta > 0 ? '+' : '';
  if (unit === '%' || unit === 'p.p.') {
    return `${sign}${numberFormat(delta, 2)}${unit === '%' ? '%' : 'p'}`;
  }
  const pct = deltaPct === null || deltaPct === undefined ? '' : ` (${sign}${numberFormat(deltaPct * 100, 2)}%)`;
  return `${sign}${formatValue(delta, unit)}${pct}`;
}

function numberFormat(value, digits = 0) {
  return new Intl.NumberFormat('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
