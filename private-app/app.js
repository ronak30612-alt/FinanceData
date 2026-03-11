const state = {
  authenticated: false,
  username: null,
  workflows: null,
  activeSource: 'FISIS',
  fisis: { industry: 'ALL', statisticKeyword: '', statistic: null },
  ecos: { keyword: '', table: null },
  kofia: { keyword: '' },
  incos: { dataset: 'ALL', entity: 'ALL' },
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
  resultTableTemplate: document.querySelector('#resultTableTemplate'),
};

boot().catch((error) => {
  document.body.innerHTML = `<main class="shell"><section class="panel"><h1>앱 초기화 실패</h1><p>${escapeHtml(error.message)}</p></section></main>`;
});

async function boot() {
  await refreshSession();
  wireAuthEvents();
  if (state.authenticated) {
    await loadWorkflows();
    showApp();
  } else {
    showLogin();
  }
}

function wireAuthEvents() {
  elements.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await login();
  });

  elements.logoutButton.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    state.authenticated = false;
    showLogin();
  });
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
    return;
  }
  await refreshSession();
  await loadWorkflows();
  showApp();
}

async function refreshSession() {
  const response = await fetch('/api/session');
  const payload = await response.json();
  state.authenticated = Boolean(payload.authenticated);
  state.username = payload.username;
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
  elements.sessionText.textContent = `${state.username}로 로그인됨`;
  renderTabs();
  renderSourcePanel();
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
      renderSourcePanel();
    });
  }
}

async function renderSourcePanel() {
  if (state.activeSource === 'FISIS') {
    await renderFisisPanel();
    return;
  }
  if (state.activeSource === 'ECOS') {
    await renderEcosPanel();
    return;
  }
  if (state.activeSource === 'KRX') {
    await renderKrxPanel();
    return;
  }
  if (state.activeSource === 'INCOS') {
    await renderIncosPanel();
    return;
  }
  if (state.activeSource === 'KOFIA') {
    await renderKofiaPanel();
  }
}

function commonOptionControls(prefix, defaults = {}) {
  return `
    <div class="workflow-card">
      <h3>표시 옵션</h3>
      <div class="control-row">
        <label><span>정밀도</span><input id="${prefix}Precision" type="number" value="${defaults.precision ?? 2}" min="0" max="6" /></label>
        <label><span>단위</span>
          <select id="${prefix}UnitMode">
            <option value="raw">원본</option>
            <option value="million">백만 단위</option>
            <option value="billion">십억 단위</option>
          </select>
        </label>
      </div>
    </div>
  `;
}

async function renderFisisPanel() {
  const query = new URLSearchParams({
    source: 'FISIS',
    industry: state.fisis.industry,
    keyword: state.fisis.statisticKeyword,
    statistic: state.fisis.statistic?.code ?? '',
  });
  const response = await fetch(`/api/options?${query.toString()}`);
  const data = await response.json();

  elements.sourcePanel.innerHTML = `
    <div class="workflow-grid">
      <div class="workflow-card">
        <h3>1. 금융업권 선택</h3>
        <label><span>업권</span><select id="fisisIndustry" size="10">${renderOptionList(['ALL', ...data.industries], state.fisis.industry)}</select></label>
      </div>
      <div class="workflow-card">
        <h3>2. 회사 선택</h3>
        <label><span>비교 회사</span><select id="fisisCompanies" multiple size="10">${data.companies.map((item) => `<option value="${item.code}">${item.name}</option>`).join('')}</select></label>
      </div>
      <div class="workflow-card">
        <h3>3. 통계표 선택</h3>
        <label><span>통계표 필터</span><input id="fisisStatisticKeyword" value="${escapeAttr(state.fisis.statisticKeyword)}" /></label>
        <label><span>통계표</span><select id="fisisStatistic" size="10">${data.statistics.map((item) => `<option value="${item.code}" ${item.code === state.fisis.statistic?.code ? 'selected' : ''}>${item.code} · ${item.name}</option>`).join('')}</select></label>
      </div>
      <div class="workflow-card">
        <h3>4. 통계항목 선택</h3>
        <label><span>항목</span><select id="fisisAccounts" multiple size="10">${data.accounts.map((item) => `<option value="${item.code}">${item.name}</option>`).join('')}</select></label>
      </div>
      ${commonOptionControls('fisis')}
      <div class="workflow-card">
        <h3>기간</h3>
        <div class="control-row">
          <label><span>주기</span><select id="fisisTerm"><option value="Q">분기</option><option value="M">월</option><option value="Y">년</option></select></label>
          <label><span>시작</span><input id="fisisStart" value="202303" /></label>
          <label><span>종료</span><input id="fisisEnd" value="202512" /></label>
        </div>
      </div>
    </div>
    <div class="step-actions">
      <button class="button primary" id="runFisisQuery" type="button">FISIS 조회</button>
    </div>
    <div id="fisisResult"></div>
  `;

  document.querySelector('#fisisIndustry').addEventListener('change', async (event) => {
    state.fisis.industry = event.target.value;
    state.fisis.statistic = null;
    await renderFisisPanel();
  });
  document.querySelector('#fisisStatisticKeyword').addEventListener('change', async (event) => {
    state.fisis.statisticKeyword = event.target.value;
    await renderFisisPanel();
  });
  document.querySelector('#fisisStatistic').addEventListener('change', async (event) => {
    const selected = data.statistics.find((item) => item.code === event.target.value) ?? null;
    state.fisis.statistic = selected;
    await renderFisisPanel();
  });
  document.querySelector('#runFisisQuery').addEventListener('click', async () => {
    const companies = selectedOptions('#fisisCompanies', data.companies);
    const accounts = selectedOptions('#fisisAccounts', data.accounts);
    const result = await postQuery({
      source: 'FISIS',
      companies,
      statistic: state.fisis.statistic,
      accounts,
      term: document.querySelector('#fisisTerm').value,
      start: document.querySelector('#fisisStart').value,
      end: document.querySelector('#fisisEnd').value,
      precision: document.querySelector('#fisisPrecision').value,
      unitMode: document.querySelector('#fisisUnitMode').value,
    });
    renderResult('#fisisResult', result);
  });
}

async function renderEcosPanel() {
  const query = new URLSearchParams({
    source: 'ECOS',
    keyword: state.ecos.keyword,
    statCode: state.ecos.table?.code ?? '',
  });
  const response = await fetch(`/api/options?${query.toString()}`);
  const data = await response.json();

  elements.sourcePanel.innerHTML = `
    <div class="workflow-grid">
      <div class="workflow-card">
        <h3>1. 통계표 검색</h3>
        <label><span>검색어</span><input id="ecosKeyword" value="${escapeAttr(state.ecos.keyword)}" /></label>
        <label><span>통계표</span><select id="ecosTable" size="12">${data.tables.map((item) => `<option value="${item.code}" ${item.code === state.ecos.table?.code ? 'selected' : ''}>${item.code} · ${item.name}</option>`).join('')}</select></label>
      </div>
      <div class="workflow-card">
        <h3>2. 세부 ITEM 선택</h3>
        <label><span>ITEM</span><select id="ecosItems" multiple size="12">${data.items.map((item) => `<option value="${item.code}">${item.code} · ${item.name} (${item.cycle})</option>`).join('')}</select></label>
      </div>
      ${commonOptionControls('ecos')}
      <div class="workflow-card">
        <h3>기간</h3>
        <div class="control-row">
          <label><span>주기</span><select id="ecosCycle"><option value="M">월</option><option value="D">일</option><option value="Q">분기</option><option value="A">년</option></select></label>
          <label><span>시작</span><input id="ecosStart" value="202301" /></label>
          <label><span>종료</span><input id="ecosEnd" value="202602" /></label>
        </div>
      </div>
    </div>
    <div class="step-actions">
      <button class="button primary" id="runEcosQuery" type="button">ECOS 조회</button>
    </div>
    <div id="ecosResult"></div>
  `;

  document.querySelector('#ecosKeyword').addEventListener('change', async (event) => {
    state.ecos.keyword = event.target.value;
    await renderEcosPanel();
  });
  document.querySelector('#ecosTable').addEventListener('change', async (event) => {
    state.ecos.table = data.tables.find((item) => item.code === event.target.value) ?? null;
    await renderEcosPanel();
  });
  document.querySelector('#runEcosQuery').addEventListener('click', async () => {
    const items = selectedOptions('#ecosItems', data.items);
    const result = await postQuery({
      source: 'ECOS',
      table: state.ecos.table,
      items,
      cycle: document.querySelector('#ecosCycle').value,
      start: document.querySelector('#ecosStart').value,
      end: document.querySelector('#ecosEnd').value,
      precision: document.querySelector('#ecosPrecision').value,
      unitMode: document.querySelector('#ecosUnitMode').value,
    });
    renderResult('#ecosResult', result);
  });
}

async function renderKrxPanel() {
  const response = await fetch('/api/options?source=KRX');
  const data = await response.json();
  elements.sourcePanel.innerHTML = `
    <div class="workflow-grid">
      <div class="workflow-card">
        <h3>1. 지수 선택</h3>
        <label><span>지수</span><select id="krxIndices" multiple size="14">${data.indices.map((item) => `<option value="${item.code}">${item.name}</option>`).join('')}</select></label>
      </div>
      ${commonOptionControls('krx')}
      <div class="workflow-card">
        <h3>기간</h3>
        <div class="control-row">
          <label><span>시작</span><input id="krxStart" value="20251201" /></label>
          <label><span>종료</span><input id="krxEnd" value="20260310" /></label>
        </div>
      </div>
    </div>
    <div class="step-actions">
      <button class="button primary" id="runKrxQuery" type="button">KRX 조회</button>
    </div>
    <div id="krxResult"></div>
  `;

  document.querySelector('#runKrxQuery').addEventListener('click', async () => {
    const indices = selectedOptions('#krxIndices', data.indices);
    const result = await postQuery({
      source: 'KRX',
      indices,
      start: document.querySelector('#krxStart').value,
      end: document.querySelector('#krxEnd').value,
      precision: document.querySelector('#krxPrecision').value,
      unitMode: document.querySelector('#krxUnitMode').value,
    });
    renderResult('#krxResult', result);
  });
}

async function renderIncosPanel() {
  const query = new URLSearchParams({
    source: 'INCOS',
    dataset: state.incos.dataset,
    entity: state.incos.entity,
  });
  const response = await fetch(`/api/options?${query.toString()}`);
  const data = await response.json();

  elements.sourcePanel.innerHTML = `
    <div class="workflow-grid">
      <div class="workflow-card">
        <h3>1. 데이터셋 선택</h3>
        <label><span>데이터셋</span><select id="incosDataset" size="8">${renderObjectOptions(data.datasets, state.incos.dataset)}</select></label>
      </div>
      <div class="workflow-card">
        <h3>2. 종목/기관 선택</h3>
        <label><span>엔터티</span><select id="incosEntity" size="8">${renderObjectOptions(data.entities, state.incos.entity)}</select></label>
      </div>
      <div class="workflow-card">
        <h3>3. 지표 선택</h3>
        <label><span>지표</span><select id="incosMetrics" multiple size="12">${data.metrics.map((item) => `<option value="${item.code}">${item.title}</option>`).join('')}</select></label>
      </div>
      ${commonOptionControls('incos')}
      <div class="workflow-card">
        <h3>기간</h3>
        <div class="control-row">
          <label><span>시작</span><input id="incosStart" value="2023-01" /></label>
          <label><span>종료</span><input id="incosEnd" value="2025-12" /></label>
        </div>
      </div>
    </div>
    <div class="step-actions">
      <button class="button primary" id="runIncosQuery" type="button">INCOS 조회</button>
    </div>
    <div id="incosResult"></div>
  `;

  document.querySelector('#incosDataset').addEventListener('change', async (event) => {
    state.incos.dataset = event.target.value;
    state.incos.entity = 'ALL';
    await renderIncosPanel();
  });
  document.querySelector('#incosEntity').addEventListener('change', async (event) => {
    state.incos.entity = event.target.value;
    await renderIncosPanel();
  });
  document.querySelector('#runIncosQuery').addEventListener('click', async () => {
    const selected = [...document.querySelector('#incosMetrics').selectedOptions].map((option) => option.value);
    const result = await postQuery({
      source: 'INCOS',
      seriesKeys: selected,
      start: document.querySelector('#incosStart').value,
      end: document.querySelector('#incosEnd').value,
      precision: document.querySelector('#incosPrecision').value,
      unitMode: document.querySelector('#incosUnitMode').value,
    });
    renderResult('#incosResult', result);
  });
}

async function renderKofiaPanel() {
  const query = new URLSearchParams({ source: 'KOFIA', keyword: state.kofia.keyword });
  const response = await fetch(`/api/options?${query.toString()}`);
  const data = await response.json();
  elements.sourcePanel.innerHTML = `
    <div class="workflow-grid">
      <div class="workflow-card">
        <h3>1. 서비스 카탈로그</h3>
        <label><span>검색어</span><input id="kofiaKeyword" value="${escapeAttr(state.kofia.keyword)}" /></label>
        <label><span>서비스</span><select id="kofiaServices" size="14">${data.services.map((item) => `<option value="${item.code}">${item.code} · ${item.name}</option>`).join('')}</select></label>
        <p class="note">${data.note}</p>
      </div>
    </div>
  `;
  document.querySelector('#kofiaKeyword').addEventListener('change', async (event) => {
    state.kofia.keyword = event.target.value;
    await renderKofiaPanel();
  });
}

function renderOptionList(values, selected) {
  return values.map((value) => `<option value="${escapeAttr(value)}" ${value === selected ? 'selected' : ''}>${value === 'ALL' ? '전체' : value}</option>`).join('');
}

function renderObjectOptions(values, selected) {
  return ['ALL', ...values.map((item) => item.code)].map((value) => {
    const label = value === 'ALL' ? '전체' : values.find((item) => item.code === value)?.name ?? value;
    return `<option value="${escapeAttr(value)}" ${value === selected ? 'selected' : ''}>${label}</option>`;
  }).join('');
}

function selectedOptions(selector, pool) {
  const values = [...document.querySelector(selector).selectedOptions].map((option) => option.value);
  return pool.filter((item) => values.includes(item.code));
}

async function postQuery(payload) {
  const response = await fetch('/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return response.json();
}

function renderResult(selector, result) {
  const host = document.querySelector(selector);
  if (result.error) {
    host.innerHTML = `<p class="error">${escapeHtml(result.error)}</p>`;
    return;
  }
  const fragment = elements.resultTableTemplate.content.cloneNode(true);
  const tableHead = fragment.querySelector('thead');
  const tableBody = fragment.querySelector('tbody');
  tableHead.innerHTML = `<tr>${result.table.columns.map((column) => `<th>${column.label}</th>`).join('')}</tr>`;
  tableBody.innerHTML = result.table.rows.map((row) => `
    <tr>
      ${result.table.columns.map((column) => `<td>${row[column.key] ?? '-'}</td>`).join('')}
    </tr>
  `).join('');
  host.innerHTML = '';
  host.append(fragment);
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
