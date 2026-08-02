require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const nodemailer = require("nodemailer");
const { createSupabaseApi } = require("./supabase-api");

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const LOCAL_BI_DIR = path.join(__dirname, "BI");
const VOLUME_BI_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "BI")
  : "";

function configuredBiDir() {
  const candidates = [process.env.BI_DIR, VOLUME_BI_DIR];
  const preferred = candidates.find((dir) => dir && fs.existsSync(dir) && walkXlsx(dir).length);
  if (preferred) return preferred;
  return LOCAL_BI_DIR;
}

const BI_DIR = configuredBiDir();
const FINANCE_DIR = path.join(BI_DIR, "FINANCEIRO");
const TRANSFEERA_DIR = path.join(BI_DIR, "TRANSFEERA");
const supabase = createSupabaseApi();

const UPLOAD_TARGETS = ["CURITIBA", "GOIANIA", "RIO DE JANEIRO", "SÃO PAULO", "FINANCEIRO", "TRANSFEERA"];

const biUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const target = String(req.body.target || "").toUpperCase();
      if (!UPLOAD_TARGETS.includes(target)) return cb(new Error("Destino invalido."));
      const dir = path.join(BI_DIR, target);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, path.basename(file.originalname).replace(/[/\\]/g, "_"));
    },
  }),
  fileFilter: (_req, file, cb) => cb(null, /\.xlsx$/i.test(file.originalname)),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function handleBiUpload(req, res, next) {
  biUpload.array("files", 20)(req, res, (error) => {
    if (error) return res.status(400).json({ error: error.message || "Erro no upload." });
    next();
  });
}

function canUseTarget(profile, target) {
  if (!supabase.enabled) return true;
  if (!profile) return false;
  if (profile.role === "admin") return true;
  const permissions = profile.permissions || {};
  return ["FINANCEIRO", "TRANSFEERA"].includes(target)
    ? Boolean(permissions.atualizar_bi_financeiro)
    : Boolean(permissions.atualizar_bi);
}

function listBiFiles() {
  const result = {};
  for (const target of UPLOAD_TARGETS) {
    const dir = path.join(BI_DIR, target);
    result[target] = (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [])
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".xlsx"))
      .map((entry) => {
        const stat = fs.statSync(path.join(dir, entry.name));
        return { name: entry.name, size: stat.size, mtime: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  }
  return result;
}

const cityOrder = ["SAO PAULO", "GOIANIA", "CURITIBA", "RIO DE JANEIRO"];

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizeCity(value) {
  const plain = normalizeText(value).toUpperCase();
  if (plain.includes("SAO PAULO")) return "SAO PAULO";
  if (plain.includes("GOIANIA")) return "GOIANIA";
  if (plain.includes("CURITIBA")) return "CURITIBA";
  if (plain.includes("RIO")) return "RIO DE JANEIRO";
  return plain || "SEM CIDADE";
}

function normalizeVehicle(value) {
  const plain = normalizeText(value).toUpperCase();
  if (plain.includes("MOTO")) return "Moto";
  if (plain.includes("BIKE") || plain.includes("BICICLETA")) return "Bike";
  return String(value ?? "").trim();
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "")
    .replace("%", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .trim();
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toPercent(value) {
  if (typeof value === "number") return value > 1 ? value / 100 : value;
  return toNumber(value) / 100;
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value)) return value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d);
  }
  const match = String(value ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));

  const isoLike = String(value ?? "").match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (isoLike) return new Date(Number(isoLike[1]), Number(isoLike[2]) - 1, Number(isoLike[3]));

  return null;
}

function isoDate(date) {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function brDate(date) {
  if (!date) return "-";
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function addDays(iso, days) {
  const date = parseDate(iso);
  if (!date) return "";
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function shortBr(iso) {
  const date = parseDate(iso);
  return date ? `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}` : "";
}

// Semana comercial de segunda a domingo.
function weekStartIso(iso) {
  const date = parseDate(iso);
  if (!date) return "";
  const weekday = date.getDay();
  date.setDate(date.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  return isoDate(date);
}

function normalizeCpf(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length > 14) return digits.slice(-14);
  if (digits.length > 11) return digits.padStart(14, "0");
  return digits.padStart(11, "0");
}

function formatCpf(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return digits;
}

function getWeekLabel(date) {
  if (!date) return "Sem semana";
  const first = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date - first) / 86400000);
  const week = Math.ceil((days + first.getDay() + 1) / 7);
  return `${date.getFullYear()}-S${String(week).padStart(2, "0")}`;
}

// As faixas do relatorio sao 11:00-14:00, 14:00-18:00, 18:00-22:00 e 22:00-23:59.
// O corte da tarde precisa ser em 14h: com 15h a faixa 14:00-18:00 caia no almoco
// e o turno Tarde nunca aparecia.
function getShift(period) {
  const hour = Number(String(period ?? "").match(/^(\d{1,2})/)?.[1] ?? 0);
  if (hour >= 22) return "Ceia";
  if (hour >= 18) return "Jantar";
  if (hour >= 14) return "Tarde";
  return "Almoco";
}

const SHIFT_ORDER = ["Almoco", "Tarde", "Jantar", "Ceia"];
const SHIFT_LABELS = { Almoco: "ALMOÇO", Tarde: "TARDE", Jantar: "JANTAR", Ceia: "CEIA" };

function walkXlsx(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkXlsx(full);
    return entry.isFile() && entry.name.toLowerCase().endsWith(".xlsx") ? [full] : [];
  });
}

function readRows() {
  const files = walkXlsx(BI_DIR).filter((file) => {
    const relative = normalizeText(path.relative(BI_DIR, file)).toUpperCase();
    return !relative.startsWith("FINANCEIRO") && !relative.startsWith("TRANSFEERA");
  });
  const rows = [];

  for (const file of files) {
    const workbook = XLSX.readFile(file, { cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    for (const raw of json) {
      const date = parseDate(raw["Data"]);
      const city = normalizeCity(raw["Cidade"] || path.basename(path.dirname(file)));
      const realHours = toNumber(raw["Horas reais conectado durante os horários"] || raw["Horas reais conectado durante os hor�rios"]);
      const scheduledHours = toNumber(raw["Duração total dos horários agendados"] || raw["Dura��o total dos hor�rios agendados"]);
      const orders = toNumber(raw["Pedidos finalizados"]);

      rows.push({
        date: isoDate(date),
        dateBr: brDate(date),
        week: getWeekLabel(date),
        weekday: date ? date.getDay() : 0,
        period: String(raw["Período do turno"] || raw["Per�odo do turno"] || ""),
        criticalFlag: normalizeText(raw["Turnos críticos"] || raw["Turnos cr�ticos"]).toUpperCase(),
        shift: getShift(raw["Período do turno"] || raw["Per�odo do turno"]),
        hotzone: String(raw["Hot Zone / Nome da loja"] || "Sem hotzone").trim(),
        scheduleType: String(raw["Tipo de agendamento"] || ""),
        vehicle: normalizeVehicle(rawValue(raw, ["Modal", "Modalidade", "Tipo de veiculo", "Tipo de veículo", "Meio de transporte", "Veiculo", "Veículo"])),
        id: String(raw["ID do entregador"] || "").trim(),
        cpf: String(raw["CPF do entregador"] || "").trim(),
        name: String(raw["Nome do entregador"] || "").trim(),
        phone: String(raw["Número de telefone"] || raw["N�mero de telefone"] || "").trim(),
        city,
        orders,
        realHours,
        scheduledHours,
        tsh: scheduledHours ? realHours / scheduledHours : toPercent(raw["%TSH"]),
        ar: toPercent(raw["AR"]),
        caa: toPercent(raw["CAA"]),
        ot: toPercent(raw["Overtime"]),
        file: path.relative(__dirname, file),
      });
    }
  }

  return rows.filter((row) => row.date && row.city);
}

function normalizedKey(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function rawValue(raw, candidates) {
  const entries = Object.entries(raw);
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(raw, candidate)) return raw[candidate];
  }

  const normalizedCandidates = candidates.map(normalizedKey);
  const found = entries.find(([key]) => normalizedCandidates.includes(normalizedKey(key)));
  return found ? found[1] : "";
}

function readFinanceRows() {
  const files = walkXlsx(FINANCE_DIR);
  const rows = [];

  for (const file of files) {
    const workbook = XLSX.readFile(file, { cellDates: true });
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      for (const raw of json) {
        const totalDaily = toNumber(rawValue(raw, ["Total diário(R$)", "Total diario(R$)", "Total diário", "Total diario"]));
        const deliveryGains = toNumber(rawValue(raw, ["Ganhos da entrega(R$)", "Ganhos da entrega"]));
        const rewards = toNumber(rawValue(raw, ["Recompensas(R$)", "Recompensas"]));
        const pendingCash = toNumber(rawValue(raw, ["Valor pendente do pedido pago em dinheiro(R$)", "Valor pendente do pedido pago em dinheiro"]));
        const lossDiscount = toNumber(rawValue(raw, ["Desconto de perdas de pedido(R$)", "Desconto de perdas de pedido"]));
        const others = toNumber(rawValue(raw, ["Outros(R$)", "Outros"]));
        const tips = toNumber(rawValue(raw, ["Gorjetas(R$)", "Gorjetas"]));
        const manualAdjustment = toNumber(rawValue(raw, ["Ajuste manual(R$)", "Ajuste manual"]));
        const referralRewards = toNumber(rawValue(raw, ["Recompensas por indicação(R$)", "Recompensas por indicacao(R$)", "Recompensas por indicação", "Recompensas por indicacao"]));
        const meaningfulValue = totalDaily || deliveryGains || rewards || pendingCash || lossDiscount || others || tips || manualAdjustment || referralRewards;
        if (!meaningfulValue) continue;

        const date = parseDate(rawValue(raw, ["Data", "Date"]));
        const city = normalizeCity(rawValue(raw, ["Cidade", "City"]) || path.basename(path.dirname(file)));
        const cpf = String(rawValue(raw, ["CPF do entregador", "CPF"]) || "").trim();

        rows.push({
          date: isoDate(date),
          dateBr: brDate(date),
          week: getWeekLabel(date),
          city,
          id: String(rawValue(raw, ["ID do entregador parceiro", "ID do entregador", "ID"]) || "").trim(),
          name: String(rawValue(raw, ["Nome do entregador", "Entregador"]) || "").trim(),
          phone: String(rawValue(raw, ["Nº de telefone do entregador", "N° de telefone do entregador", "Numero de telefone do entregador", "Número de telefone do entregador"]) || "").trim(),
          cpf,
          totalDaily,
          deliveryGains,
          pendingCash,
          lossDiscount,
          rewards,
          others,
          tips,
          manualAdjustment,
          referralRewards,
          extras: others + tips + manualAdjustment + referralRewards,
          file: path.relative(__dirname, file),
        });
      }
    }
  }

  return rows.filter((row) => row.city && (row.cpf || row.name || row.totalDaily));
}

// Um pagamento devolvido/falho nao tira dinheiro do caixa: so conta como pago o que liquidou.
const SETTLED_STATUSES = ["", "FINALIZADO", "TRANSFERIDO", "PAGO", "CONCLUIDO", "CONCLUIDA"];
const FAILED_STATUSES = ["DEVOLVIDO", "FALHA", "FALHOU", "CANCELADO", "CANCELADA", "REJEITADO", "ERRO"];

function transferStatusKind(status) {
  const key = normalizeText(status).toUpperCase().trim();
  if (SETTLED_STATUSES.includes(key)) return "pago";
  if (FAILED_STATUSES.includes(key)) return "falhou";
  return "pendente";
}

// "Repasse 09/07" vira a data do lote quando a linha nao tem "Data transferido".
function batchDate(batch, fallbackYear) {
  const match = String(batch ?? "").match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!match) return null;
  let year = match[3] ? Number(match[3]) : fallbackYear;
  if (!year) return null;
  if (year < 100) year += 2000;
  return new Date(year, Number(match[2]) - 1, Number(match[1]));
}

function readTransferRows() {
  const files = walkXlsx(TRANSFEERA_DIR);
  const rows = [];

  for (const file of files) {
    const workbook = XLSX.readFile(file, { cellDates: true });
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      const parsed = [];

      for (const raw of json) {
        const value = toNumber(rawValue(raw, ["Valor", "Valor(R$)", "Valor R$"]));
        const transferDate = parseDate(rawValue(raw, ["Data transferido", "Data de transferencia", "Data de transferência", "Data"]));
        const cpf = normalizeCpf(rawValue(raw, ["CPF ou CNPJ", "CPF", "CNPJ", "Chave PIX"]));
        const name = String(rawValue(raw, ["Favorecido", "Nome", "Entregador"]) || "").trim();
        if (!value && !cpf && !name) continue;
        parsed.push({ raw, value, transferDate, cpf, name });
      }

      const yearCount = new Map();
      for (const item of parsed) {
        if (!item.transferDate) continue;
        const year = item.transferDate.getFullYear();
        yearCount.set(year, (yearCount.get(year) || 0) + 1);
      }
      const fileYear = [...yearCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      for (const item of parsed) {
        const batch = String(rawValue(item.raw, ["Nome do lote", "Lote"]) || "").trim();
        const date = item.transferDate || batchDate(batch, fileYear);
        const status = String(rawValue(item.raw, ["Status"]) || "").trim();

        rows.push({
          date: isoDate(date),
          dateBr: brDate(date),
          financeDate: addDays(isoDate(date), -1),
          dateSource: item.transferDate ? "transferencia" : (date ? "lote" : ""),
          cpf: item.cpf,
          name: item.name,
          value: item.value,
          status,
          statusKind: transferStatusKind(status),
          reason: String(rawValue(item.raw, ["Motivo", "Motivo da devolucao", "Motivo da devolução"]) || "").trim(),
          batch,
          receipt: String(rawValue(item.raw, ["Comprovante Transfeera"]) || "").trim(),
          bankReceipt: String(rawValue(item.raw, ["Comprovante Banco"]) || "").trim(),
          file: path.relative(__dirname, file),
        });
      }
    }
  }

  return rows.filter((row) => row.cpf || row.name || row.value);
}

let data = readRows();
let financeData = readFinanceRows();
let transferData = readTransferRows();
let loadedAt = new Date();
let sourceFiles = walkXlsx(BI_DIR);

function reloadData() {
  data = readRows();
  financeData = readFinanceRows();
  transferData = readTransferRows();
  loadedAt = new Date();
  sourceFiles = walkXlsx(BI_DIR);
  return data;
}

function latestSourceUpdate() {
  const timestamps = sourceFiles
    .map((file) => fs.statSync(file).mtime)
    .filter(Boolean)
    .sort((a, b) => b - a);
  return timestamps[0] || null;
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));
}

function avg(rows, key) {
  const values = rows.map((row) => row[key]).filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function distinct(rows, key) {
  return new Set(rows.map((row) => row[key]).filter(Boolean)).size;
}

function filterRows(query) {
  const start = query.start || "";
  const end = query.end || "";
  return data.filter((row) => {
    if (query.city && row.city !== query.city) return false;
    if (query.hotzone && row.hotzone !== query.hotzone) return false;
    if (query.cpf && row.cpf !== query.cpf) return false;
    if (query.id && row.id !== query.id) return false;
    if (query.name && row.name !== query.name) return false;
    if (query.week && row.week !== query.week) return false;
    if (query.shift && row.shift !== query.shift) return false;
    if (start && row.date < start) return false;
    if (end && row.date > end) return false;
    return true;
  });
}

function filterRowsExcept(query, except) {
  return filterRows(except ? { ...query, [except]: "" } : query);
}

function colorForPercent(value) {
  if (value >= 0.9) return "good";
  if (value >= 0.75) return "warn";
  return "bad";
}

function groupBy(rows, keyGetter) {
  const map = new Map();
  for (const row of rows) {
    const key = keyGetter(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function summarizeTsh(rows) {
  const real = sum(rows, "realHours");
  const meta = sum(rows, "scheduledHours");
  return { real, meta, tsh: meta ? real / meta : 0 };
}

function criticalRows(rows) {
  return rows.filter((row) => [5, 6, 0].includes(row.weekday) && ["Jantar", "Ceia"].includes(row.shift));
}

function semRotaCount(rows) {
  const byDriver = groupBy(rows, (row) => row.cpf || row.id);
  let count = 0;
  for (const driverRows of byDriver.values()) {
    if (!driverRows.some((row) => row.orders > 0)) count += 1;
  }
  return count;
}

function buildDashboard(rows) {
  const cityGroups = groupBy(rows, (row) => row.city);
  const cityCards = [...cityGroups.entries()]
    .sort((a, b) => cityOrder.indexOf(a[0]) - cityOrder.indexOf(b[0]))
    .map(([city, cityRows]) => {
      const general = summarizeTsh(cityRows);
      const critical = summarizeTsh(criticalRows(cityRows));
      // Cada cidade mostra os turnos que realmente existem no relatorio dela:
      // Sao Paulo e Curitiba nao tem ceia, Goiania e Rio tem.
      const shifts = SHIFT_ORDER
        .map((shift) => ({ shift, rows: cityRows.filter((row) => row.shift === shift) }))
        .filter(({ rows: shiftRows }) => shiftRows.length)
        .map(({ shift, rows: shiftRows }) => ({
          label: SHIFT_LABELS[shift],
          ...summarizeTsh(shiftRows),
        }));

      return {
        city,
        orders: sum(cityRows, "orders"),
        drivers: distinct(cityRows, "cpf"),
        hours: sum(cityRows, "scheduledHours"),
        semRota: semRotaCount(cityRows),
        general,
        critical,
        shifts,
        deficit: Math.max(general.meta - general.real, 0),
      };
    });

  const hotzones = [...groupBy(rows, (row) => `${row.city}||${row.hotzone}`).entries()]
    .map(([key, zoneRows]) => {
      const [city, hotzone] = key.split("||");
      const general = summarizeTsh(zoneRows);
      const critical = summarizeTsh(criticalRows(zoneRows));
      return {
        city,
        hotzone,
        tsh: general.tsh,
        critical: critical.tsh,
        delivered: general.real,
        goal: general.meta,
        ar: avg(zoneRows, "ar"),
        caa: avg(zoneRows, "caa"),
        ot: avg(zoneRows, "ot"),
      };
    })
    .sort((a, b) => cityOrder.indexOf(a.city) - cityOrder.indexOf(b.city) || a.hotzone.localeCompare(b.hotzone, "pt-BR"));

  const drivers = [...groupBy(rows, (row) => `${row.city}||${row.hotzone}||${row.cpf}||${row.id}`).values()]
    .map((driverRows) => {
      const base = driverRows[0];
      const lastRoute = driverRows
        .filter((row) => row.orders > 0)
        .map((row) => row.date)
        .sort()
        .at(-1);
      const general = summarizeTsh(driverRows);
      const critical = summarizeTsh(criticalRows(driverRows));
      const days = lastRoute ? Math.floor((new Date() - new Date(`${lastRoute}T00:00:00`)) / 86400000) : 9999;
      return {
        city: base.city,
        hotzone: base.hotzone,
        id: base.id,
        cpf: base.cpf,
        name: base.name,
        routes: sum(driverRows, "orders"),
        tsh: general.tsh,
        critical: critical.tsh,
        ar: avg(driverRows, "ar"),
        caa: avg(driverRows, "caa"),
        ot: avg(driverRows, "ot"),
        lastRoute: lastRoute ? brDate(new Date(`${lastRoute}T00:00:00`)) : "-",
        daysNoRoute: days,
      };
    })
    .sort((a, b) => b.daysNoRoute - a.daysNoRoute || a.name.localeCompare(b.name, "pt-BR"));

  const weekly = [...groupBy(rows, (row) => `${row.city}||${row.week}`).entries()]
    .map(([key, weekRows]) => {
      const [city, week] = key.split("||");
      const general = summarizeTsh(weekRows);
      const critical = summarizeTsh(criticalRows(weekRows));
      return {
        city,
        week,
        orders: sum(weekRows, "orders"),
        tsh: general.tsh,
        critical: critical.tsh,
        ar: avg(weekRows, "ar"),
        caa: avg(weekRows, "caa"),
        ot: avg(weekRows, "ot"),
      };
    })
    .sort((a, b) => a.week.localeCompare(b.week) || cityOrder.indexOf(a.city) - cityOrder.indexOf(b.city));

  return {
    total: {
      orders: sum(rows, "orders"),
      drivers: distinct(rows, "cpf"),
      hours: sum(rows, "scheduledHours"),
      delivered: sum(rows, "realHours"),
      semRota: semRotaCount(rows),
      start: rows.map((row) => row.date).sort()[0] || "",
      end: rows.map((row) => row.date).sort().at(-1) || "",
    },
    cityCards,
    hotzones,
    drivers: drivers.slice(0, 300),
    driverTotal: drivers.length,
    weekly,
    colorForPercent,
  };
}

function pickMostFrequent(rows, key) {
  const counts = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function buildDriverShifts(driverRows) {
  return SHIFT_ORDER.map((shift) => {
    const shiftRows = driverRows.filter((row) => row.shift === shift);
    if (!shiftRows.length) return null;
    const shiftGeneral = summarizeTsh(shiftRows);
    return {
      shift,
      orders: sum(shiftRows, "orders"),
      tsh: shiftGeneral.tsh,
      ar: avg(shiftRows, "ar"),
      caa: avg(shiftRows, "caa"),
      ot: avg(shiftRows, "ot"),
    };
  }).filter(Boolean);
}

function buildDailyResult(rows) {
  const drivers = [...groupBy(rows, (row) => `${row.city}||${row.cpf}||${row.id}`).values()]
    .map((driverRows) => {
      const base = driverRows[0];
      const general = summarizeTsh(driverRows);
      return {
        city: base.city,
        id: base.id,
        cpf: base.cpf,
        name: base.name,
        hotzone: pickMostFrequent(driverRows, "hotzone"),
        vehicle: pickMostFrequent(driverRows, "vehicle"),
        orders: sum(driverRows, "orders"),
        tsh: general.tsh,
        ar: avg(driverRows, "ar"),
        caa: avg(driverRows, "caa"),
        ot: avg(driverRows, "ot"),
        shifts: buildDriverShifts(driverRows),
      };
    })
    .filter((driver) => driver.name || driver.cpf || driver.id);

  const cities = cityOrder
    .filter((city) => drivers.some((driver) => driver.city === city))
    .map((city) => {
      // Ranking por corridas finalizadas, da maior para a menor; TSH desempata.
      const cityDrivers = drivers
        .filter((driver) => driver.city === city)
        .sort((a, b) => b.orders - a.orders || b.tsh - a.tsh);
      return {
        city,
        top: cityDrivers.slice(0, 10),
        rest: cityDrivers.slice(10),
      };
    });

  return { cities };
}

function filterFinanceRows(query) {
  const start = query.start || "";
  const end = query.end || "";
  return financeData.filter((row) => {
    if (query.city && row.city !== query.city) return false;
    if (start && (!row.date || row.date < start)) return false;
    if (end && (!row.date || row.date > end)) return false;
    return true;
  });
}

// Promocoes internas sao custo da Receba: entram no financeiro para mostrar
// quanto sobrou sem elas. Respeitam o mesmo periodo e a mesma cidade do filtro.
function promotionsForQuery(query) {
  const promotions = buildPromotions(query);
  const city = normalizeCity(query?.city || "");
  const cities = cityOrder.includes(city) ? [city] : cityOrder;
  const amountOf = (row) => cities.reduce((total, item) => total + (row.values[item] || 0), 0);

  const byDate = new Map(promotions.rows.map((row) => [row.date, amountOf(row)]));
  const byCity = new Map(cities.map((item) => [item, promotions.totals[item] || 0]));
  const total = [...byDate.values()].reduce((sumValue, value) => sumValue + value, 0);

  return { total, byDate, byCity, cities };
}

function buildFinance(rows, query = {}) {
  const promotions = promotionsForQuery(query);
  const promotionOn = (date) => promotions.byDate.get(date) || 0;
  const totalDaily = sum(rows, "totalDaily");
  const deliveryGains = sum(rows, "deliveryGains");
  const rewards = sum(rows, "rewards");
  const earningsBase = deliveryGains + rewards;
  const pendingCash = sum(rows, "pendingCash");
  const lossDiscount = sum(rows, "lossDiscount");
  const others = sum(rows, "others");
  const tips = sum(rows, "tips");
  const manualAdjustment = sum(rows, "manualAdjustment");
  const referralRewards = sum(rows, "referralRewards");
  const extras = others + tips + manualAdjustment + referralRewards;
  const drivers = distinct(rows, "cpf") || distinct(rows, "name");
  const ticket = rows.length ? totalDaily / rows.length : 0;

  // A comissao e cobrada sobre ganhos + recompensas; a promocao e custo da Receba,
  // entao o ganho real e a comissao menos o que foi investido em promocao.
  const rates = [0.10, 0.15, 0.20, 0.25, 0.30];
  const projections = rates.map((rate) => {
    const gross = earningsBase * rate;
    return {
      rate,
      label: `${Math.round(rate * 100)}%`,
      gross,
      promotions: promotions.total,
      gain: gross - promotions.total,
    };
  });

  // Entregas vem do BI operacional (o relatorio financeiro nao traz contagem de pedidos).
  const operationalOrders = sum(filterRows({
    city: query.city || "",
    start: query.start || "",
    end: query.end || "",
  }), "orders");

  const minRate = rates[0];
  const minGross = earningsBase * minRate;
  const minNet = minGross - promotions.total;
  const profit = {
    rate: minRate,
    label: `${Math.round(minRate * 100)}%`,
    gross: minGross,
    net: minNet,
    orders: operationalOrders,
    drivers,
    perOrder: operationalOrders ? minNet / operationalOrders : null,
    perDriver: drivers ? minNet / drivers : null,
  };

  const byCity = [...groupBy(rows, (row) => row.city).entries()]
    .map(([city, groupRows]) => ({
      city,
      totalDaily: sum(groupRows, "totalDaily"),
      deliveryGains: sum(groupRows, "deliveryGains"),
      rewards: sum(groupRows, "rewards"),
      pendingCash: sum(groupRows, "pendingCash"),
      lossDiscount: sum(groupRows, "lossDiscount"),
      drivers: distinct(groupRows, "cpf") || distinct(groupRows, "name"),
      records: groupRows.length,
      earningsBase: sum(groupRows, "deliveryGains") + sum(groupRows, "rewards"),
      share: earningsBase ? (sum(groupRows, "deliveryGains") + sum(groupRows, "rewards")) / earningsBase : 0,
      gain10: (sum(groupRows, "deliveryGains") + sum(groupRows, "rewards")) * 0.10,
      gain20: (sum(groupRows, "deliveryGains") + sum(groupRows, "rewards")) * 0.20,
      gain30: (sum(groupRows, "deliveryGains") + sum(groupRows, "rewards")) * 0.30,
      promotions: promotions.byCity.get(city) || 0,
      netOfPromotions: sum(groupRows, "totalDaily") - (promotions.byCity.get(city) || 0),
    }))
    .sort((a, b) => b.totalDaily - a.totalDaily);

  const byDriver = [...groupBy(rows, (row) => row.cpf || row.name || row.id).values()]
    .map((groupRows) => {
      const base = groupRows[0];
      const total = sum(groupRows, "totalDaily");
      const driverEarnings = sum(groupRows, "deliveryGains") + sum(groupRows, "rewards");
      return {
        city: base.city,
        id: base.id,
        cpf: base.cpf,
        name: base.name || "Sem nome",
        totalDaily: total,
        earningsBase: driverEarnings,
        deliveryGains: sum(groupRows, "deliveryGains"),
        rewards: sum(groupRows, "rewards"),
        pendingCash: sum(groupRows, "pendingCash"),
        lossDiscount: sum(groupRows, "lossDiscount"),
        gain20: driverEarnings * 0.20,
      };
    })
    .sort((a, b) => b.totalDaily - a.totalDaily)
    .slice(0, 300);

  const byWeek = [...groupBy(rows.filter((row) => row.date), (row) => weekStartIso(row.date)).entries()]
    .map(([weekStart, groupRows]) => {
      const weekEnd = addDays(weekStart, 6);
      const weekEarnings = sum(groupRows, "deliveryGains") + sum(groupRows, "rewards");
      const activeDays = distinct(groupRows, "date");
      const weekTotal = sum(groupRows, "totalDaily");
      const weekPromotions = [...new Set(groupRows.map((row) => row.date))]
        .reduce((total, date) => total + promotionOn(date), 0);
      return {
        weekStart,
        weekEnd,
        label: `${shortBr(weekStart)}-${shortBr(weekEnd)}`,
        rangeBr: `${brDate(parseDate(weekStart))} a ${brDate(parseDate(weekEnd))}`,
        promotions: weekPromotions,
        netOfPromotions: weekTotal - weekPromotions,
        totalDaily: weekTotal,
        deliveryGains: sum(groupRows, "deliveryGains"),
        rewards: sum(groupRows, "rewards"),
        earningsBase: weekEarnings,
        gain20: weekEarnings * 0.20,
        drivers: distinct(groupRows, "cpf") || distinct(groupRows, "name"),
        activeDays,
        avgPerDay: activeDays ? sum(groupRows, "totalDaily") / activeDays : 0,
      };
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .map((week, index, list) => {
      const previous = index > 0 ? list[index - 1].totalDaily : 0;
      return { ...week, change: previous ? (week.totalDaily - previous) / previous : null };
    });

  const byDate = [...groupBy(rows.filter((row) => row.date), (row) => row.date).entries()]
    .map(([date, groupRows]) => ({
      date,
      dateBr: brDate(new Date(`${date}T00:00:00`)),
      totalDaily: sum(groupRows, "totalDaily"),
      deliveryGains: sum(groupRows, "deliveryGains"),
      rewards: sum(groupRows, "rewards"),
      earningsBase: sum(groupRows, "deliveryGains") + sum(groupRows, "rewards"),
      gain20: (sum(groupRows, "deliveryGains") + sum(groupRows, "rewards")) * 0.20,
      promotions: promotionOn(date),
      netOfPromotions: sum(groupRows, "totalDaily") - promotionOn(date),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    // Comparativo dia a dia com o dia anterior que tem financeiro, igual ao semanal.
    .map((day, index, list) => {
      const previous = index > 0 ? list[index - 1] : null;
      return {
        ...day,
        previousDateBr: previous?.dateBr || "",
        change: previous?.totalDaily ? (day.totalDaily - previous.totalDaily) / previous.totalDaily : null,
      };
    });

  const composition = [
    { label: "Corridas em dinheiro", value: deliveryGains, color: "orange" },
    { label: "Recompensas", value: rewards, color: "green" },
    { label: "Extras", value: extras, color: "blue" },
    { label: "Pendente dinheiro", value: pendingCash, color: "yellow" },
    { label: "Descontos", value: lossDiscount, color: "bad" },
  ];

  return {
    rowCount: rows.length,
    total: {
      totalDaily,
      deliveryGains,
      rewards,
      earningsBase,
      pendingCash,
      lossDiscount,
      extras,
      others,
      tips,
      manualAdjustment,
      referralRewards,
      drivers,
      ticket,
      promotions: promotions.total,
      netOfPromotions: totalDaily - promotions.total,
      promotionShare: totalDaily ? promotions.total / totalDaily : 0,
      start: rows.map((row) => row.date).filter(Boolean).sort()[0] || "",
      end: rows.map((row) => row.date).filter(Boolean).sort().at(-1) || "",
    },
    projections,
    profit,
    byCity,
    byDriver,
    byDate,
    byWeek,
    composition,
  };
}

// ── Auditoria Transfeera x Financeiro ─────────────────────────────────────────
// Regra do negocio: o Transfeera so pode conter o que esta no relatorio financeiro.
// O repasse do dia D no Transfeera paga o financeiro do dia D-1.

const AUDIT_TOLERANCE = 0.01;

// O Transfeera cobra R$ 1,00 por transferencia, descontado do valor que chega ao
// entregador. Pagar ate R$ 1,00 a menos por transferencia e a taxa, nao divergencia.
const TRANSFEERA_FEE = 1.00;

function feeAllowance(transfer) {
  return TRANSFEERA_FEE * Math.max(1, transfer?.paidCount || 1) + AUDIT_TOLERANCE;
}

function isFeeOnlyGap(diff, transfer) {
  return diff < -AUDIT_TOLERANCE && -diff <= feeAllowance(transfer);
}

const AUDIT_ISSUES = {
  nao_previsto: { severity: "critico", label: "Pago sem previsao" },
  valor_maior: { severity: "critico", label: "Pago a mais" },
  pagamento_sem_cpf: { severity: "critico", label: "Pago sem CPF" },
  valor_menor: { severity: "atencao", label: "Pago a menos" },
  nao_pago: { severity: "atencao", label: "Nao pago" },
  pagamento_falhou: { severity: "atencao", label: "Devolvido / falhou" },
  status_pendente: { severity: "atencao", label: "Status pendente" },
  ok: { severity: "ok", label: "Conciliado" },
};

const SEVERITY_ORDER = { critico: 0, atencao: 1, ok: 2 };

function sameName(left, right) {
  if (!left || !right) return true;
  return normalizeText(left).toUpperCase().replace(/\s+/g, " ").trim()
    === normalizeText(right).toUpperCase().replace(/\s+/g, " ").trim();
}

function addKeyToDate(keysByDate, date, key) {
  if (!keysByDate.has(date)) keysByDate.set(date, new Set());
  keysByDate.get(date).add(key);
}

function buildFinanceIndex() {
  const groups = new Map();
  const keysByDate = new Map();
  const cpfs = new Set();
  const byCpf = new Map();
  const dates = new Set();
  const seen = new Set();
  let withoutCpf = 0;
  let duplicated = 0;

  for (const row of financeData) {
    if (!row.date) continue;
    dates.add(row.date);
    const cpf = normalizeCpf(row.cpf);
    if (!cpf) {
      withoutCpf += 1;
      continue;
    }

    // O mesmo dia exportado duas vezes (nomes de arquivo diferentes) dobraria
    // todos os valores e criaria divergencia em massa. Conta uma vez so.
    const fingerprint = `${cpf}|${row.date}|${row.id}|${row.totalDaily}`;
    if (seen.has(fingerprint)) {
      duplicated += 1;
      continue;
    }
    seen.add(fingerprint);
    cpfs.add(cpf);
    if (!byCpf.has(cpf)) byCpf.set(cpf, { name: row.name, city: row.city });

    const key = `${cpf}||${row.date}`;
    const current = groups.get(key) || { cpf, date: row.date, rows: [], amount: 0, name: "", city: "" };
    current.rows.push(row);
    current.amount += Number(row.totalDaily) || 0;
    current.name = current.name || row.name;
    current.city = current.city || row.city;
    groups.set(key, current);
    addKeyToDate(keysByDate, row.date, key);
  }

  return { groups, keysByDate, cpfs, byCpf, dates, withoutCpf, duplicated };
}

function buildTransferIndex() {
  const groups = new Map();
  const keysByDate = new Map();
  const noCpfByDate = new Map();
  const dates = new Set();
  const seen = new Set();
  const noCpf = [];
  const noDate = [];
  let duplicated = 0;

  for (const row of transferData) {
    // O comprovante carrega o id da transferencia: reimportar o mesmo extrato
    // nao pode virar pagamento em dobro.
    const fingerprint = row.receipt || `${row.cpf}|${row.date}|${row.value}|${row.batch}|${row.status}`;
    if (seen.has(fingerprint)) {
      duplicated += 1;
      continue;
    }
    seen.add(fingerprint);

    if (!row.financeDate) {
      noDate.push(row);
      continue;
    }
    if (!row.cpf) {
      noCpf.push(row);
      continue;
    }
    dates.add(row.financeDate);

    const key = `${row.cpf}||${row.financeDate}`;
    const current = groups.get(key) || {
      cpf: row.cpf,
      financeDate: row.financeDate,
      rows: [],
      paid: 0,
      failedAmount: 0,
      pendingAmount: 0,
      paidCount: 0,
      failedCount: 0,
      pendingCount: 0,
    };
    current.rows.push(row);
    const value = Number(row.value) || 0;
    if (row.statusKind === "pago") {
      current.paid += value;
      current.paidCount += 1;
    } else if (row.statusKind === "falhou") {
      current.failedAmount += value;
      current.failedCount += 1;
    } else {
      current.pendingAmount += value;
      current.pendingCount += 1;
    }
    groups.set(key, current);
    addKeyToDate(keysByDate, row.financeDate, key);
  }

  // Linhas sem CPF ainda contam a data do lote para a cobertura do dia.
  for (const row of noCpf) {
    if (!row.financeDate) continue;
    dates.add(row.financeDate);
    if (!noCpfByDate.has(row.financeDate)) noCpfByDate.set(row.financeDate, []);
    noCpfByDate.get(row.financeDate).push(row);
  }

  return { groups, keysByDate, noCpfByDate, dates, noCpf, noDate, duplicated };
}

function classifyAudit(finance, transfer) {
  const financeAmount = finance?.amount || 0;
  const paid = transfer?.paid || 0;
  const diff = paid - financeAmount;

  if (!finance) {
    if (paid > AUDIT_TOLERANCE) return "nao_previsto";
    if (transfer?.failedCount) return "pagamento_falhou";
    if (transfer?.pendingCount) return "status_pendente";
    return "ok";
  }
  if (financeAmount <= AUDIT_TOLERANCE) {
    return paid > AUDIT_TOLERANCE ? "nao_previsto" : "ok";
  }
  if (!transfer || paid <= AUDIT_TOLERANCE) return "nao_pago";
  if (diff > AUDIT_TOLERANCE) return "valor_maior";
  // Diferenca acima da taxa e divergencia; ate a taxa segue para as demais checagens.
  if (diff < -AUDIT_TOLERANCE && !isFeeOnlyGap(diff, transfer)) return "valor_menor";
  if (transfer.pendingCount) return "status_pendente";
  // Nome diferente com CPF e valor batendo e erro de digitacao ou nome abreviado da
  // conta bancaria, nao divergencia de dinheiro: vira etiqueta, nao problema.
  return "ok";
}

function buildAuditRow(issue, finance, transfer, financeDate, financeCpfs, financeByCpf) {
  const transferRows = transfer?.rows || [];
  const financeRows = finance?.rows || [];
  const first = transferRows[0] || {};
  const financeAmount = finance?.amount || 0;
  const paid = transfer?.paid || 0;
  const diff = paid - financeAmount;
  const cpf = transfer?.cpf || finance?.cpf || "";
  const known = financeByCpf.get(cpf);

  let risk = 0;
  if (issue === "nao_previsto" || issue === "pagamento_sem_cpf") risk = paid;
  else if (issue === "valor_maior") risk = diff;

  let pending = 0;
  if (issue === "nao_pago") pending = financeAmount - paid;
  else if (issue === "valor_menor") pending = -diff;

  const flags = [];
  if (isFeeOnlyGap(diff, transfer)) flags.push("taxa_transfeera");
  // Todo repasse deveria chegar com a taxa descontada. Quando o valor bate na
  // casa do centavo a taxa nao foi cobrada: e isso que merece conferencia, nao
  // o caso normal de ter taxa.
  else if ((transfer?.paidCount || 0) > 0 && financeAmount > AUDIT_TOLERANCE && Math.abs(diff) <= AUDIT_TOLERANCE) {
    flags.push("sem_taxa");
  }
  if (transferRows.length && financeRows.length && !sameName(first.name, financeRows[0]?.name)) {
    flags.push("nome_diferente");
  }
  if ((transfer?.paidCount || 0) > 1) flags.push("duplicado");
  // Devolucao sem valor nao diz nada: so etiqueta quando ha dinheiro voltando.
  if ((transfer?.failedAmount || 0) > AUDIT_TOLERANCE) flags.push("devolvido");
  if (transfer?.pendingCount) flags.push("pendente");
  if (cpf && !financeCpfs.has(cpf)) flags.push("cpf_desconhecido");
  if (transferRows.some((row) => row.dateSource === "lote")) flags.push("data_do_lote");

  const severity = AUDIT_ISSUES[issue]?.severity || "atencao";

  return {
    issue,
    severity,
    severityRank: SEVERITY_ORDER[severity],
    label: AUDIT_ISSUES[issue]?.label || issue,
    flags,
    financeDate,
    transferDate: first.date || addDays(financeDate, 1),
    cpf,
    cpfMask: formatCpf(cpf),
    transferName: first.name || "",
    financeName: financeRows[0]?.name || known?.name || "",
    city: financeRows[0]?.city || known?.city || "",
    financeAmount,
    transferAmount: paid,
    failedAmount: transfer?.failedAmount || 0,
    pendingAmount: transfer?.pendingAmount || 0,
    diff,
    risk,
    pending,
    transferStatus: uniq(transferRows.map((row) => row.status)).join(", "),
    reason: uniq(transferRows.map((row) => row.reason)).join(", "),
    batch: uniq(transferRows.map((row) => row.batch)).join(", "),
    receipt: first.receipt || "",
    transferRows: transferRows.length,
    financeRows: financeRows.length,
    transferFile: first.file || "",
    financeFile: financeRows[0]?.file || "",
  };
}

function withinRange(date, start, end) {
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

// ── Promocoes ─────────────────────────────────────────────────────────────────
// Valores digitados na mao (nao vem de xlsx), guardados como { data: { cidade: valor } }.

function promotionsFilePath() {
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "promocoes.json");
  return path.join(__dirname, "promocoes.json");
}

function readPromotions() {
  const file = promotionsFilePath();
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePromotions(store) {
  fs.writeFileSync(promotionsFilePath(), JSON.stringify(store, null, 2), "utf8");
}

function buildPromotions(query) {
  const store = readPromotions();
  const start = query.start || "";
  const end = query.end || "";

  const allDates = Object.keys(store).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();

  const rows = allDates
    .filter((date) => withinRange(date, start, end))
    .map((date) => {
      const values = {};
      let total = 0;
      for (const city of cityOrder) {
        const value = Number(store[date]?.[city]) || 0;
        values[city] = value;
        total += value;
      }
      return { date, dateBr: brDate(parseDate(date)), values, total };
    });

  const totals = {};
  for (const city of cityOrder) {
    totals[city] = rows.reduce((sumValue, row) => sumValue + row.values[city], 0);
  }

  const byWeek = [...groupBy(rows, (row) => weekStartIso(row.date)).entries()]
    .map(([weekStart, weekRows]) => ({
      weekStart,
      label: `${shortBr(weekStart)}-${shortBr(addDays(weekStart, 6))}`,
      total: weekRows.reduce((sumValue, row) => sumValue + row.total, 0),
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  return {
    cities: cityOrder,
    rows,
    totals,
    byWeek,
    grandTotal: rows.reduce((sumValue, row) => sumValue + row.total, 0),
    daysWithValue: rows.filter((row) => row.total > 0).length,
    start: rows[0]?.date || "",
    end: rows.at(-1)?.date || "",
    // Dias lancados que o filtro de data esta escondendo.
    outsideRange: allDates.length - rows.length,
    storedStart: allDates[0] || "",
    storedEnd: allDates.at(-1) || "",
  };
}

function buildTransferAudit(query) {
  const start = query.start || "";
  const end = query.end || "";
  const finance = buildFinanceIndex();
  const transfer = buildTransferIndex();

  const allDates = [...new Set([...finance.dates, ...transfer.dates])]
    .filter((date) => withinRange(date, start, end))
    .sort();

  const rows = [];
  const okRows = [];
  const days = [];
  let riskAmount = 0;
  let pendingAmount = 0;
  let blockedAmount = 0;
  let notSentAmount = 0;
  let okCount = 0;
  let criticalCount = 0;
  let attentionCount = 0;
  let checked = 0;
  let feeCount = 0;
  let feeAmount = 0;
  let noFeeCount = 0;
  let noFeeAmount = 0;
  let nameDiffCount = 0;

  for (const date of allDates) {
    const hasFinance = finance.dates.has(date);
    const hasTransfer = transfer.dates.has(date);
    const day = {
      financeDate: date,
      transferDate: addDays(date, 1),
      status: hasFinance && hasTransfer ? "auditado" : hasTransfer ? "sem_financeiro" : "sem_transfeera",
      financeAmount: 0,
      transferAmount: 0,
      financeDrivers: 0,
      transferCount: 0,
      critico: 0,
      atencao: 0,
      ok: 0,
      risk: 0,
    };

    const dayKeys = new Set([
      ...(finance.keysByDate.get(date) || []),
      ...(transfer.keysByDate.get(date) || []),
    ]);

    for (const key of dayKeys) {
      const financeGroup = finance.groups.get(key);
      const transferGroup = transfer.groups.get(key);
      day.financeAmount += financeGroup?.amount || 0;
      day.transferAmount += transferGroup?.paid || 0;
      if (financeGroup) day.financeDrivers += 1;
      if (transferGroup) day.transferCount += transferGroup.rows.length;

      // Dia sem par nao gera divergencia por CPF: falta base para comparar.
      if (day.status !== "auditado") continue;

      const issue = classifyAudit(financeGroup, transferGroup);
      const row = buildAuditRow(issue, financeGroup, transferGroup, date, finance.cpfs, finance.byCpf);
      checked += 1;
      day[row.severity] += 1;
      if (row.flags.includes("taxa_transfeera")) {
        feeCount += 1;
        feeAmount += -row.diff;
      }
      if (row.flags.includes("sem_taxa")) {
        noFeeCount += 1;
        noFeeAmount += row.transferAmount;
      }
      if (row.flags.includes("nome_diferente")) nameDiffCount += 1;
      if (issue === "ok") {
        okCount += 1;
        okRows.push(row);
        continue;
      }
      if (row.severity === "critico") criticalCount += 1;
      else attentionCount += 1;
      riskAmount += row.risk;
      pendingAmount += row.pending;
      day.risk += row.risk;
      rows.push(row);
    }

    // Pagamentos sem CPF sempre viram alerta: nao da para casar com o financeiro.
    for (const item of transfer.noCpfByDate.get(date) || []) {
      const paid = item.statusKind === "pago" ? Number(item.value) || 0 : 0;
      const issue = paid > AUDIT_TOLERANCE ? "pagamento_sem_cpf" : "pagamento_falhou";
      const row = {
        issue,
        severity: AUDIT_ISSUES[issue].severity,
        severityRank: SEVERITY_ORDER[AUDIT_ISSUES[issue].severity],
        label: AUDIT_ISSUES[issue].label,
        flags: item.statusKind === "falhou" ? ["devolvido", "sem_cpf"] : ["sem_cpf"],
        financeDate: date,
        transferDate: item.date,
        cpf: "",
        cpfMask: "sem CPF",
        transferName: item.name || "",
        financeName: "",
        city: "",
        financeAmount: 0,
        transferAmount: paid,
        failedAmount: item.statusKind === "falhou" ? Number(item.value) || 0 : 0,
        pendingAmount: item.statusKind === "pendente" ? Number(item.value) || 0 : 0,
        diff: paid,
        risk: paid,
        pending: 0,
        transferStatus: item.status,
        reason: item.reason,
        batch: item.batch,
        receipt: item.receipt,
        transferRows: 1,
        financeRows: 0,
        transferFile: item.file,
        financeFile: "",
      };
      day[row.severity] += 1;
      day.transferCount += 1;
      day.transferAmount += paid;
      if (row.severity === "critico") criticalCount += 1;
      else attentionCount += 1;
      riskAmount += row.risk;
      day.risk += row.risk;
      rows.push(row);
    }

    if (day.status === "sem_financeiro") blockedAmount += day.transferAmount;
    if (day.status === "sem_transfeera") notSentAmount += day.financeAmount;
    days.push(day);
  }

  const orphanTransfers = transfer.noDate
    .filter((row) => row.statusKind !== "falhou" || Number(row.value) > 0)
    .map((row) => ({
      name: row.name,
      cpf: row.cpf,
      cpfMask: formatCpf(row.cpf) || "sem CPF",
      value: Number(row.value) || 0,
      status: row.status,
      reason: row.reason,
      batch: row.batch,
      file: row.file,
    }));

  const blockedDays = days.filter((day) => day.status === "sem_financeiro");
  const pendingDays = days.filter((day) => day.status === "sem_transfeera");
  const auditedDays = days.filter((day) => day.status === "auditado");

  let verdict = "sem_dados";
  if (criticalCount > 0 || blockedDays.length > 0 || orphanTransfers.length > 0) verdict = "alerta";
  else if (attentionCount > 0) verdict = "atencao";
  else if (auditedDays.length > 0) verdict = "ok";

  rows.sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    || (b.risk - a.risk)
    || a.financeDate.localeCompare(b.financeDate)
    || Math.abs(b.diff) - Math.abs(a.diff));

  return {
    summary: {
      verdict,
      checked,
      ok: okCount,
      divergent: rows.length,
      criticalCount,
      attentionCount,
      riskAmount,
      pendingAmount,
      blockedAmount,
      notSentAmount,
      auditedDays: auditedDays.length,
      blockedDays: blockedDays.length,
      pendingDays: pendingDays.length,
      orphanTransfers: orphanTransfers.length,
      orphanAmount: orphanTransfers.reduce((total, item) => total + item.value, 0),
      financeAmount: auditedDays.reduce((total, day) => total + day.financeAmount, 0),
      transferAmount: auditedDays.reduce((total, day) => total + day.transferAmount, 0),
      financeRows: financeData.length,
      transferRows: transferData.length,
      financeWithoutCpf: finance.withoutCpf,
      financeDuplicated: finance.duplicated,
      transferDuplicated: transfer.duplicated,
      feeCount,
      feeAmount,
      feePerTransfer: TRANSFEERA_FEE,
      noFeeCount,
      noFeeAmount,
      nameDiffCount,
      start: allDates[0] || "",
      end: allDates.at(-1) || "",
    },
    days,
    orphanTransfers,
    // Divergencias primeiro; as conciliadas vao no fim para o filtro "Conciliado".
    rows: [
      ...rows.slice(0, 2000),
      ...okRows.sort((a, b) => b.transferAmount - a.transferAmount).slice(0, 1500),
    ],
    truncated: Math.max(0, rows.length - 2000),
    okTruncated: Math.max(0, okRows.length - 1500),
  };
}

app.use("/api/auth", supabase.router);
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    operationalRows: data.length,
    financialRows: financeData.length,
    transferRows: transferData.length,
    supabase: supabase.enabled,
  });
});

app.get("/api/meta", (req, res) => {
  const query = req.query;
  res.json({
    rowCount: data.length,
    files: uniq(data.map((row) => row.file)),
    sourcePath: path.relative(__dirname, BI_DIR) || "BI",
    fileCount: sourceFiles.length,
    financeRowCount: financeData.length,
    transferRowCount: transferData.length,
    loadedAt: loadedAt.toISOString(),
    latestSourceUpdate: latestSourceUpdate()?.toISOString() || "",
    cities: cityOrder.filter((city) => filterRowsExcept(query, "city").some((row) => row.city === city)),
    hotzones: uniq(filterRowsExcept(query, "hotzone").map((row) => row.hotzone)),
    cpfs: uniq(filterRowsExcept(query, "cpf").map((row) => row.cpf)),
    ids: uniq(filterRowsExcept(query, "id").map((row) => row.id)),
    names: uniq(filterRowsExcept(query, "name").map((row) => row.name)),
    weeks: uniq(filterRowsExcept(query, "week").map((row) => row.week)),
    shifts: SHIFT_ORDER.filter((shift) => filterRowsExcept(query, "shift").some((row) => row.shift === shift)),
    minDate: data.map((row) => row.date).sort()[0] || "",
    maxDate: data.map((row) => row.date).sort().at(-1) || "",
    financeMinDate: financeData.map((row) => row.date).filter(Boolean).sort()[0] || "",
    financeMaxDate: financeData.map((row) => row.date).filter(Boolean).sort().at(-1) || "",
    transferMinDate: transferData.map((row) => row.date).filter(Boolean).sort()[0] || "",
    transferMaxDate: transferData.map((row) => row.date).filter(Boolean).sort().at(-1) || "",
  });
});

app.post("/api/reload", supabase.authorize("atualizar_bi", "atualizar_bi_financeiro"), (_req, res) => {
  reloadData();
  res.json({
    ok: true,
    rowCount: data.length,
    financeRowCount: financeData.length,
    transferRowCount: transferData.length,
    fileCount: sourceFiles.length,
    loadedAt: loadedAt.toISOString(),
    latestSourceUpdate: latestSourceUpdate()?.toISOString() || "",
  });
});

app.get("/api/bi-files", supabase.authorize("atualizar_bi", "atualizar_bi_financeiro"), (_req, res) => {
  res.json({ files: listBiFiles() });
});

app.post("/api/upload-bi", supabase.authorize("atualizar_bi", "atualizar_bi_financeiro"), handleBiUpload, (req, res) => {
  const target = String(req.body.target || "").toUpperCase();
  if (!canUseTarget(req.profile, target)) {
    (req.files || []).forEach((file) => fs.unlink(file.path, () => {}));
    return res.status(403).json({ error: "Sem permissao para atualizar este destino." });
  }
  if (!req.files?.length) return res.status(400).json({ error: "Nenhum arquivo .xlsx valido enviado." });
  reloadData();
  res.json({
    ok: true,
    uploaded: req.files.map((file) => file.filename),
    target,
    rowCount: data.length,
    financeRowCount: financeData.length,
    transferRowCount: transferData.length,
    fileCount: sourceFiles.length,
    loadedAt: loadedAt.toISOString(),
  });
});

app.delete("/api/bi-files", supabase.authorize("atualizar_bi", "atualizar_bi_financeiro"), (req, res) => {
  const target = String(req.query.target || "").toUpperCase();
  const filename = path.basename(String(req.query.filename || ""));
  if (!UPLOAD_TARGETS.includes(target) || !filename) return res.status(400).json({ error: "Parametros invalidos." });
  if (!canUseTarget(req.profile, target)) return res.status(403).json({ error: "Sem permissao para excluir neste destino." });

  const filePath = path.join(BI_DIR, target, filename);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return res.status(404).json({ error: "Arquivo nao encontrado." });
  }
  fs.unlinkSync(filePath);
  reloadData();
  res.json({
    ok: true,
    rowCount: data.length,
    financeRowCount: financeData.length,
    transferRowCount: transferData.length,
    fileCount: sourceFiles.length,
    loadedAt: loadedAt.toISOString(),
  });
});

app.get("/api/dashboard", supabase.authorize("kpis", "cadastro"), (req, res) => {
  const rows = filterRows(req.query);
  res.json(buildDashboard(rows));
});

app.get("/api/finance", supabase.authorize("financeiro"), (req, res) => {
  const rows = filterFinanceRows(req.query);
  res.json(buildFinance(rows, req.query));
});

// Auditoria tem permissao propria: liberada usuario a usuario na tela Usuarios.
app.get("/api/transfer-audit", supabase.authorize("auditoria"), (req, res) => {
  res.json(buildTransferAudit(req.query));
});

app.get("/api/promotions", supabase.authorize("financeiro"), (req, res) => {
  res.json(buildPromotions(req.query));
});

app.post("/api/promotions", supabase.authorize("financeiro"), (req, res) => {
  const date = String(req.body.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Informe uma data valida." });
  const store = readPromotions();
  if (store[date]) return res.status(409).json({ error: "Essa data ja esta na tabela." });
  store[date] = {};
  writePromotions(store);
  res.json(buildPromotions(req.query));
});

app.put("/api/promotions", supabase.authorize("financeiro"), (req, res) => {
  const date = String(req.body.date || "");
  const city = normalizeCity(req.body.city);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Data invalida." });
  if (!cityOrder.includes(city)) return res.status(400).json({ error: "Cidade invalida." });

  const value = toNumber(req.body.value);
  if (!Number.isFinite(value) || value < 0) return res.status(400).json({ error: "Valor invalido." });

  const store = readPromotions();
  store[date] = store[date] || {};
  if (value === 0) delete store[date][city];
  else store[date][city] = Number(value.toFixed(2));
  writePromotions(store);
  res.json(buildPromotions(req.query));
});

app.delete("/api/promotions", supabase.authorize("financeiro"), (req, res) => {
  const date = String(req.query.date || "");
  const store = readPromotions();
  if (!store[date]) return res.status(404).json({ error: "Data nao encontrada." });
  delete store[date];
  writePromotions(store);
  res.json(buildPromotions(req.query));
});

app.get("/api/daily-result", supabase.authorize("kpis", "cadastro"), (req, res) => {
  const rows = filterRows(req.query);
  res.json(buildDailyResult(rows));
});

// ── Auth ──────────────────────────────────────────────────────────────────────

const AUTH_EMAILS = [
  "recebageral2026@gmail.com",
  "recebaoperações2026@gmail.com",
  "recebaoperacoes2026@gmail.com",
  "recebaatuacoes2026@gmail.com",
  "recebafinanceiro2026@gmail.com",
  "recebapoder2026@gmail.com",
];
const DEFAULT_PASSWORD = "RECEBA99";
const FIXED_PASSWORDS = {
  "recebapoder2026@gmail.com": "RECEBA99FOOD",
};
const resetCodes = new Map(); // email → { code, expiresAt }

function usersFilePath() {
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "users.json");
  return path.join(__dirname, "users.json");
}

function readUsers() {
  const file = usersFilePath();
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
}

function writeUsers(users) {
  fs.writeFileSync(usersFilePath(), JSON.stringify(users, null, 2), "utf8");
}

function isAuthEmail(email) {
  return AUTH_EMAILS.includes(email);
}

function makeTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

app.post("/api/login", (req, res) => {
  if (supabase.enabled) return res.json({ ok: false, message: "Login local desativado. Peça ao administrador para criar seu acesso." });
  const email = String(req.body.email || "").toLowerCase().trim();
  const password = String(req.body.password || "");
  if (!isAuthEmail(email)) return res.json({ ok: false, message: "Email sem acesso liberado." });

  // Senha fixa permanente por email (ex: RECEBA99FOOD para recebapoder2026)
  if (FIXED_PASSWORDS[email] && password === FIXED_PASSWORDS[email]) {
    return res.json({ ok: true });
  }

  // Senha padrao RECEBA99 sempre funciona para qualquer email
  if (password === DEFAULT_PASSWORD) {
    return res.json({ ok: true, firstAccess: true });
  }

  // Senha personalizada cadastrada pelo usuario
  const users = readUsers();
  const stored = users[email];
  if (stored?.password && password === stored.password) {
    return res.json({ ok: true });
  }

  return res.json({ ok: false, message: "Senha incorreta." });
});

app.post("/api/set-password", (req, res) => {
  if (supabase.enabled) return res.json({ ok: false, message: "Login local desativado." });
  const email = String(req.body.email || "").toLowerCase().trim();
  const password = String(req.body.password || "");
  if (!isAuthEmail(email)) return res.json({ ok: false, message: "Email sem acesso liberado." });
  if (password.length < 6) return res.json({ ok: false, message: "A senha precisa ter pelo menos 6 caracteres." });
  if (password === DEFAULT_PASSWORD) return res.json({ ok: false, message: "Escolha uma senha diferente da senha padrao." });

  const users = readUsers();
  users[email] = { password, changedAt: new Date().toISOString() };
  writeUsers(users);
  return res.json({ ok: true });
});

app.post("/api/forgot-password", async (req, res) => {
  if (supabase.enabled) return res.json({ ok: false, message: "Login local desativado." });
  const email = String(req.body.email || "").toLowerCase().trim();
  if (!isAuthEmail(email)) {
    return res.json({ ok: true }); // não revelar se email existe
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  resetCodes.set(email, { code, expiresAt: Date.now() + 15 * 60 * 1000 });

  try {
    const transporter = makeTransporter();
    await transporter.sendMail({
      from: `"RECEBA BI" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Codigo de redefinicao de senha - RECEBA BI",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px">
          <h2 style="color:#e85d04;margin-bottom:4px">RECEBA BI</h2>
          <p style="color:#555">Seu codigo para redefinir a senha:</p>
          <div style="font-size:36px;font-weight:bold;letter-spacing:10px;color:#111;padding:20px;background:#f5f5f5;text-align:center;border-radius:8px;margin:16px 0">
            ${code}
          </div>
          <p style="color:#888;font-size:12px">Este codigo expira em 15 minutos. Ignore este email se nao solicitou a redefinicao.</p>
        </div>`,
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error("Erro ao enviar email:", error.message);
    return res.status(500).json({ ok: false, message: "Erro ao enviar email. Verifique as configuracoes SMTP." });
  }
});

app.post("/api/verify-reset", (req, res) => {
  if (supabase.enabled) return res.json({ ok: false, message: "Login local desativado." });
  const email = String(req.body.email || "").toLowerCase().trim();
  const code = String(req.body.code || "").trim();
  const password = String(req.body.password || "");
  if (!isAuthEmail(email)) return res.json({ ok: false, message: "Email sem acesso." });

  const stored = resetCodes.get(email);
  if (!stored) return res.json({ ok: false, message: "Nenhum codigo encontrado. Solicite novamente." });
  if (Date.now() > stored.expiresAt) {
    resetCodes.delete(email);
    return res.json({ ok: false, message: "Codigo expirado. Solicite um novo." });
  }
  if (code !== stored.code) return res.json({ ok: false, message: "Codigo incorreto." });
  if (password.length < 6) return res.json({ ok: false, message: "A senha precisa ter pelo menos 6 caracteres." });
  if (password === DEFAULT_PASSWORD) return res.json({ ok: false, message: "Escolha uma senha diferente da senha padrao." });

  const users = readUsers();
  users[email] = { password, changedAt: new Date().toISOString() };
  writeUsers(users);
  resetCodes.delete(email);
  return res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────

function watchBiDir() {
  let debounceTimer = null;
  const triggerReload = (filename) => {
    if (filename && !/\.xlsx$/i.test(filename)) return;
    if (filename && path.basename(filename).startsWith("~$")) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const before = data.length;
      reloadData();
      console.log(`BI recarregado automaticamente: ${before} -> ${data.length} linhas (${sourceFiles.length} arquivos .xlsx)`);
    }, 1500);
  };

  try {
    fs.watch(BI_DIR, { recursive: true }, (_event, filename) => triggerReload(filename));
    console.log(`Observando alteracoes em ${BI_DIR} para recarregar o BI automaticamente.`);
  } catch (error) {
    console.warn(`Nao foi possivel observar ${BI_DIR} automaticamente: ${error.message}`);
  }
}

app.listen(PORT, () => {
  console.log(`Dashboard BI disponível em http://localhost:${PORT}`);
  console.log(`${data.length} linhas carregadas de ${walkXlsx(BI_DIR).length} arquivos .xlsx`);
  watchBiDir();
});
