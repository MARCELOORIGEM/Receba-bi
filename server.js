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
const supabase = createSupabaseApi();

const UPLOAD_TARGETS = ["CURITIBA", "GOIANIA", "RIO DE JANEIRO", "SÃO PAULO", "FINANCEIRO"];

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
  return target === "FINANCEIRO" ? Boolean(permissions.atualizar_bi_financeiro) : Boolean(permissions.atualizar_bi);
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
  const match = String(value ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
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

function getWeekLabel(date) {
  if (!date) return "Sem semana";
  const first = new Date(date.getFullYear(), 0, 1);
  const days = Math.floor((date - first) / 86400000);
  const week = Math.ceil((days + first.getDay() + 1) / 7);
  return `${date.getFullYear()}-S${String(week).padStart(2, "0")}`;
}

function getShift(period) {
  const hour = Number(String(period ?? "").match(/^(\d{1,2})/)?.[1] ?? 0);
  if (hour >= 22) return "Ceia";
  if (hour >= 18) return "Jantar";
  if (hour >= 15) return "Tarde";
  return "Almoco";
}

function walkXlsx(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkXlsx(full);
    return entry.isFile() && entry.name.toLowerCase().endsWith(".xlsx") ? [full] : [];
  });
}

function readRows() {
  const files = walkXlsx(BI_DIR).filter((file) => !normalizeText(path.relative(BI_DIR, file)).toUpperCase().startsWith("FINANCEIRO"));
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

let data = readRows();
let financeData = readFinanceRows();
let loadedAt = new Date();
let sourceFiles = walkXlsx(BI_DIR);

function reloadData() {
  data = readRows();
  financeData = readFinanceRows();
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
      const shifts = ["Almoco", "Tarde", "Jantar"].map((shift) => ({
        label: shift === "Almoco" ? "ALMOÇO" : shift.toUpperCase(),
        ...summarizeTsh(cityRows.filter((row) => row.shift === shift)),
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

const SHIFT_ORDER = ["Almoco", "Tarde", "Jantar", "Ceia"];

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
      const cityDrivers = drivers
        .filter((driver) => driver.city === city)
        .sort((a, b) => b.tsh - a.tsh || b.orders - a.orders);
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

function buildFinance(rows) {
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

  const rates = [0.10, 0.15, 0.20, 0.25, 0.30];
  const projections = rates.map((rate) => ({
    rate,
      gain: earningsBase * rate,
      label: `${Math.round(rate * 100)}%`,
  }));

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

  const byDate = [...groupBy(rows.filter((row) => row.date), (row) => row.date).entries()]
    .map(([date, groupRows]) => ({
      date,
      dateBr: brDate(new Date(`${date}T00:00:00`)),
      totalDaily: sum(groupRows, "totalDaily"),
      deliveryGains: sum(groupRows, "deliveryGains"),
      rewards: sum(groupRows, "rewards"),
      earningsBase: sum(groupRows, "deliveryGains") + sum(groupRows, "rewards"),
      gain20: (sum(groupRows, "deliveryGains") + sum(groupRows, "rewards")) * 0.20,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

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
      start: rows.map((row) => row.date).filter(Boolean).sort()[0] || "",
      end: rows.map((row) => row.date).filter(Boolean).sort().at(-1) || "",
    },
    projections,
    byCity,
    byDriver,
    byDate,
    composition,
  };
}

app.use("/api/auth", supabase.router);
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    operationalRows: data.length,
    financialRows: financeData.length,
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
  });
});

app.post("/api/reload", supabase.authorize("atualizar_bi", "atualizar_bi_financeiro"), (_req, res) => {
  reloadData();
  res.json({
    ok: true,
    rowCount: data.length,
    financeRowCount: financeData.length,
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
  res.json(buildFinance(rows));
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
