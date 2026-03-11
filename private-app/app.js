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
  document.body.innerHTML = `<main class="shell"><section class="panel"><h1>App init failed</h1><p>${escapeHtml(error.message)}</p></section></main>`;
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
    if (!(await login())) return;
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
    state.lastRun = null;
    renderBundle();
    renderResult(null);
  });

  elements.downloadCsvButton.addEventListener('click', downloadCsv);
  elements.downloadExcelButton.addEventListener('click', downloadExcel);
  elements.downloadJsonButton.addEventListener('click', downloadJson);
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
    alert('Login failed');
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
  elements.sessionText.textContent = `Signed in as ${state.session.username}. Build one or more requests, then merge them into one comparison run.`;
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
  if (state.activeSource === 'FISIS') return renderFisis();
  if (state.activeSource === 'ECOS') return renderEcos();
  if (state.activeSource === 'KOFIA') return renderKofia();
  if (state.activeSource === 'KRX') return renderKrx();
  if (state.activeSource === 'INCOS') return renderIncos();
}

function renderOptionGrid(prefix, form) {
  return `
    <div class="step-block">
      <h3>Display options</h3>
      <div class="option-grid">
        <label>
          <span>Precision</span>
          <input id="${prefix}Precision" type="number" value="${form.precision}" min="0" max="6" />
        </label>
        <label>
          <span>Unit mode</span>
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
        <h3>1. Industry</h3>
        <label><span>Financial industry</span><select id="fisisIndustry" size="9">${renderOptions(['ALL', ...data.industries], form.industry)}</select></label>
      </div>
      <div class="step-block">
        <h3>2. Companies</h3>
        <label><span>Compare companies</span>${renderCheckList('fisisCompanies', data.companies, form.companies)}</label>
      </div>
      <div class="step-block">
        <h3>3. Statistics table</h3>
        <label><span>Keyword</span><input id="fisisKeyword" value="${escapeAttr(form.keyword)}" /></label>
        <label><span>Statistics table</span><select id="fisisStatistic" size="10">${renderObjectOptions(data.statistics, form.statistic, 'code', (item) => `${item.code} · ${item.name}`)}</select></label>
      </div>
      <div class="step-block">
        <h3>4. Accounts</h3>
        <label><span>Statistics accounts</span>${renderCheckList('fisisAccounts', data.accounts, form.accounts)}</label>
      </div>
      <div class="step-block">
        <h3>Period</h3>
        <div class="option-grid">
          <label><span>Term</span><select id="fisisTerm">${renderOptions(['Q', 'M', 'Y'], form.term)}</select></label>
          <label><span>Start</span><input id="fisisStart" value="${escapeAttr(form.start)}" /></label>
          <label><span>End</span><input id="fisisEnd" value="${escapeAttr(form.end)}" /></label>
        </div>
      </div>
      ${renderOptionGrid('fisis', form)}
    </div>
    <div class="step-actions">
      <button class="button primary" id="fisisAdd" type="button">Add to bundle</button>
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
  bindCheckList('fisisCompanies', (values) => { form.companies = values; });
  bindCheckList('fisisAccounts', (values) => { form.accounts = values; });
  document.querySelector('#fisisTerm').addEventListener('change', (event) => { form.term = event.target.value; });
  document.querySelector('#fisisStart').addEventListener('change', (event) => { form.start = event.target.value; });
  document.querySelector('#fisisEnd').addEventListener('change', (event) => { form.end = event.target.value; });
  document.querySelector('#fisisAdd').addEventListener('click', () => {
    const statistic = data.statistics.find((item) => item.code === form.statistic);
    const companies = data.companies.filter((item) => form.companies.includes(item.code));
    const accounts = data.accounts.filter((item) => form.accounts.includes(item.code));
    addBundleItem({
      source: 'FISIS',
      label: `FISIS · ${statistic?.name ?? 'Statistics'} · ${companies.length} companies`,
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
        <h3>1. Statistics table</h3>
        <label><span>Keyword</span><input id="ecosKeyword" value="${escapeAttr(form.keyword)}" /></label>
        <label><span>Table</span><select id="ecosTable" size="12">${renderObjectOptions(data.tables, form.table, 'code', (item) => `${item.code} · ${item.name}`)}</select></label>
      </div>
      <div class="step-block">
        <h3>2. Items</h3>
        <label><span>Items</span>${renderCheckList('ecosItems', data.items, form.items, 'code', (item) => `${item.code} · ${item.name} (${item.cycle})`)}</label>
      </div>
      <div class="step-block">
        <h3>Period</h3>
        <div class="option-grid">
          <label><span>Cycle</span><select id="ecosCycle">${renderOptions(['D', 'M', 'Q', 'A'], form.cycle)}</select></label>
          <label><span>Start</span><input id="ecosStart" value="${escapeAttr(form.start)}" /></label>
          <label><span>End</span><input id="ecosEnd" value="${escapeAttr(form.end)}" /></label>
        </div>
      </div>
      ${renderOptionGrid('ecos', form)}
    </div>
    <div class="step-actions">
      <button class="button primary" id="ecosAdd" type="button">Add to bundle</button>
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
  bindCheckList('ecosItems', (values) => { form.items = values; });
  document.querySelector('#ecosCycle').addEventListener('change', (event) => { form.cycle = event.target.value; });
  document.querySelector('#ecosStart').addEventListener('change', (event) => { form.start = event.target.value; });
  document.querySelector('#ecosEnd').addEventListener('change', (event) => { form.end = event.target.value; });
  document.querySelector('#ecosAdd').addEventListener('click', () => {
    const table = data.tables.find((item) => item.code === form.table);
    const items = data.items.filter((item) => form.items.includes(item.code));
    addBundleItem({
      source: 'ECOS',
      label: `ECOS · ${table?.name ?? 'Statistics'} · ${items.length} items`,
      summary: items.map((item) => item.name).join(', '),
      payload: { ...form, table, items },
    });
  });
}

async function renderKofia() {
  const form = state.forms.KOFIA;
  const query = new URLSearchParams({ source: 'KOFIA', operation: form.operation, dateHint: form.dateHint });
  const data = await (await fetch(`/api/options?${query.toString()}`)).json();
  const op = data.operationOptions;

  elements.sourcePanel.innerHTML = `
    <div class="builder-grid">
      <div class="step-block">
        <h3>1. Operation</h3>
        <label><span>KOFIA operation</span><select id="kofiaOperation" size="10">${renderObjectOptions(data.operations, form.operation, 'code', (item) => item.name)}</select></label>
      </div>
      <div class="step-block">
        <h3>2. Date controls</h3>
        <div class="option-grid">
          <label><span>Selector hint date</span><input id="kofiaDateHint" value="${escapeAttr(form.dateHint)}" /></label>
          <label><span>Exact date</span><input id="kofiaExactDate" value="${escapeAttr(form.exactDate)}" placeholder="${op?.dateMode === 'M' ? 'YYYYMM' : 'YYYYMMDD'}" /></label>
          <label><span>Start</span><input id="kofiaStart" value="${escapeAttr(form.start)}" placeholder="${op?.dateMode === 'M' ? 'YYYYMM' : 'YYYYMMDD'}" /></label>
          <label><span>End</span><input id="kofiaEnd" value="${escapeAttr(form.end)}" placeholder="${op?.dateMode === 'M' ? 'YYYYMM' : 'YYYYMMDD'}" /></label>
        </div>
        <p class="hint">Use exact date for a single snapshot. Use start/end for a range. Monthly operations expect YYYYMM, daily operations expect YYYYMMDD.</p>
      </div>
      ${renderKofiaSelectorBlocks(op, form)}
      <div class="step-block">
        <h3>3. Metrics</h3>
        <label><span>Metric fields</span>${renderCheckList('kofiaMetrics', (op?.valueFields ?? []).map((field) => ({ code: field, name: field })), form.metrics)}</label>
      </div>
      ${renderOptionGrid('kofia', form)}
    </div>
    <div class="step-actions">
      <button class="button subtle" id="kofiaRefresh" type="button">Reload selectors</button>
      <button class="button primary" id="kofiaAdd" type="button">Add to bundle</button>
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
  bindCheckList('kofiaMetrics', (values) => { form.metrics = values; });
  document.querySelector('#kofiaRefresh').addEventListener('click', async () => {
    await renderKofia();
  });
  document.querySelector('#kofiaAdd').addEventListener('click', () => {
    addBundleItem({
      source: 'KOFIA',
      label: `KOFIA · ${op?.label ?? form.operation}`,
      summary: `${Object.entries(form.filters).filter(([, value]) => value && value !== 'ALL').map(([key, value]) => `${key}:${value}`).join(' / ')} / ${(form.metrics.length ? form.metrics : op?.valueFields ?? []).join(', ')}`,
      payload: { ...form },
    });
  });
}

function renderKofiaSelectorBlocks(op, form) {
  if (!op) return '';
  return Object.entries(op.selectors ?? []).map(([key, values]) => `
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
        <h3>1. Indices</h3>
        <label><span>KRX indices</span>${renderCheckList('krxIndices', data.indices, form.indices, 'code', (item) => item.name)}</label>
      </div>
      <div class="step-block">
        <h3>KRX service catalog</h3>
        <div class="bundle-summary">
          ${Object.entries(data.serviceCatalog ?? {}).map(([group, items]) => `
            <p><strong>${group}</strong>: ${items.map((item) => `${item.name}${item.wired ? ' (live)' : ' (catalog)'}`).join(', ')}</p>
          `).join('')}
        </div>
      </div>
      <div class="step-block">
        <h3>Period</h3>
        <div class="option-grid">
          <label><span>Start</span><input id="krxStart" value="${escapeAttr(form.start)}" /></label>
          <label><span>End</span><input id="krxEnd" value="${escapeAttr(form.end)}" /></label>
        </div>
      </div>
      ${renderOptionGrid('krx', form)}
    </div>
    <div class="step-actions">
      <button class="button primary" id="krxAdd" type="button">Add to bundle</button>
    </div>
  `;

  bindCommonInputs('krx', form);
  bindCheckList('krxIndices', (values) => { form.indices = values; });
  document.querySelector('#krxStart').addEventListener('change', (event) => { form.start = event.target.value; });
  document.querySelector('#krxEnd').addEventListener('change', (event) => { form.end = event.target.value; });
  document.querySelector('#krxAdd').addEventListener('click', () => {
    const indices = data.indices.filter((item) => form.indices.includes(item.code));
    addBundleItem({
      source: 'KRX',
      label: `KRX · ${indices.length} indices`,
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
        <h3>1. Dataset</h3>
        <label><span>Dataset</span><select id="incosDataset" size="8">${renderOptions(['ALL', ...data.datasets.map((item) => item.code)], form.dataset)}</select></label>
      </div>
      <div class="step-block">
        <h3>2. Entity</h3>
        <label><span>Entity</span><select id="incosEntity" size="8">${renderOptions(['ALL', ...data.entities.map((item) => item.code)], form.entity)}</select></label>
      </div>
      <div class="step-block">
        <h3>3. Metrics</h3>
        <label><span>Metrics</span>${renderCheckList('incosMetrics', data.metrics, form.metrics, 'code', (item) => item.title)}</label>
      </div>
      <div class="step-block">
        <h3>Period</h3>
        <div class="option-grid">
          <label><span>Start</span><input id="incosStart" value="${escapeAttr(form.start)}" /></label>
          <label><span>End</span><input id="incosEnd" value="${escapeAttr(form.end)}" /></label>
        </div>
      </div>
      ${renderOptionGrid('incos', form)}
    </div>
    <div class="step-actions">
      <button class="button primary" id="incosAdd" type="button">Add to bundle</button>
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
  bindCheckList('incosMetrics', (values) => { form.metrics = values; });
  document.querySelector('#incosStart').addEventListener('change', (event) => { form.start = event.target.value; });
  document.querySelector('#incosEnd').addEventListener('change', (event) => { form.end = event.target.value; });
  document.querySelector('#incosAdd').addEventListener('click', () => {
    addBundleItem({
      source: 'INCOS',
      label: `INCOS · ${form.dataset === 'ALL' ? 'All datasets' : form.dataset}`,
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
  state.bundle.push({ id: createId(), ...item });
  renderBundle();
}

function renderBundle() {
  elements.bundleList.innerHTML = '';
  if (state.bundle.length === 0) {
    elements.bundleList.innerHTML = '<p class="hint">No requests in the bundle yet.</p>';
    return;
  }

  for (const item of state.bundle) {
    const fragment = elements.bundleItemTemplate.content.cloneNode(true);
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
    alert('Add at least one request to the bundle first.');
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
    for (const item of result.series) {
      series.push({
        key: `${result.source}:${item.key}`,
        label: `${result.bundleLabel} · ${item.label}`,
        points: item.points,
      });
    }
  }

  const periods = [...new Set(series.flatMap((item) => item.points.map((point) => point.period)))].sort();
  const rows = periods.map((period) => {
    const row = { period };
    for (const item of series) {
      row[item.key] = item.points.find((point) => point.period === period)?.value ?? null;
    }
    return row;
  });

  return {
    series,
    table: {
      columns: [{ key: 'period', label: 'Period' }, ...series.map((item) => ({ key: item.key, label: item.label }))],
      rows,
    },
  };
}

function renderResult(result) {
  if (!result) {
    elements.resultMeta.textContent = 'No comparison has been run yet.';
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

  elements.resultMeta.textContent = `${result.series.length} series across ${result.table.rows.length} periods`;
  elements.chartEmpty.style.display = 'none';
  elements.chartSvg.style.display = 'block';
  renderChart(result.series);
  renderTable(result.table);
}

function renderTable(table) {
  elements.resultTableHead.innerHTML = `<tr>${table.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr>`;
  elements.resultTableBody.innerHTML = table.rows.map((row) => `
    <tr>
      ${table.columns.map((column) => `<td>${row[column.key] ?? '-'}</td>`).join('')}
    </tr>
  `).join('');
}

function renderChart(series) {
  const periods = [...new Set(series.flatMap((item) => item.points.map((point) => point.period)))].sort();
  const values = series.flatMap((item) => item.points.map((point) => point.value)).filter((value) => value !== null && Number.isFinite(value));
  const width = 1080;
  const height = 420;
  const padding = { top: 24, right: 24, bottom: 44, left: 72 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;
  const xStep = periods.length > 1 ? innerWidth / (periods.length - 1) : innerWidth / 2;
  const parts = [];

  Array.from({ length: 5 }, (_, index) => {
    const value = maxValue - (range / 4) * index;
    const y = padding.top + (innerHeight / 4) * index;
    parts.push(`<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(57,43,24,0.08)" stroke-width="1" />`);
    parts.push(`<text x="${padding.left - 12}" y="${y + 4}" text-anchor="end" fill="#6a5b48" font-size="12">${escapeHtml(String(roundNumber(value, 2)))}</text>`);
  });

  const tickEvery = Math.max(1, Math.ceil(periods.length / 10));
  periods.forEach((period, index) => {
    if (index % tickEvery !== 0 && index !== periods.length - 1) return;
    const x = padding.left + (periods.length === 1 ? innerWidth / 2 : xStep * index);
    parts.push(`<text x="${x}" y="${height - 14}" text-anchor="middle" fill="#6a5b48" font-size="12">${escapeHtml(period)}</text>`);
  });

  series.forEach((item, index) => {
    const color = COLORS[index % COLORS.length];
    const coordinates = item.points
      .map((point) => {
        const pointIndex = periods.indexOf(point.period);
        if (pointIndex === -1 || !Number.isFinite(point.value)) return null;
        const x = padding.left + (periods.length === 1 ? innerWidth / 2 : xStep * pointIndex);
        const y = padding.top + ((maxValue - point.value) / range) * innerHeight;
        return { x, y };
      })
      .filter(Boolean);
    if (!coordinates.length) return;
    parts.push(`<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${coordinates.map((p) => `${p.x},${p.y}`).join(' ')}" />`);
  });

  elements.chartSvg.innerHTML = parts.join('');
  elements.chartLegend.innerHTML = series.map((item, index) => `
    <div class="legend-item">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${COLORS[index % COLORS.length]}"></span>
      <span>${escapeHtml(item.label)}</span>
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
        <tbody>${state.lastRun.table.rows.map((row) => `<tr>${state.lastRun.table.columns.map((column) => `<td>${row[column.key] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>
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
    const label = value === 'ALL' ? 'All' : value;
    return `<option value="${escapeAttr(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

function renderObjectOptions(items, selected, keyField = 'code', labelFn = (item) => item.name) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : [selected]);
  return items.map((item) => `<option value="${escapeAttr(item[keyField])}" ${selectedSet.has(item[keyField]) ? 'selected' : ''}>${escapeHtml(labelFn(item))}</option>`).join('');
}

function renderCheckList(id, items, selected, keyField = 'code', labelFn = (item) => item.name) {
  const selectedSet = new Set(Array.isArray(selected) ? selected : [selected]);
  return `
    <div class="check-list" id="${id}">
      ${items.map((item) => `
        <label class="check-item">
          <input type="checkbox" value="${escapeAttr(item[keyField])}" ${selectedSet.has(item[keyField]) ? 'checked' : ''} />
          <span>${escapeHtml(labelFn(item))}</span>
        </label>
      `).join('')}
    </div>
  `;
}

function bindCheckList(id, onChange) {
  const root = document.querySelector(`#${id}`);
  if (!root) return;
  const sync = () => {
    const values = [...root.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
    onChange(values);
  };
  for (const input of root.querySelectorAll('input[type="checkbox"]')) {
    input.addEventListener('change', sync);
  }
  sync();
}

function unitModeLabel(value) {
  if (value === 'million') return 'Millions';
  if (value === 'billion') return 'Billions';
  return 'Raw';
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

function createId() {
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
