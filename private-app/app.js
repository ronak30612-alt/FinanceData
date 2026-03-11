const COLORS = ['#0e6d61', '#1f487e', '#b95d38', '#866c1f', '#8a3957', '#4c6d2f', '#266fa0', '#8f4e1a'];

const state = {
  session: null,
  workflows: null,
  activeSource: 'FISIS',
  bundle: [],
  lastRun: null,
  forms: {
    FISIS: { industry: 'ALL', keyword: '', statistic: '', companies: [], accounts: [], term: 'Q', start: '202303', end: '202512', precision: 2, unitMode: 'raw' },
    ECOS: { keyword: '', table: '', items: [], cycle: 'M', start: '202301', end: '202602', precision: 2, unitMode: 'raw' },
    KOFIA: { operation: 'getTrustScaleInfo', dateHint: '202512', exactDate: '', start: '', end: '', filters: {}, metrics: [], precision: 2, unitMode: 'raw' },
    KRX: { indices: [], start: '20251201', end: '20260310', precision: 2, unitMode: 'raw' },
    INCOS: { dataset: 'ALL', entity: 'ALL', metrics: [], start: '2023-01', end: '2025-12', precision: 2, unitMode: 'raw' },
  },
};

const elements = {
  authPanel: document.querySelector('#authPanel'),
  appPanel: document.querySelector('#appPanel'),
  loginForm: document.querySelector('#loginForm'),
  usernameInput: document.querySelector('#usernameInput'),
  passwordInput: document.querySelector('#passwordInput'),
  logoutButton: document.querySelector('#logoutButton'),
  sessionText: document.querySelector('#sessionText'),
  sourceTabs: document.querySelector('#sourceTabs'),
  sourcePanel: document.querySelector('#sourcePanel'),
  bundleList: document.querySelector('#bundleList'),
  runBundleButton: document.querySelector('#runBundleButton'),
  clearBundleButton: document.querySelector('#clearBundleButton'),
  downloadCsvButton: document.querySelector('#downloadCsvButton'),
  downloadExcelButton: document.querySelector('#downloadExcelButton'),
  downloadJsonButton: document.querySelector('#downloadJsonButton'),
  resultMeta: document.querySelector('#resultMeta'),
  chartEmpty: document.querySelector('#chartEmpty'),
  chartSvg: document.querySelector('#chartSvg'),
  chartLegend: document.querySelector('#chartLegend'),
  resultTableHead: document.querySelector('#resultTable thead'),
  resultTableBody: document.querySelector('#resultTable tbody'),
  bundleItemTemplate: document.querySelector('#bundleItemTemplate'),
};

boot().catch((error) => {
  document.body.innerHTML = `<main class="shell"><section class="panel"><h1>앱 초기화 실패</h1><p>${escapeHtml(error.message)}</p></section></main>`;
});

async function boot() {
  await refreshSession();
  wireEvents();
  if (!state.session?.authenticated) {
    showLogin();
    return;
  }
  await loadWorkflows();
  showApp();
}

function wireEvents() {
  elements.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const ok = await login();
    if (!ok) return;
    await loadWorkflows();
    showApp();
  });

  elements.logoutButton.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    state.session = null;
    showLogin();
  });

  elements.runBundleButton.addEventListener('click', async () => {
    await runBundle();
  });

  elements.clearBundleButton.addEventListener('click', () => {
    state.bundle = [];
    renderBundle();
    renderResult(null);
  });

  elements.downloadCsvButton.addEventListener('click', () => downloadCsv());
  elements.downloadExcelButton.addEventListener('click', () => downloadExcel());
  elements.downloadJsonButton.addEventListener('click', () => downloadJson());
}

async function login() {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: elements.usernameInput.value.trim(),
      password: elements.passwordInput.value,
    }),
  });
  if (!response.ok) {
    alert('로그인 실패');
    return false;
  }
  await refreshSession();
  return true;
}

async function refreshSession() {
  const response = await fetch('/api/session');
  state.session = await response.json();
}

async function loadWorkflows() {
  const response = await fetch('/api/workflows');
  state.workflows = await response.json();
}

function showLogin() {
  elements.authPanel.classList.remove('hidden');
  elements.appPanel.classList.add('hidden');
}

function showApp() {
  elements.authPanel.classList.add('hidden');
  elements.appPanel.classList.remove('hidden');
  elements.sessionText.textContent = `${state.session.username} 계정으로 로그인됨. 선택형 빌더에서 여러 요청을 묶어 비교할 수 있다.`;
  renderTabs();
  renderBundle();
  renderActiveSource();
}

function renderTabs() {
  elements.sourceTabs.innerHTML = state.workflows.sources.map((source) => `
    <button class="button tab-button ${source.id === state.activeSource ? 'active' : ''}" type="button" data-source="${source.id}">
      ${source.title}
    </button>
  `).join('');

  for (const button of elements.sourceTabs.querySelectorAll('[data-source]')) {
    button.addEventListener('click', () => {
      state.activeSource = button.dataset.source;
      renderTabs();
      renderActiveSource();
    });
  }
}

async function renderActiveSource() {
  if (state.activeSource === 'FISIS') {
    await renderFisis();
    return;
  }
  if (state.activeSource === 'ECOS') {
    await renderEcos();
    return;
  }
  if (state.activeSource === 'KOFIA') {
    await renderKofia();
    return;
  }
  if (state.activeSource === 'KRX') {
    await renderKrx();
    return;
  }
  if (state.activeSource === 'INCOS') {
    await renderIncos();
  }
}

function optionGrid(prefix, form) {
  return `
    <div class="step-block">
      <h3>표시 옵션</h3>
      <div class="option-grid">
        <label>
          <span>소수점</span>
          <input id="${prefix}Precision" type="number" value="${form.precision}" min="0" max="6" />
        </label>
        <label>
          <span>단위</span>
          <select id="${prefix}UnitMode">
            ${['raw', 'million', 'billion'].map((value) => `<option value="${value}" ${form.unitMode === value ? 'selected' : ''}>${unitModeLabel(value)}</option>`).join('')}
          </select>
        </label>
      </div>
    </div>
  `;
}

async function renderFisis() {
  const form = state.forms.FISIS;
  const query = new URLSearchParams({ source: 'FISIS', industry: form.industry, keyword: form.keyword, statistic: form.statistic });
  const data = await (await fetch(`/api/options?${query.toString()}`)).json();

  elements.sourcePanel.innerHTML = `
    <div class="builder-grid">
      <div class="step-block">
        <h3>1. 금융업권</h3>
        <label><span>업권</span><select id="fisisIndustry" size="9">${renderOptions(['ALL', ...data.industries], form.industry)}</select></label>
      </div>
      <div class="step-block">
        <h3>2. 비교할 회사</h3>
        <label><span>회사</span><select id="fisisCompanies" multiple size="9">${renderObjectOptions(data.companies, form.companies)}</select></label>
      </div>
      <div class="step-block">
        <h3>3. 통계표</h3>
        <label><span>키워드</span><input id="fisisKeyword" value="${escapeAttr(form.keyword)}" /></label>
        <label><span>통계표</span><select id="fisisStatistic" size="10">${renderObjectOptions(data.statistics, form.statistic, 'code', (item) => `${item.code} · ${item.name}`)}</select></label>
      </div>
      <div class="step-block">
        <h3>4. 통계항목</h3>
        <label><span>항목</span><select id="fisisAccounts" multiple size="10">${renderObjectOptions(data.accounts, form.accounts)}</select></label>
      </div>
      <div class="step-block">
        <h3>기간 / 주기</h3>
        <div class="option-grid">
          <label><span>주기</span><select id="fisisTerm">${renderOptions(['Q', 'M', 'Y'], form.term)}</select></label>
          <label><span>시작</span><input id="fisisStart" value="${escapeAttr(form.start)}" /></label>
          <label><span>종료</span><input id="fisisEnd" value="${escapeAttr(form.end)}" /></label>
        </div>
      </div>
      ${optionGrid('fisis', form)}
    </div>
    <div class="step-actions">
      <button class="button primary" id="fisisAdd" type="button">비교 번들에 추가</button>
    </div>
  `;

  bindCommonInputs('fisis', form);
  document.querySelector('#fisisIndustry').addEventListener('change', async (event) => {
    form.industry = event.target.value;
    form.statistic = '';
    form.accounts = [];
    await renderFisis();
  });
  document.querySelector('#fisisKeyword').addEventListener('change', async (event) => {
    form.keyword = event.target.value;
    await renderFisis();
  });
  document.querySelector('#fisisStatistic').addEventListener('change', async (event) => {
    form.statistic = event.target.value;
    form.accounts = [];
    await renderFisis();
  });
  document.querySelector('#fisisCompanies').addEventListener('change', (event) => {
    form.companies = selectedValues(event.target);
  });
  document.querySelector('#fisisAccounts').addEventListener('change', (event) => {
    form.accounts = selectedValues(event.target);
  });
  document.querySelector('#fisisAdd').addEventListener('click', () => {
    const statistic = data.statistics.find((item) => item.code === form.statistic);
    const companies = data.companies.filter((item) => form.companies.includes(item.code));
    const accounts = data.accounts.filter((item) => form.accounts.includes(item.code));
    addBundleItem({
      source: 'FISIS',
      label: `FISIS · ${statistic?.name ?? '통계표'} · ${companies.length}개 회사`,
      summary: `${companies.map((item) => item.name).join(', ')} / ${accounts.map((item) => item.name).join(', ')}`,
      payload: { ...form, statistic, companies, accounts },
    });
  });
}

async function renderEcos() {
  const form = state.forms.ECOS;
  const query = new URLSearchParams({ source: 'ECOS', keyword: form.keyword, statCode: form.table });
  const data = await (await fetch(`/api/options?${query.toString()}`)).json();

  elements.sourcePanel.innerHTML = `
    <div class="builder-grid">
      <div class="step-block">
        <h3>1. 통계표 검색</h3>
        <label><span>키워드</span><input id="ecosKeyword" value="${escapeAttr(form.keyword)}" /></label>
        <label><span>통계표</span><select id="ecosTable" size="12">${renderObjectOptions(data.tables, form.table, 'code', (item) => `${item.code} · ${item.name}`)}</select></label>
      </div>
      <div class="step-block">
        <h3>2. 세부 ITEM</h3>
        <label><span>ITEM</span><select id="ecosItems" multiple size="12">${renderObjectOptions(data.items, form.items, 'code', (item) => `${item.code} · ${item.name} (${item.cycle})`)}</select></label>
      </div>
      <div class="step-block">
        <h3>기간 / 주기</h3>
        <div class="option-grid">
          <label><span>주기</span><select id="ecosCycle">${renderOptions(['D', 'M', 'Q', 'A'], form.cycle)}</select></label>
          <label><span>시작</span><input id="ecosStart" value="${escapeAttr(form.start)}" /></label>
          <label><span>종료</span><input id="ecosEnd" value="${escapeAttr(form.end)}" /></label>
        </div>
      </div>
      ${optionGrid('ecos', form)}
    </div>
    <div class="step-actions">
      <button class="button primary" id="ecosAdd" type="button">비교 번들에 추가</button>
    </div>
  `;

  bindCommonInputs('ecos', form);
  document.querySelector('#ecosKeyword').addEventListener('change', async (event) => {
    form.keyword = event.target.value;
    await renderEcos();
  });
  document.querySelector('#ecosTable').addEventListener('change', async (event) => {
    form.table = event.target.value;
    form.items = [];
    await renderEcos();
  });
  document.querySelector('#ecosItems').addEventListener('change', (event) => {
    form.items = selectedValues(event.target);
  });
  document.querySelector('#ecosAdd').addEventListener('click', () => {
    const table = data.tables.find((item) => item.code === form.table);
    const items = data.items.filter((item) => form.items.includes(item.code));
    addBundleItem({
      source: 'ECOS',
      label: `ECOS · ${table?.name ?? '통계표'} · ${items.length}개 항목`,
      summary: items.map((item) => item.name).join(', '),
      payload: { ...form, table, items },
    });
  });
}

async function renderKofia() {
  const form = state.forms.KOFIA;
  const query = new URLSearchParams({ source: 'KOFIA', operation: form.operation, dateHint: form.dateHint || '' });
  const data = await (await fetch(`/api/options?${query.toString()}`)).json();
  const op = data.operationOptions;

  elements.sourcePanel.innerHTML = `
    <div class="builder-grid">
      <div class="step-block">
        <h3>1. 오퍼레이션</h3>
        <label><span>데이터셋</span><select id="kofiaOperation" size="10">${renderObjectOptions(data.operations, form.operation, 'code', (item) => item.name)}</select></label>
      </div>
      <div class="step-block">
        <h3>2. 기준 시점</h3>
        <div class="option-grid">
          <label><span>옵션 조회용 기준값</span><input id="kofiaDateHint" value="${escapeAttr(form.dateHint)}" /></label>
          <label><span>단일 기준일</span><input id="kofiaExactDate" value="${escapeAttr(form.exactDate)}" /></label>
          <label><span>시작</span><input id="kofiaStart" value="${escapeAttr(form.start)}" /></label>
          <label><span>종료</span><input id="kofiaEnd" value="${escapeAttr(form.end)}" /></label>
        </div>
      </div>
      ${renderKofiaSelectorBlocks(op, form)}
      <div class="step-block">
        <h3>3. 값 항목 선택</h3>
        <label><span>Metric</span><select id="kofiaMetrics" multiple size="10">${(op?.valueFields ?? []).map((field) => `<option value="${field}" ${form.metrics.includes(field) ? 'selected' : ''}>${field}</option>`).join('')}</select></label>
      </div>
      ${optionGrid('kofia', form)}
    </div>
    <div class="step-actions">
      <button class="button subtle" id="kofiaRefresh" type="button">선택지 갱신</button>
      <button class="button primary" id="kofiaAdd" type="button">비교 번들에 추가</button>
    </div>
  `;

  bindCommonInputs('kofia', form);
  document.querySelector('#kofiaOperation').addEventListener('change', async (event) => {
    form.operation = event.target.value;
    form.filters = {};
    form.metrics = [];
    await renderKofia();
  });
  document.querySelector('#kofiaDateHint').addEventListener('change', async (event) => {
    form.dateHint = event.target.value;
    await renderKofia();
  });
  document.querySelector('#kofiaExactDate').addEventListener('change', (event) => { form.exactDate = event.target.value; });
  document.querySelector('#kofiaStart').addEventListener('change', (event) => { form.start = event.target.value; });
  document.querySelector('#kofiaEnd').addEventListener('change', (event) => { form.end = event.target.value; });
  for (const select of elements.sourcePanel.querySelectorAll('[data-kofia-filter]')) {
    select.addEventListener('change', (event) => {
      form.filters[event.target.dataset.kofiaFilter] = event.target.value;
    });
  }
  document.querySelector('#kofiaMetrics')?.addEventListener('change', (event) => {
    form.metrics = selectedValues(event.target);
  });
  document.querySelector('#kofiaRefresh').addEventListener('click', async () => {
    await renderKofia();
  });
  document.querySelector('#kofiaAdd').addEventListener('click', () => {
    addBundleItem({
      source: 'KOFIA',
      label: `KOFIA · ${op?.label ?? form.operation}`,
      summary: `${Object.entries(form.filters).filter(([, value]) => value).map(([key, value]) => `${key}:${value}`).join(' / ')} / ${form.metrics.join(', ')}`,
      payload: { ...form },
    });
  });
}

function renderKofiaSelectorBlocks(op, form) {
  if (!op) {
    return '';
  }
  return Object.entries(op.selectors ?? {}).map(([key, values]) => `
    <div class="step-block">
      <h3>${key}</h3>
      <label><span>${key}</span><select data-kofia-filter="${key}" size="10">${renderOptions(['ALL', ...values], form.filters[key] ?? 'ALL')}</select></label>
    </div>
  `).join('');
}

async function renderKrx() {
  const form = state.forms.KRX;
  const data = await (await fetch('/api/options?source=KRX')).json();
  elements.sourcePanel.innerHTML = `
    <div class="builder-grid">
      <div class="step-block">
        <h3>1. 지수 선택</h3>
        <label><span>지수</span><select id="krxIndices" multiple size="14">${renderObjectOptions(data.indices, form.indices, 'code', (item) => item.name)}</select></label>
      </div>
      <div class="step-block">
        <h3>기간</h3>
        <div class="option-grid">
          <label><span>시작</span><input id="krxStart" value="${escapeAttr(form.start)}" /></label>
          <label><span>종료</span><input id="krxEnd" value="${escapeAttr(form.end)}" /></label>
        </div>
      </div>
      ${optionGrid('krx', form)}
    </div>
    <div class="step-actions">
      <button class="button primary" id="krxAdd" type="button">비교 번들에 추가</button>
    </div>
  `;

  bindCommonInputs('krx', form);
  document.querySelector('#krxIndices').addEventListener('change', (event) => { form.indices = selectedValues(event.target); });
  document.querySelector('#krxStart').addEventListener('change', (event) => { form.start = event.target.value; });
  document.querySelector('#krxEnd').addEventListener('change', (event) => { form.end = event.target.value; });
  document.querySelector('#krxAdd').addEventListener('click', () => {
    const indices = data.indices.filter((item) => form.indices.includes(item.code));
    addBundleItem({
      source: 'KRX',
      label: `KRX · ${indices.length}개 지수`,
      summary: indices.map((item) => item.name).join(', '),
      payload: { ...form, indices },
    });
  });
}

async function renderIncos() {
  const form = state.forms.INCOS;
  const query = new URLSearchParams({ source: 'INCOS', dataset: form.dataset, entity: form.entity });
  const data = await (await fetch(`/api/options?${query.toString()}`)).json();

  elements.sourcePanel.innerHTML = `
    <div class="builder-grid">
      <div class="step-block">
        <h3>1. 데이터셋</h3>
        <label><span>데이터셋</span><select id="incosDataset" size="8">${renderOptions(['ALL', ...data.datasets.map((item) => item.code)], form.dataset)}</select></label>
      </div>
      <div class="step-block">
        <h3>2. 엔터티</h3>
        <label><span>엔터티</span><select id="incosEntity" size="8">${renderOptions(['ALL', ...data.entities.map((item) => item.code)], form.entity)}</select></label>
      </div>
      <div class="step-block">
        <h3>3. 지표</h3>
        <label><span>지표</span><select id="incosMetrics" multiple size="12">${renderObjectOptions(data.metrics, form.metrics, 'code', (item) => item.title)}</select></label>
      </div>
      <div class="step-block">
        <h3>기간</h3>
        <div class="option-grid">
          <label><span>시작</span><input id="incosStart" value="${escapeAttr(form.start)}" /></label>
          <label><span>종료</span><input id="incosEnd" value="${escapeAttr(form.end)}" /></label>
        </div>
      </div>
      ${optionGrid('incos', form)}
    </div>
    <div class="step-actions">
      <button class="button primary" id="incosAdd" type="button">비교 번들에 추가</button>
    </div>
  `;

  bindCommonInputs('incos', form);
  document.querySelector('#incosDataset').addEventListener('change', async (event) => {
    form.dataset = event.target.value;
    form.entity = 'ALL';
    form.metrics = [];
    await renderIncos();
  });
  document.querySelector('#incosEntity').addEventListener('change', async (event) => {
    form.entity = event.target.value;
    form.metrics = [];
    await renderIncos();
  });
  document.querySelector('#incosMetrics').addEventListener('change', (event) => {
    form.metrics = selectedValues(event.target);
  });
  document.querySelector('#incosAdd').addEventListener('click', () => {
    addBundleItem({
      source: 'INCOS',
      label: `INCOS · ${form.dataset === 'ALL' ? '전체' : form.dataset}`,
      summary: data.metrics.filter((item) => form.metrics.includes(item.code)).map((item) => item.title).join(', '),
      payload: { ...form, seriesKeys: [...form.metrics] },
    });
  });
}

function bindCommonInputs(prefix, form) {
  const precision = document.querySelector(`#${prefix}Precision`);
  const unitMode = document.querySelector(`#${prefix}UnitMode`);
  if (precision) precision.addEventListener('change', (event) => { form.precision = Number(event.target.value); });
  if (unitMode) unitMode.addEventListener('change', (event) => { form.unitMode = event.target.value; });
}

function addBundleItem(item) {
  state.bundle.push({
    id: cryptoRandomId(),
    ...item,
  });
  renderBundle();
}

function renderBundle() {
  elements.bundleList.innerHTML = '';
  if (state.bundle.length === 0) {
    elements.bundleList.innerHTML = '<p class="hint">아직 번들에 추가된 요청이 없다.</p>';
    return;
  }
  for (const item of state.bundle) {
    const fragment = document.querySelector('#bundleItemTemplate').content.cloneNode(true);
    fragment.querySelector('.bundle-source').textContent = item.source;
    fragment.querySelector('.bundle-title').textContent = item.label;
    fragment.querySelector('.bundle-summary').textContent = item.summary || '-';
    fragment.querySelector('.bundle-remove').addEventListener('click', () => {
      state.bundle = state.bundle.filter((entry) => entry.id !== item.id);
      renderBundle();
    });
    elements.bundleList.append(fragment);
  }
}

async function runBundle() {
  if (state.bundle.length === 0) {
    alert('먼저 비교 번들에 요청을 추가하세요.');
    return;
  }

  const results = [];
  for (const item of state.bundle) {
    const response = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: item.source, ...item.payload }),
    });
    const result = await response.json();
    if (result.error) {
      renderResult({ error: `${item.label}: ${result.error}` });
      return;
    }
    results.push({ ...result, bundleLabel: item.label });
  }

  state.lastRun = mergeResults(results);
  renderResult(state.lastRun);
}

function mergeResults(results) {
  const series = [];
  for (const result of results) {
    for (const entry of result.series) {
      series.push({
        key: `${result.source}:${entry.key}`,
        label: `${result.bundleLabel} · ${entry.label}`,
        points: entry.points,
      });
    }
  }

  const periods = [...new Set(series.flatMap((entry) => entry.points.map((point) => point.period)))].sort();
  const rows = periods.map((period) => {
    const record = { period };
    for (const entry of series) {
      record[entry.key] = entry.points.find((point) => point.period === period)?.value ?? null;
    }
    return record;
  });

  return {
    series,
    table: {
      columns: [{ key: 'period', label: '기간' }, ...series.map((entry) => ({ key: entry.key, label: entry.label }))],
      rows,
    },
  };
}

function renderResult(result) {
  if (!result) {
    elements.resultMeta.textContent = '아직 실행된 비교가 없다.';
    elements.chartEmpty.style.display = 'grid';
    elements.chartSvg.style.display = 'none';
    elements.chartLegend.innerHTML = '';
    elements.resultTableHead.innerHTML = '';
    elements.resultTableBody.innerHTML = '';
    return;
  }

  if (result.error) {
    elements.resultMeta.textContent = result.error;
    elements.chartEmpty.style.display = 'grid';
    elements.chartSvg.style.display = 'none';
    elements.chartLegend.innerHTML = '';
    elements.resultTableHead.innerHTML = '';
    elements.resultTableBody.innerHTML = '';
    return;
  }

  elements.resultMeta.textContent = `${result.series.length}개 시리즈 / ${result.table.rows.length}개 기간`;
  elements.chartEmpty.style.display = 'none';
  elements.chartSvg.style.display = 'block';
  renderChart(result.series);
  renderTable(result.table);
}

function renderTable(table) {
  elements.resultTableHead.innerHTML = `<tr>${table.columns.map((column) => `<th>${column.label}</th>`).join('')}</tr>`;
  elements.resultTableBody.innerHTML = table.rows.map((row) => `
    <tr>
      ${table.columns.map((column) => `<td>${row[column.key] ?? '-'}</td>`).join('')}
    </tr>
  `).join('');
}

function renderChart(series) {
  const periods = [...new Set(series.flatMap((entry) => entry.points.map((point) => point.period)))].sort();
  const allValues = series.flatMap((entry) => entry.points.map((point) => point.value)).filter((value) => value !== null && Number.isFinite(value));
  const width = 1080;
  const height = 420;
  const padding = { top: 24, right: 24, bottom: 44, left: 72 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const range = maxValue - minValue || 1;
  const xStep = periods.length > 1 ? innerWidth / (periods.length - 1) : innerWidth / 2;
  const parts = [];

  Array.from({ length: 5 }, (_, index) => {
    const value = maxValue - (range / 4) * index;
    const y = padding.top + (innerHeight / 4) * index;
    parts.push(`<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(57,43,24,0.08)" stroke-width="1" />`);
    parts.push(`<text x="${padding.left - 12}" y="${y + 4}" text-anchor="end" fill="#6a5b48" font-size="12">${escapeHtml(String(roundNumber(value, 2)))}</text>`);
  });

  periods.forEach((period, index) => {
    const x = padding.left + (periods.length === 1 ? innerWidth / 2 : xStep * index);
    parts.push(`<text x="${x}" y="${height - 14}" text-anchor="middle" fill="#6a5b48" font-size="12">${escapeHtml(period)}</text>`);
  });

  series.forEach((entry, index) => {
    const color = COLORS[index % COLORS.length];
    const coordinates = entry.points
      .map((point) => {
        const pIndex = periods.indexOf(point.period);
        if (pIndex === -1 || !Number.isFinite(point.value)) return null;
        const x = padding.left + (periods.length === 1 ? innerWidth / 2 : xStep * pIndex);
        const y = padding.top + ((maxValue - point.value) / range) * innerHeight;
        return { x, y, value: point.value, period: point.period };
      })
      .filter(Boolean);
    if (!coordinates.length) return;
    parts.push(`<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${coordinates.map((p) => `${p.x},${p.y}`).join(' ')}" />`);
  });

  elements.chartSvg.innerHTML = parts.join('');
  elements.chartLegend.innerHTML = series.map((entry, index) => `
    <div class="legend-item">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${COLORS[index % COLORS.length]}"></span>
      <span>${entry.label}</span>
    </div>
  `).join('');
}

function downloadCsv() {
  if (!state.lastRun) return;
  const lines = [
    state.lastRun.table.columns.map((column) => csvEscape(column.label)).join(','),
    ...state.lastRun.table.rows.map((row) => state.lastRun.table.columns.map((column) => csvEscape(row[column.key] ?? '')).join(',')),
  ];
  downloadBlob('finance-comparison.csv', new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }));
}

function downloadExcel() {
  if (!state.lastRun) return;
  const html = `
    <html><head><meta charset="utf-8"></head><body>
    <table>
      <thead><tr>${state.lastRun.table.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
      <tbody>
        ${state.lastRun.table.rows.map((row) => `<tr>${state.lastRun.table.columns.map((column) => `<td>${row[column.key] ?? ''}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>
    </body></html>
  `;
  downloadBlob('finance-comparison.xls', new Blob([html], { type: 'application/vnd.ms-excel' }));
}

function downloadJson() {
  if (!state.lastRun) return;
  downloadBlob('finance-comparison.json', new Blob([JSON.stringify(state.lastRun, null, 2)], { type: 'application/json;charset=utf-8' }));
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderOptions(values, selected) {
  return values.map((value) => {
    const label = value === 'ALL' ? '전체' : value;
    return `<option value="${escapeAttr(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

function renderObjectOptions(items, selected, keyField = 'code', labelFn = (item) => item.name) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : [selected]);
  return items.map((item) => `<option value="${escapeAttr(item[keyField])}" ${selectedSet.has(item[keyField]) ? 'selected' : ''}>${escapeHtml(labelFn(item))}</option>`).join('');
}

function selectedValues(select) {
  return [...select.selectedOptions].map((option) => option.value);
}

function unitModeLabel(value) {
  if (value === 'million') return '백만 단위';
  if (value === 'billion') return '십억 단위';
  return '원본';
}

function roundNumber(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2, 10);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value ?? '');
}
