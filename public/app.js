const DEFAULT_PASSWORD = "RECEBA99";

const state = {
  view: "operacional",
  opPage: "kpis",
  cadastroView: "novos",
  chartMetrics: new Set(["orders", "tsh", "critical"]),
  trendPeriod: "daily",
  signupPeriod: "monthly",
  signups: null,
  signupPeople: [],
  signupFilter: { start: "", end: "", praca: "", origin: "", modal: "", status: "", search: "" },
  meta: null,
  dashboard: null,
  finance: null,
  transferAudit: null,
  promotions: null,
  dailyResult: null,
  user: null,
  users: [],
  authMode: "local",
  supabaseEnabled: false,
  accessToken: "",
  refreshToken: "",
  pendingFirstAccessEmail: "",
  pendingForgotEmail: "",
  auditFilter: { status: "problemas", search: "" },
  // A conferencia dia a dia cresce um cartao por relatorio importado: sem filtro
  // proprio a lista viraria uma parede de cartoes.
  auditDayFilter: { status: "todos", month: "todos", search: "", order: "desc", expanded: false },
  tableSort: {
    hotzones: { key: "city", direction: "asc" },
    drivers: { key: "city", direction: "asc" },
    financeDrivers: { key: "totalDaily", direction: "desc" },
    auditRows: { key: "risk", direction: "desc" },
    signupPraca: { key: "signups", direction: "desc" },
    signupOrigin: { key: "signups", direction: "desc" },
    signupRows: { key: "date", direction: "desc" },
  },
};

const $ = (id) => document.getElementById(id);
const SESSION_KEY = "receba:activeSession";
const FULL_ACCESS_EMAIL = "recebapoder2026@gmail.com";
const ALLOWED_USERS = [
  "recebageral2026@gmail.com",
  "recebaoperações2026@gmail.com",
  "recebaoperacoes2026@gmail.com",
  "recebaatuacoes2026@gmail.com",
  "recebafinanceiro2026@gmail.com",
  FULL_ACCESS_EMAIL,
];

const fmtInt = (value) => Math.round(value || 0).toLocaleString("pt-BR");
const fmtMoney = (value) => (value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtHour = (value) => `${(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h`;
const fmtPct = (value) => `${((value || 0) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const fmtDateTime = (value) => value
  ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
  : "--";
const fmtDate = (value) => value
  ? new Date(value).toLocaleDateString("pt-BR")
  : "--";
const normalizeText = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "");

// Rotulo em cima de cada coluna: com muitas colunas o valor cheio nao cabe, entao
// encurta ("R$ 66,8 mil") e o exato continua no hover e na tabela.
const fmtMoneyShort = (value) => {
  const abs = Math.abs(value || 0);
  const compact = (divisor, suffix) => `R$ ${((value || 0) / divisor)
    .toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${suffix}`;
  if (abs >= 1000000) return compact(1000000, "mi");
  if (abs >= 1000) return compact(1000, "mil");
  return fmtMoney(value);
};

// Percentual comparativo com a coluna anterior, sempre no mesmo formato.
function changePill(change, baseLabel = "base") {
  if (change === null || change === undefined) return `<em class="flat">${baseLabel}</em>`;
  const up = change >= 0;
  return `<em class="${up ? "up" : "down"}">${up ? "\u25b2" : "\u25bc"} ${fmtPct(Math.abs(change))}</em>`;
}

function pctClass(value) {
  if (value >= 0.9) return "good";
  if (value >= 0.75) return "warn";
  return "bad";
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}


function getActiveSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (session.mode === "supabase" && session.accessToken && session.profile) return session;
    const email = normalizeEmail(session.email);
    return isAllowedEmail(email) ? { mode: "local", profile: { email } } : null;
  } catch {
    return null;
  }
}

function saveActiveSession(user) {
  if (state.authMode === "supabase") {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      mode: "supabase",
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      profile: user,
    }));
    return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify({ mode: "local", email: user.email }));
}

function clearActiveSession() {
  localStorage.removeItem(SESSION_KEY);
}

function isAllowedEmail(email) {
  return ALLOWED_USERS.includes(email);
}

function hasFinancialAccess(user) {
  if (!user) return false;
  const email = normalizeEmail(typeof user === "string" ? user : user.email);
  return email === FULL_ACCESS_EMAIL
    || ["financeiro", "ambos"].includes(user.access_area)
    || Boolean(user.permissions?.financeiro);
}

// RECEBA AUDIT e Promocoes sao permissoes proprias, marcadas no card do usuario.
// Perfil antigo, sem a chave salva, continua herdando do financeiro.
function hasOwnFinancePermission(user, key) {
  if (state.authMode === "local") return true;
  if (!user) return false;
  if (normalizeEmail(user.email) === FULL_ACCESS_EMAIL) return true;
  if (user.permissions?.[key] !== undefined) return Boolean(user.permissions[key]);
  return hasFinancialAccess(user);
}

function hasAuditAccess(user) {
  return hasOwnFinancePermission(user, "auditoria");
}

function hasPromoAccess(user) {
  return hasOwnFinancePermission(user, "promocoes");
}

function hasUsersAccess(user) {
  if (!user) return false;
  return user.role === "admin"
    || Boolean(user.permissions?.usuarios)
    || normalizeEmail(user.email) === FULL_ACCESS_EMAIL;
}

function hasUploadAccess(user) {
  if (state.authMode === "local") return true;
  return user?.role === "admin"
    || Boolean(user?.permissions?.atualizar_bi)
    || Boolean(user?.permissions?.atualizar_bi_financeiro)
    || normalizeEmail(user?.email) === FULL_ACCESS_EMAIL;
}

function canUploadTarget(user, target) {
  if (state.authMode === "local") return true;
  if (user?.role === "admin" || normalizeEmail(user?.email) === FULL_ACCESS_EMAIL) return true;
  return ["FINANCEIRO", "TRANSFEERA"].includes(target)
    ? Boolean(user?.permissions?.atualizar_bi_financeiro)
    : Boolean(user?.permissions?.atualizar_bi);
}

function applyUploadCardAccess() {
  document.querySelectorAll(".upload-card").forEach((card) => {
    card.classList.toggle("hidden", !canUploadTarget(state.user, card.dataset.target));
  });
}

function hasOperationalAccess(user) {
  if (state.authMode === "local") return true;
  return ["operacional", "ambos"].includes(user?.access_area)
    || Boolean(user?.permissions?.kpis)
    || Boolean(user?.permissions?.cadastro);
}

function setLoginMessage(message, ok = false) {
  $("loginMessage").textContent = message;
  $("loginMessage").classList.toggle("ok", ok);
}

function setPasswordMessage(message, ok = false) {
  $("passwordMessage").textContent = message;
  $("passwordMessage").classList.toggle("ok", ok);
}

function showFirstAccess(email) {
  state.pendingFirstAccessEmail = email;
  ["loginForm", "forgotForm", "resetForm"].forEach((id) => $( id).classList.add("hidden"));
  $("firstAccessForm").classList.remove("hidden");
  $("newPassword").value = "";
  $("confirmPassword").value = "";
  setPasswordMessage("");
  $("newPassword").focus();
}

function showLogin() {
  $("appShell").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  document.body.classList.remove("booting");
  state.pendingFirstAccessEmail = "";
  state.pendingForgotEmail = "";
  ["firstAccessForm", "forgotForm", "resetForm"].forEach((id) => $(id).classList.add("hidden"));
  $("loginForm").classList.remove("hidden");
  $("loginPassword").value = "";
  document.querySelector(".finance-link").classList.add("hidden");
  document.querySelector(".audit-link").classList.add("hidden");
  document.querySelector(".promo-link").classList.add("hidden");
  document.querySelector(".users-link").classList.add("hidden");
  document.querySelector(".upload-link").classList.add("hidden");
  syncSideSections();
  setLoginMessage("");
}

function setForgotMessage(message, ok = false) {
  $("forgotMessage").textContent = message;
  $("forgotMessage").classList.toggle("ok", ok);
}

function setResetMessage(message, ok = false) {
  $("resetMessage").textContent = message;
  $("resetMessage").classList.toggle("ok", ok);
}

function showForgotForm() {
  ["loginForm", "firstAccessForm", "resetForm"].forEach((id) => $(id).classList.add("hidden"));
  $("forgotForm").classList.remove("hidden");
  $("forgotEmail").value = "";
  setForgotMessage("");
  $("forgotEmail").focus();
}

function showResetForm(email) {
  state.pendingForgotEmail = email;
  ["loginForm", "firstAccessForm", "forgotForm"].forEach((id) => $(id).classList.add("hidden"));
  $("resetForm").classList.remove("hidden");
  $("resetCode").value = "";
  $("resetPassword").value = "";
  $("resetConfirm").value = "";
  setResetMessage("");
  $("resetCode").focus();
}

// Titulo de bloco sem item liberado embaixo viraria rotulo solto no menu, e a
// linha divisoria do ultimo bloco visivel fica sobrando.
function syncSideSections() {
  const visible = [];
  document.querySelectorAll(".side-section").forEach((section) => {
    const anyVisible = [...section.querySelectorAll(".side-link")]
      .some((link) => !link.classList.contains("hidden"));
    section.classList.toggle("hidden", !anyVisible);
    section.classList.remove("last-visible");
    if (anyVisible) visible.push(section);
  });
  visible.at(-1)?.classList.add("last-visible");
}

function applyUserAccess() {
  const canSeeFinance = hasFinancialAccess(state.user);
  const canSeeAudit = hasAuditAccess(state.user);
  const canSeePromo = hasPromoAccess(state.user);
  const canManageUsers = hasUsersAccess(state.user);
  const canUpload = hasUploadAccess(state.user);
  const canSeeOperational = hasOperationalAccess(state.user);
  const permissions = state.user?.permissions || {};
  const localMode = state.authMode === "local";
  document.querySelector('.side-link[data-view="operacional"]').classList.toggle("hidden", !canSeeOperational);
  document.querySelector(".side-subnav").classList.toggle("hidden", !canSeeOperational);
  document.querySelector(".finance-link").classList.toggle("hidden", !canSeeFinance);
  document.querySelector(".audit-link").classList.toggle("hidden", !canSeeAudit);
  document.querySelector(".promo-link").classList.toggle("hidden", !canSeePromo);
  document.querySelector(".users-link").classList.toggle("hidden", !canManageUsers);
  document.querySelector(".upload-link").classList.toggle("hidden", !canUpload);
  applyUploadCardAccess();
  document.querySelector('[data-op-page="kpis"].side-sub-link').classList.toggle("hidden", !localMode && !permissions.kpis);
  document.querySelector('[data-op-page="cadastro"].side-sub-link').classList.toggle("hidden", !localMode && !permissions.cadastro);
  document.querySelector('[data-op-page="resultado"].side-sub-link').classList.toggle("hidden", !localMode && !permissions.kpis && !permissions.cadastro);
  $("refreshDataButton").classList.toggle("hidden", !localMode && !permissions.atualizar_bi);
  syncSideSections();
  if (!canSeeFinance && state.view === "financeiro") setOperationalPage("kpis");
  if (!canSeeAudit && state.view === "auditoria") setOperationalPage("kpis");
  if (!canSeePromo && state.view === "promocoes") setOperationalPage("kpis");
  if (!canManageUsers && state.view === "usuarios") setOperationalPage("kpis");
  if (!canUpload && state.view === "upload") setOperationalPage("kpis");
}

const LAST_VIEW_KEY = "receba:lastView";

// Guarda a tela aberta para o F5 voltar exatamente onde a pessoa estava, em vez
// de jogar todo mundo de volta nos KPIs.
function saveLastView() {
  if (!state.user) return;
  try {
    localStorage.setItem(LAST_VIEW_KEY, JSON.stringify({
      view: state.view,
      opPage: state.opPage,
      cadastroView: state.cadastroView,
    }));
  } catch {
    // Navegador sem localStorage: a tela apenas volta no padrao.
  }
}

function readLastView() {
  try {
    return JSON.parse(localStorage.getItem(LAST_VIEW_KEY) || "null");
  } catch {
    return null;
  }
}

function restoreLastView(user) {
  const saved = readLastView();
  if (!saved?.view) return false;

  const permissions = user?.permissions || {};
  const localMode = state.authMode === "local";
  const allowed = {
    operacional: hasOperationalAccess(user),
    financeiro: hasFinancialAccess(user),
    auditoria: hasAuditAccess(user),
    promocoes: hasPromoAccess(user),
    usuarios: hasUsersAccess(user),
    upload: hasUploadAccess(user),
  };
  if (!allowed[saved.view]) return false;

  if (saved.view !== "operacional") {
    setView(saved.view);
    return true;
  }

  // A sub-pagina guardada pode ter deixado de ser permitida entre uma sessao e
  // outra: nesse caso volta para a que a pessoa ainda pode ver.
  const canKpis = localMode || permissions.kpis !== false;
  const canCadastro = localMode || Boolean(permissions.cadastro);
  let page = saved.opPage || "kpis";
  if (page === "cadastro" && !canCadastro) page = "kpis";
  if ((page === "kpis" || page === "resultado") && !canKpis) page = canCadastro ? "cadastro" : "kpis";
  if (saved.cadastroView) state.cadastroView = saved.cadastroView;
  setOperationalPage(page);
  return true;
}

function openApp(user) {
  state.user = user;
  saveActiveSession(user);
  applyUserAccess();
  $("loginScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  document.body.classList.remove("booting");
  if (restoreLastView(user)) return;
  if (hasOperationalAccess(user)) {
    const firstPage = user.permissions?.kpis === false && user.permissions?.cadastro ? "cadastro" : "kpis";
    setOperationalPage(firstPage);
  } else if (hasFinancialAccess(user)) {
    setView("financeiro");
  } else if (hasAuditAccess(user)) {
    setView("auditoria");
  } else if (hasUsersAccess(user)) {
    setView("usuarios");
  }
}

async function validateLogin(email, password) {
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return response.json();
}

function queryParams() {
  const params = new URLSearchParams();
  ["city", "hotzone", "cpf", "id", "name", "week", "shift", "start", "end"].forEach((filterId) => {
    if ($(filterId).value) params.set(filterId, $(filterId).value);
  });
  return params.toString();
}

function financeQueryParams() {
  const params = new URLSearchParams();
  ["city", "start", "end"].forEach((id) => {
    if ($(id).value) params.set(id, $(id).value);
  });
  return params.toString();
}

// A auditoria compara Transfeera x financeiro por CPF: filtrar por cidade
// esconderia justamente os pagamentos que nao existem no financeiro.
function auditQueryParams() {
  const params = new URLSearchParams();
  ["start", "end"].forEach((id) => {
    if ($(id).value) params.set(id, $(id).value);
  });
  return params.toString();
}

async function getJson(url, options = {}) {
  const response = await fetch(url, options.method
    ? { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } }
    : options);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Erro ao carregar ${url}`);
  }
  return response.json();
}

async function loadAuthConfig() {
  try {
    const config = await getJson("/api/auth/config");
    state.supabaseEnabled = Boolean(config.enabled);
    $("supabaseStatus").textContent = config.enabled ? "Supabase conectado" : "Supabase nao configurado";
    $("supabaseStatus").classList.toggle("offline", !config.enabled);
    document.querySelector(".forgot-link").classList.toggle("hidden", config.enabled);
  } catch {
    state.supabaseEnabled = false;
  }
}

async function refreshSupabaseSession() {
  // Le o refreshToken mais recente do localStorage (nao o da memoria): o
  // Supabase roda o refresh token a cada uso, entao se outra aba ja
  // renovou a sessao, usar o token antigo guardado em memoria falharia.
  const storedSession = getActiveSession();
  const refreshToken = (storedSession?.mode === "supabase" && storedSession.refreshToken) || state.refreshToken;
  if (!refreshToken) return false;
  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) return false;
  const data = await response.json();
  state.accessToken = data.accessToken;
  state.refreshToken = data.refreshToken;
  state.user = data.profile;
  saveActiveSession(state.user);
  return true;
}

async function authFetch(url, options = {}, retry = true) {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {}),
  };
  if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && retry && await refreshSupabaseSession()) {
    return authFetch(url, options, false);
  }
  return response;
}

async function authJson(url, options = {}) {
  const response = await authFetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Erro de autenticacao.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function dataJson(url, options = {}) {
  return state.supabaseEnabled ? authJson(url, options) : getJson(url, options);
}

async function loadMeta() {
  state.meta = await getJson("/api/meta");
  buildSearchSelect("city", state.meta.cities);
  buildSearchSelect("hotzone", state.meta.hotzones);
  buildSearchSelect("cpf", state.meta.cpfs);
  buildSearchSelect("id", state.meta.ids);
  buildSearchSelect("name", state.meta.names);
  buildSearchSelect("week", state.meta.weeks);
  buildSearchSelect("shift", state.meta.shifts);
  $("start").value = state.meta.minDate;
  $("end").value = state.meta.maxDate;
  updateSidebarDataInfo(state.meta);
}

function updateSidebarDataInfo(meta) {
  $("lastUpdate").textContent = fmtDateTime(meta.latestSourceUpdate || meta.loadedAt);
  $("updateStatus").textContent = "Atualizado";
}

async function updateFilterOptions() {
  const meta = await getJson(`/api/meta?${queryParams()}`);
  state.meta = { ...state.meta, ...meta };
  buildSearchSelect("city", state.meta.cities);
  buildSearchSelect("hotzone", state.meta.hotzones);
  buildSearchSelect("cpf", state.meta.cpfs);
  buildSearchSelect("id", state.meta.ids);
  buildSearchSelect("name", state.meta.names);
  buildSearchSelect("week", state.meta.weeks);
  buildSearchSelect("shift", state.meta.shifts);
}

function buildSearchSelect(filterId, values) {
  const root = document.querySelector(`.search-select[data-filter="${filterId}"]`);
  const currentValue = $(filterId).value || "";
  root.innerHTML = `
    <button class="search-select-trigger" type="button">
      <span>${escapeHtml(currentValue) || "Todos"}</span>
      <i></i>
    </button>
    <div class="search-select-panel">
      <div class="search-box">
        <span></span>
        <input type="text" placeholder="Pesquisar" autocomplete="off" />
      </div>
      <div class="search-options"></div>
    </div>
  `;

  const trigger = root.querySelector(".search-select-trigger");
  const triggerText = trigger.querySelector("span");
  const panel = root.querySelector(".search-select-panel");
  const search = root.querySelector(".search-box input");
  const options = root.querySelector(".search-options");

  const renderOptions = (term = "") => {
    const normalized = term.trim().toLowerCase();
    const filtered = values.filter((value) => String(value).toLowerCase().includes(normalized)).slice(0, 250);
    options.innerHTML = [`<button class="search-option" type="button" data-value="">Todos</button>`]
      .concat(filtered.map((value) => `<button class="search-option" type="button" data-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`))
      .join("");

    options.querySelectorAll(".search-option").forEach((option) => {
      option.addEventListener("click", () => {
        const value = option.dataset.value;
        $(filterId).value = value;
        triggerText.textContent = value || "Todos";
        root.classList.remove("open");
        search.value = "";
        renderOptions();
        refresh();
        updateFilterOptions();
      });
    });
  };

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    document.querySelectorAll(".search-select.open").forEach((select) => {
      if (select !== root) select.classList.remove("open");
    });
    root.classList.toggle("open");
    if (root.classList.contains("open")) {
      renderOptions();
      search.focus();
    }
  });

  search.addEventListener("input", () => renderOptions(search.value));
  root.addEventListener("click", (event) => event.stopPropagation());
  panel.addEventListener("click", (event) => event.stopPropagation());
  renderOptions();
}

function resetSearchSelect(filterId) {
  $(filterId).value = "";
  const root = document.querySelector(`.search-select[data-filter="${filterId}"]`);
  root?.classList.remove("open");
  const triggerText = root?.querySelector(".search-select-trigger span");
  if (triggerText) triggerText.textContent = "Todos";
  const search = root?.querySelector(".search-box input");
  if (search) search.value = "";
}

function clearFilters() {
  ["city", "hotzone", "cpf", "id", "name", "week", "shift"].forEach(resetSearchSelect);
  const finance = ["financeiro", "auditoria", "promocoes"].includes(state.view);
  $("start").value = finance ? state.meta?.financeMinDate || "" : state.meta?.minDate || "";
  $("end").value = finance ? state.meta?.financeMaxDate || "" : state.meta?.maxDate || "";
  state.auditFilter = { status: "problemas", search: "" };
  state.auditDayFilter = { status: "todos", month: "todos", search: "", order: "desc", expanded: false };
  $("auditSearch").value = "";
  $("auditDaySearch").value = "";
  refresh();
  if (state.view === "promocoes") loadPromotions();
  updateFilterOptions();
}

// O botao de limpar so aparece quando ha filtro valendo: periodo cheio e nenhuma
// escolha marcada nao tem o que limpar.
function renderClearFiltersButton() {
  const meta = state.meta || {};
  const isDefaultDate = (value, ...defaults) => !value || defaults.filter(Boolean).includes(value);
  const dirty = ["city", "hotzone", "cpf", "id", "name", "week", "shift"].some((id) => $(id).value)
    || !isDefaultDate($("start").value, meta.minDate, meta.financeMinDate, meta.transferMinDate)
    || !isDefaultDate($("end").value, meta.maxDate, meta.financeMaxDate, meta.transferMaxDate);
  document.querySelector('[data-filter-control="actions"]').classList.toggle("hidden", !dirty);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sortValue(value) {
  if (typeof value === "number") return value;
  const text = String(value ?? "").trim();
  const dateMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dateMatch) return `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  return normalizeText(text).toLowerCase();
}

function sortedRows(rows, tableName) {
  const sort = state.tableSort[tableName];
  if (!sort?.key) return rows;
  const direction = sort.direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const left = sortValue(a[sort.key]);
    const right = sortValue(b[sort.key]);
    if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
    return String(left).localeCompare(String(right), "pt-BR", { numeric: true }) * direction;
  });
}

function sortHeader(tableName, key, label) {
  const sort = state.tableSort[tableName];
  const active = sort?.key === key;
  const arrow = active ? (sort.direction === "asc" ? "↑" : "↓") : "";
  return `<th data-table="${tableName}" data-sort-key="${key}">
    <button class="sort-button" type="button">
      <span>${label}</span><i>${arrow}</i>
    </button>
  </th>`;
}

async function refresh() {
  const params = queryParams();
  const canLoadOperational = !state.supabaseEnabled || hasOperationalAccess(state.user);
  const canLoadFinance = !state.supabaseEnabled || hasFinancialAccess(state.user);
  const canLoadAudit = !state.supabaseEnabled || hasAuditAccess(state.user);
  const financeParams = financeQueryParams();
  // Os cadastros tem filtro proprio (a planilha cobre um periodo bem maior que
  // os relatorios), por isso nao usam os parametros do filtro geral.
  const [dashboard, finance, transferAudit, dailyResult, signups] = await Promise.all([
    canLoadOperational ? dataJson(`/api/dashboard?${params}`) : Promise.resolve(null),
    canLoadFinance ? dataJson(`/api/finance?${financeParams}`) : Promise.resolve(null),
    canLoadAudit ? dataJson(`/api/transfer-audit?${auditQueryParams()}`) : Promise.resolve(null),
    canLoadOperational ? dataJson(`/api/daily-result?${params}`) : Promise.resolve(null),
    canLoadOperational ? dataJson(`/api/signups?${signupQueryParams()}`) : Promise.resolve(null),
  ]);
  state.dashboard = dashboard;
  state.finance = finance;
  state.transferAudit = transferAudit;
  state.dailyResult = dailyResult;
  state.signups = signups;
  applySignupRange();
  render();
}

function brDate(iso) {
  if (!iso) return "-";
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function renderSummary() {
  const total = state.dashboard.total;
  $("cadastroSummary").innerHTML = `
    <h2>RESUMO GERAL</h2>
    <div class="pill">${brDate(total.start)} - ${brDate(total.end)}</div>
    <div class="summary-metrics">
      <div><div class="mini-label">Total corridas</div><div class="mini-value">${fmtInt(total.orders)}</div></div>
      <div><div class="mini-label">Entregadores</div><div class="mini-value">${fmtInt(total.drivers)}</div></div>
      <div><div class="mini-label">Horas totais</div><div class="mini-value">${fmtHour(total.hours)}</div></div>
      <div><div class="mini-label">Drivers sem rota</div><div class="mini-value">${fmtInt(total.semRota)}</div></div>
    </div>`;
}

function cityAccentClass(city) {
  if (city === "CURITIBA") return "city-cwb";
  if (city === "GOIANIA") return "city-go";
  if (city === "RIO DE JANEIRO") return "city-rj";
  return "city-sp";
}

function cityToneClass(city) {
  if (city === "CURITIBA") return "tone-cwb";
  if (city === "GOIANIA") return "tone-go";
  if (city === "RIO DE JANEIRO") return "tone-rj";
  if (city === "SAO PAULO") return "tone-sp";
  return "tone-default";
}

function renderCadastroCards() {
  $("cadastroCards").innerHTML = state.dashboard.cityCards.map((card) => `
    <article class="cadastro-card ${cityAccentClass(card.city)}">
      <div class="cadastro-card-head">
        <span></span>
        <strong>${card.city}</strong>
      </div>
      <div class="cadastro-metrics">
        <div><small>CORRIDAS</small><b>${fmtInt(card.orders)}</b></div>
        <div><small>ENTREGADORES</small><b>${fmtInt(card.drivers)}</b></div>
        <div><small>HORAS NO TURNO</small><b>${fmtHour(card.hours)}</b></div>
        <div><small>DRIVERS SEM ROTA</small><b class="bad">${fmtInt(card.semRota)}</b></div>
      </div>
    </article>`).join("");
}

function renderCityCards() {
  $("cityCards").innerHTML = state.dashboard.cityCards.map((card) => `
    <article class="city-card">
      <div class="city-title"><strong>${card.city}</strong><span>TSH entregue x meta de escala</span></div>
      <div class="metric-grid">
        <div class="metric"><small>TSH GERAL</small><b class="${pctClass(card.general.tsh)}">${fmtPct(card.general.tsh)}</b><span>${fmtHour(card.general.real)} / ${fmtHour(card.general.meta)}</span></div>
        <div class="metric"><small>TSH CRITICAL</small><b class="${pctClass(card.critical.tsh)}">${fmtPct(card.critical.tsh)}</b><span>${fmtHour(card.critical.real)} / ${fmtHour(card.critical.meta)}</span></div>
      </div>
      <div class="shift-row">
        ${card.shifts.map((shift) => `<div class="shift"><small>${shift.label}</small><b class="${pctClass(shift.tsh)}">${fmtPct(shift.tsh)}</b></div>`).join("")}
      </div>
      <div class="deficit"><small>DEFICIT DE HORAS</small><b class="bad">${fmtHour(card.deficit)}</b></div>
    </article>`).join("");
}

function renderHotzones() {
  const rows = sortedRows(state.dashboard.hotzones, "hotzones").map((row) => `
    <tr>
      <td class="city-cell ${cityToneClass(row.city)}">${row.city}</td>
      <td>${row.hotzone}</td>
      <td class="num ${pctClass(row.tsh)}">${fmtPct(row.tsh)}</td>
      <td class="num ${pctClass(row.critical)}">${fmtPct(row.critical)}</td>
      <td class="num good">${fmtHour(row.delivered)}</td>
      <td class="num">${fmtHour(row.goal)}</td>
      <td class="num ${pctClass(row.ar)}">${fmtPct(row.ar)}</td>
      <td class="num ${pctClass(row.caa)}">${fmtPct(row.caa)}</td>
      <td class="num ${pctClass(row.ot)}">${fmtPct(row.ot)}</td>
    </tr>`).join("");

  $("hotzoneTable").innerHTML = `
    <thead><tr>
      ${sortHeader("hotzones", "city", "CIDADE")}
      ${sortHeader("hotzones", "hotzone", "HOTZONE")}
      ${sortHeader("hotzones", "tsh", "TSH")}
      ${sortHeader("hotzones", "critical", "TSH CRITICAL")}
      ${sortHeader("hotzones", "delivered", "ENTREGUE")}
      ${sortHeader("hotzones", "goal", "META")}
      ${sortHeader("hotzones", "ar", "AR")}
      ${sortHeader("hotzones", "caa", "CAA")}
      ${sortHeader("hotzones", "ot", "OT")}
    </tr></thead>
    <tbody>${rows}</tbody>`;
}

function renderDrivers() {
  $("driverInfo").textContent = `Exibindo ${state.dashboard.drivers.length} de ${state.dashboard.driverTotal} entregadores`;
  const rows = sortedRows(state.dashboard.drivers, "drivers").map((row) => `
    <tr>
      <td class="city-cell ${cityToneClass(row.city)}">${row.city}</td>
      <td>${row.hotzone}</td>
      <td>${row.id}</td>
      <td>${row.name}</td>
      <td class="num">${fmtInt(row.routes)}</td>
      <td class="num ${pctClass(row.tsh)}">${fmtPct(row.tsh)}</td>
      <td class="num ${pctClass(row.critical)}">${fmtPct(row.critical)}</td>
      <td class="num ${pctClass(row.ar)}">${fmtPct(row.ar)}</td>
      <td class="num ${pctClass(row.caa)}">${fmtPct(row.caa)}</td>
      <td class="num ${pctClass(row.ot)}">${fmtPct(row.ot)}</td>
      <td class="num">${row.lastRoute}</td>
      <td class="num ${row.daysNoRoute === 9999 ? "" : row.daysNoRoute > 7 ? "bad" : row.daysNoRoute > 2 ? "warn" : "good"}">${row.daysNoRoute === 9999 ? "Sem rota" : `${row.daysNoRoute} dias`}</td>
    </tr>`).join("");

  $("driverTable").innerHTML = `
    <thead><tr>
      ${sortHeader("drivers", "city", "CIDADE")}
      ${sortHeader("drivers", "hotzone", "HOTZONE")}
      ${sortHeader("drivers", "id", "ID")}
      ${sortHeader("drivers", "name", "ENTREGADOR")}
      ${sortHeader("drivers", "routes", "ROTAS")}
      ${sortHeader("drivers", "tsh", "TSH")}
      ${sortHeader("drivers", "critical", "CRITICAL")}
      ${sortHeader("drivers", "ar", "AR")}
      ${sortHeader("drivers", "caa", "CAA")}
      ${sortHeader("drivers", "ot", "OT")}
      ${sortHeader("drivers", "lastRoute", "ÚLTIMA ROTA")}
      ${sortHeader("drivers", "daysNoRoute", "SEM RODAR")}
    </tr></thead>
    <tbody>${rows}</tbody>`;
}

// ─── Novos cadastros (guia CADASTROS da planilha) ───────────────────────────

const SIGNUP_STATUS_META = {
  ativo: { label: "Rodando (até 7 dias)", tone: "good", helper: "Fizeram corrida até 7 dias antes da data de referência" },
  morno: { label: "Sumidos (8 a 30 dias)", tone: "warn", helper: "Última corrida entre 8 e 30 dias atrás" },
  inativo: { label: "Parados (+30 dias)", tone: "bad", helper: "Última corrida há mais de 30 dias" },
  semRota: { label: "Escalou mas não rodou", tone: "warn", helper: "Entrou na escala e não fez nenhuma corrida" },
  semRegistro: { label: "Sem registro", tone: "muted", helper: "Não aparece em nenhum relatório importado" },
};

function signupQueryParams() {
  const params = new URLSearchParams();
  Object.entries(state.signupFilter).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return params.toString();
}

function readSignupFilterInputs() {
  state.signupFilter = {
    start: $("signupStart").value,
    end: $("signupEnd").value,
    praca: $("signupPraca").value,
    origin: $("signupOrigin").value,
    modal: $("signupModal").value,
    status: $("signupStatus").value,
    search: state.signupPeople.map((person) => person.value).join("|"),
  };
}

// ─── Campo suspenso de entregador: escolhe varios ou digita ─────────────────

const signupPeopleBox = {
  root: null,
  timer: null,
  results: [],
  term: "",
};

function signupPeopleInit() {
  const root = $("signupPeople");
  signupPeopleBox.root = root;
  const input = root.querySelector('[data-role="input"]');

  root.querySelector('[data-role="trigger"]').addEventListener("click", (event) => {
    event.stopPropagation();
    document.querySelectorAll(".search-select.open, .multi-select.open").forEach((element) => {
      if (element !== root) element.classList.remove("open");
    });
    root.classList.toggle("open");
    if (root.classList.contains("open")) {
      input.focus();
      signupPeopleFetch(input.value);
    }
  });

  input.addEventListener("input", () => {
    clearTimeout(signupPeopleBox.timer);
    signupPeopleBox.timer = setTimeout(() => signupPeopleFetch(input.value), 250);
  });

  // Enter usa o que foi digitado mesmo sem estar na lista: da para procurar um
  // pedaco de nome ou um CPF que ainda nao apareceu.
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const term = input.value.trim();
    if (!term) return;
    signupPeopleAdd({ value: term, label: `"${term}"`, typed: true });
    input.value = "";
    signupPeopleFetch("");
  });

  root.addEventListener("click", (event) => event.stopPropagation());

  root.querySelector('[data-role="options"]').addEventListener("click", (event) => {
    const option = event.target.closest("[data-person]");
    if (!option) return;
    const person = signupPeopleBox.results.find((item) => item.value === option.dataset.person);
    if (!person) return;
    signupPeopleToggle({ value: person.value, label: person.label });
  });

  root.querySelector('[data-role="chips"]').addEventListener("click", (event) => {
    const chip = event.target.closest("[data-remove]");
    if (!chip) return;
    signupPeopleToggle({ value: chip.dataset.remove });
  });
}

async function signupPeopleFetch(term) {
  signupPeopleBox.term = term;
  try {
    const data = await dataJson(`/api/signups/people?q=${encodeURIComponent(term.trim())}`);
    signupPeopleBox.results = data.people || [];
  } catch (error) {
    console.error(error);
    signupPeopleBox.results = [];
  }
  signupPeopleRenderOptions();
}

function signupPeopleAdd(person) {
  if (state.signupPeople.some((item) => item.value === person.value)) return;
  state.signupPeople = [...state.signupPeople, person];
  signupPeopleApply();
}

function signupPeopleToggle(person) {
  const exists = state.signupPeople.some((item) => item.value === person.value);
  state.signupPeople = exists
    ? state.signupPeople.filter((item) => item.value !== person.value)
    : [...state.signupPeople, person];
  signupPeopleApply();
}

function signupPeopleApply() {
  signupPeopleRender();
  readSignupFilterInputs();
  loadSignups().catch((error) => console.error(error));
}

function signupPeopleRenderOptions() {
  const options = signupPeopleBox.root.querySelector('[data-role="options"]');
  if (!signupPeopleBox.results.length) {
    options.innerHTML = `<p class="multi-select-empty">Nenhum entregador encontrado. Tecle Enter para buscar assim mesmo.</p>`;
    return;
  }

  options.innerHTML = signupPeopleBox.results.map((person) => {
    const selected = state.signupPeople.some((item) => item.value === person.value);
    const hint = [person.cpf ? `CPF ${person.cpf}` : "", person.id ? `ID ${person.id}` : ""].filter(Boolean).join(" - ");
    return `
      <button class="multi-select-option${selected ? " selected" : ""}" type="button" data-person="${escapeHtml(person.value)}">
        <b>${escapeHtml(person.label)}</b>
        <small>${escapeHtml(hint)}</small>
      </button>`;
  }).join("");
}

function signupPeopleRender() {
  const root = signupPeopleBox.root;
  if (!root) return;
  const selected = state.signupPeople;
  root.querySelector('[data-role="label"]').textContent = !selected.length
    ? "Todos"
    : selected.length === 1
      ? selected[0].label
      : `${selected.length} selecionados`;

  root.querySelector('[data-role="chips"]').innerHTML = selected.map((person) => `
    <span class="multi-select-chip">${escapeHtml(person.label)}<button type="button" data-remove="${escapeHtml(person.value)}" aria-label="Remover">x</button></span>`).join("");

  signupPeopleRenderOptions();
}

async function loadSignups() {
  if (state.supabaseEnabled && !hasOperationalAccess(state.user)) return;
  state.signups = await dataJson(`/api/signups?${signupQueryParams()}`);
  applySignupRange();
  renderSignups();
}

// A primeira carga vem sem datas: o servidor devolve o intervalo inteiro da
// planilha e os campos assumem esse periodo.
function applySignupRange() {
  const range = state.signups?.range;
  if (!range) return;
  if (!state.signupFilter.start && range.min) {
    $("signupStart").value = range.min;
    state.signupFilter.start = range.min;
  }
  if (!state.signupFilter.end && range.max) {
    $("signupEnd").value = range.max;
    state.signupFilter.end = range.max;
  }
}

function fillSignupSelect(id, values, allLabel) {
  const select = $(id);
  const current = select.value;
  select.innerHTML = [`<option value="">${allLabel}</option>`, ...values.map((value) => {
    const option = typeof value === "string" ? { value, label: value } : value;
    return `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`;
  })].join("");
  select.value = current;
}

function renderSignupSource() {
  const { source, coverage, total } = state.signups;
  const origin = source.error
    ? `<b>planilha indisponível</b> (${escapeHtml(source.error)}) - mostrando a última cópia salva`
    : `<b>${escapeHtml(source.origin)}</b>, guia <b>${escapeHtml(source.tab)}</b>${source.fetchedAt ? ` lida em ${fmtDateTime(source.fetchedAt)}` : ""}`;
  const cobertura = coverage.operationalStart
    ? `Relatórios operacionais carregados: <b>${brDate(coverage.operationalStart)} a ${brDate(coverage.operationalEnd)}</b>. "Última data que rodou" e "dias sem rodar" usam <b>${brDate(coverage.reference)}</b> como referência; cadastro sem turno nesse intervalo aparece como <b>sem registro</b>.`
    : "Nenhum relatório operacional carregado: sem ele não dá para saber quem rodou.";

  $("signupSource").className = `signup-source${source.error ? " error" : ""}`;
  $("signupSource").innerHTML = `Fonte dos cadastros: ${origin} - ${fmtInt(total.signups)} linhas no filtro atual.<br />${cobertura}`;
}

function renderSignupKpis() {
  const { total, coverage } = state.signups;
  const best = total.bestDay ? `melhor dia ${total.bestDay.dateBr} com ${fmtInt(total.bestDay.signups)}` : "sem dias no filtro";
  const cards = [
    ["QUANTOS FORAM CADASTRADOS", fmtInt(total.signups), `${fmtInt(total.people)} pessoas diferentes - ${fmtInt(total.recadastros)} cadastros repetidos`, "orange"],
    ["CADASTROS POR DIA (MÉDIA)", (total.perDay || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 }), `${fmtInt(total.days)} dias com cadastro - ${best}`, "blue"],
    ["JÁ RODARAM PELO MENOS 1 VEZ", fmtInt(total.activated), `${fmtPct(total.activationRate)} dos cadastros chegaram a fazer corrida`, "green"],
    ["RODANDO AGORA (ÚLTIMOS 7 DIAS)", fmtInt(total.ativo), `Contado a partir de ${brDate(coverage.reference)}, último dia dos relatórios`, "green"],
    ["PARARAM DE RODAR (+30 DIAS)", fmtInt(total.inativo), `E mais ${fmtInt(total.morno)} sumidos há 8 a 30 dias`, "bad"],
    ["SEM REGISTRO NOS RELATÓRIOS", fmtInt(total.semRegistro), "Cadastrados que não aparecem em nenhum relatório importado", "yellow"],
    ["CORRIDAS FEITAS POR ELES", fmtInt(total.orders), "Total de corridas dentro do período dos relatórios", "orange"],
    ["TEMPO ATÉ A PRIMEIRA CORRIDA", total.avgDaysToFirstRoute === null
      ? "--"
      : `${total.avgDaysToFirstRoute.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} dias`,
    "Média de quem se cadastrou dentro do período dos relatórios", "blue"],
  ];

  $("signupKpis").innerHTML = cards.map(([label, value, helper, tone]) => `
    <article class="finance-kpi ${tone}">
      <small>${label}</small>
      <strong>${value}</strong>
      <span>${helper}</span>
    </article>`).join("");
}

// Verde sobre barra laranja some. O ciano claro tem contraste alto tanto com o
// laranja quanto com o fundo escuro, e o numero ainda ganha uma etiqueta escura
// para nunca ficar ilegivel por cima da barra.
const SIGNUP_BAR_COLOR = "#ff6b12";
const SIGNUP_ACTIVATED_COLOR = "#4cd9ff";

function drawValueChip(ctx, text, centerX, centerY, color) {
  ctx.font = "bold 10px Arial";
  const width = ctx.measureText(text).width + 12;
  const height = 16;
  const x = centerX - width / 2;
  const y = centerY - height / 2;

  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, width, height, 5);
  else ctx.rect(x, y, width, height);
  ctx.fillStyle = "rgba(13,16,20,.92)";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.fillText(text, centerX - ctx.measureText(text).width / 2, centerY + 3.5);
}

function drawSignupChart(canvas, rows) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  if (!rows.length) {
    ctx.fillStyle = "#8e98a4";
    ctx.font = "bold 13px Arial";
    ctx.fillText("Sem cadastros no período filtrado.", 20, 46);
    return;
  }

  const left = 46;
  const right = width - 18;
  const top = 34;
  const base = height - 40;
  const max = Math.max(1, ...rows.map((row) => row.signups));
  const slot = (right - left) / rows.length;
  const barWidth = Math.max(2, Math.min(slot * 0.62, 26));
  const x = (index) => left + slot * index + slot / 2;
  const y = (value) => base - (value / max) * (base - top);

  ctx.font = "10px Arial";
  for (let step = 0; step <= 4; step += 1) {
    const value = (max / 4) * step;
    const py = y(value);
    ctx.strokeStyle = "#2c3238";
    ctx.beginPath();
    ctx.moveTo(left, py);
    ctx.lineTo(right, py);
    ctx.stroke();
    ctx.fillStyle = "#8e98a4";
    ctx.fillText(fmtInt(value), 8, py + 3);
  }

  rows.forEach((row, index) => {
    ctx.fillStyle = SIGNUP_BAR_COLOR;
    const barHeight = base - y(row.signups);
    ctx.fillRect(x(index) - barWidth / 2, y(row.signups), barWidth, barHeight);
  });

  // Linha de ativados por cima das barras: mostra na mesma escala quantos
  // daqueles cadastros viraram entregador rodando.
  ctx.strokeStyle = SIGNUP_ACTIVATED_COLOR;
  ctx.fillStyle = SIGNUP_ACTIVATED_COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  rows.forEach((row, index) => {
    const py = y(row.activated);
    if (index) ctx.lineTo(x(index), py);
    else ctx.moveTo(x(index), py);
  });
  ctx.stroke();
  if (rows.length <= 40) {
    rows.forEach((row, index) => {
      ctx.beginPath();
      ctx.arc(x(index), y(row.activated), 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  const labelStep = Math.max(1, Math.ceil(rows.length / 18));
  ctx.font = "10px Arial";
  rows.forEach((row, index) => {
    if (index % labelStep && index !== rows.length - 1) return;
    ctx.fillStyle = "#aaa";
    const label = row.label;
    ctx.fillText(label, x(index) - ctx.measureText(label).width / 2, base + 16);
  });

  if (rows.length <= 24) {
    rows.forEach((row, index) => {
      ctx.font = "bold 10px Arial";
      ctx.fillStyle = "#f3f5f8";
      const label = fmtInt(row.signups);
      ctx.fillText(label, x(index) - ctx.measureText(label).width / 2, y(row.signups) - 6);

      // Etiqueta do "ja rodaram": vai acima do ponto, ou abaixo quando encostaria
      // no numero da barra.
      const py = y(row.activated);
      const collides = Math.abs(py - 12 - (y(row.signups) - 6)) < 16;
      drawValueChip(ctx, fmtInt(row.activated), x(index), collides ? py + 14 : py - 12, SIGNUP_ACTIVATED_COLOR);
    });
  }

  ctx.font = "bold 11px Arial";
  ctx.fillStyle = SIGNUP_BAR_COLOR;
  ctx.fillRect(left, 14, 18, 4);
  ctx.fillText("Cadastros", left + 24, 21);
  ctx.fillStyle = SIGNUP_ACTIVATED_COLOR;
  ctx.fillRect(left + 110, 14, 18, 4);
  ctx.fillText("Já rodaram", left + 134, 21);
}

const SIGNUP_MODAL_COLORS = { Motocicleta: "#ff6b12", Bicicleta: "#5b9bff" };
const SIGNUP_MODAL_FALLBACK = ["#ffc233", "#c77dff", "#8e98a4"];

function signupModalColor(modal, index) {
  return SIGNUP_MODAL_COLORS[modal] || SIGNUP_MODAL_FALLBACK[index % SIGNUP_MODAL_FALLBACK.length];
}

// Barras lado a lado por periodo: da para ver se a entrada de bike cresceu mais
// que a de moto sem precisar comparar duas telas.
function drawSignupModalChart(canvas, rows, modals) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  if (!rows.length || !modals.length) {
    ctx.fillStyle = "#8e98a4";
    ctx.font = "bold 13px Arial";
    ctx.fillText("Sem cadastros no período filtrado.", 20, 46);
    return;
  }

  const left = 46;
  const right = width - 18;
  const top = 34;
  const base = height - 40;
  const max = Math.max(1, ...rows.flatMap((row) => modals.map((modal) => row.modals[modal] || 0)));
  const slot = (right - left) / rows.length;
  const groupWidth = Math.min(slot * 0.72, 26 * modals.length);
  const barWidth = Math.max(2, groupWidth / modals.length);
  const center = (index) => left + slot * index + slot / 2;
  const y = (value) => base - (value / max) * (base - top);

  ctx.font = "10px Arial";
  for (let step = 0; step <= 4; step += 1) {
    const value = (max / 4) * step;
    const py = y(value);
    ctx.strokeStyle = "#2c3238";
    ctx.beginPath();
    ctx.moveTo(left, py);
    ctx.lineTo(right, py);
    ctx.stroke();
    ctx.fillStyle = "#8e98a4";
    ctx.fillText(fmtInt(value), 8, py + 3);
  }

  rows.forEach((row, index) => {
    modals.forEach((modal, modalIndex) => {
      const value = row.modals[modal] || 0;
      const px = center(index) - groupWidth / 2 + barWidth * modalIndex;
      ctx.fillStyle = signupModalColor(modal, modalIndex);
      ctx.fillRect(px, y(value), Math.max(barWidth - 2, 1.5), base - y(value));
      if (rows.length <= 16 && value) {
        ctx.font = "bold 10px Arial";
        const label = fmtInt(value);
        ctx.fillText(label, px + (barWidth - 2) / 2 - ctx.measureText(label).width / 2, y(value) - 5);
      }
    });
  });

  const labelStep = Math.max(1, Math.ceil(rows.length / 18));
  ctx.font = "10px Arial";
  rows.forEach((row, index) => {
    if (index % labelStep && index !== rows.length - 1) return;
    ctx.fillStyle = "#aaa";
    ctx.fillText(row.label, center(index) - ctx.measureText(row.label).width / 2, base + 16);
  });

  ctx.font = "bold 11px Arial";
  let legendX = left;
  modals.forEach((modal, index) => {
    ctx.fillStyle = signupModalColor(modal, index);
    ctx.fillRect(legendX, 14, 18, 4);
    ctx.fillText(modal, legendX + 24, 21);
    legendX += 24 + ctx.measureText(modal).width + 20;
  });
}

function renderSignupChart() {
  const rows = state.signups.series[state.signupPeriod] || [];
  drawSignupChart($("signupChart"), rows);
  const modals = state.signups.byModal.map((item) => item.key);
  drawSignupModalChart($("signupModalChart"), rows, modals);
}

function signupGroupTable(tableId, tableName, rows, firstLabel) {
  const body = sortedRows(rows, tableName).map((row) => `
    <tr>
      <td>${escapeHtml(row.key)}</td>
      <td class="num">${fmtInt(row.signups)}</td>
      <td class="num">${fmtPct(row.share)}</td>
      <td class="num">${fmtInt(row.activated)}</td>
      <td class="num ${row.activationRate >= 0.4 ? "good" : row.activationRate >= 0.25 ? "warn" : "bad"}">${fmtPct(row.activationRate)}</td>
      <td class="num">${fmtInt(row.active7)}</td>
      <td class="num">${fmtInt(row.orders)}</td>
    </tr>`).join("");

  $(tableId).innerHTML = `
    <colgroup>
      <col style="width:27%" /><col style="width:14%" /><col style="width:11%" />
      <col style="width:13%" /><col style="width:12%" /><col style="width:11%" /><col style="width:12%" />
    </colgroup>
    <thead><tr>
      ${sortHeader(tableName, "key", firstLabel)}
      ${sortHeader(tableName, "signups", "CADASTROS")}
      ${sortHeader(tableName, "share", "% TOTAL")}
      ${sortHeader(tableName, "activated", "RODARAM")}
      ${sortHeader(tableName, "activationRate", "ATIVAÇÃO")}
      ${sortHeader(tableName, "active7", "ATIVOS 7D")}
      ${sortHeader(tableName, "orders", "CORRIDAS")}
    </tr></thead>
    <tbody>${body || `<tr><td colspan="7">Sem dados no filtro.</td></tr>`}</tbody>`;
}

function renderSignupStatusCards() {
  const { total } = state.signups;
  const values = {
    ativo: total.ativo,
    morno: total.morno,
    inativo: total.inativo,
    semRota: total.semRota,
    semRegistro: total.semRegistro,
  };

  $("signupStatusCards").innerHTML = Object.entries(SIGNUP_STATUS_META).map(([key, meta]) => `
    <article class="signup-status-card clickable ${meta.tone} ${state.signupFilter.status === key ? "selected" : ""}" data-signup-status="${key}">
      <small>${meta.label}</small>
      <b>${fmtInt(values[key])}</b>
      <span>${meta.helper}</span>
    </article>`).join("");

  $("signupStatusInfo").textContent = "Clique em um cartão para filtrar a tabela abaixo.";
  $("signupModalChips").innerHTML = state.signups.byModal.map((row) => `
    <span class="signup-chip">${escapeHtml(row.key)}: <b>${fmtInt(row.signups)}</b> (${fmtPct(row.share)}) - ativacao ${fmtPct(row.activationRate)}</span>`).join("");
}

function signupDaysCell(row) {
  if (row.daysSinceActivity === null) return `<span class="signup-badge muted">-</span>`;
  const tone = row.daysSinceActivity <= 7 ? "good" : row.daysSinceActivity <= 30 ? "warn" : "bad";
  return `<span class="${tone}">${fmtInt(row.daysSinceActivity)} dias</span>`;
}

function renderSignupTable() {
  const { rows, rowTotal } = state.signups;
  $("signupTableInfo").textContent = `Exibindo ${fmtInt(rows.length)} de ${fmtInt(rowTotal)} cadastros`
    + (rowTotal > rows.length ? " (refine o filtro para ver o resto)" : "");

  const body = sortedRows(rows, "signupRows").map((row) => `
    <tr>
      <td>${row.dateBr}</td>
      <td>${escapeHtml(row.id || "-")}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.cpf || "-")}</td>
      <td>${escapeHtml(row.modal)}</td>
      <td>${escapeHtml(row.pracas.join(", "))}</td>
      <td>${escapeHtml(row.origin)}</td>
      <td>${row.lastActivityBr || "-"}</td>
      <td class="num">${signupDaysCell(row)}</td>
      <td class="num">${fmtInt(row.orders)}</td>
      <td class="num">${fmtInt(row.shiftDays)}</td>
      <td><span class="signup-badge ${SIGNUP_STATUS_META[row.status].tone}">${SIGNUP_STATUS_META[row.status].label}</span></td>
    </tr>`).join("");

  $("signupTable").innerHTML = `
    <thead><tr>
      ${sortHeader("signupRows", "date", "CADASTRO")}
      ${sortHeader("signupRows", "id", "ID")}
      ${sortHeader("signupRows", "name", "ENTREGADOR")}
      ${sortHeader("signupRows", "cpf", "CPF")}
      ${sortHeader("signupRows", "modal", "MODAL")}
      ${sortHeader("signupRows", "praca", "PRAÇA")}
      ${sortHeader("signupRows", "origin", "ORIGEM")}
      ${sortHeader("signupRows", "lastActivity", "ÚLTIMA ROTA")}
      ${sortHeader("signupRows", "daysSinceActivity", "SEM RODAR")}
      ${sortHeader("signupRows", "orders", "CORRIDAS")}
      ${sortHeader("signupRows", "shiftDays", "ESCALADO")}
      ${sortHeader("signupRows", "status", "SITUAÇÃO")}
    </tr></thead>
    <tbody>${body || `<tr><td colspan="12">Nenhum cadastro com esse filtro.</td></tr>`}</tbody>`;
}

// "Limpar" so faz sentido quando existe algo para limpar: com o periodo cheio e
// nenhuma escolha marcada, o botao some.
function hasActiveSignupFilter() {
  const range = state.signups?.range || {};
  const { start, end, ...choices } = state.signupFilter;
  if (Object.values(choices).some(Boolean)) return true;
  return (start && start !== range.min) || (end && end !== range.max);
}

function renderSignupClearButton() {
  $("signupClear").classList.toggle("hidden", !hasActiveSignupFilter());
}

function renderSignups() {
  if (!state.signups) return;
  fillSignupSelect("signupPraca", state.signups.options.pracas, "Todas");
  fillSignupSelect("signupOrigin", state.signups.options.origins, "Todas");
  fillSignupSelect("signupModal", state.signups.options.modals, "Todos");
  fillSignupSelect("signupStatus", state.signups.options.statuses, "Todas");
  renderSignupSource();
  renderSignupKpis();
  renderSignupChart();
  signupGroupTable("signupPracaTable", "signupPraca", state.signups.byPraca, "PRAÇA");
  signupGroupTable("signupOriginTable", "signupOrigin", state.signups.byOrigin, "ORIGEM");
  renderSignupStatusCards();
  renderSignupTable();
  renderSignupClearButton();
}

function exportSignupsCsv() {
  if (!state.signups?.rows.length) return;
  const header = ["Data cadastro", "ID", "Entregador", "CPF", "Modal", "Praça", "Origem", "Última vez que rodou", "Dias sem rodar", "Corridas", "Dias escalado", "Situação"];
  const body = state.signups.rows.map((row) => [
    row.dateBr,
    row.id,
    row.name,
    row.cpf,
    row.modal,
    row.pracas.join(" / "),
    row.origin,
    row.lastActivityBr,
    row.daysSinceActivity === null ? "" : row.daysSinceActivity,
    row.orders,
    row.shiftDays,
    SIGNUP_STATUS_META[row.status].label,
  ]);

  const csv = [header, ...body]
    .map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";"))
    .join("\r\n");

  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `cadastros-${state.signupFilter.start || "inicio"}-a-${state.signupFilter.end || "fim"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function renderFinance() {
  if (!state.finance) return;
  const finance = state.finance;
  const total = finance.total;
  $("financePeriod").textContent = total.start && total.end ? `${brDate(total.start)} - ${brDate(total.end)}` : "Sem periodo financeiro";

  $("financeKpis").innerHTML = [
    ["TOTAL GANHO", fmtMoney(total.earningsBase), "Ganhos da entrega + recompensas", "orange"],
    ["DINHEIRO", fmtMoney(total.pendingCash), "Pedido pago em dinheiro pendente", "white"],
    ["RECOMPENSAS", fmtMoney(total.rewards), "Bonus e recompensas", "blue"],
    ["DESCONTOS", fmtMoney(total.lossDiscount), "Perdas de pedido", "bad"],
    ["ENTREGADORES", fmtInt(total.drivers), "Com financeiro no periodo", "yellow"],
  ].map(([label, value, helper, tone]) => `
    <article class="finance-kpi ${tone}">
      <small>${label}</small>
      <strong>${value}</strong>
      <span>${helper}</span>
    </article>`).join("");

  renderProfitMin(finance.profit);

  $("financeProjections").innerHTML = finance.projections.map((item) => `
    <article class="projection-card ${item.gain < 0 ? "negative" : ""}">
      <small>GANHO RECEBA</small>
      <strong>${item.label}</strong>
      <b>${fmtMoney(item.gain)}</b>
      <span>${item.promotions
        ? `${fmtMoney(item.gross)} menos ${fmtMoney(item.promotions)} de promocao`
        : "sobre ganhos + recompensas"}</span>
    </article>`).join("");

  const maxComposition = Math.max(1, ...finance.composition.map((item) => Math.abs(item.value)));
  $("financeComposition").innerHTML = finance.composition.map((item) => `
    <article class="composition-row ${item.color}">
      <div><strong>${item.label}</strong><span>${fmtMoney(item.value)}</span></div>
      <b style="width:${Math.min(100, Math.abs(item.value) / maxComposition * 100)}%"></b>
    </article>`).join("");

  const maxCity = Math.max(1, ...finance.byCity.map((row) => row.totalDaily));
  $("financeCityBars").innerHTML = finance.byCity.length ? finance.byCity.map((row) => `
    <article class="${cityToneClass(row.city)}">
      <div><strong>${row.city}</strong><span>${fmtMoney(row.totalDaily)} | ${fmtPct(row.share)}</span></div>
      <b style="width:${Math.max(3, row.totalDaily / maxCity * 100)}%"></b>
      <small>Base ganhos: ${fmtMoney(row.earningsBase)} | 20% Receba: ${fmtMoney(row.gain20)} | Entregadores: ${fmtInt(row.drivers)}</small>
    </article>`).join("") : `<div class="finance-empty-state">Coloque o arquivo financeiro na pasta BI para carregar os valores.</div>`;

  renderPromoSummary(finance.total);
  renderWeeklyRevenue(finance.byWeek || []);

  renderFinanceDays(finance.byDate || []);

  renderFinanceDrivers();
}

// Evolucao dia a dia: valor e comparativo com o dia anterior no topo da coluna.
function renderFinanceDays(byDate) {
  const days = byDate.slice(-12);
  if (!days.length) {
    $("financeDayGrid").innerHTML = `<div class="finance-empty-state">Sem datas financeiras carregadas.</div>`;
    return;
  }

  const max = Math.max(1, ...days.map((row) => row.totalDaily));
  const money = days.length > 8 ? fmtMoneyShort : fmtMoney;
  // Poucos dias no filtro nao devem deixar as colunas encostadas na esquerda:
  // uma coluna por dia, distribuidas na largura do painel.
  $("financeDayGrid").style.gridTemplateColumns = `repeat(${days.length}, minmax(0, 1fr))`;

  $("financeDayGrid").innerHTML = days.map((row) => {
    const tooltip = [
      row.dateBr,
      `Total: ${fmtMoney(row.totalDaily)}`,
      `20% ganhos: ${fmtMoney(row.gain20)}`,
      row.promotions ? `Promocao interna: ${fmtMoney(row.promotions)}` : "",
      row.change === null
        ? "Primeiro dia do periodo"
        : `${row.change >= 0 ? "+" : ""}${fmtPct(row.change)} vs ${row.previousDateBr || "dia anterior"}`,
    ].filter(Boolean).join("\n");

    return `
      <article title="${escapeHtml(tooltip)}">
        <div class="finance-day-value">
          <strong>${money(row.totalDaily)}</strong>
          ${changePill(row.change, "1o dia")}
        </div>
        <b style="height:${Math.max(6, row.totalDaily / max * 100)}%"></b>
        <span>${row.dateBr}</span>
        <small>20% ganhos ${fmtMoney(row.gain20)}</small>
      </article>`;
  }).join("");
}

// Cores validadas contra o painel escuro (#303030): laranja e azul da marca.
const REVENUE_SERIES = [
  { key: "netOfPromotions", label: "Sem promocao", color: "var(--orange)" },
  { key: "promotions", label: "Promocao interna", color: "var(--blue)" },
];

function renderPromoSummary(total) {
  const promotions = total.promotions || 0;
  $("financePromoSummary").innerHTML = `
    <article class="promo-summary-card">
      <small>TOTAL COM PROMOCAO</small>
      <strong>${fmtMoney(total.totalDaily)}</strong>
      <span>Faturamento bruto do periodo</span>
    </article>
    <span class="promo-summary-op">-</span>
    <article class="promo-summary-card promo">
      <small>PROMOCOES INTERNAS</small>
      <strong>${fmtMoney(promotions)}</strong>
      <span>${promotions ? `${fmtPct(total.promotionShare)} do faturamento` : "Nenhuma promocao lancada no periodo"}</span>
    </article>
    <span class="promo-summary-op">=</span>
    <article class="promo-summary-card net">
      <small>TOTAL SEM PROMOCAO</small>
      <strong>${fmtMoney(total.netOfPromotions)}</strong>
      <span>Quanto ficou descontando as promocoes</span>
    </article>`;
}

// Piso de lucro: o cenario mais baixo (10%) ja descontada a promocao,
// dividido pelas entregas e pelos entregadores do periodo.
function renderProfitMin(profit) {
  if (!profit) return;
  const negative = profit.net < 0;
  const perOrder = profit.perOrder === null ? "--" : fmtMoney(profit.perOrder);
  const perDriver = profit.perDriver === null ? "--" : fmtMoney(profit.perDriver);
  const ordersNote = profit.orders
    ? `${fmtInt(profit.orders)} entregas finalizadas`
    : "sem entregas no BI operacional para este periodo";

  $("financeProfitMin").innerHTML = `
    <article class="profit-min-card ${negative ? "negative" : ""}">
      <div class="profit-min-head">
        <small>LUCRO MINIMO NO CENARIO DE ${profit.label}</small>
        <strong>${fmtMoney(profit.net)}</strong>
        <span>${fmtMoney(profit.gross)} de comissao menos a promocao investida</span>
      </div>
      <div class="profit-min-split">
        <div>
          <small>POR ENTREGA</small>
          <b>${perOrder}</b>
          <span>${ordersNote}</span>
        </div>
        <div>
          <small>POR ENTREGADOR</small>
          <b>${perDriver}</b>
          <span>${fmtInt(profit.drivers)} entregadores com financeiro</span>
        </div>
      </div>
      ${negative ? `<p class="profit-min-alert">A promocao consumiu toda a comissao neste cenario: no piso de ${profit.label} a operacao fecha no negativo.</p>` : ""}
    </article>`;
}

function renderWeeklyRevenue(weeks) {
  const chart = $("weeklyRevenueChart");
  const hasPromotions = weeks.some((week) => week.promotions > 0);
  const series = hasPromotions ? REVENUE_SERIES : REVENUE_SERIES.slice(0, 1);

  // Uma serie nao precisa de legenda: o titulo do painel ja a nomeia.
  $("weeklyRevenueLegend").innerHTML = hasPromotions
    ? series.map((item) => `<span class="chart-legend-item"><i style="background:${item.color}"></i>${item.label}</span>`).join("")
    : "";

  if (!weeks.length) {
    chart.innerHTML = `<div class="finance-empty-state">Sem semanas financeiras carregadas.</div>`;
    $("weeklyRevenueTable").innerHTML = "";
    return;
  }

  const max = Math.max(1, ...weeks.map((week) => week.totalDaily));
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const best = weeks.reduce((top, week) => (week.totalDaily > top.totalDaily ? week : top), weeks[0]);
  // Com muitas semanas o valor cheio nao cabe no topo da coluna: encurta o rotulo.
  const money = weeks.length > 8 ? fmtMoneyShort : fmtMoney;

  const bars = weeks.map((week) => {
    const net = Math.max(0, week.netOfPromotions);
    const promo = Math.max(0, week.promotions);
    const changeText = week.change === null
      ? "primeira semana"
      : `${week.change >= 0 ? "+" : ""}${fmtPct(week.change)} vs semana anterior`;
    const tooltip = [
      week.rangeBr,
      `Total: ${fmtMoney(week.totalDaily)}`,
      hasPromotions ? `Sem promocao: ${fmtMoney(week.netOfPromotions)}` : "",
      hasPromotions ? `Promocao: ${fmtMoney(week.promotions)}` : "",
      `Media/dia: ${fmtMoney(week.avgPerDay)} em ${fmtInt(week.activeDays)} dia(s)`,
      `Entregadores: ${fmtInt(week.drivers)}`,
      changeText,
    ].filter(Boolean).join("\n");

    return `
      <div class="revenue-bar ${week === best ? "best" : ""}" tabindex="0" data-tooltip="${escapeHtml(tooltip)}">
        <div class="revenue-bar-value">
          <b>${money(week.totalDaily)}</b>
          ${changePill(week.change, "1a semana")}
        </div>
        <div class="revenue-bar-stack">
          ${promo > 0 ? `<span class="revenue-seg promo" style="height:${promo / max * 100}%"></span>` : ""}
          <span class="revenue-seg net" style="height:${Math.max(1, net / max * 100)}%"></span>
        </div>
        <div class="revenue-bar-label">
          <strong>${week.label}</strong>
        </div>
      </div>`;
  }).join("");

  chart.innerHTML = `
    <div class="revenue-axis">${ticks.map((tick) => `<span style="bottom:${tick * 100}%">${fmtMoney(max * tick)}</span>`).join("")}</div>
    <div class="revenue-plot">
      ${ticks.map((tick) => `<i class="revenue-grid" style="bottom:${tick * 100}%"></i>`).join("")}
      <div class="revenue-bars">${bars}</div>
    </div>`;

  $("weeklyRevenueTable").innerHTML = `
    <table>
      <thead><tr>
        <th>SEMANA</th><th>PERIODO</th><th>TOTAL</th>
        ${hasPromotions ? "<th>PROMOCAO</th><th>SEM PROMOCAO</th>" : ""}
        <th>MEDIA/DIA</th><th>ENTREGADORES</th><th>VARIACAO</th>
      </tr></thead>
      <tbody>${weeks.map((week) => `
        <tr>
          <td>${week.label}</td>
          <td>${week.rangeBr}</td>
          <td class="num">${fmtMoney(week.totalDaily)}</td>
          ${hasPromotions ? `<td class="num blue">${fmtMoney(week.promotions)}</td><td class="num">${fmtMoney(week.netOfPromotions)}</td>` : ""}
          <td class="num">${fmtMoney(week.avgPerDay)}</td>
          <td class="num">${fmtInt(week.drivers)}</td>
          <td class="num ${week.change === null ? "" : week.change >= 0 ? "good" : "bad"}">${week.change === null ? "-" : `${week.change >= 0 ? "+" : ""}${fmtPct(week.change)}`}</td>
        </tr>`).join("")}</tbody>
    </table>`;
}

function renderFinanceDrivers() {
  $("financeDriverInfo").textContent = `Exibindo ${state.finance.byDriver.length} entregadores`;
  const rows = sortedRows(state.finance.byDriver, "financeDrivers").map((row) => `
    <tr>
      <td class="city-cell ${cityToneClass(row.city)}">${row.city}</td>
      <td>${row.id}</td>
      <td>${row.name}</td>
      <td>${row.cpf}</td>
      <td class="num">${fmtMoney(row.totalDaily)}</td>
      <td class="num">${fmtMoney(row.earningsBase)}</td>
      <td class="num good">${fmtMoney(row.deliveryGains)}</td>
      <td class="num blue">${fmtMoney(row.rewards)}</td>
      <td class="num warn">${fmtMoney(row.pendingCash)}</td>
      <td class="num bad">${fmtMoney(row.lossDiscount)}</td>
      <td class="num">${fmtMoney(row.gain20)}</td>
    </tr>`).join("");

  $("financeDriverTable").innerHTML = `
    <thead><tr>
      ${sortHeader("financeDrivers", "city", "CIDADE")}
      ${sortHeader("financeDrivers", "id", "ID")}
      ${sortHeader("financeDrivers", "name", "ENTREGADOR")}
      ${sortHeader("financeDrivers", "cpf", "CPF")}
      ${sortHeader("financeDrivers", "totalDaily", "TOTAL")}
      ${sortHeader("financeDrivers", "earningsBase", "GANHOS")}
      ${sortHeader("financeDrivers", "deliveryGains", "CORRIDAS")}
      ${sortHeader("financeDrivers", "rewards", "RECOMPENSAS")}
      ${sortHeader("financeDrivers", "pendingCash", "PENDENTE")}
      ${sortHeader("financeDrivers", "lossDiscount", "DESCONTOS")}
      ${sortHeader("financeDrivers", "gain20", "20% RECEBA")}
    </tr></thead>
    <tbody>${rows}</tbody>`;
}

const AUDIT_FLAG_LABELS = {
  taxa_transfeera: "Taxa Transfeera",
  sem_taxa: "Sem taxa Transfeera",
  nome_diferente: "Nome diferente",
  duplicado: "Pago 2x",
  devolvido: "Devolvido",
  pendente: "Nao liquidado",
  cpf_desconhecido: "CPF fora do financeiro",
  sem_cpf: "Sem CPF",
  data_do_lote: "Data do lote",
};

// Um controle so, sem opcoes que dizem a mesma coisa: severidade ja aparece na
// cor da linha e nos KPIs, entao aqui ficam os status concretos.
// Devolvido so entra quando ha dinheiro voltando, e a taxa do Transfeera aparece
// pelo avesso: o normal e ter taxa, a excecao (nao ter) e o que se procura.
const AUDIT_STATUS_FILTERS = [
  { value: "problemas", label: "So problemas", match: (row) => row.severity !== "ok" },
  { value: "nao_pago", label: "Nao pago", match: (row) => row.issue === "nao_pago" },
  { value: "valor_menor", label: "Pago a menos", match: (row) => row.issue === "valor_menor" },
  { value: "valor_maior", label: "Pago a mais", match: (row) => row.issue === "valor_maior" },
  { value: "nao_previsto", label: "Pago sem previsao", match: (row) => row.issue === "nao_previsto" || row.issue === "pagamento_sem_cpf" },
  {
    value: "pagamento_falhou",
    label: "Devolvido / falhou",
    match: (row) => row.issue === "pagamento_falhou"
      && ((row.failedAmount || 0) > 0.01 || (row.transferAmount || 0) > 0.01),
  },
  { value: "conciliado", label: "Conciliado", match: (row) => row.issue === "ok" },
  { value: "sem_taxa", label: "Sem taxa Transfeera", match: (row) => row.flags.includes("sem_taxa") },
  { value: "nome", label: "Nome diferente", match: (row) => row.flags.includes("nome_diferente") },
  { value: "tudo", label: "Tudo", match: () => true },
];

// Nome diferente com CPF e valor batendo: mostrar os dois nomes lado a lado e
// marcar o que muda, senao a etiqueta obriga a abrir o relatorio para entender.
function nameKeys(value) {
  return new Set(normalizeText(String(value || "")).toUpperCase().split(/\s+/).filter(Boolean));
}

function highlightNameDiff(value, otherKeys) {
  const tokens = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return "<em>sem nome</em>";
  return tokens
    .map((token) => (otherKeys.has(normalizeText(token).toUpperCase())
      ? escapeHtml(token)
      : `<mark>${escapeHtml(token)}</mark>`))
    .join(" ");
}

function auditNameCell(row) {
  const finance = row.financeName || "";
  const transfer = row.transferName || "";
  if (!row.flags.includes("nome_diferente")) return escapeHtml(finance || transfer || "-");
  return `
    <div class="audit-name-diff">
      <span><i>FIN</i>${highlightNameDiff(finance, nameKeys(transfer))}</span>
      <span><i>TRANSF</i>${highlightNameDiff(transfer, nameKeys(finance))}</span>
    </div>`;
}

function auditFlagLabel(row, flag) {
  if (flag === "devolvido" && row.failedAmount > 0) return `Devolvido ${fmtMoney(row.failedAmount)}`;
  if (flag === "pendente" && row.pendingAmount > 0) return `Nao liquidado ${fmtMoney(row.pendingAmount)}`;
  return AUDIT_FLAG_LABELS[flag] || flag;
}

function auditSeverityClass(severity) {
  if (severity === "critico") return "bad";
  if (severity === "atencao") return "warn";
  return "good";
}

function auditVisibleRows() {
  const rows = state.transferAudit?.rows || [];
  const term = normalizeText(state.auditFilter.search).toLowerCase().trim();
  const digits = term.replace(/\D/g, "");
  const status = AUDIT_STATUS_FILTERS.find((item) => item.value === state.auditFilter.status)
    || AUDIT_STATUS_FILTERS[0];
  return rows.filter((row) => {
    if (!status.match(row)) return false;
    if (!term) return true;
    if (digits && row.cpf.includes(digits)) return true;
    if (row.driverId && String(row.driverId).toLowerCase().includes(term)) return true;
    const names = normalizeText(`${row.transferName} ${row.financeName}`).toLowerCase();
    return names.includes(term);
  });
}

function renderAuditVerdict(summary) {
  const verdict = summary.verdict || "sem_dados";
  const copy = {
    alerta: {
      tone: "alerta",
      icon: "!",
      title: summary.criticalCount
        ? `${fmtInt(summary.criticalCount)} pagamento(s) fora do financeiro`
        : "Transfeera sem base para conferir",
      detail: summary.criticalCount
        ? `${fmtMoney(summary.riskAmount)} sairam do Transfeera sem lastro no relatorio financeiro.`
        : `${fmtMoney(summary.blockedAmount)} pagos em dias sem relatorio financeiro carregado.`,
    },
    atencao: {
      tone: "atencao",
      icon: "~",
      title: `${fmtInt(summary.attentionCount)} ponto(s) de atencao`,
      detail: "Nada saiu a mais, mas ha valores nao pagos, pagos a menos ou com status pendente.",
    },
    ok: {
      tone: "ok",
      icon: "OK",
      title: "Transfeera bate com o financeiro",
      detail: `${fmtInt(summary.ok)} pagamentos conferidos em ${fmtInt(summary.auditedDays)} dia(s). Nenhum valor fora do relatorio.`,
    },
    sem_dados: {
      tone: "neutro",
      icon: "?",
      title: "Nenhum dia com os dois relatorios",
      detail: "Envie o financeiro do dia D e o Transfeera do dia D+1 para a conferencia rodar.",
    },
  }[verdict];

  // Cada alerta e um cartao com o numero na frente e o motivo embaixo: da para
  // varrer a linha inteira sem ler frase por frase.
  const alerts = [];
  if (summary.blockedDays) {
    alerts.push({ tone: "bad", value: `${fmtInt(summary.blockedDays)} dia(s)`, label: "Pagou sem financeiro carregado", extra: fmtMoney(summary.blockedAmount) });
  }
  if (summary.orphanTransfers) {
    alerts.push({ tone: "bad", value: `${fmtInt(summary.orphanTransfers)} pagamento(s)`, label: "Sem data no extrato do Transfeera", extra: fmtMoney(summary.orphanAmount) });
  }
  if (summary.pendingDays) {
    alerts.push({ tone: "warn", value: `${fmtInt(summary.pendingDays)} dia(s)`, label: "Financeiro ainda sem Transfeera", extra: fmtMoney(summary.notSentAmount) });
  }
  if (summary.noFeeCount) {
    alerts.push({ tone: "warn", value: `${fmtInt(summary.noFeeCount)} pagamento(s)`, label: `Sem a taxa de ${fmtMoney(summary.feePerTransfer)} do Transfeera`, extra: fmtMoney(summary.noFeeAmount) });
  }
  if (summary.financeWithoutCpf) {
    alerts.push({ tone: "warn", value: `${fmtInt(summary.financeWithoutCpf)} linha(s)`, label: "Financeiro sem CPF, fora da conferencia" });
  }
  if (summary.nameDiffCount) {
    alerts.push({ tone: "info", value: `${fmtInt(summary.nameDiffCount)} pagamento(s)`, label: "Nome diferente, CPF e valor conferindo" });
  }
  if (summary.financeDuplicated || summary.transferDuplicated) {
    alerts.push({
      tone: "info",
      value: `${fmtInt((summary.financeDuplicated || 0) + (summary.transferDuplicated || 0))} linha(s)`,
      label: `Arquivo repetido ignorado (${fmtInt(summary.financeDuplicated)} fin. / ${fmtInt(summary.transferDuplicated)} transf.)`,
    });
  }

  const checked = summary.checked || 0;
  const parts = [
    { key: "crit", count: summary.criticalCount || 0, label: "critico(s)" },
    { key: "warn", count: summary.attentionCount || 0, label: "atencao" },
    { key: "ok", count: summary.ok || 0, label: "conciliado(s)" },
  ];
  const meter = checked
    ? `
    <div class="audit-verdict-meter">
      <div class="audit-meter-bar">
        ${parts.filter((part) => part.count).map((part) => `
          <i class="${part.key}" style="width:${(part.count / checked * 100).toFixed(2)}%"></i>`).join("")}
      </div>
      <div class="audit-meter-legend">
        ${parts.map((part) => `
          <span class="${part.key} ${part.count ? "" : "zero"}"><b>${fmtInt(part.count)}</b> ${part.label}</span>`).join("")}
        <em>de ${fmtInt(checked)} verificacao(oes) em ${fmtInt(summary.auditedDays)} dia(s)</em>
      </div>
    </div>`
    : "";

  const metrics = [
    { tone: summary.riskAmount > 0 ? "bad" : "ok", label: "VALOR EM RISCO", value: fmtMoney(summary.riskAmount), helper: `${fmtInt(summary.criticalCount)} sem lastro no financeiro` },
    { tone: summary.pendingAmount > 0 ? "warn" : "ok", label: "A REGULARIZAR", value: fmtMoney(summary.pendingAmount), helper: "Previsto e ainda nao pago" },
    { tone: "neutro", label: "PERIODO", value: summary.start ? `${brDate(summary.start).slice(0, 5)} a ${brDate(summary.end).slice(0, 5)}` : "--", helper: summary.start ? `${brDate(summary.start)} a ${brDate(summary.end)}` : "Sem relatorio no filtro" },
  ];

  $("auditVerdict").className = `audit-verdict ${copy.tone}`;
  $("auditVerdict").innerHTML = `
    <div class="audit-verdict-main">
      <span class="audit-verdict-icon">${copy.icon}</span>
      <div>
        <small>TRANSFEERA X FINANCEIRO</small>
        <strong>${copy.title}</strong>
        <span>${copy.detail}</span>
      </div>
    </div>
    <div class="audit-verdict-side">
      ${metrics.map((item) => `
        <div class="audit-metric ${item.tone}">
          <small>${item.label}</small>
          <b>${item.value}</b>
          <i>${item.helper}</i>
        </div>`).join("")}
    </div>
    ${meter}
    ${alerts.length ? `
      <ul class="audit-verdict-alerts">
        ${alerts.map((item) => `
          <li class="audit-alert ${item.tone}">
            <b>${item.value}</b>
            <span>${item.label}</span>
            ${item.extra ? `<em>${item.extra}</em>` : ""}
          </li>`).join("")}
      </ul>` : ""}`;
}

const AUDIT_DAY_FILTERS = [
  { value: "todos", label: "Todos", match: () => true },
  { value: "divergencia", label: "Com divergencia", match: (day) => day.status === "auditado" && (day.critico > 0 || day.atencao > 0) },
  { value: "conciliado", label: "Conciliado", match: (day) => day.status === "auditado" && !day.critico && !day.atencao },
  { value: "sem_financeiro", label: "Sem financeiro", match: (day) => day.status === "sem_financeiro" },
  { value: "sem_transfeera", label: "Sem Transfeera", match: (day) => day.status === "sem_transfeera" },
];

const AUDIT_DAY_PAGE = 12;

const MONTH_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function monthLabel(month) {
  const [year, index] = month.split("-");
  return `${MONTH_SHORT[Number(index) - 1] || index}/${year}`;
}

// Busca por dia aceita "08", "08/07" ou "08/07/2026", olhando as duas datas do cartao.
function auditDayMatchesSearch(day, term) {
  if (!term) return true;
  const text = `${brDate(day.financeDate)} ${brDate(day.transferDate)}`;
  if (text.includes(term)) return true;
  const digits = term.replace(/\D/g, "");
  return digits.length >= 2 && text.replace(/\D/g, "").includes(digits);
}

function auditDayTone(day) {
  if (day.status === "sem_financeiro") return "alerta";
  if (day.status === "sem_transfeera") return "neutro";
  if (day.critico) return "alerta";
  if (day.atencao) return "atencao";
  return "ok";
}

function auditDayStatusLabel(day) {
  if (day.status === "sem_financeiro") return "Sem financeiro";
  if (day.status === "sem_transfeera") return "Sem Transfeera";
  if (day.critico) return "Divergencia";
  if (day.atencao) return "Atencao";
  return "Conciliado";
}

function renderAuditDayToolbar(days, base) {
  const filter = state.auditDayFilter;
  const months = [...new Set(days.map((day) => day.financeDate.slice(0, 7)))].sort();
  const order = filter.order === "asc" ? "asc" : "desc";

  $("auditDayMonth").innerHTML = [
    `<option value="todos" ${filter.month === "todos" ? "selected" : ""}>Todos (${fmtInt(days.length)} dias)</option>`,
    ...months.map((month) => {
      const count = days.filter((day) => day.financeDate.startsWith(month)).length;
      return `<option value="${month}" ${filter.month === month ? "selected" : ""}>${monthLabel(month)} (${fmtInt(count)})</option>`;
    }),
  ].join("");

  $("auditDayChips").innerHTML = AUDIT_DAY_FILTERS
    .map((item) => ({ ...item, count: base.filter(item.match).length }))
    .filter((item) => item.count > 0 || item.value === filter.status || item.value === "todos")
    .map((item) => `
      <button type="button" class="audit-chip audit-day-chip ${item.value} ${filter.status === item.value ? "active" : ""}" data-audit-day-status="${item.value}">
        ${item.label}<b>${fmtInt(item.count)}</b>
      </button>`).join("");

  $("auditDayOrder").textContent = order === "desc" ? "Mais recentes" : "Mais antigos";
  $("auditDayOrder").dataset.order = order;

  const dirty = filter.status !== "todos" || filter.month !== "todos" || Boolean(filter.search);
  $("auditDayClear").classList.toggle("hidden", !dirty);
}

function renderAuditDays(days) {
  const filter = state.auditDayFilter;
  const term = filter.search.trim();
  // Mudar o periodo la em cima pode apagar o mes escolhido aqui: sem isso o
  // painel ficaria vazio sem explicar o motivo.
  if (filter.month !== "todos" && !days.some((day) => day.financeDate.startsWith(filter.month))) {
    filter.month = "todos";
  }

  // Mes e busca valem para todos os chips; o chip de status filtra por cima.
  const base = days.filter((day) => (filter.month === "todos" || day.financeDate.startsWith(filter.month))
    && auditDayMatchesSearch(day, term));
  renderAuditDayToolbar(days, base);

  const status = AUDIT_DAY_FILTERS.find((item) => item.value === filter.status) || AUDIT_DAY_FILTERS[0];
  const matched = base.filter(status.match)
    .sort((a, b) => (filter.order === "asc" ? 1 : -1) * a.financeDate.localeCompare(b.financeDate));

  if (!days.length) {
    $("auditDays").innerHTML = `<div class="finance-empty-state">Nenhum dia carregado no periodo selecionado.</div>`;
    $("auditDaysFooter").innerHTML = "";
    return;
  }
  if (!matched.length) {
    $("auditDays").innerHTML = `<div class="finance-empty-state">Nenhum dia com esse filtro. Ajuste o status, o mes ou a busca.</div>`;
    $("auditDaysFooter").innerHTML = "";
    return;
  }

  const visible = filter.expanded ? matched : matched.slice(0, AUDIT_DAY_PAGE);

  $("auditDays").innerHTML = visible.map((day) => {
    const tone = auditDayTone(day);
    const active = $("start").value === day.financeDate && $("end").value === day.financeDate;
    // Diferenca so faz sentido quando os dois relatorios existem: em dia sem par
    // o numero seria o total inteiro e leria como divergencia gigante.
    const diff = (day.transferAmount || 0) - (day.financeAmount || 0);
    const audited = day.status === "auditado";
    const diffTone = !audited ? "off" : Math.abs(diff) < 0.01 ? "" : diff > 0 ? "bad" : "warn";
    const checked = (day.critico || 0) + (day.atencao || 0) + (day.ok || 0);
    const bar = checked
      ? `<div class="audit-day-meter">
          ${[["crit", day.critico], ["warn", day.atencao], ["ok", day.ok]]
            .filter(([, count]) => count > 0)
            .map(([key, count]) => `<i class="${key}" style="width:${(count / checked * 100).toFixed(2)}%"></i>`).join("")}
         </div>`
      : "";
    const note = day.status === "auditado"
      ? `${fmtInt(day.critico)} critico(s) · ${fmtInt(day.atencao)} atencao · ${fmtInt(day.ok)} conciliado(s)`
      : day.status === "sem_financeiro"
        ? "Pagou sem relatorio financeiro"
        : "Financeiro sem repasse importado";

    return `
      <button type="button" class="audit-day ${tone} ${active ? "active" : ""}" data-audit-day="${day.financeDate}">
        <header>
          <span class="audit-day-status">${auditDayStatusLabel(day)}</span>
          ${!audited
            ? ""
            : diffTone
              ? `<span class="audit-day-diff ${diffTone}">${diff > 0 ? "+" : "-"}${fmtMoney(Math.abs(diff))}</span>`
              : `<span class="audit-day-diff ok">bate</span>`}
        </header>
        <div class="audit-day-dates">
          <strong>FIN ${brDate(day.financeDate).slice(0, 5)}</strong>
          <small>TRANSF ${brDate(day.transferDate).slice(0, 5)}</small>
        </div>
        <div class="audit-day-values">
          <span><i>Financeiro</i><b>${fmtMoney(day.financeAmount)}</b></span>
          <span><i>Pago</i><b>${fmtMoney(day.transferAmount)}</b></span>
        </div>
        ${bar}
        <em>${note}</em>
      </button>`;
  }).join("");

  const hidden = matched.length - visible.length;
  $("auditDaysFooter").innerHTML = `
    <span>Mostrando ${fmtInt(visible.length)} de ${fmtInt(matched.length)} dia(s)${matched.length !== days.length ? ` (${fmtInt(days.length)} no periodo)` : ""}</span>
    ${hidden > 0 || filter.expanded
      ? `<button type="button" class="audit-days-toggle" id="auditDaysToggle">${filter.expanded ? "Ver menos" : `Ver todos os ${fmtInt(matched.length)} dias`}</button>`
      : ""}`;
}

function renderAuditStatusFilter() {
  const rows = state.transferAudit?.rows || [];
  const current = state.auditFilter.status;
  const seen = new Set();
  const options = [];

  for (const item of AUDIT_STATUS_FILTERS) {
    const matched = rows.reduce((list, row, index) => {
      if (item.match(row)) list.push(index);
      return list;
    }, []);
    const signature = matched.join(",");
    const keep = item.value === current // a selecionada nunca desaparece
      || (matched.length > 0 && !seen.has(signature));
    if (!keep) continue;
    seen.add(signature);
    options.push({ ...item, count: matched.length });
  }

  $("auditStatus").innerHTML = options.map((item) => `
    <option value="${item.value}" ${current === item.value ? "selected" : ""}>${item.label} (${fmtInt(item.count)})</option>`).join("");
}

// Alerta visivel de qualquer pagina: quantos itens criticos existem hoje.
function renderAuditBadge(summary) {
  const badge = $("auditBadge");
  const blocking = (summary.criticalCount || 0) + (summary.blockedDays || 0) + (summary.orphanTransfers || 0);
  badge.textContent = blocking > 99 ? "99+" : String(blocking);
  badge.title = blocking ? `${fmtInt(summary.criticalCount || 0)} pagamento(s) sem lastro | ${fmtMoney(summary.riskAmount)} em risco` : "";
  badge.classList.toggle("hidden", blocking === 0);
}

function renderAudit() {
  if (!state.transferAudit) return;
  const audit = state.transferAudit;
  const summary = audit.summary || {};

  renderAuditVerdict(summary);
  renderAuditDays(audit.days || []);
  renderAuditStatusFilter();
  renderAuditBadge(summary);

  $("auditPeriod").textContent = summary.start
    ? `${brDate(summary.start)} a ${brDate(summary.end)} | ${fmtInt(summary.auditedDays)} dia(s) com os dois relatorios`
    : "Sem periodo auditado";

  $("auditKpis").innerHTML = [
    ["VALOR EM RISCO", fmtMoney(summary.riskAmount), `${fmtInt(summary.criticalCount)} pagamento(s) sem lastro`, summary.riskAmount > 0 ? "bad" : "green"],
    ["A PAGAR / A MENOS", fmtMoney(summary.pendingAmount), "Previsto no financeiro e ainda nao pago", "yellow"],
    ["CONCILIADOS", fmtInt(summary.ok), `de ${fmtInt(summary.checked)} entregadores x dia`, "green"],
    ["TOTAL FINANCEIRO", fmtMoney(summary.financeAmount), "Dias com os dois relatorios", "blue"],
    ["TOTAL PAGO", fmtMoney(summary.transferAmount), "Liquidado no Transfeera nos mesmos dias", "orange"],
  ].map(([label, value, helper, tone]) => `
    <article class="finance-kpi ${tone}">
      <small>${label}</small>
      <strong>${value}</strong>
      <span>${helper}</span>
    </article>`).join("");

  const visible = auditVisibleRows();
  const statusLabel = AUDIT_STATUS_FILTERS.find((item) => item.value === state.auditFilter.status)?.label || "";
  $("auditInfo").textContent = audit.truncated
    ? `${fmtInt(visible.length)} em "${statusLabel}" | ${fmtInt(summary.divergent)} divergencias no total (${fmtInt(audit.truncated)} nao exibidas)`
    : `${fmtInt(visible.length)} item(ns) em "${statusLabel}" | ${fmtInt(summary.divergent)} divergencia(s) e ${fmtInt(summary.ok)} conciliado(s) no periodo`;

  const rows = sortedRows(visible, "auditRows").map((row) => {
    // Pago sem nada no financeiro: as duas colunas de valor piscam.
    const unbacked = row.issue === "nao_previsto" || row.issue === "pagamento_sem_cpf";
    // Barrinhas na mesma escala mostram de relance qual lado e maior.
    const scale = Math.max(row.financeAmount, row.transferAmount, 0.01);
    const barWidth = (value) => `${Math.min(100, Math.max(value > 0 ? 4 : 0, value / scale * 100))}%`;

    return `
    <tr class="audit-row ${row.severity} ${unbacked ? "unbacked" : ""}">
      <td>
        <span class="audit-badge ${auditSeverityClass(row.severity)}">${escapeHtml(row.label)}</span>
        ${row.flags.map((flag) => `<span class="audit-flag ${flag}">${auditFlagLabel(row, flag)}</span>`).join("")}
      </td>
      <td>${brDate(row.financeDate)}</td>
      <td>${brDate(row.transferDate)}</td>
      <td class="city-cell ${cityToneClass(row.city)}">${row.city || "-"}</td>
      <td class="driver-id">${escapeHtml(row.driverId || "-")}</td>
      <td>${escapeHtml(row.cpfMask || "-")}</td>
      <td>${auditNameCell(row)}</td>
      <td class="num audit-amount ${unbacked ? "blink" : ""}">
        <span>${fmtMoney(row.financeAmount)}</span>
        <i class="audit-bar fin" style="width:${barWidth(row.financeAmount)}"></i>
      </td>
      <td class="num audit-amount ${unbacked ? "blink" : ""}">
        <span>${fmtMoney(row.transferAmount)}</span>
        <i class="audit-bar pago" style="width:${barWidth(row.transferAmount)}"></i>
      </td>
      <td class="num ${Math.abs(row.diff) >= 0.01 ? "bad" : ""}">${fmtMoney(row.diff)}</td>
      <td class="num ${row.risk > 0 ? "bad" : ""}">${row.risk > 0 ? fmtMoney(row.risk) : "-"}</td>
      <td>${escapeHtml([row.transferStatus, row.reason].filter(Boolean).join(" - ") || "-")}</td>
      <td>${row.receipt ? `<a class="audit-receipt" href="${escapeHtml(row.receipt)}" target="_blank" rel="noopener">Ver</a>` : "-"}</td>
    </tr>`;
  }).join("");

  $("auditTable").innerHTML = `
    <thead><tr>
      ${sortHeader("auditRows", "severityRank", "PROBLEMA")}
      ${sortHeader("auditRows", "financeDate", "DATA FIN.")}
      ${sortHeader("auditRows", "transferDate", "DATA TRANSF.")}
      ${sortHeader("auditRows", "city", "CIDADE")}
      ${sortHeader("auditRows", "driverId", "ID")}
      ${sortHeader("auditRows", "cpf", "CPF / CNPJ")}
      ${sortHeader("auditRows", "financeName", "ENTREGADOR")}
      ${sortHeader("auditRows", "financeAmount", "FINANCEIRO")}
      ${sortHeader("auditRows", "transferAmount", "PAGO")}
      ${sortHeader("auditRows", "diff", "DIFERENCA")}
      ${sortHeader("auditRows", "risk", "RISCO")}
      ${sortHeader("auditRows", "transferStatus", "STATUS")}
      <th>COMPROVANTE</th>
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="13">Nada a corrigir com os filtros atuais.</td></tr>`}</tbody>`;
}

function exportAuditCsv() {
  const rows = auditVisibleRows();
  if (!rows.length) return;
  const header = ["Problema", "Alertas", "Data financeiro", "Data Transfeera", "Cidade", "ID entregador", "CPF/CNPJ", "Entregador financeiro", "Favorecido Transfeera", "Valor financeiro", "Valor pago", "Diferenca", "Risco", "Status", "Motivo", "Lote", "Comprovante"];
  const body = rows.map((row) => [
    row.label,
    row.flags.map((flag) => AUDIT_FLAG_LABELS[flag] || flag).join(" / "),
    brDate(row.financeDate),
    brDate(row.transferDate),
    row.city,
    row.driverId,
    row.cpfMask,
    row.financeName,
    row.transferName,
    row.financeAmount.toFixed(2).replace(".", ","),
    row.transferAmount.toFixed(2).replace(".", ","),
    row.diff.toFixed(2).replace(".", ","),
    row.risk.toFixed(2).replace(".", ","),
    row.transferStatus,
    row.reason,
    row.batch,
    row.receipt,
  ]);
  const csv = [header, ...body]
    .map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";"))
    .join("\r\n");
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `auditoria-transfeera-${state.transferAudit?.summary?.start || "periodo"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ── Promocoes ─────────────────────────────────────────────────────────────────

function promotionsQueryParams() {
  const params = new URLSearchParams();
  ["start", "end"].forEach((id) => {
    if ($(id).value) params.set(id, $(id).value);
  });
  return params.toString();
}

// Amplia o filtro global de datas para caber a data informada.
function widenDateFilterTo(date) {
  let changed = false;
  if (!$("start").value || date < $("start").value) {
    $("start").value = date;
    changed = true;
  }
  if (!$("end").value || date > $("end").value) {
    $("end").value = date;
    changed = true;
  }
  return changed;
}

function setPromoMessage(message, ok = false) {
  $("promoMessage").textContent = message;
  $("promoMessage").classList.toggle("ok", ok);
  $("promoMessage").classList.toggle("hidden", !message);
}

async function loadPromotions() {
  if (!hasFinancialAccess(state.user)) return;
  try {
    state.promotions = await dataJson(`/api/promotions?${promotionsQueryParams()}`);
    renderPromotions();
  } catch (error) {
    setPromoMessage(error.message);
  }
}

async function savePromotionCell(date, city, value) {
  try {
    state.promotions = await dataJson(`/api/promotions?${promotionsQueryParams()}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, city, value }),
    });
    renderPromotions();
    setPromoMessage(`${city} em ${brDate(date)} salvo.`, true);
    refresh(); // o financeiro geral precisa refletir a promocao na hora
  } catch (error) {
    setPromoMessage(error.message);
    renderPromotions();
  }
}

function renderPromotions() {
  const data = state.promotions;
  if (!data) return;
  const cities = data.cities;

  $("promoKpis").innerHTML = [
    ["TOTAL EM PROMOCOES", fmtMoney(data.grandTotal), `${fmtInt(data.daysWithValue)} dia(s) com valor`, "yellow"],
    ["DIAS LANCADOS", fmtInt(data.rows.length), data.start ? `${brDate(data.start)} a ${brDate(data.end)}` : "Nenhum dia ainda", "blue"],
    ...cities.slice(0, 3).map((city) => [city, fmtMoney(data.totals[city]), "Total no periodo", "orange"]),
  ].map(([label, value, helper, tone]) => `
    <article class="finance-kpi ${tone}">
      <small>${escapeHtml(label)}</small>
      <strong>${value}</strong>
      <span>${escapeHtml(helper)}</span>
    </article>`).join("");

  const hidden = data.outsideRange
    ? ` | ${fmtInt(data.outsideRange)} dia(s) fora do filtro (${brDate(data.storedStart)} a ${brDate(data.storedEnd)} lancados)`
    : "";
  $("promoInfo").textContent = data.rows.length
    ? `${fmtInt(data.rows.length)} dia(s) | total ${fmtMoney(data.grandTotal)}${hidden}`
    : data.outsideRange
      ? `Nenhum dia no periodo filtrado, mas ha ${fmtInt(data.outsideRange)} dia(s) lancado(s) entre ${brDate(data.storedStart)} e ${brDate(data.storedEnd)}. Ajuste as datas no topo.`
      : "Adicione uma data para comecar a lancar os valores.";

  const body = data.rows.map((row) => `
    <tr>
      <td class="promo-date">${row.dateBr}</td>
      ${cities.map((city) => `
        <td class="promo-cell">
          <input type="text" inputmode="decimal" value="${row.values[city] ? row.values[city].toFixed(2).replace(".", ",") : ""}"
            placeholder="0,00" data-promo-date="${row.date}" data-promo-city="${escapeHtml(city)}" />
        </td>`).join("")}
      <td class="num promo-total">${fmtMoney(row.total)}</td>
      <td class="promo-actions"><button type="button" class="promo-remove" data-promo-remove="${row.date}" title="Excluir dia">×</button></td>
    </tr>`).join("");

  $("promoTable").innerHTML = `
    <thead><tr>
      <th>DATA</th>
      ${cities.map((city) => `
        <th class="promo-city-head"><span class="promo-city-mark ${cityToneClass(city)}"></span>${escapeHtml(city)}</th>`).join("")}
      <th>TOTAL</th>
      <th></th>
    </tr></thead>
    <tbody>${body || `<tr><td colspan="${cities.length + 3}">Nenhuma data lancada no periodo.</td></tr>`}</tbody>
    <tfoot><tr>
      <td>TOTAL</td>
      ${cities.map((city) => `<td class="num">${fmtMoney(data.totals[city])}</td>`).join("")}
      <td class="num promo-total">${fmtMoney(data.grandTotal)}</td>
      <td></td>
    </tr></tfoot>`;
}

const permissionLabels = {
  kpis: "Dashboard KPIs",
  cadastro: "Cadastro",
  financeiro: "Dash Financeiro",
  auditoria: "RECEBA AUDIT",
  promocoes: "Promocoes",
  atualizar_bi: "Atualizar BI (cidades)",
  atualizar_bi_financeiro: "Atualizar BI (financeiro)",
  usuarios: "Gerenciar Usuarios",
};

function setUsersMessage(message, ok = false) {
  $("usersMessage").textContent = message;
  $("usersMessage").classList.toggle("ok", ok);
}

async function loadUsers() {
  if (!state.supabaseEnabled || !hasUsersAccess(state.user)) return;
  $("usersCount").textContent = "Carregando usuarios...";
  try {
    const data = await authJson("/api/auth/users");
    state.users = data.users || [];
    renderUsers();
  } catch (error) {
    $("usersCount").textContent = "Erro ao carregar";
    setUsersMessage(error.message);
  }
}

function renderUsers() {
  $("usersCount").textContent = `${state.users.length} usuarios`;
  $("usersList").innerHTML = state.users.map((user) => {
    const permissions = user.permissions || {};
    const initial = (user.name || user.email || "U").trim().charAt(0).toUpperCase();
    return `
      <article class="user-card" data-user-id="${user.id}">
        <div class="user-card-summary">
          <div class="user-identity">
            <span class="user-avatar">${escapeHtml(initial)}</span>
            <div>
              <strong>${escapeHtml(user.name || "Sem nome")}</strong>
              <span>${escapeHtml(user.email)} · ${user.role === "admin" ? "Administrador" : "Usuario"}</span>
            </div>
          </div>
          <select class="user-access-select" aria-label="Area de acesso">
            <option value="operacional" ${user.access_area === "operacional" ? "selected" : ""}>Operacional</option>
            <option value="financeiro" ${user.access_area === "financeiro" ? "selected" : ""}>Financeiro</option>
            <option value="ambos" ${user.access_area === "ambos" ? "selected" : ""}>Ambos</option>
          </select>
          <select class="user-role-select" aria-label="Perfil">
            <option value="usuario" ${user.role !== "admin" ? "selected" : ""}>Usuario</option>
            <option value="admin" ${user.role === "admin" ? "selected" : ""}>Administrador</option>
          </select>
          <button class="user-status ${user.active ? "" : "inactive"}" type="button">${user.active ? "Ativo" : "Inativo"}</button>
          <button class="user-expand" type="button" aria-label="Abrir permissoes">⌄</button>
        </div>
        <div class="user-card-details">
          <div class="user-actions">
            <button class="allow-all" type="button">Liberar tudo</button>
            <button class="reset-password" type="button">Redefinir senha</button>
            <button class="block-user" type="button">${user.active ? "Bloquear usuario" : "Ativar usuario"}</button>
            <button class="delete-user" type="button">Excluir usuario</button>
          </div>
          <div class="permissions-grid">
            ${Object.entries(permissionLabels).map(([key, label]) => `
              <label class="permission-check">
                <input type="checkbox" data-permission="${key}" ${permissions[key] ? "checked" : ""} />
                <span>${label}</span>
              </label>`).join("")}
          </div>
        </div>
      </article>`;
  }).join("") || `<div class="finance-empty-state">Nenhum usuario cadastrado.</div>`;
}

async function updateManagedUser(card, payload) {
  const id = card.dataset.userId;
  const data = await authJson(`/api/auth/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  const index = state.users.findIndex((user) => user.id === id);
  if (index >= 0) state.users[index] = { ...state.users[index], ...data.user };
  renderUsers();
  setUsersMessage("Usuario atualizado.", true);
}

function userPermissionsFromCard(card) {
  return Object.fromEntries(
    [...card.querySelectorAll("[data-permission]")]
      .map((input) => [input.dataset.permission, input.checked]),
  );
}

function bindUsersEvents() {
  $("usersList").addEventListener("click", async (event) => {
    const card = event.target.closest(".user-card");
    if (!card) return;
    try {
      if (event.target.closest(".user-expand")) {
        card.classList.toggle("open");
        return;
      }
      if (event.target.closest(".user-status") || event.target.closest(".block-user")) {
        const user = state.users.find((item) => item.id === card.dataset.userId);
        await updateManagedUser(card, { active: !user.active });
        return;
      }
      if (event.target.closest(".allow-all")) {
        await updateManagedUser(card, {
          accessArea: "ambos",
          permissions: Object.fromEntries(Object.keys(permissionLabels).map((key) => [key, true])),
        });
        return;
      }
      if (event.target.closest(".reset-password")) {
        const user = state.users.find((item) => item.id === card.dataset.userId);
        if (!window.confirm(`Redefinir a senha de ${user.name || user.email} para a senha padrao?`)) return;
        const data = await authJson(`/api/auth/users/${card.dataset.userId}/reset-password`, { method: "POST" });
        setUsersMessage(`Senha redefinida para ${data.password}. O usuario devera trocar no proximo login.`, true);
        return;
      }
      if (event.target.closest(".delete-user")) {
        const user = state.users.find((item) => item.id === card.dataset.userId);
        if (!window.confirm(`Excluir ${user.name || user.email}?`)) return;
        await authJson(`/api/auth/users/${card.dataset.userId}`, { method: "DELETE" });
        state.users = state.users.filter((item) => item.id !== card.dataset.userId);
        renderUsers();
        setUsersMessage("Usuario excluido.", true);
      }
    } catch (error) {
      setUsersMessage(error.message);
    }
  });

  $("usersList").addEventListener("change", async (event) => {
    const card = event.target.closest(".user-card");
    if (!card) return;
    try {
      if (event.target.matches(".user-access-select")) {
        await updateManagedUser(card, { accessArea: event.target.value });
      } else if (event.target.matches(".user-role-select")) {
        await updateManagedUser(card, { role: event.target.value });
      } else if (event.target.matches("[data-permission]")) {
        await updateManagedUser(card, { permissions: userPermissionsFromCard(card) });
      }
    } catch (error) {
      setUsersMessage(error.message);
    }
  });
}

const CHART_METRIC_CONFIG = {
  orders: { label: "Corridas", color: "#ff6b12", scale: "orders", fmt: fmtInt },
  tsh: { label: "TSH", color: "#00d6bd", scale: "pct", fmt: fmtPct },
  critical: { label: "TSH Critical", color: "#ffbf00", scale: "pct", fmt: fmtPct },
  caa: { label: "CAA", color: "#c77dff", scale: "pct", fmt: fmtPct },
  ar: { label: "AR", color: "#ff5da2", scale: "pct", fmt: fmtPct },
  ot: { label: "Overtime", color: "#7dd3fc", scale: "pct", fmt: fmtPct },
};
const CHART_METRIC_ORDER = Object.keys(CHART_METRIC_CONFIG);

function renderWeeklyCharts(targetId = "weeklyCharts") {
  const cities = [...new Set(state.dashboard.weekly.map((row) => row.city))];
  $(targetId).innerHTML = cities.map((city) => `
    <article class="chart-card">
      <h3>${city}</h3>
      <canvas width="560" height="190" data-city="${city}"></canvas>
    </article>`).join("");

  $(`${targetId}`).querySelectorAll("canvas[data-city]").forEach((canvas) => {
    drawChart(canvas, state.dashboard.weekly.filter((row) => row.city === canvas.dataset.city));
  });
}

const TREND_PERIODS = ["daily", "weekly", "monthly"];

function renderTrendCharts(targetId = "trendCharts") {
  const target = $(targetId);
  if (!target) return;

  const series = state.dashboard?.series?.[state.trendPeriod] || [];
  const cities = [...new Set(series.map((row) => row.city))];
  if (!cities.length) {
    target.innerHTML = `<p class="chart-empty">Sem dados para o periodo selecionado.</p>`;
    return;
  }

  target.innerHTML = cities.map((city) => `
    <article class="chart-card">
      <h3>${escapeHtml(city)}</h3>
      <canvas width="560" height="190" data-city="${escapeHtml(city)}"></canvas>
    </article>`).join("");

  target.querySelectorAll("canvas[data-city]").forEach((canvas) => {
    drawChart(canvas, series.filter((row) => row.city === canvas.dataset.city));
  });
}

function setTrendPeriod(period) {
  if (!TREND_PERIODS.includes(period)) return;
  state.trendPeriod = period;
  document.querySelectorAll(".chart-period-btn[data-period]").forEach((button) => {
    button.classList.toggle("active", button.dataset.period === period);
  });
  renderTrendCharts();
}

function chartPointLabel(row) {
  return row.label ?? String(row.week ?? "").replace(/^\d{4}-/, "");
}

function drawChart(canvas, rows) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  ctx.clearRect(0, 0, width, canvas.height);

  const activeMetrics = CHART_METRIC_ORDER.filter((key) => state.chartMetrics.has(key));
  drawLegend(ctx, activeMetrics);

  ctx.strokeStyle = "#303030";
  ctx.beginPath();
  ctx.moveTo(36, 158);
  ctx.lineTo(width - 18, 158);
  ctx.stroke();

  // A serie diaria chega com dezenas de pontos: sem afinar a linha e pular
  // rotulos o grafico vira um borrao. Semanal/mensal seguem como antes.
  const dense = rows.length > 12;
  const labelStep = Math.max(1, Math.ceil(rows.length / 12));

  const maxOrders = Math.max(1, ...rows.map((row) => row.orders));
  const x = (index) => 45 + index * ((width - 90) / Math.max(rows.length - 1, 1));
  const yOrders = (value) => 158 - (value / maxOrders) * 88;
  const yPct = (value) => 158 - value * 86;
  const yFor = (metric, value) => (CHART_METRIC_CONFIG[metric].scale === "orders" ? yOrders(value) : yPct(value));

  activeMetrics.forEach((metric) => {
    const config = CHART_METRIC_CONFIG[metric];
    drawLine(ctx, rows.map((row, index) => [x(index), yFor(metric, row[metric])]), config.color, dense);
  });

  rows.forEach((row, index) => {
    const px = x(index);
    if (index % labelStep === 0 || index === rows.length - 1) {
      const label = chartPointLabel(row);
      ctx.fillStyle = "#aaa";
      ctx.font = "11px Arial";
      ctx.fillText(label, px - ctx.measureText(label).width / 2, 178);
    }

    if (dense) return;

    activeMetrics.forEach((metric, metricIndex) => {
      const config = CHART_METRIC_CONFIG[metric];
      const value = row[metric];
      const py = yFor(metric, value) + (metricIndex % 2 === 0 ? -10 : 18) - (Math.floor(metricIndex / 2) * 12);
      ctx.fillStyle = config.color;
      ctx.font = "bold 11px Arial";
      ctx.fillText(config.fmt(value).replace(",0%", "%"), px - 15, py);
    });
  });
}

function drawLegend(ctx, activeMetrics) {
  ctx.font = "10px Arial";
  const maxX = 540;
  let x = 16;
  let y = 22;
  activeMetrics.forEach((metric) => {
    const config = CHART_METRIC_CONFIG[metric];
    const itemWidth = 24 + ctx.measureText(config.label).width + 20;
    if (x + itemWidth > maxX) {
      x = 16;
      y += 14;
    }
    ctx.fillStyle = config.color;
    ctx.fillRect(x, y, 18, 4);
    ctx.fillStyle = "#e8e8e8";
    ctx.fillText(config.label, x + 24, y + 5);
    x += itemWidth;
  });
}

function drawLine(ctx, points, color, dense = false) {
  if (!points.length) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = dense ? 2 : 4;
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.stroke();
  points.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, dense ? 2.5 : 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function render() {
  if (state.dashboard) {
    renderSummary();
    renderCityCards();
    renderCadastroCards();
    renderHotzones();
    renderDrivers();
    renderWeeklyCharts();
    renderWeeklyCharts("cadastroWeeklyCharts");
    renderTrendCharts();
  }
  renderClearFiltersButton();
  if (state.signups) renderSignups();
  if (state.finance) renderFinance();
  if (state.transferAudit) renderAudit();
  renderDailyResult();
}

function dailyResultRow(driver, rank, expandable) {
  return `
    <tr class="${expandable ? "driver-row" : ""}">
      ${expandable ? `<td class="expand-cell"><button type="button" class="expand-toggle" aria-label="Expandir turnos">›</button></td>` : ""}
      <td class="num">${rank}</td>
      <td>${escapeHtml(driver.id)}</td>
      <td>${escapeHtml(driver.name)}</td>
      <td>${escapeHtml(driver.hotzone || "-")}</td>
      <td>${escapeHtml(driver.vehicle || "-")}</td>
      <td class="num">${fmtInt(driver.orders)}</td>
      <td class="num ${pctClass(driver.tsh)}">${fmtPct(driver.tsh)}</td>
      <td class="num ${pctClass(driver.ar)}">${fmtPct(driver.ar)}</td>
      <td class="num ${pctClass(driver.caa)}">${fmtPct(driver.caa)}</td>
      <td class="num ${pctClass(driver.ot)}">${fmtPct(driver.ot)}</td>
    </tr>`;
}

function dailyResultShiftRow(driver, colspan) {
  const shifts = driver.shifts || [];
  const body = shifts.length
    ? shifts.map((shift) => `
      <tr>
        <td>${escapeHtml(shift.shift)}</td>
        <td class="num">${fmtInt(shift.orders)}</td>
        <td class="num ${pctClass(shift.tsh)}">${fmtPct(shift.tsh)}</td>
        <td class="num ${pctClass(shift.ar)}">${fmtPct(shift.ar)}</td>
        <td class="num ${pctClass(shift.caa)}">${fmtPct(shift.caa)}</td>
        <td class="num ${pctClass(shift.ot)}">${fmtPct(shift.ot)}</td>
      </tr>`).join("")
    : `<tr><td colspan="6">Sem dados por turno.</td></tr>`;

  return `
    <tr class="shift-detail-row hidden">
      <td colspan="${colspan}">
        <table class="shift-detail-table">
          <thead><tr><th>TURNO</th><th>PEDIDOS</th><th>TSH</th><th>AR</th><th>CAA</th><th>OT</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </td>
    </tr>`;
}

function dailyResultTableHead(expandable) {
  return `<thead><tr>${expandable ? "<th></th>" : ""}<th>#</th><th>ID</th><th>ENTREGADOR</th><th>HOTZONE</th><th>MODAL</th><th>PEDIDOS</th><th>TSH</th><th>AR</th><th>CAA</th><th>OT</th></tr></thead>`;
}

function renderDailyResult() {
  const container = $("dailyResultCities");
  if (!state.dailyResult || !state.dailyResult.cities.length) {
    container.innerHTML = `<div class="finance-empty-state">Nenhum entregador encontrado para os filtros selecionados.</div>`;
    return;
  }

  container.innerHTML = state.dailyResult.cities.map((group) => `
    <section class="panel page-panel daily-result-city">
      <div class="panel-head">
        <h2 class="city-cell ${cityToneClass(group.city)}">${group.city}</h2>
        <span>${group.top.length + group.rest.length} entregadores no periodo</span>
      </div>
      <h3 class="daily-result-subhead">Top 10 em corridas finalizadas</h3>
      <div class="table-wrap">
        <table class="expandable-table">
          ${dailyResultTableHead(true)}
          <tbody>${group.top.map((driver, index) => `${dailyResultRow(driver, index + 1, true)}${dailyResultShiftRow(driver, 11)}`).join("") || `<tr><td colspan="11">Sem dados no periodo.</td></tr>`}</tbody>
        </table>
      </div>
      ${group.rest.length ? `
      <h3 class="daily-result-subhead">Demais entregadores</h3>
      <div class="table-wrap tall">
        <table class="expandable-table">
          ${dailyResultTableHead(true)}
          <tbody>${group.rest.map((driver, index) => `${dailyResultRow(driver, index + 11, true)}${dailyResultShiftRow(driver, 11)}`).join("")}</tbody>
        </table>
      </div>` : ""}
    </section>`).join("");
}

function configureFiltersForView(view) {
  const filters = document.querySelector(".filters");
  // Novos cadastros tem barra propria: dois conjuntos de filtro na mesma tela
  // so criam duvida sobre qual esta valendo.
  const onSignupPage = view === "operacional" && state.opPage === "cadastro" && state.cadastroView === "novos";
  if (view === "usuarios" || view === "upload" || onSignupPage) {
    filters.classList.add("hidden");
    return;
  }
  filters.classList.remove("hidden");
  document.querySelectorAll("[data-filter-control]").forEach((element) => {
    const control = element.dataset.filterControl;
    const allowed = view === "operacional"
      ? null
      : view === "auditoria" || view === "promocoes"
        ? ["start", "end", "actions"]
        : ["city", "start", "end", "actions"];
    element.classList.toggle("hidden", Boolean(allowed) && !allowed.includes(control));
  });
  renderClearFiltersButton();
}

function applyFinanceDateDefaults() {
  if (!state.meta?.financeMinDate || !state.meta?.financeMaxDate) return false;
  const usingOperationalDefault = $("start").value === state.meta.minDate && $("end").value === state.meta.maxDate;
  const emptyDates = !$("start").value && !$("end").value;
  if (!usingOperationalDefault && !emptyDates) return false;
  $("start").value = state.meta.financeMinDate;
  $("end").value = state.meta.financeMaxDate;
  return true;
}

function setView(view) {
  if (view === "financeiro" && !hasFinancialAccess(state.user)) {
    setOperationalPage(state.opPage || "kpis");
    return;
  }
  if (view === "auditoria" && !hasAuditAccess(state.user)) {
    setOperationalPage(state.opPage || "kpis");
    return;
  }
  if (view === "promocoes" && !hasPromoAccess(state.user)) {
    setOperationalPage(state.opPage || "kpis");
    return;
  }
  if (view === "usuarios" && !hasUsersAccess(state.user)) {
    setOperationalPage(state.opPage || "kpis");
    return;
  }
  if (view === "upload" && !hasUploadAccess(state.user)) {
    setOperationalPage(state.opPage || "kpis");
    return;
  }
  state.view = view;
  document.querySelectorAll(".side-link, .view").forEach((element) => element.classList.remove("active"));
  document.querySelector(`.side-link[data-view="${view}"]`).classList.add("active");
  $(view).classList.add("active");

  const pageCopy = {
    operacional: {
      eyebrow: "OPERACIONAL",
      title: "Dash Operacional",
      subtitle: "Tudo que voce enviou foi organizado aqui: TSH, hotzones, entregadores sem rota e evolucao semanal.",
    },
    financeiro: {
      eyebrow: "FINANCEIRO",
      title: "Dash Financeiro",
      subtitle: "Financeiro por cidade e periodo, com total ganho, dinheiro pendente e projecao de ganhos de 10% a 30%.",
    },
    auditoria: {
      eyebrow: "RECEBA AUDIT",
      title: "RECEBA AUDIT - Transfeera x Financeiro",
      subtitle: "O Transfeera so pode conter o que esta no relatorio financeiro. O repasse do dia D paga o financeiro do dia D-1.",
    },
    promocoes: {
      eyebrow: "FINANCEIRO",
      title: "Promocoes",
      subtitle: "Lance o valor de promocao interna por dia e cidade. O total entra no Dash Financeiro como desconto.",
    },
    usuarios: {
      eyebrow: "ADMINISTRACAO",
      title: "Usuarios",
      subtitle: "Gerencie acessos, perfis e permissoes usando Supabase.",
    },
    upload: {
      eyebrow: "ADMINISTRACAO",
      title: "Upload BI",
      subtitle: "Envie os relatorios .xlsx atualizados por cidade ou financeiro.",
    },
  };
  const copy = pageCopy[view];
  $("pageEyebrow").textContent = copy.eyebrow;
  $("pageTitle").textContent = copy.title;
  $("pageSubtitle").textContent = copy.subtitle;
  configureFiltersForView(view);
  if (view === "operacional") {
    setOperationalPage(state.opPage);
  } else if (view === "promocoes") {
    if (applyFinanceDateDefaults()) refresh();
    loadPromotions();
  } else if ((view === "financeiro" || view === "auditoria") && applyFinanceDateDefaults()) {
    refresh();
  } else if (view === "usuarios") {
    loadUsers();
  } else if (view === "upload") {
    applyUploadCardAccess();
    loadBiFiles();
  }
  saveLastView();
}

function setOperationalPage(page) {
  state.opPage = page;
  document.querySelectorAll(".op-tab, .op-page, .side-sub-link").forEach((element) => element.classList.remove("active"));
  document.querySelector(`.op-tab[data-op-page="${page}"]`).classList.add("active");
  document.querySelector(`.side-sub-link[data-op-page="${page}"]`).classList.add("active");
  $(`op-${page}`).classList.add("active");
  document.querySelector(`.side-link[data-view="operacional"]`).classList.add("active");
  document.querySelector(`.side-link[data-view="financeiro"]`).classList.remove("active");
  document.querySelector(`.side-link[data-view="auditoria"]`).classList.remove("active");
  document.querySelector(`.side-link[data-view="promocoes"]`).classList.remove("active");
  document.querySelector(`.side-link[data-view="usuarios"]`).classList.remove("active");
  document.querySelector(`.side-link[data-view="upload"]`).classList.remove("active");
  $("operacional").classList.add("active");
  $("financeiro").classList.remove("active");
  $("auditoria").classList.remove("active");
  $("promocoes").classList.remove("active");
  $("usuarios").classList.remove("active");
  $("upload").classList.remove("active");
  configureFiltersForView("operacional");
  $("pageEyebrow").textContent = "OPERACIONAL";

  const pageCopy = {
    kpis: {
      title: "Dash Operacional - KPIs",
      subtitle: "Primeira pagina operacional com TSH por cidade, critical, turnos, deficit de horas e tabela de hotzones.",
    },
    cadastro: {
      title: "Dash Operacional - Cadastro",
      subtitle: "Novos cadastros por dia, de onde vem cada um e a última data que rodou; na segunda aba, a base completa de entregadores.",
    },
    resultado: {
      title: "Dash Operacional - Resultado Diario",
      subtitle: "Top 10 por corridas finalizadas em cada cidade e os demais logo abaixo. Clique na linha para abrir o detalhe por turno.",
    },
    evolucao: {
      title: "Dash Operacional - Evolucao",
      subtitle: "Compare corridas, TSH e critical por semana em cada cidade.",
    },
  };

  $("pageTitle").textContent = pageCopy[page].title;
  $("pageSubtitle").textContent = pageCopy[page].subtitle;
  if (page === "cadastro") setCadastroView(state.cadastroView);
  saveLastView();
}

document.querySelectorAll(".side-link").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelectorAll(".op-tab").forEach((button) => {
  button.addEventListener("click", () => setOperationalPage(button.dataset.opPage));
});

document.querySelectorAll(".side-sub-link").forEach((button) => {
  button.addEventListener("click", () => setOperationalPage(button.dataset.opPage));
});

["start", "end"].forEach((filterId) => {
  $(filterId).addEventListener("change", () => {
    refresh();
    updateFilterOptions();
    if (state.view === "promocoes") loadPromotions();
  });
});

$("clearFiltersButton").addEventListener("click", clearFilters);

$("auditStatus").addEventListener("change", (event) => {
  state.auditFilter.status = event.target.value;
  renderAudit();
});

$("auditDays").addEventListener("click", (event) => {
  const day = event.target.closest("[data-audit-day]");
  if (!day) return;
  const value = day.dataset.auditDay;
  const alreadySelected = $("start").value === value && $("end").value === value;
  $("start").value = alreadySelected ? state.meta?.financeMinDate || "" : value;
  $("end").value = alreadySelected ? state.meta?.financeMaxDate || "" : value;
  refresh();
});

$("auditDayChips").addEventListener("click", (event) => {
  const chip = event.target.closest("[data-audit-day-status]");
  if (!chip) return;
  state.auditDayFilter.status = chip.dataset.auditDayStatus;
  state.auditDayFilter.expanded = false;
  renderAudit();
});

$("auditDayMonth").addEventListener("change", (event) => {
  state.auditDayFilter.month = event.target.value;
  state.auditDayFilter.expanded = false;
  renderAudit();
});

$("auditDaySearch").addEventListener("input", (event) => {
  state.auditDayFilter.search = event.target.value;
  state.auditDayFilter.expanded = false;
  renderAudit();
});

$("auditDayOrder").addEventListener("click", () => {
  state.auditDayFilter.order = state.auditDayFilter.order === "desc" ? "asc" : "desc";
  renderAudit();
});

$("auditDayClear").addEventListener("click", () => {
  state.auditDayFilter = { ...state.auditDayFilter, status: "todos", month: "todos", search: "", expanded: false };
  $("auditDaySearch").value = "";
  renderAudit();
});

$("auditDaysFooter").addEventListener("click", (event) => {
  if (!event.target.closest("#auditDaysToggle")) return;
  state.auditDayFilter.expanded = !state.auditDayFilter.expanded;
  renderAudit();
});

$("auditSearch").addEventListener("input", (event) => {
  state.auditFilter.search = event.target.value;
  renderAudit();
});

$("auditExport").addEventListener("click", exportAuditCsv);

$("weeklyRevenueTableToggle").addEventListener("click", () => {
  const table = $("weeklyRevenueTable");
  const shown = table.classList.toggle("hidden");
  $("weeklyRevenueTableToggle").textContent = shown ? "Ver tabela" : "Ver grafico";
  $("weeklyRevenueTableToggle").setAttribute("aria-expanded", String(!shown));
});

$("promoAddForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const date = $("promoNewDate").value;
  if (!date) return;
  // Sem isso a data entra no arquivo mas some da tela por causa do filtro de periodo.
  const widened = widenDateFilterTo(date);
  try {
    state.promotions = await dataJson(`/api/promotions?${promotionsQueryParams()}`, {
      method: "POST",
      body: JSON.stringify({ date }),
    });
    $("promoNewDate").value = "";
    renderPromotions();
    setPromoMessage(widened
      ? `Dia ${brDate(date)} adicionado. O periodo do filtro foi ampliado para mostrar ele.`
      : `Dia ${brDate(date)} adicionado.`, true);
    if (widened) refresh();
  } catch (error) {
    setPromoMessage(error.message);
    if (widened) loadPromotions(); // mostra a data que ja existia no periodo ampliado
  }
});

$("promoTable").addEventListener("change", (event) => {
  const input = event.target.closest("[data-promo-date]");
  if (!input) return;
  savePromotionCell(input.dataset.promoDate, input.dataset.promoCity, input.value.trim() || "0");
});

$("promoTable").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target.closest("[data-promo-date]")) event.target.blur();
});

$("promoTable").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-promo-remove]");
  if (!button) return;
  const date = button.dataset.promoRemove;
  if (!confirm(`Excluir o dia ${brDate(date)} e todos os valores de promocao dele?`)) return;
  try {
    state.promotions = await dataJson(`/api/promotions?date=${date}&${promotionsQueryParams()}`, { method: "DELETE" });
    renderPromotions();
    setPromoMessage(`Dia ${brDate(date)} excluido.`, true);
    refresh();
  } catch (error) {
    setPromoMessage(error.message);
  }
});

document.addEventListener("click", (event) => {
  const header = event.target.closest("th[data-sort-key]");
  if (!header) return;
  const { table, sortKey } = header.dataset;
  const current = state.tableSort[table];
  state.tableSort[table] = {
    key: sortKey,
    direction: current?.key === sortKey && current.direction === "asc" ? "desc" : "asc",
  };
  render();
});

document.addEventListener("click", () => {
  document.querySelectorAll(".search-select.open, .multi-select.open").forEach((select) => select.classList.remove("open"));
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = normalizeEmail($("loginUser").value);
  const password = $("loginPassword").value;
  const btn = $("loginForm").querySelector(".login-submit");
  btn.disabled = true;
  setLoginMessage("");

  try {
    if (state.supabaseEnabled) {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erro ao entrar.");
      state.authMode = "supabase";
      state.accessToken = data.accessToken;
      state.refreshToken = data.refreshToken;
      state.user = data.profile;
      if (data.profile.must_change_password) {
        showFirstAccess(email);
      } else {
        await refresh();
        openApp(data.profile);
      }
      return;
    }

    state.authMode = "local";
    const result = await validateLogin(email, password);
    if (!result.ok) { setLoginMessage(result.message); return; }
    if (result.firstAccess) { showFirstAccess(email); return; }
    openApp({ email });
  } catch (error) {
    setLoginMessage(error.message || "Erro de conexao. Tente novamente.");
  } finally {
    btn.disabled = false;
  }
});

$("firstAccessForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = state.pendingFirstAccessEmail;
  const newPassword = $("newPassword").value;
  const confirmPassword = $("confirmPassword").value;

  if (newPassword.length < 6) { setPasswordMessage("A senha precisa ter pelo menos 6 caracteres."); return; }
  if (newPassword === DEFAULT_PASSWORD) { setPasswordMessage("Escolha uma senha diferente da senha padrao."); return; }
  if (newPassword !== confirmPassword) { setPasswordMessage("As senhas nao conferem."); return; }

  const btn = $("firstAccessForm").querySelector(".login-submit");
  btn.disabled = true;

  try {
    if (state.authMode === "supabase") {
      await authJson("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ password: newPassword }),
      });
      state.user = { ...state.user, must_change_password: false };
      setPasswordMessage("Senha salva com sucesso.", true);
      await refresh();
      openApp(state.user);
      return;
    }

    const result = await fetch("/api/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: newPassword }),
    }).then((r) => r.json());

    if (!result.ok) { setPasswordMessage(result.message); return; }
    setPasswordMessage("Senha salva com sucesso.", true);
    openApp({ email });
  } catch (error) {
    setPasswordMessage(error.message || "Erro de conexao. Tente novamente.");
  } finally {
    btn.disabled = false;
  }
});

$("skipFirstAccess").addEventListener("click", () => {
  if (state.authMode === "supabase") {
    setPasswordMessage("A troca de senha e obrigatoria no primeiro acesso.");
    return;
  }
  openApp({ email: state.pendingFirstAccessEmail });
});

$("cancelFirstAccess").addEventListener("click", () => {
  state.accessToken = "";
  state.refreshToken = "";
  state.user = null;
  showLogin();
});

document.querySelector(".forgot-link").addEventListener("click", (event) => {
  event.preventDefault();
  showForgotForm();
});

$("cancelForgot").addEventListener("click", () => { showLogin(); });

$("forgotForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = normalizeEmail($("forgotEmail").value);
  if (!email) { setForgotMessage("Digite seu email."); return; }

  const btn = $("forgotForm").querySelector(".login-submit");
  btn.disabled = true;
  btn.textContent = "ENVIANDO...";

  try {
    const result = await fetch("/api/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).then((r) => r.json());

    if (!result.ok) { setForgotMessage(result.message || "Erro ao enviar email."); return; }
    showResetForm(email);
  } catch {
    setForgotMessage("Erro de conexao. Tente novamente.");
  } finally {
    btn.disabled = false;
    btn.textContent = "ENVIAR CODIGO";
  }
});

$("cancelReset").addEventListener("click", () => { showLogin(); });

$("resetForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = state.pendingForgotEmail;
  const code = $("resetCode").value.trim();
  const password = $("resetPassword").value;
  const confirm = $("resetConfirm").value;

  if (password !== confirm) { setResetMessage("As senhas nao conferem."); return; }

  const btn = $("resetForm").querySelector(".login-submit");
  btn.disabled = true;

  try {
    const result = await fetch("/api/verify-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, password }),
    }).then((r) => r.json());

    if (!result.ok) { setResetMessage(result.message); return; }
    setResetMessage("Senha redefinida com sucesso!", true);
    setTimeout(() => openApp({ email }), 1000);
  } catch {
    setResetMessage("Erro de conexao. Tente novamente.");
  } finally {
    btn.disabled = false;
  }
});

$("logoutButton").addEventListener("click", () => {
  clearActiveSession();
  try { localStorage.removeItem(LAST_VIEW_KEY); } catch { /* sem localStorage */ }
  state.accessToken = "";
  state.refreshToken = "";
  state.user = null;
  $("appShell").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  showLogin();
});

$("createUserForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const accessArea = $("newUserAccess").value;
  const role = $("newUserRole").value;
  const permissions = {
    kpis: accessArea !== "financeiro",
    cadastro: accessArea !== "financeiro",
    financeiro: accessArea !== "operacional",
    auditoria: accessArea !== "operacional",
    promocoes: accessArea !== "operacional",
    atualizar_bi: role === "admin",
    atualizar_bi_financeiro: role === "admin",
    usuarios: role === "admin",
  };

  try {
    const data = await authJson("/api/auth/users", {
      method: "POST",
      body: JSON.stringify({
        name: $("newUserName").value,
        email: $("newUserEmail").value,
        password: $("newUserPassword").value,
        accessArea,
        role,
        permissions,
      }),
    });
    state.users.unshift(data.user);
    renderUsers();
    $("createUserForm").reset();
    $("newUserPassword").value = DEFAULT_PASSWORD;
    setUsersMessage("Usuario criado com sucesso.", true);
  } catch (error) {
    setUsersMessage(error.message);
  }
});

$("reloadUsersButton").addEventListener("click", loadUsers);
bindUsersEvents();

function setUploadStatus(card, text, tone) {
  const status = card.querySelector('[data-role="status"]');
  status.textContent = text;
  status.className = tone ? `upload-status ${tone}` : "upload-status";
}

function logUpload(card, text, tone) {
  const log = card.querySelector('[data-role="log"]');
  const item = document.createElement("li");
  if (tone) item.className = tone;
  item.textContent = text;
  log.prepend(item);
  while (log.children.length > 6) log.removeChild(log.lastChild);
}

async function uploadBiFiles(card, fileList) {
  const target = card.dataset.target;
  const files = Array.from(fileList || []).filter((file) => /\.xlsx$/i.test(file.name));
  if (!files.length) return;

  setUploadStatus(card, "Enviando...", "busy");
  const formData = new FormData();
  formData.append("target", target);
  files.forEach((file) => formData.append("files", file));

  try {
    const response = state.supabaseEnabled
      ? await authFetch("/api/upload-bi", { method: "POST", body: formData })
      : await fetch("/api/upload-bi", { method: "POST", body: formData });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Erro ao enviar arquivo.");

    setUploadStatus(card, "Atualizado", "ok");
    result.uploaded.forEach((name) => logUpload(card, `${name} enviado`, "ok"));

    await loadBiFiles();
    state.meta = await getJson("/api/meta");
    updateSidebarDataInfo(state.meta);
    if (state.user) await refresh();
  } catch (error) {
    setUploadStatus(card, "Erro", "error");
    logUpload(card, error.message, "error");
  } finally {
    setTimeout(() => setUploadStatus(card, "Pronto"), 2500);
  }
}

function fmtFileSize(bytes) {
  if (!bytes) return "0 KB";
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

function renderBiFiles() {
  document.querySelectorAll(".upload-card").forEach((card) => {
    const files = state.biFiles?.[card.dataset.target] || [];
    const list = card.querySelector('[data-role="files-list"]');
    const count = card.querySelector('[data-role="files-count"]');
    if (!list || !count) return;
    count.textContent = `${files.length} arquivo${files.length === 1 ? "" : "s"}`;
    list.innerHTML = files.length
      ? files.map((file) => `
        <li>
          <div class="file-info">
            <span class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
            <span class="file-meta">${fmtFileSize(file.size)} · ${fmtDate(file.mtime)}</span>
          </div>
          <button type="button" class="delete-bi-file" data-file="${escapeHtml(file.name)}" aria-label="Excluir arquivo" title="Excluir arquivo">×</button>
        </li>`).join("")
      : `<li class="empty">Nenhum arquivo enviado ainda.</li>`;
  });
}

async function loadBiFiles() {
  try {
    const data = state.supabaseEnabled ? await authJson("/api/bi-files") : await getJson("/api/bi-files");
    state.biFiles = data.files || {};
  } catch (error) {
    console.error("Erro ao carregar arquivos do BI:", error);
    state.biFiles = {};
  }
  renderBiFiles();
}

async function deleteBiFile(card, filename) {
  const target = card.dataset.target;
  if (!window.confirm(`Excluir "${filename}"? Essa acao nao pode ser desfeita.`)) return;
  try {
    const query = `target=${encodeURIComponent(target)}&filename=${encodeURIComponent(filename)}`;
    const response = state.supabaseEnabled
      ? await authFetch(`/api/bi-files?${query}`, { method: "DELETE" })
      : await fetch(`/api/bi-files?${query}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || "Erro ao excluir arquivo.");

    logUpload(card, `${filename} excluido`, "ok");
    await loadBiFiles();
    state.meta = await getJson("/api/meta");
    updateSidebarDataInfo(state.meta);
    if (state.user) await refresh();
  } catch (error) {
    logUpload(card, error.message, "error");
  }
}

function bindUploadEvents() {
  document.querySelectorAll(".upload-card").forEach((card) => {
    const dropzone = card.querySelector('[data-role="dropzone"]');
    const input = card.querySelector('[data-role="input"]');

    input.addEventListener("change", () => {
      uploadBiFiles(card, input.files);
      input.value = "";
    });

    ["dragover", "dragenter"].forEach((eventName) => {
      dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropzone.classList.add("dragover");
      });
    });
    ["dragleave", "dragend"].forEach((eventName) => {
      dropzone.addEventListener(eventName, () => dropzone.classList.remove("dragover"));
    });
    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragover");
      uploadBiFiles(card, event.dataTransfer.files);
    });

    card.querySelector('[data-role="files-list"]')?.addEventListener("click", (event) => {
      const button = event.target.closest(".delete-bi-file");
      if (!button) return;
      deleteBiFile(card, button.dataset.file);
    });
  });
}

bindUploadEvents();

function setChartMetric(metric) {
  if (state.chartMetrics.has(metric)) {
    state.chartMetrics.delete(metric);
  } else {
    state.chartMetrics.add(metric);
  }
  document.querySelectorAll(".chart-metric-btn").forEach((button) => {
    button.classList.toggle("active", state.chartMetrics.has(button.dataset.metric));
  });
  if (state.dashboard) {
    renderWeeklyCharts();
    renderWeeklyCharts("cadastroWeeklyCharts");
    renderTrendCharts();
  }
}

document.querySelectorAll(".chart-metric-btn").forEach((button) => {
  button.addEventListener("click", () => setChartMetric(button.dataset.metric));
});

document.querySelectorAll(".chart-period-btn[data-period]").forEach((button) => {
  button.addEventListener("click", () => setTrendPeriod(button.dataset.period));
});

// ─── Eventos da pagina de cadastro ──────────────────────────────────────────

function setCadastroView(view) {
  state.cadastroView = view;
  document.querySelectorAll(".cadastro-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.cadastroView === view);
  });
  document.querySelectorAll(".cadastro-view").forEach((section) => {
    section.classList.toggle("active", section.id === `cadastro-${view}`);
  });
  configureFiltersForView(state.view);
  saveLastView();
  // O canvas so mede certo depois de visivel: redesenha ao abrir a aba.
  if (view === "novos" && state.signups) renderSignupChart();
}

document.querySelectorAll(".cadastro-tab").forEach((button) => {
  button.addEventListener("click", () => setCadastroView(button.dataset.cadastroView));
});

document.querySelectorAll("[data-signup-period]").forEach((button) => {
  button.addEventListener("click", () => {
    state.signupPeriod = button.dataset.signupPeriod;
    document.querySelectorAll("[data-signup-period]").forEach((item) => {
      item.classList.toggle("active", item.dataset.signupPeriod === state.signupPeriod);
    });
    if (state.signups) renderSignupChart();
  });
});

["signupStart", "signupEnd", "signupPraca", "signupOrigin", "signupModal", "signupStatus"].forEach((id) => {
  $(id).addEventListener("change", () => {
    readSignupFilterInputs();
    loadSignups().catch((error) => console.error(error));
  });
});

signupPeopleInit();

$("signupClear").addEventListener("click", () => {
  ["signupPraca", "signupOrigin", "signupModal", "signupStatus"].forEach((id) => { $(id).value = ""; });
  state.signupPeople = [];
  signupPeopleRender();
  $("signupStart").value = state.signups?.range.min || "";
  $("signupEnd").value = state.signups?.range.max || "";
  readSignupFilterInputs();
  loadSignups().catch((error) => console.error(error));
});

$("signupStatusCards").addEventListener("click", (event) => {
  const card = event.target.closest("[data-signup-status]");
  if (!card) return;
  const status = card.dataset.signupStatus;
  $("signupStatus").value = state.signupFilter.status === status ? "" : status;
  readSignupFilterInputs();
  loadSignups().catch((error) => console.error(error));
});

$("signupExport").addEventListener("click", exportSignupsCsv);

$("signupSync").addEventListener("click", async () => {
  const button = $("signupSync");
  button.disabled = true;
  button.textContent = "Lendo planilha...";
  try {
    state.signups = await dataJson(`/api/signups/refresh?${signupQueryParams()}`, { method: "POST" });
    applySignupRange();
    renderSignups();
    button.textContent = "Atualizado";
  } catch (error) {
    console.error(error);
    button.textContent = "Erro ao atualizar";
  } finally {
    button.disabled = false;
    setTimeout(() => { button.textContent = "Atualizar planilha"; }, 1800);
  }
});

$("dailyResultCities").addEventListener("click", (event) => {
  const row = event.target.closest(".driver-row");
  if (!row) return;
  const detail = row.nextElementSibling;
  if (!detail || !detail.classList.contains("shift-detail-row")) return;
  detail.classList.toggle("hidden");
  row.querySelector(".expand-toggle")?.classList.toggle("open");
});

$("refreshDataButton").addEventListener("click", async () => {
  const button = $("refreshDataButton");
  $("updateStatus").textContent = "Atualizando";
  button.textContent = "Puxando BI...";
  button.disabled = true;
  try {
    const response = state.supabaseEnabled
      ? await authFetch("/api/reload", { method: "POST" })
      : await fetch("/api/reload", { method: "POST" });
    if (!response.ok) throw new Error("Erro ao atualizar BI");
    state.meta = await getJson("/api/meta");
    updateSidebarDataInfo(state.meta);
    await refresh();
    if (state.user) {
      $("loginScreen").classList.add("hidden");
      $("appShell").classList.remove("hidden");
      applyUserAccess();
      configureFiltersForView(state.view);
    }
    button.textContent = "Atualizado";
    setTimeout(() => {
      button.textContent = "Atualizar BI";
    }, 1400);
  } catch (error) {
    $("updateStatus").textContent = "Erro";
    button.textContent = "Tentar novamente";
    console.error(error);
  } finally {
    button.disabled = false;
  }
});

const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

document.querySelectorAll(".password-toggle").forEach((button) => {
  button.innerHTML = EYE_ICON;
  button.addEventListener("click", () => {
    const input = $(button.dataset.target);
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    button.innerHTML = visible ? EYE_ICON : EYE_OFF_ICON;
    button.setAttribute("aria-label", visible ? "Mostrar senha" : "Ocultar senha");
  });
});

// Com sessao guardada a tela de login nem chega a aparecer no F5: o app abre
// direto em modo carregando e so cai para o login se a sessao for recusada.
const bootSession = getActiveSession();
if (bootSession) {
  document.body.classList.add("booting");
  $("loginScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");
}

Promise.all([loadAuthConfig(), loadMeta()])
  .then(async () => {
    const session = getActiveSession();
    if (session?.mode === "supabase") {
      state.authMode = "supabase";
      state.accessToken = session.accessToken;
      state.refreshToken = session.refreshToken;
      state.user = session.profile;
      try {
        const data = await authJson("/api/auth/me");
        state.user = data.profile;
        await refresh();
        openApp(data.profile);
      } catch (error) {
        // So encerra a sessao guardada se o servidor confirmou que ela e invalida.
        // Falhas de rede/deploy nao devem deslogar o usuario.
        if (error.status === 401) clearActiveSession();
        showLogin();
      }
    } else if (session?.mode === "local" && !state.supabaseEnabled) {
      state.authMode = "local";
      state.user = session.profile;
      await refresh();
      openApp(session.profile);
    } else {
      if (session) clearActiveSession();
      if (!state.supabaseEnabled) await refresh();
      setView("operacional");
      setOperationalPage("kpis");
    }
  })
  .catch((error) => {
    console.error("Erro ao iniciar sessao:", error);
    showLogin();
  });
