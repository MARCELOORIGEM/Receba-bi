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
const SIGNUP_DIR = path.join(BI_DIR, "CADASTROS");
const supabase = createSupabaseApi();

// Os cadastros moram dentro do sistema, em cadastros.json gravado pelo proprio
// servidor. A planilha do Google saiu de cena. A carga inicial vem de um dos
// arquivos abaixo, lidos uma unica vez: o .json versionado (para a instalacao
// nova ja nascer com a base de Sao Paulo) ou, na falta dele, a ultima copia da
// planilha que tenha sobrado em disco.
const SIGNUP_SEED_FILES = [
  path.join(SIGNUP_DIR, "cadastros-inicial.json"),
  path.join(SIGNUP_DIR, "_cadastros-google.csv"),
];
const SIGNUP_DEFAULT_CITY = process.env.CADASTROS_CIDADE_PADRAO || "SAO PAULO";

const UPLOAD_TARGETS = ["CURITIBA", "GOIANIA", "RIO DE JANEIRO", "SÃO PAULO", "FINANCEIRO", "TRANSFEERA", "CADASTROS"];

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
    return !relative.startsWith("FINANCEIRO") && !relative.startsWith("TRANSFEERA") && !relative.startsWith("CADASTROS");
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

// ---------------------------------------------------------------------------
// CADASTROS (base interna do sistema, gravada em cadastros.json)
// ---------------------------------------------------------------------------

// O cadastro e preenchido na mao: praca, modal e origem chegam com acento,
// caixa e grafia trocados. Sem normalizar, "capitação" e "capitacao" viravam
// duas linhas diferentes no resumo.
const PRACA_LIST = ["Guaianases", "Itaquera", "Jardim Angélica", "Mooca", "Paulista", "Penha", "Santana", "Santo Amaro"];
const PRACA_BY_KEY = new Map(PRACA_LIST.map((praca) => [normalizeText(praca).toLowerCase(), praca]));

const ORIGIN_RULES = [
  [/indicacao\s*telegram/, "Indicação Telegram"],
  [/telegram/, "Telegram"],
  [/cap[ioa]?t|capoit/, "Captação"],
  [/retorno/, "Retorno"],
  [/^base$/, "Base"],
  [/wall?[ac]?ce|wallace/, "Wallace"],
  [/os[vw]a[nl]?d/, "Oswaldo"],
  [/^jm$/, "JM"],
  [/junior/, "Junior"],
  [/geovane/, "Geovane"],
  [/ferinha/, "Ferinha"],
];

function titleCase(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/(^|\s|-)([a-zà-ú])/g, (_all, prefix, letter) => prefix + letter.toUpperCase());
}

function normalizePraca(value) {
  const key = normalizeText(value).toLowerCase().replace(/^"+|"+$/g, "").trim();
  if (!key) return "";
  return PRACA_BY_KEY.get(key) || "";
}

// Praca fora da lista de Sao Paulo continua sendo descartada: em SP a lista e
// fechada e erro de digitacao viraria praca nova no resumo. As outras cidades
// ainda nao tem lista propria, entao ali vale o que foi digitado.
function normalizeSignupPraca(value, city) {
  const known = normalizePraca(value);
  if (known) return known;
  if (city === "SAO PAULO") return "";
  const plain = String(value ?? "").trim();
  return plain ? titleCase(plain) : "";
}

// "Penha, Itaquera" e `"Mooca, Penha", Penha` sao a mesma coisa: uma lista de
// pracas com aspas sobrando do copiar/colar.
function splitPracas(value, city) {
  const parts = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(parts.map((part) => normalizeSignupPraca(part, city)).filter(Boolean))];
}

// Cadastro sem cidade e cadastro de Sao Paulo: era a unica praca que existia
// quando a base foi criada.
function normalizeSignupCity(value) {
  const plain = String(value ?? "").trim();
  return plain ? normalizeCity(plain) : SIGNUP_DEFAULT_CITY;
}

// Cadastro que veio da planilha antiga nao tem a coluna: quem ja estava na base
// entra como ativo, senao 4 mil pessoas apareceriam desligadas de uma vez.
const SIGNUP_INACTIVE_WORDS = ["inativo", "inativa", "nao", "n", "false", "0", "desligado", "desligada", "bloqueado", "bloqueada", "cancelado", "cancelada"];

function normalizeSignupActive(value) {
  if (typeof value === "boolean") return value;
  const plain = normalizeText(value).toLowerCase().trim();
  if (!plain) return true;
  return !SIGNUP_INACTIVE_WORDS.includes(plain);
}

// Telefone chega de todo jeito: com +55, com espaco, com traco, so numeros. O
// que da para reconhecer vira (11) 91234-5678; o resto fica como foi digitado,
// porque contato meia-boca ainda e melhor que contato apagado.
function normalizeSignupContact(value) {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return raw;
}

function normalizeOrigin(value) {
  const plain = normalizeText(value).toLowerCase().replace(/["']/g, "").trim();
  if (!plain) return "Sem origem";
  const rule = ORIGIN_RULES.find(([pattern]) => pattern.test(plain));
  return rule ? rule[1] : titleCase(String(value ?? "").trim());
}

function normalizeModal(value) {
  const plain = normalizeText(value).toLowerCase();
  if (plain.includes("moto")) return "Motocicleta";
  if (plain.includes("bici") || plain.includes("bike")) return "Bicicleta";
  return plain ? titleCase(value) : "Sem modal";
}

function normalizeDriverId(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 20 ? digits : "";
}

// CSV do Google: campos com virgula vem entre aspas ("Penha, Itaquera"), entao
// nao da para quebrar so no split(",").
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') { field += char; continue; }
      if (text[index + 1] === '"') { field += '"'; index += 1; continue; }
      quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\r") continue;
    if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function csvToObjects(text) {
  const [header, ...body] = parseCsv(String(text ?? "").replace(/^﻿/, ""));
  if (!header) return [];
  return body.map((cells) => {
    const item = {};
    header.forEach((name, index) => {
      const key = String(name ?? "").trim();
      if (key) item[key] = cells[index] ?? "";
    });
    return item;
  });
}

function signupFromRaw(raw, source) {
  const date = parseDate(rawValue(raw, ["DATA", "Data", "Data do cadastro"]));
  const id = normalizeDriverId(rawValue(raw, ["ID", "ID do entregador"]));
  const cpf = normalizeCpf(rawValue(raw, ["CPF", "CPF do entregador"]));
  const name = String(rawValue(raw, ["ENTREGADOR", "NOME", "Nome do entregador"]) ?? "").replace(/\s+/g, " ").trim();
  if (!date || (!id && !cpf && !name)) return null;

  const city = normalizeSignupCity(rawValue(raw, ["CIDADE", "Cidade", "CITY"]));
  const pracas = splitPracas(rawValue(raw, ["PRAÇA", "PRACA", "Praça", "REGIÃO", "REGIAO"]), city);
  const iso = isoDate(date);

  return {
    date: iso,
    dateBr: brDate(date),
    week: weekStartIso(iso),
    month: iso.slice(0, 7),
    id,
    cpf,
    name: name || "Sem nome",
    modal: normalizeModal(rawValue(raw, ["MODAL", "Modal", "Modalidade"])),
    praca: pracas[0] || "Sem praça",
    pracas: pracas.length ? pracas : ["Sem praça"],
    origin: normalizeOrigin(rawValue(raw, ["ORIGEM", "Origem"])),
    city,
    contact: normalizeSignupContact(rawValue(raw, ["CONTATO", "Contato", "TELEFONE", "Telefone", "CELULAR", "WHATSAPP"])),
    active: normalizeSignupActive(rawValue(raw, ["SITUAÇÃO", "SITUACAO", "Situacao", "ATIVO", "STATUS"])),
    recordKey: "",
    source,
  };
}

// Mesma pessoa cadastrada duas vezes no mesmo dia (planilha colada em duplicata)
// conta uma vez so; cadastro repetido em outro dia continua aparecendo e vira o
// indicador "recadastros".
function dedupeSignups(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const key = `${row.id || row.cpf || row.name}||${row.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, "pt-BR"));
}

function readSignupFiles() {
  const rows = [];
  for (const file of walkXlsx(SIGNUP_DIR)) {
    const workbook = XLSX.readFile(file, { cellDates: true });
    for (const sheetName of workbook.SheetNames) {
      const json = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
      for (const raw of json) {
        const row = signupFromRaw(raw, path.relative(__dirname, file));
        if (row) rows.push(row);
      }
    }
  }
  return rows;
}

// A base fica num JSON por instalacao, no volume quando existe volume e na raiz
// do projeto quando nao existe - mesmo criterio de promocoes.json. Cada linha e
// { key, date, id, cpf, name, modal, pracas, origin, city, createdAt, updatedAt }.

function signupStoreFile() {
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "cadastros.json");
  return path.join(__dirname, "cadastros.json");
}

function readSignupStore() {
  const file = signupStoreFile();
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSignupStore(records) {
  fs.writeFileSync(signupStoreFile(), JSON.stringify(records, null, 2), "utf8");
}

let signupKeySeq = 0;

function nextSignupKey() {
  signupKeySeq += 1;
  return `c${Date.now().toString(36)}${signupKeySeq.toString(36)}`;
}

// Mesma chave do dedupe das linhas: uma pessoa por dia.
function signupIdentity(record) {
  return `${record.id || record.cpf || record.name}||${record.date}`;
}

// O registro guarda o que foi digitado e a normalizacao acontece na leitura,
// para que regra nova de praca ou origem valha tambem para o que ja esta salvo.
function signupRecordRow(record) {
  const date = parseDate(record.date);
  if (!date) return null;
  const iso = isoDate(date);
  const city = normalizeSignupCity(record.city);
  const pracas = splitPracas(record.pracas, city);
  const name = String(record.name ?? "").replace(/\s+/g, " ").trim();

  return {
    date: iso,
    dateBr: brDate(date),
    week: weekStartIso(iso),
    month: iso.slice(0, 7),
    id: normalizeDriverId(record.id),
    cpf: normalizeCpf(record.cpf),
    name: name || "Sem nome",
    modal: normalizeModal(record.modal),
    praca: pracas[0] || "Sem praça",
    pracas: pracas.length ? pracas : ["Sem praça"],
    origin: normalizeOrigin(record.origin),
    city,
    contact: normalizeSignupContact(record.contact),
    active: normalizeSignupActive(record.active),
    recordKey: record.key,
    source: "Base do sistema",
  };
}

// Monta o registro a partir do formulario. Devolve { error } em vez de lancar:
// quem chama e a rota, e a mensagem vai direto para a tela.
function buildSignupRecord(input, existing) {
  const date = parseDate(input.date);
  if (!date) return { error: "Informe a data do cadastro." };

  const name = String(input.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) return { error: "Informe o nome do entregador." };

  const id = normalizeDriverId(input.id);
  if (String(input.id ?? "").trim() && !id) return { error: "ID do entregador invalido: use somente os numeros." };

  const cpf = normalizeCpf(input.cpf);
  if (String(input.cpf ?? "").trim() && !cpf) return { error: "CPF invalido." };

  const city = normalizeSignupCity(input.city);
  if (!cityOrder.includes(city)) return { error: "Cidade invalida." };

  const stamp = new Date().toISOString();
  return {
    record: {
      key: existing?.key || nextSignupKey(),
      date: isoDate(date),
      id,
      cpf,
      name,
      modal: String(input.modal ?? "").trim(),
      pracas: splitPracas(input.pracas ?? input.praca, city),
      origin: String(input.origin ?? "").trim(),
      city,
      contact: normalizeSignupContact(input.contact),
      active: normalizeSignupActive(input.active),
      createdAt: existing?.createdAt || stamp,
      updatedAt: stamp,
    },
  };
}

function signupRecordFromRaw(raw) {
  const row = signupFromRaw(raw, "");
  if (!row) return null;
  const stamp = new Date().toISOString();
  return {
    key: nextSignupKey(),
    date: row.date,
    id: row.id,
    cpf: row.cpf,
    name: row.name === "Sem nome" ? "" : row.name,
    modal: row.modal === "Sem modal" ? "" : row.modal,
    pracas: row.pracas.filter((praca) => praca !== "Sem praça"),
    origin: row.origin === "Sem origem" ? "" : row.origin,
    city: row.city,
    contact: row.contact,
    active: row.active,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function readSignupSeed() {
  const file = SIGNUP_SEED_FILES.find((candidate) => fs.existsSync(candidate));
  if (!file) return [];
  const text = fs.readFileSync(file, "utf8");

  if (file.endsWith(".json")) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.map((record) => ({ ...record, key: record.key || nextSignupKey() })) : [];
    } catch {
      return [];
    }
  }

  return csvToObjects(text).map((raw) => signupRecordFromRaw(raw)).filter(Boolean);
}

// Primeira carga: o lote inicial vira a base, tudo como Sao Paulo. Roda uma vez
// so - existindo cadastros.json, a semente nunca mais e lida e quem manda e a
// base que o sistema grava.
function seedSignupStore() {
  if (fs.existsSync(signupStoreFile())) return 0;
  const seen = new Set();
  const records = [];

  for (const record of readSignupSeed()) {
    const identity = signupIdentity(record);
    if (seen.has(identity)) continue;
    seen.add(identity);
    records.push(record);
  }

  writeSignupStore(records);
  return records.length;
}

let signupStatus = {
  origin: "Base do sistema",
  file: path.relative(__dirname, signupStoreFile()),
  seeded: seedSignupStore(),
  storeRows: 0,
  fileRows: 0,
  updatedAt: "",
};

// A base do sistema manda. Os .xlsx enviados em Upload BI > Cadastros entram
// como reforco e perdem no dedupe quando repetem alguem do mesmo dia.
function loadSignupData() {
  const storeRows = readSignupStore().map(signupRecordRow).filter(Boolean);
  const fileRows = readSignupFiles();
  const file = signupStoreFile();

  signupStatus = {
    ...signupStatus,
    storeRows: storeRows.length,
    fileRows: fileRows.length,
    updatedAt: fs.existsSync(file) ? fs.statSync(file).mtime.toISOString() : "",
  };

  return dedupeSignups([...storeRows, ...fileRows]);
}

// Grava a base e recarrega a lista em memoria de uma vez so.
function saveSignupStore(records) {
  writeSignupStore(records);
  signupData = loadSignupData();
}

// ── A planilha dentro do sistema ─────────────────────────────────────────────
// A tela de indicadores mostra o dado ja normalizado ("Sem praça", "Sem modal").
// A planilha precisa do oposto: devolve a celula do jeito que foi digitada, para
// quem edita ver o proprio texto de volta e nao um rotulo inventado pelo sistema.

function signupSheetRow(record) {
  const date = parseDate(record.date);
  const iso = date ? isoDate(date) : "";
  const pracas = Array.isArray(record.pracas) ? record.pracas : String(record.pracas ?? "").split(",");

  return {
    key: record.key,
    date: iso,
    dateBr: date ? brDate(date) : "",
    month: iso.slice(0, 7),
    id: String(record.id ?? ""),
    name: String(record.name ?? ""),
    cpf: String(record.cpf ?? ""),
    contact: normalizeSignupContact(record.contact),
    modal: String(record.modal ?? ""),
    praca: pracas.map((praca) => String(praca ?? "").trim()).filter(Boolean).join(", "),
    origin: String(record.origin ?? ""),
    city: normalizeSignupCity(record.city),
    active: normalizeSignupActive(record.active),
    updatedAt: record.updatedAt || "",
  };
}

function matchesSheetSearch(row, terms) {
  const name = normalizeText(row.name).toLowerCase();
  return terms.some((term) => name.includes(term.text)
    || (term.digits.length >= 3
      && (row.cpf.includes(term.digits) || row.id.includes(term.digits) || row.contact.replace(/\D/g, "").includes(term.digits))));
}

// A grade manda a base inteira, sem corte: quem desenha so as linhas visiveis e
// a tela. Antes o corte existia porque cada linha virava dez campos no HTML e o
// navegador travava - com a rolagem virtual esse teto deixou de existir.
function buildSignupSheet(query) {
  const all = readSignupStore().map(signupSheetRow).filter((row) => row.date);
  const terms = searchTerms(query.q);

  const rows = all
    .filter((row) => {
      if (query.city && row.city !== query.city) return false;
      if (query.month && row.month !== query.month) return false;
      if (query.active === "ativo" && !row.active) return false;
      if (query.active === "inativo" && row.active) return false;
      return !terms.length || matchesSheetSearch(row, terms);
    })
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, "pt-BR"));

  return {
    rows,
    filtered: rows.length,
    total: all.length,
    ativos: all.filter((row) => row.active).length,
    inativos: all.filter((row) => !row.active).length,
    file: signupStatus.file,
    updatedAt: signupStatus.updatedAt,
    options: {
      cities: uniq(all.map((row) => row.city)),
      months: [...new Set(all.map((row) => row.month))].filter(Boolean).sort().reverse(),
      cityChoices: cityOrder,
      pracaChoices: PRACA_LIST,
      modalChoices: ["Motocicleta", "Bicicleta"],
      originChoices: uniq(all.map((row) => normalizeOrigin(row.origin))).filter((origin) => origin !== "Sem origem"),
    },
  };
}

// Gravar pela planilha devolve a propria planilha; gravar por outra tela devolve
// o painel de indicadores. Uma chamada so, sem ida e volta extra.
function signupResponse(query) {
  return query.view === "sheet" ? buildSignupSheet(query) : buildSignups(query);
}

// ── Colar direto do Google Sheets ────────────────────────────────────────────
// Ctrl+C no Google Sheets produz TSV. Exportar produz CSV. Os dois caem aqui.
const SIGNUP_PASTE_COLUMNS = ["DATA", "ID", "ENTREGADOR", "CPF", "CONTATO", "MODAL", "PRAÇA", "ORIGEM", "CIDADE", "SITUAÇÃO"];

function splitPastedLine(line) {
  if (line.includes("\t")) return line.split("\t");
  if (line.includes(";")) return line.split(";");
  return parseCsv(line)[0] || [];
}

function parsePastedSignups(text, fallbackCity) {
  const lines = String(text ?? "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];

  // Colando com o cabecalho junto, ele manda nas colunas; colando so as linhas,
  // vale a ordem da planilha de cadastros.
  const first = splitPastedLine(lines[0]).map((cell) => normalizedKey(cell));
  const header = first.includes("entregador") || first.includes("data") ? splitPastedLine(lines.shift()) : null;

  return lines.map((line) => {
    const cells = splitPastedLine(line);
    const raw = {};
    const names = header || SIGNUP_PASTE_COLUMNS;

    names.forEach((name, index) => {
      const key = String(name ?? "").trim();
      if (key) raw[key] = cells[index] ?? "";
    });

    if (fallbackCity && !String(rawValue(raw, ["CIDADE", "Cidade", "CITY"]) ?? "").trim()) raw.CIDADE = fallbackCity;
    return raw;
  });
}

let data = readRows();
let financeData = readFinanceRows();
let transferData = readTransferRows();
let signupData = loadSignupData();
let activityIndex = buildActivityIndex();
let loadedAt = new Date();
let sourceFiles = walkXlsx(BI_DIR);

function reloadData() {
  data = readRows();
  financeData = readFinanceRows();
  transferData = readTransferRows();
  signupData = loadSignupData();
  activityIndex = buildActivityIndex();
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

  // O grafico dos KPIs troca a granularidade sem recarregar: o servidor ja manda
  // as tres agregacoes prontas, so muda o balde (dia, semana ou mes).
  const series = {
    daily: periodSeries(rows, (row) => row.date, (period) => `${period.slice(8, 10)}/${period.slice(5, 7)}`),
    weekly: periodSeries(rows, (row) => row.week, (period) => period.replace(/^\d{4}-/, "")),
    monthly: periodSeries(rows, (row) => row.date.slice(0, 7), (period) => `${MONTH_LABELS[Number(period.slice(5, 7)) - 1]}/${period.slice(2, 4)}`),
  };

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
    series,
    colorForPercent,
  };
}

// ---------------------------------------------------------------------------
// Cruzamento cadastro x operacao: quem rodou, quando rodou pela ultima vez e
// quanto ganhou. A chave e o ID do entregador; CPF entra como reserva porque
// alguns cadastros antigos vieram sem ID.
// ---------------------------------------------------------------------------
function buildActivityIndex() {
  const byId = new Map();
  const byCpf = new Map();

  const bucket = (map, key) => {
    if (!key) return null;
    if (!map.has(key)) {
      map.set(key, {
        firstRoute: "",
        lastRoute: "",
        lastShift: "",
        orders: 0,
        shiftDays: new Set(),
        cities: new Map(),
        hotzones: new Map(),
        lastEarning: "",
        earned: 0,
        name: "",
      });
    }
    return map.get(key);
  };

  const countIn = (map, key) => {
    if (!key) return;
    map.set(key, (map.get(key) || 0) + 1);
  };

  const addOperational = (entry, row) => {
    if (!entry) return;
    entry.name = entry.name || row.name;
    entry.shiftDays.add(row.date);
    if (row.date > entry.lastShift) entry.lastShift = row.date;
    countIn(entry.cities, row.city);
    countIn(entry.hotzones, row.hotzone);
    if (row.orders > 0) {
      entry.orders += row.orders;
      if (!entry.firstRoute || row.date < entry.firstRoute) entry.firstRoute = row.date;
      if (row.date > entry.lastRoute) entry.lastRoute = row.date;
    }
  };

  for (const row of data) {
    if (!row.date) continue;
    addOperational(bucket(byId, normalizeDriverId(row.id)), row);
    addOperational(bucket(byCpf, normalizeCpf(row.cpf)), row);
  }

  const addFinance = (entry, row) => {
    if (!entry || !row.date) return;
    entry.earned += row.totalDaily || 0;
    if (row.date > entry.lastEarning) entry.lastEarning = row.date;
  };

  for (const row of financeData) {
    addFinance(bucket(byId, normalizeDriverId(row.id)), row);
    addFinance(bucket(byCpf, normalizeCpf(row.cpf)), row);
  }

  return { byId, byCpf };
}

function mostFrequent(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function daysBetween(fromIso, toIso) {
  const from = parseDate(fromIso);
  const to = parseDate(toIso);
  if (!from || !to) return null;
  return Math.round((to - from) / 86400000);
}

function maxIso(rows, key) {
  let max = "";
  for (const row of rows) {
    const value = row[key];
    if (value && value > max) max = value;
  }
  return max;
}

function minIso(rows, key) {
  let min = "";
  for (const row of rows) {
    const value = row[key];
    if (value && (!min || value < min)) min = value;
  }
  return min;
}

// "Dias sem rodar" contado a partir de hoje diria que todo mundo esta parado
// quando o ultimo relatorio importado e de semanas atras. A referencia e o
// ultimo dia coberto pelos relatorios.
function activityReference() {
  const operationalEnd = maxIso(data, "date");
  const financeEnd = maxIso(financeData, "date");
  const latest = [operationalEnd, financeEnd].filter(Boolean).sort().at(-1) || "";
  return {
    reference: latest || isoDate(new Date()),
    operationalStart: minIso(data, "date"),
    operationalEnd,
    financeStart: minIso(financeData, "date"),
    financeEnd,
  };
}

const SIGNUP_STATUS_LABELS = {
  ativo: "Rodando (até 7 dias)",
  morno: "Sumidos (8 a 30 dias)",
  inativo: "Parados (+30 dias)",
  semRota: "Escalou mas não rodou",
  semRegistro: "Sem registro nos relatórios",
};

function enrichSignup(row, reference, operationalStart = "") {
  const entry = (row.id && activityIndex.byId.get(row.id))
    || (row.cpf && activityIndex.byCpf.get(row.cpf))
    || null;

  const lastRoute = entry?.lastRoute || "";
  const lastEarning = entry?.lastEarning || "";
  const lastActivity = [lastRoute, lastEarning].filter(Boolean).sort().at(-1) || "";
  const daysSinceRoute = lastRoute ? daysBetween(lastRoute, reference) : null;
  const daysSinceActivity = lastActivity ? daysBetween(lastActivity, reference) : null;
  // Tempo ate a primeira rota so vale para quem se cadastrou dentro do periodo
  // dos relatorios: quem entrou em novembro e teve a primeira rota registrada em
  // junho (quando comeca o relatorio importado) inflaria a media sem significar
  // nada. Rota anterior ao cadastro tambem sai da conta: e recadastro.
  const firstRoute = entry?.firstRoute || "";
  const inCoverage = Boolean(operationalStart) && row.date >= operationalStart;
  const daysToFirstRoute = firstRoute && inCoverage && firstRoute >= row.date ? daysBetween(row.date, firstRoute) : null;

  // Rodou = fez corrida no relatorio operacional ou recebeu no financeiro.
  // Quem aparece so na escala, sem corrida e sem ganho, e "escalou e nao rodou".
  const status = !entry
    ? "semRegistro"
    : !lastActivity
      ? "semRota"
      : daysSinceActivity <= 7
        ? "ativo"
        : daysSinceActivity <= 30
          ? "morno"
          : "inativo";

  return {
    ...row,
    matched: Boolean(entry),
    orders: entry?.orders || 0,
    shiftDays: entry?.shiftDays.size || 0,
    operationalCity: entry ? mostFrequent(entry.cities) : "",
    hotzone: entry ? mostFrequent(entry.hotzones) : "",
    operationalName: entry?.name || "",
    earned: entry?.earned || 0,
    firstRoute,
    firstRouteBr: firstRoute ? brDate(parseDate(firstRoute)) : "",
    lastRoute,
    lastRouteBr: lastRoute ? brDate(parseDate(lastRoute)) : "",
    lastShift: entry?.lastShift || "",
    lastEarning,
    lastEarningBr: lastEarning ? brDate(parseDate(lastEarning)) : "",
    lastActivity,
    lastActivityBr: lastActivity ? brDate(parseDate(lastActivity)) : "",
    daysSinceRoute,
    daysSinceActivity,
    daysToFirstRoute,
    status,
    statusLabel: SIGNUP_STATUS_LABELS[status],
  };
}

// A busca aceita varios entregadores de uma vez, separados por "|": cada termo
// pode ser nome, CPF ou ID, e a linha entra se casar com qualquer um deles.
function searchTerms(value) {
  return String(value ?? "")
    .split("|")
    .map((term) => ({
      text: normalizeText(term).toLowerCase().trim(),
      digits: String(term).replace(/\D/g, ""),
    }))
    .filter((term) => term.text);
}

function matchesSignupSearch(row, terms) {
  const name = normalizeText(row.name).toLowerCase();
  return terms.some((term) => name.includes(term.text)
    || (term.digits.length >= 3 && (row.cpf.includes(term.digits) || row.id.includes(term.digits))));
}

function filterSignups(query, rows) {
  const start = query.start || "";
  const end = query.end || "";
  const terms = searchTerms(query.search);

  return rows.filter((row) => {
    if (start && row.date < start) return false;
    if (end && row.date > end) return false;
    if (query.city && row.city !== query.city) return false;
    if (query.praca && !row.pracas.includes(query.praca)) return false;
    if (query.origin && row.origin !== query.origin) return false;
    if (query.modal && row.modal !== query.modal) return false;
    if (query.status && row.status !== query.status) return false;
    if (!terms.length) return true;
    return matchesSignupSearch(row, terms);
  });
}

// Lista do campo de busca suspenso: devolve so o topo dos que casam com o que
// foi digitado, para nao mandar os 4 mil cadastros a cada tecla.
function signupPeople(query) {
  const terms = searchTerms(query.q);
  const seen = new Map();

  for (const row of signupData) {
    if (terms.length && !matchesSignupSearch(row, terms)) continue;
    const value = row.id || row.cpf || row.name;
    const current = seen.get(value);
    if (current) {
      if (row.date > current.date) current.date = row.date;
      continue;
    }
    seen.set(value, { value, label: row.name, cpf: row.cpf, id: row.id, date: row.date });
  }

  return [...seen.values()]
    .sort((a, b) => b.date.localeCompare(a.date) || a.label.localeCompare(b.label, "pt-BR"))
    .slice(0, 60);
}

function signupGroup(rows, keyOf) {
  const groups = [...groupBy(rows, keyOf).entries()].map(([key, groupRows]) => {
    const activated = groupRows.filter((row) => row.orders > 0);
    return {
      key,
      signups: groupRows.length,
      share: rows.length ? groupRows.length / rows.length : 0,
      activated: activated.length,
      activationRate: groupRows.length ? activated.length / groupRows.length : 0,
      active7: groupRows.filter((row) => row.status === "ativo").length,
      neverRan: groupRows.filter((row) => row.orders === 0).length,
      orders: sum(groupRows, "orders"),
      ordersPerSignup: groupRows.length ? sum(groupRows, "orders") / groupRows.length : 0,
    };
  });
  return groups.sort((a, b) => b.signups - a.signups || a.key.localeCompare(b.key, "pt-BR"));
}

function signupSeries(rows, bucketOf, labelOf) {
  return [...groupBy(rows, bucketOf).entries()]
    .map(([period, periodRows]) => {
      // Quebra por modal no mesmo balde: o grafico de modal usa a mesma serie do
      // grafico de cadastros, so muda o que e desenhado.
      const modals = {};
      for (const row of periodRows) modals[row.modal] = (modals[row.modal] || 0) + 1;

      return {
        period,
        label: labelOf(period),
        signups: periodRows.length,
        activated: periodRows.filter((row) => row.orders > 0).length,
        active7: periodRows.filter((row) => row.status === "ativo").length,
        modals,
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));
}

function buildSignups(query) {
  const coverage = activityReference();
  const all = signupData.map((row) => enrichSignup(row, coverage.reference, coverage.operationalStart));
  const rows = filterSignups(query, all);

  const people = new Set(rows.map((row) => row.id || row.cpf || row.name));
  const byDay = groupBy(rows, (row) => row.date);
  const bestDay = [...byDay.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const activated = rows.filter((row) => row.orders > 0);
  const timesToFirst = rows.map((row) => row.daysToFirstRoute).filter((value) => value !== null);

  const statusCount = (status) => rows.filter((row) => row.status === status).length;

  return {
    total: {
      signups: rows.length,
      people: people.size,
      recadastros: rows.length - people.size,
      days: byDay.size,
      perDay: byDay.size ? rows.length / byDay.size : 0,
      bestDay: bestDay ? { date: bestDay[0], dateBr: brDate(parseDate(bestDay[0])), signups: bestDay[1].length } : null,
      activated: activated.length,
      activationRate: rows.length ? activated.length / rows.length : 0,
      orders: sum(rows, "orders"),
      earned: sum(rows, "earned"),
      avgDaysToFirstRoute: timesToFirst.length ? timesToFirst.reduce((acc, value) => acc + value, 0) / timesToFirst.length : null,
      ativo: statusCount("ativo"),
      morno: statusCount("morno"),
      inativo: statusCount("inativo"),
      semRota: statusCount("semRota"),
      semRegistro: statusCount("semRegistro"),
      start: minIso(rows, "date"),
      end: maxIso(rows, "date"),
    },
    series: {
      daily: signupSeries(rows, (row) => row.date, (period) => `${period.slice(8, 10)}/${period.slice(5, 7)}`),
      weekly: signupSeries(rows, (row) => row.week, (period) => `${period.slice(8, 10)}/${period.slice(5, 7)}`),
      monthly: signupSeries(rows, (row) => row.month, (period) => `${MONTH_LABELS[Number(period.slice(5, 7)) - 1]}/${period.slice(2, 4)}`),
    },
    byPraca: signupGroup(rows, (row) => row.praca),
    byOrigin: signupGroup(rows, (row) => row.origin),
    byModal: signupGroup(rows, (row) => row.modal),
    rows: [...rows].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, "pt-BR")).slice(0, 1500),
    rowTotal: rows.length,
    options: {
      cities: uniq(all.map((row) => row.city)),
      pracas: uniq(all.flatMap((row) => row.pracas)),
      origins: uniq(all.map((row) => row.origin)),
      modals: uniq(all.map((row) => row.modal)),
      statuses: Object.entries(SIGNUP_STATUS_LABELS).map(([value, label]) => ({ value, label })),
      // Listas do formulario, nao do filtro: o filtro mostra so o que existe na
      // base, o formulario precisa mostrar tudo que da para digitar.
      cityChoices: cityOrder,
      pracaChoices: PRACA_LIST,
      modalChoices: ["Motocicleta", "Bicicleta"],
      originChoices: uniq(all.map((row) => row.origin)).filter((origin) => origin !== "Sem origem"),
    },
    range: { min: minIso(all, "date"), max: maxIso(all, "date") },
    coverage,
    source: { ...signupStatus },
  };
}

const MONTH_LABELS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function periodSeries(rows, bucketOf, labelOf) {
  const dated = rows.filter((row) => row.date);
  return [...groupBy(dated, (row) => `${row.city}||${bucketOf(row)}`).entries()]
    .map(([key, periodRows]) => {
      const [city, period] = key.split("||");
      const general = summarizeTsh(periodRows);
      const critical = summarizeTsh(criticalRows(periodRows));
      return {
        city,
        period,
        label: labelOf(period),
        orders: sum(periodRows, "orders"),
        tsh: general.tsh,
        critical: critical.tsh,
        ar: avg(periodRows, "ar"),
        caa: avg(periodRows, "caa"),
        ot: avg(periodRows, "ot"),
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period) || cityOrder.indexOf(a.city) - cityOrder.indexOf(b.city));
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

// "Melhor entregador" nao e quem fez mais corrida: e quem entrega volume com
// qualidade. A nota junta os quatro indicadores que a operacao cobra mais o
// volume, para nao perder para quem fez tres corridas perfeitas e sumiu.
//
// TSH e AR sao taxas de acerto (mediana 80% e 74%): valem direto. CAA e OT sao
// taxas de erro (mediana 0,4%, pior caso 26%): entram invertidas, senao a nota
// premiaria justamente quem mais cancela e mais atrasa.
const DRIVER_SCORE_WEIGHTS = { tsh: 0.35, ar: 0.20, caa: 0.20, ot: 0.10, orders: 0.15 };

const DRIVER_SORTS = [
  { value: "score", label: "Nota geral" },
  { value: "orders", label: "Corridas finalizadas" },
  { value: "tsh", label: "TSH" },
  { value: "ar", label: "AR" },
  { value: "caa", label: "CAA (menor primeiro)" },
  { value: "ot", label: "Overtime (menor primeiro)" },
];

// Tudo e comparado dentro da propria cidade. Volume: fatia do maior, senao o
// numero cru so diria qual cidade e maior. Erro: fatia do pior, senao um CAA de
// 0,4% contra 26% viraria diferenca de meio ponto e a coluna nao pesaria nada.
function driverScoreParts(driver, worst) {
  const share = (value, most) => (most > 0 ? Math.min(1, (value || 0) / most) : 0);
  return {
    tsh: Math.min(1, driver.tsh || 0),
    ar: Math.min(1, driver.ar || 0),
    caa: 1 - share(driver.caa, worst.caa),
    ot: 1 - share(driver.ot, worst.ot),
    orders: share(driver.orders, worst.orders),
  };
}

function driverScore(driver, worst) {
  const parts = driverScoreParts(driver, worst);
  return Object.entries(DRIVER_SCORE_WEIGHTS)
    .reduce((total, [key, weight]) => total + weight * parts[key], 0);
}

function buildDailyResult(rows, query = {}) {
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

  const sort = DRIVER_SORTS.some((item) => item.value === query.sort) ? query.sort : "score";
  // Sem piso, uma corrida unica com 100% em tudo lidera o ranking da cidade.
  const minOrders = Math.max(0, Math.floor(Number(query.minOrders ?? 10)) || 0);
  // 0 = todos: quem pede "todos" quer a planilha inteira no Excel.
  const top = Math.max(0, Math.floor(Number(query.top ?? 10)) || 0);

  const cities = cityOrder
    .filter((city) => drivers.some((driver) => driver.city === city))
    .map((city) => {
      const cityDrivers = drivers.filter((driver) => driver.city === city);
      const worst = {
        orders: cityDrivers.reduce((most, driver) => Math.max(most, driver.orders || 0), 0),
        caa: cityDrivers.reduce((most, driver) => Math.max(most, driver.caa || 0), 0),
        ot: cityDrivers.reduce((most, driver) => Math.max(most, driver.ot || 0), 0),
      };
      const scored = cityDrivers.map((driver) => ({ ...driver, score: driverScore(driver, worst) }));

      // CAA e OT sao erro: ordenar "melhor primeiro" ali e do menor para o maior.
      const invertido = sort === "caa" || sort === "ot";
      const valor = (driver) => (invertido ? -(driver[sort] || 0) : driver[sort] || 0);
      // A nota desempata qualquer criterio; corridas desempatam a nota.
      const byChosen = (a, b) => valor(b) - valor(a) || b.score - a.score || b.orders - a.orders;
      const ranked = scored.filter((driver) => driver.orders >= minOrders).sort(byChosen);
      const abaixo = scored.filter((driver) => driver.orders < minOrders).sort((a, b) => b.orders - a.orders);
      const cut = top > 0 ? top : ranked.length;

      return {
        city,
        top: ranked.slice(0, cut),
        // Quem nao bateu o minimo continua listado, so nao disputa o ranking.
        rest: [...ranked.slice(cut), ...abaixo],
        drivers: scored.length,
        ranked: ranked.length,
        belowMin: abaixo.length,
      };
    });

  return { cities, sort, minOrders, top, sorts: DRIVER_SORTS, weights: DRIVER_SCORE_WEIGHTS };
}

// ── Excel do ranking ─────────────────────────────────────────────────────────
// Uma aba por cidade, na ordem escolhida na tela e com a quantidade pedida.
const DAILY_EXPORT_HEADER = ["#", "ID", "CPF", "ENTREGADOR", "HOTZONE", "MODAL", "CORRIDAS", "TSH", "AR", "CAA", "OT", "NOTA"];
const DAILY_EXPORT_WIDTHS = [5, 18, 15, 34, 18, 13, 11, 10, 10, 10, 10, 10];

function dailyResultWorkbook(result) {
  const workbook = XLSX.utils.book_new();

  for (const group of result.cities) {
    const body = group.top.map((driver, index) => [
      index + 1,
      driver.id,
      driver.cpf,
      driver.name,
      driver.hotzone || "",
      driver.vehicle || "",
      driver.orders,
      driver.tsh,
      driver.ar,
      driver.caa,
      driver.ot,
      driver.score,
    ]);

    const sheet = XLSX.utils.aoa_to_sheet([DAILY_EXPORT_HEADER, ...body]);
    sheet["!cols"] = DAILY_EXPORT_WIDTHS.map((width) => ({ wch: width }));

    // TSH, AR, CAA, OT e NOTA sao fracoes: sem o formato o Excel mostra 0,92.
    for (let line = 0; line < body.length; line += 1) {
      for (const column of [7, 8, 9, 10, 11]) {
        const cell = sheet[XLSX.utils.encode_cell({ r: line + 1, c: column })];
        if (cell) cell.z = "0.0%";
      }
    }

    XLSX.utils.book_append_sheet(workbook, sheet, group.city.slice(0, 31));
  }

  if (!result.cities.length) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([DAILY_EXPORT_HEADER]), "Sem dados");
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
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
    if (!byCpf.has(cpf)) byCpf.set(cpf, { id: row.id, name: row.name, city: row.city });

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
    // ID do entregador no BI financeiro: o mesmo identificador das outras telas.
    driverId: financeRows[0]?.id || known?.id || "",
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
        driverId: "",
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
    signupRows: signupData.length,
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
    signupRowCount: signupData.length,
    signupSource: signupStatus,
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
    signupRowCount: signupData.length,
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

app.get("/api/signups", supabase.authorize("cadastro", "kpis"), (req, res) => {
  res.json(buildSignups(req.query));
});

app.get("/api/signups/people", supabase.authorize("cadastro", "kpis"), (req, res) => {
  res.json({ people: signupPeople(req.query) });
});

// Cadastrar, corrigir e apagar direto na tela. Toda resposta devolve o painel
// inteiro ja recalculado, para a tela nao precisar de uma segunda chamada.
app.post("/api/signups", supabase.authorize("cadastro"), (req, res) => {
  const built = buildSignupRecord(req.body);
  if (built.error) return res.status(400).json({ error: built.error });

  const store = readSignupStore();
  if (store.some((item) => signupIdentity(item) === signupIdentity(built.record))) {
    return res.status(409).json({ error: "Esse entregador ja esta cadastrado nessa data." });
  }

  store.push(built.record);
  saveSignupStore(store);
  res.json({ ...signupResponse(req.query), savedKey: built.record.key });
});

app.put("/api/signups/:key", supabase.authorize("cadastro"), (req, res) => {
  const store = readSignupStore();
  const index = store.findIndex((item) => item.key === req.params.key);
  if (index < 0) return res.status(404).json({ error: "Cadastro nao encontrado na base." });

  const built = buildSignupRecord(req.body, store[index]);
  if (built.error) return res.status(400).json({ error: built.error });

  const clash = store.some((item, position) => position !== index && signupIdentity(item) === signupIdentity(built.record));
  if (clash) return res.status(409).json({ error: "Esse entregador ja esta cadastrado nessa data." });

  store[index] = built.record;
  saveSignupStore(store);
  res.json({ ...signupResponse(req.query), savedKey: built.record.key });
});

app.delete("/api/signups/:key", supabase.authorize("cadastro"), (req, res) => {
  const store = readSignupStore();
  const rest = store.filter((item) => item.key !== req.params.key);
  if (rest.length === store.length) return res.status(404).json({ error: "Cadastro nao encontrado na base." });

  saveSignupStore(rest);
  res.json(signupResponse(req.query));
});

// A grade editavel: a planilha do Google passou a morar aqui dentro.
app.get("/api/signups/sheet", supabase.authorize("cadastro", "kpis"), (req, res) => {
  res.json(buildSignupSheet(req.query));
});

// Trazer a planilha inteira de uma vez: cola e importa. Linha que ja existe
// (mesma pessoa no mesmo dia) e ignorada, entao colar duas vezes nao duplica.
app.post("/api/signups/paste", supabase.authorize("cadastro"), (req, res) => {
  const parsed = parsePastedSignups(req.body.text, req.body.city);
  if (!parsed.length) return res.status(400).json({ error: "Nada para importar: cole as linhas da planilha." });

  const store = readSignupStore();
  const seen = new Set(store.map(signupIdentity));
  let created = 0;
  let repeated = 0;
  let ignored = 0;

  for (const raw of parsed) {
    const record = signupRecordFromRaw(raw);
    if (!record) { ignored += 1; continue; }

    const identity = signupIdentity(record);
    if (seen.has(identity)) { repeated += 1; continue; }

    seen.add(identity);
    store.push(record);
    created += 1;
  }

  saveSignupStore(store);
  res.json({ created, repeated, ignored, sheet: buildSignupSheet(req.query) });
});

app.get("/api/finance", supabase.authorize("financeiro"), (req, res) => {
  const rows = filterFinanceRows(req.query);
  res.json(buildFinance(rows, req.query));
});

// RECEBA AUDIT e Promocoes tem permissao propria, liberada usuario a usuario
// na tela Usuarios.
app.get("/api/transfer-audit", supabase.authorize("auditoria"), (req, res) => {
  res.json(buildTransferAudit(req.query));
});

app.get("/api/promotions", supabase.authorize("promocoes"), (req, res) => {
  res.json(buildPromotions(req.query));
});

app.post("/api/promotions", supabase.authorize("promocoes"), (req, res) => {
  const date = String(req.body.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Informe uma data valida." });
  const store = readPromotions();
  if (store[date]) return res.status(409).json({ error: "Essa data ja esta na tabela." });
  store[date] = {};
  writePromotions(store);
  res.json(buildPromotions(req.query));
});

app.put("/api/promotions", supabase.authorize("promocoes"), (req, res) => {
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

app.delete("/api/promotions", supabase.authorize("promocoes"), (req, res) => {
  const date = String(req.query.date || "");
  const store = readPromotions();
  if (!store[date]) return res.status(404).json({ error: "Data nao encontrada." });
  delete store[date];
  writePromotions(store);
  res.json(buildPromotions(req.query));
});

app.get("/api/daily-result", supabase.authorize("kpis", "cadastro"), (req, res) => {
  const rows = filterRows(req.query);
  res.json(buildDailyResult(rows, req.query));
});

app.get("/api/daily-result/export", supabase.authorize("kpis", "cadastro"), (req, res) => {
  const result = buildDailyResult(filterRows(req.query), req.query);
  const stamp = isoDate(new Date());

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="melhores-entregadores-${stamp}.xlsx"`);
  res.send(dailyResultWorkbook(result));
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

  const seeded = signupStatus.seeded ? ` - ${signupStatus.seeded} vindos da carga inicial` : "";
  console.log(`Cadastros: ${signupData.length} linhas na base do sistema (${signupStatus.file})${seeded}.`);
});
