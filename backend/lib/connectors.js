const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { parseCsv } = require("./csv");

const REQUIRED_FIELDS = ["fullName", "street", "city", "state", "zip"];
const OPTIONAL_FIELDS = ["unit", "county", "phone", "dob", "leadSource"];

function normalizeState(value) {
  return String(value || "").trim().toUpperCase().slice(0, 2);
}

function normalizeZip(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5, 9)}`;
}

function normalizeDob(value) {
  if (!value) return "";
  const raw = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const mm = slash[1].padStart(2, "0");
    const dd = slash[2].padStart(2, "0");
    return `${slash[3]}-${mm}-${dd}`;
  }

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return "";
}

function dedupeKey(lead) {
  return `${lead.fullName.toLowerCase()}|${lead.street.toLowerCase()}|${lead.city.toLowerCase()}|${lead.state}|${lead.zip}`;
}

function pickPath(input, path) {
  if (!path) return input;
  return String(path)
    .split(".")
    .reduce((acc, key) => (acc && Object.prototype.hasOwnProperty.call(acc, key) ? acc[key] : undefined), input);
}

function parseRowsFromCsvText(text) {
  return parseCsv(text).records;
}

async function readFromSftp(connector) {
  if (connector.config.localMockPath) {
    return fs.readFile(connector.config.localMockPath, "utf8");
  }

  let SftpClient;
  try {
    SftpClient = require("ssh2-sftp-client");
  } catch {
    throw new Error("SFTP requires optional dependency ssh2-sftp-client or localMockPath");
  }

  const client = new SftpClient();
  await client.connect({
    host: connector.config.host,
    port: Number(connector.config.port || 22),
    username: connector.config.username,
    password: connector.config.password,
    privateKey: connector.config.privateKey,
  });

  try {
    const data = await client.get(connector.config.remotePath);
    return Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
  } finally {
    await client.end();
  }
}

async function getRawRecords(connector) {
  if (connector.type === "csv_url") {
    const response = await fetch(connector.config.url, { headers: connector.config.headers || {} });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    return parseRowsFromCsvText(text);
  }

  if (connector.type === "api_json") {
    const response = await fetch(connector.config.url, { headers: connector.config.headers || {} });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const records = pickPath(json, connector.config.recordsPath);
    if (Array.isArray(records)) return records;
    if (Array.isArray(json)) return json;
    return [];
  }

  if (connector.type === "sftp_csv") {
    const text = await readFromSftp(connector);
    return parseRowsFromCsvText(text);
  }

  throw new Error(`Unsupported connector type: ${connector.type}`);
}

function sourceValue(record, sourceKey) {
  if (!sourceKey) return "";
  return String(record[sourceKey] ?? "").trim();
}

function transformRecord(record, connector) {
  const mapping = connector.mapping || {};

  const lead = {
    id: randomUUID(),
    fullName: sourceValue(record, mapping.fullName),
    street: sourceValue(record, mapping.street),
    unit: sourceValue(record, mapping.unit),
    city: sourceValue(record, mapping.city),
    state: normalizeState(sourceValue(record, mapping.state)),
    zip: normalizeZip(sourceValue(record, mapping.zip)),
    county: sourceValue(record, mapping.county),
    phone: sourceValue(record, mapping.phone),
    dob: normalizeDob(sourceValue(record, mapping.dob)),
    leadSource: sourceValue(record, mapping.leadSource) || connector.name,
    provider: connector.name,
    connectorId: connector.id,
    stage: "READY",
    importedAt: new Date().toISOString(),
  };

  for (const key of REQUIRED_FIELDS) {
    if (!lead[key]) return null;
  }

  return lead;
}

function importViaConnector(connector, existingLeads, rawRecords) {
  const existingKeys = new Set(existingLeads.map(dedupeKey));
  const imported = [];
  let duplicates = 0;
  let invalid = 0;

  rawRecords.forEach((record) => {
    const lead = transformRecord(record, connector);
    if (!lead) {
      invalid += 1;
      return;
    }

    const key = dedupeKey(lead);
    if (existingKeys.has(key)) {
      duplicates += 1;
      return;
    }

    existingKeys.add(key);
    imported.push(lead);
  });

  return { imported, duplicates, invalid };
}

function calcAge(dob) {
  if (!dob) return null;
  const birth = new Date(`${dob}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function applyLeadFilters(leads, filters) {
  const stage = String(filters.stage || "ALL");
  const state = String(filters.state || "").trim().toUpperCase();
  const county = String(filters.county || "").trim().toLowerCase();
  const zipPrefix = String(filters.zipPrefix || "").trim();
  const minAge = Number(filters.minAge || 0);
  const maxAge = Number(filters.maxAge || 999);

  return leads.filter((lead) => {
    if (stage !== "ALL" && lead.stage !== stage) return false;
    if (state && lead.state !== state) return false;
    if (county && !String(lead.county || "").toLowerCase().includes(county)) return false;
    if (zipPrefix && !String(lead.zip || "").startsWith(zipPrefix)) return false;

    const age = calcAge(lead.dob);
    if (age !== null && (age < minAge || age > maxAge)) return false;

    return true;
  });
}

function paginateBatch(leads, batchSize, batchNumber) {
  const size = Math.max(1, Number(batchSize || 1));
  const page = Math.max(1, Number(batchNumber || 1));
  const start = (page - 1) * size;
  return leads.slice(start, start + size);
}

module.exports = {
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  getRawRecords,
  importViaConnector,
  applyLeadFilters,
  paginateBatch,
  calcAge,
};
