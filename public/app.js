const state = {
  view: "operacional",
  opPage: "kpis",
  meta: null,
  dashboard: null,
  finance: null,
  user: null,
  pendingFirstAccessEmail: "",
  pendingForgotEmail: "",
  tableSort: {
    hotzones: { key: "city", direction: "asc" },
    drivers: { key: "city", direction: "asc" },
    financeDrivers: { key: "totalDaily", direction: "desc" },
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
const normalizeText = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "");

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
    const email = normalizeEmail(session.email);
    return isAllowedEmail(email) ? { email } : null;
  } catch {
    return null;
  }
}

function saveActiveSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ email: user.email }));
}

function clearActiveSession() {
  localStorage.removeItem(SESSION_KEY);
}

function isAllowedEmail(email) {
  return ALLOWED_USERS.includes(email);
}

function hasFinancialAccess(email) {
  return email === FULL_ACCESS_EMAIL;
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
  state.pendingFirstAccessEmail = "";
  state.pendingForgotEmail = "";
  ["firstAccessForm", "forgotForm", "resetForm"].forEach((id) => $(id).classList.add("hidden"));
  $("loginForm").classList.remove("hidden");
  $("loginPassword").value = "";
  document.querySelector(".finance-link").classList.add("hidden");
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

function applyUserAccess() {
  const canSeeFinance = hasFinancialAccess(state.user?.email);
  document.querySelector(".finance-link").classList.toggle("hidden", !canSeeFinance);
  if (!canSeeFinance && state.view === "financeiro") setOperationalPage("kpis");
}

function openApp(user) {
  state.user = user;
  saveActiveSession(user);
  applyUserAccess();
  $("loginScreen").classList.add("hidden");
  $("appShell").classList.remove("hidden");
  setOperationalPage("kpis");
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
  ["city", "hotzone", "cpf", "week", "start", "end"].forEach((id) => {
    if ($(id).value) params.set(id, $(id).value);
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

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Erro ao carregar ${url}`);
  return response.json();
}

async function loadMeta() {
  state.meta = await getJson("/api/meta");
  buildSearchSelect("city", state.meta.cities);
  buildSearchSelect("hotzone", state.meta.hotzones);
  buildSearchSelect("cpf", state.meta.cpfs);
  buildSearchSelect("week", state.meta.weeks);
  $("start").value = state.meta.minDate;
  $("end").value = state.meta.maxDate;
  updateSidebarDataInfo(state.meta);
}

function updateSidebarDataInfo(meta) {
  $("lastUpdate").textContent = fmtDateTime(meta.latestSourceUpdate || meta.loadedAt);
  $("updateStatus").textContent = "Atualizado";
}

function buildSearchSelect(filterId, values) {
  const root = document.querySelector(`.search-select[data-filter="${filterId}"]`);
  root.innerHTML = `
    <button class="search-select-trigger" type="button">
      <span>Todos</span>
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
  ["city", "hotzone", "cpf", "week"].forEach(resetSearchSelect);
  const finance = state.view === "financeiro";
  $("start").value = finance ? state.meta?.financeMinDate || "" : state.meta?.minDate || "";
  $("end").value = finance ? state.meta?.financeMaxDate || "" : state.meta?.maxDate || "";
  refresh();
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
  const [dashboard, finance] = await Promise.all([
    getJson(`/api/dashboard?${params}`),
    getJson(`/api/finance?${financeQueryParams()}`),
  ]);
  state.dashboard = dashboard;
  state.finance = finance;
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
      ${sortHeader("drivers", "lastRoute", "ULTIMA ROTA")}
      ${sortHeader("drivers", "daysNoRoute", "SEM RODAR")}
    </tr></thead>
    <tbody>${rows}</tbody>`;
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

  $("financeProjections").innerHTML = finance.projections.map((item) => `
    <article class="projection-card">
      <small>GANHO RECEBA</small>
      <strong>${item.label}</strong>
      <b>${fmtMoney(item.gain)}</b>
      <span>sobre ganhos + recompensas</span>
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

  const maxDay = Math.max(1, ...finance.byDate.map((row) => row.totalDaily));
  $("financeDayGrid").innerHTML = finance.byDate.slice(-12).map((row) => `
    <article>
      <b style="height:${Math.max(8, row.totalDaily / maxDay * 100)}%"></b>
      <strong>${fmtMoney(row.totalDaily)}</strong>
      <span>${row.dateBr}</span>
      <small>20% ganhos ${fmtMoney(row.gain20)}</small>
    </article>`).join("") || `<div class="finance-empty-state">Sem datas financeiras carregadas.</div>`;

  renderFinanceDrivers();
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

function drawChart(canvas, rows) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  ctx.clearRect(0, 0, width, canvas.height);

  drawLegend(ctx);

  ctx.strokeStyle = "#303030";
  ctx.beginPath();
  ctx.moveTo(36, 158);
  ctx.lineTo(width - 18, 158);
  ctx.stroke();

  const maxOrders = Math.max(1, ...rows.map((row) => row.orders));
  const x = (index) => 45 + index * ((width - 90) / Math.max(rows.length - 1, 1));
  const yOrders = (value) => 158 - (value / maxOrders) * 88;
  const yPct = (value) => 158 - value * 86;

  drawLine(ctx, rows.map((row, index) => [x(index), yOrders(row.orders)]), "#ff6b12");
  drawLine(ctx, rows.map((row, index) => [x(index), yPct(row.tsh)]), "#00d6bd");
  drawLine(ctx, rows.map((row, index) => [x(index), yPct(row.critical)]), "#ffbf00");

  rows.forEach((row, index) => {
    const px = x(index);
    ctx.fillStyle = "#aaa";
    ctx.font = "11px Arial";
    ctx.fillText(row.week.replace("2026-", ""), px - 12, 178);

    ctx.fillStyle = "#ff6b12";
    ctx.font = "bold 11px Arial";
    ctx.fillText(fmtInt(row.orders), px - 18, yOrders(row.orders) - 24);

    ctx.fillStyle = "#00d6bd";
    ctx.fillText(fmtPct(row.tsh).replace(",0%", "%"), px - 13, yPct(row.tsh) - 10);

    ctx.fillStyle = "#ffbf00";
    ctx.fillText(fmtPct(row.critical).replace(",0%", "%"), px - 13, yPct(row.critical) + 18);
  });
}

function drawLegend(ctx) {
  const items = [
    ["Corridas", "#ff6b12", 16],
    ["TSH", "#00d6bd", 92],
    ["TSH Critical", "#ffbf00", 142],
  ];

  ctx.font = "10px Arial";
  items.forEach(([label, color, x]) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, 22, 18, 4);
    ctx.fillStyle = "#e8e8e8";
    ctx.fillText(label, x + 24, 27);
  });
}

function drawLine(ctx, points, color) {
  if (!points.length) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.stroke();
  points.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function render() {
  renderSummary();
  renderCityCards();
  renderCadastroCards();
  renderHotzones();
  renderDrivers();
  renderWeeklyCharts();
  renderWeeklyCharts("cadastroWeeklyCharts");
  renderFinance();
}

function configureFiltersForView(view) {
  const financeOnly = view === "financeiro";
  document.querySelector(".filters").classList.remove("hidden");
  document.querySelectorAll("[data-filter-control]").forEach((element) => {
    const control = element.dataset.filterControl;
    const visible = !financeOnly || ["city", "start", "end", "actions"].includes(control);
    element.classList.toggle("hidden", !visible);
  });
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
  if (view === "financeiro" && !hasFinancialAccess(state.user?.email)) {
    setOperationalPage(state.opPage || "kpis");
    return;
  }
  state.view = view;
  document.querySelectorAll(".side-link, .view").forEach((element) => element.classList.remove("active"));
  document.querySelector(`.side-link[data-view="${view}"]`).classList.add("active");
  $(view).classList.add("active");

  const operational = view === "operacional";
  $("pageEyebrow").textContent = operational ? "OPERACIONAL" : "FINANCEIRO";
  $("pageTitle").textContent = operational ? "Dash Operacional" : "Dash Financeiro";
  $("pageSubtitle").textContent = operational
    ? "Tudo que voce enviou foi organizado aqui: TSH, hotzones, entregadores sem rota e evolucao semanal."
    : "Financeiro por cidade e periodo, com total ganho, dinheiro pendente e projecao de ganhos de 10% a 30%.";
  configureFiltersForView(view);
  if (operational) {
    setOperationalPage(state.opPage);
  } else if (applyFinanceDateDefaults()) {
    refresh();
  }
}

function setOperationalPage(page) {
  state.opPage = page;
  document.querySelectorAll(".op-tab, .op-page, .side-sub-link").forEach((element) => element.classList.remove("active"));
  document.querySelector(`.op-tab[data-op-page="${page}"]`).classList.add("active");
  document.querySelector(`.side-sub-link[data-op-page="${page}"]`).classList.add("active");
  $(`op-${page}`).classList.add("active");
  document.querySelector(`.side-link[data-view="operacional"]`).classList.add("active");
  document.querySelector(`.side-link[data-view="financeiro"]`).classList.remove("active");
  $("operacional").classList.add("active");
  $("financeiro").classList.remove("active");
  configureFiltersForView("operacional");
  $("pageEyebrow").textContent = "OPERACIONAL";

  const pageCopy = {
    kpis: {
      title: "Dash Operacional - KPIs",
      subtitle: "Primeira pagina operacional com TSH por cidade, critical, turnos, deficit de horas e tabela de hotzones.",
    },
    cadastro: {
      title: "Dash Operacional - Cadastro",
      subtitle: "Grafico de linhas no topo, resumo por cidade e cadastro completo dos entregadores.",
    },
    evolucao: {
      title: "Dash Operacional - Evolucao",
      subtitle: "Compare corridas, TSH e critical por semana em cada cidade.",
    },
  };

  $("pageTitle").textContent = pageCopy[page].title;
  $("pageSubtitle").textContent = pageCopy[page].subtitle;
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

["city", "hotzone", "cpf", "week", "start", "end"].forEach((id) => {
  $(id).addEventListener("change", refresh);
});

$("clearFiltersButton").addEventListener("click", clearFilters);

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
  document.querySelectorAll(".search-select.open").forEach((select) => select.classList.remove("open"));
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = normalizeEmail($("loginUser").value);
  const password = $("loginPassword").value;
  const btn = $("loginForm").querySelector(".login-submit");
  btn.disabled = true;

  try {
    const result = await validateLogin(email, password);
    if (!result.ok) { setLoginMessage(result.message); return; }
    if (result.firstAccess) { showFirstAccess(email); return; }
    openApp({ email });
  } catch {
    setLoginMessage("Erro de conexao. Tente novamente.");
  } finally {
    btn.disabled = false;
  }
});

$("firstAccessForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = state.pendingFirstAccessEmail;
  const newPassword = $("newPassword").value;
  const confirmPassword = $("confirmPassword").value;

  if (newPassword !== confirmPassword) { setPasswordMessage("As senhas nao conferem."); return; }

  const btn = $("firstAccessForm").querySelector(".login-submit");
  btn.disabled = true;

  try {
    const result = await fetch("/api/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: newPassword }),
    }).then((r) => r.json());

    if (!result.ok) { setPasswordMessage(result.message); return; }
    setPasswordMessage("Senha salva com sucesso.", true);
    openApp({ email });
  } catch {
    setPasswordMessage("Erro de conexao. Tente novamente.");
  } finally {
    btn.disabled = false;
  }
});

$("skipFirstAccess").addEventListener("click", () => { openApp({ email: state.pendingFirstAccessEmail }); });
$("cancelFirstAccess").addEventListener("click", () => { showLogin(); });

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
  state.user = null;
  $("appShell").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  showLogin();
});

$("refreshDataButton").addEventListener("click", async () => {
  const button = $("refreshDataButton");
  $("updateStatus").textContent = "Atualizando";
  button.textContent = "Puxando BI...";
  button.disabled = true;
  try {
    const response = await fetch("/api/reload", { method: "POST" });
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

$("togglePassword").addEventListener("click", () => {
  const password = $("loginPassword");
  const visible = password.type === "text";
  password.type = visible ? "password" : "text";
  $("togglePassword").textContent = visible ? "Ver" : "Ocultar";
});

loadMeta()
  .then(refresh)
  .then(() => {
    const session = getActiveSession();
    if (session) {
      openApp(session);
    } else {
      setView("operacional");
      setOperationalPage("kpis");
    }
  })
  .catch((error) => {
    document.body.innerHTML = `<pre style="padding:20px;color:#ff6b12">${error.stack}</pre>`;
  });
