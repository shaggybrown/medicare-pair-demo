const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { URL } = require("node:url");

const { parseCsv, toCsv } = require("./lib/csv");
const { ensureDataFiles, getConnectors, setConnectors, getLeads, setLeads, getCrm, setCrm } = require("./lib/store");
const {
  REQUIRED_FIELDS,
  getRawRecords,
  importViaConnector,
  applyLeadFilters,
  paginateBatch,
  calcAge,
} = require("./lib/connectors");

const PORT = Number(process.env.PORT || 8787);
const CONNECTOR_TICK_MS = Number(process.env.CONNECTOR_TICK_MS || 60000);
const rootDir = path.join(__dirname, "..");

const allowedConnectorTypes = new Set(["csv_url", "api_json", "sftp_csv"]);
const runningConnectorIds = new Set();
const staticExt = new Set([".html", ".css", ".js", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"]);

ensureDataFiles();

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function validateMapping(mapping) {
  if (!mapping || typeof mapping !== "object") return "mapping object is required";
  for (const key of REQUIRED_FIELDS) {
    if (!mapping[key]) return `missing mapping for ${key}`;
  }
  return null;
}

async function runConnectorImport(connectorId, trigger = "manual") {
  if (runningConnectorIds.has(connectorId)) {
    return { ok: false, error: "connector is already running" };
  }

  const connectors = getConnectors();
  const idx = connectors.findIndex((connector) => connector.id === connectorId);
  if (idx === -1) return { ok: false, error: "connector not found" };

  const connector = connectors[idx];
  runningConnectorIds.add(connectorId);

  try {
    const rawRecords = await getRawRecords(connector);
    const leads = getLeads();
    const { imported, duplicates, invalid } = importViaConnector(connector, leads, rawRecords);
    if (imported.length) setLeads([...imported, ...leads]);

    connectors[idx] = {
      ...connector,
      lastRunAt: new Date().toISOString(),
      lastRunStatus: "ok",
      lastRunSummary: {
        trigger,
        fetched: rawRecords.length,
        imported: imported.length,
        duplicates,
        invalid,
      },
      lastRunError: "",
    };
    setConnectors(connectors);

    return {
      ok: true,
      connectorId,
      fetched: rawRecords.length,
      imported: imported.length,
      duplicates,
      invalid,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const updated = getConnectors();
    const errorIdx = updated.findIndex((item) => item.id === connectorId);
    if (errorIdx !== -1) {
      updated[errorIdx] = {
        ...updated[errorIdx],
        lastRunAt: new Date().toISOString(),
        lastRunStatus: "error",
        lastRunError: msg,
      };
      setConnectors(updated);
    }

    return { ok: false, error: msg };
  } finally {
    runningConnectorIds.delete(connectorId);
  }
}

function shouldRunNow(connector) {
  if (!connector.enabled) return false;
  const scheduleMinutes = Number(connector.scheduleMinutes || 0);
  if (scheduleMinutes <= 0) return false;

  const now = Date.now();
  const lastRunAtMs = connector.lastRunAt ? Date.parse(connector.lastRunAt) : 0;
  if (!lastRunAtMs) return true;

  return now - lastRunAtMs >= scheduleMinutes * 60 * 1000;
}

async function schedulerTick() {
  const due = getConnectors().filter(shouldRunNow);
  for (const connector of due) {
    await runConnectorImport(connector.id, "scheduled");
  }
}

function getLeadQueryResult(query) {
  const leads = getLeads();
  const filtered = applyLeadFilters(leads, {
    stage: query.get("stage") || "ALL",
    state: query.get("state") || "",
    county: query.get("county") || "",
    zipPrefix: query.get("zipPrefix") || "",
    minAge: query.get("minAge") || 0,
    maxAge: query.get("maxAge") || 999,
  });

  const batchSize = Number(query.get("batchSize") || 5000);
  const batchNumber = Number(query.get("batchNumber") || 1);
  const batch = paginateBatch(filtered, batchSize, batchNumber);

  return {
    totalStored: leads.length,
    totalFiltered: filtered.length,
    batchSize,
    batchNumber,
    items: batch,
  };
}

function leadToCsvRow(lead) {
  return [
    lead.fullName,
    lead.street,
    lead.unit,
    lead.city,
    lead.state,
    lead.zip,
    lead.county,
    lead.phone,
    lead.dob,
    calcAge(lead.dob) ?? "",
    lead.provider,
    lead.stage,
    lead.importedAt,
  ];
}

function eventWithAvailability(event) {
  return {
    ...event,
    seatsAvailable: Math.max(0, Number(event.seatsTotal || 0) - Number(event.seatsBooked || 0)),
  };
}

function updatePostcardMetric(crm, campaignCode, variant, fieldName) {
  if (!campaignCode || !variant) return;
  const card = crm.postcards.find((item) => item.campaignCode === campaignCode && item.variant === variant);
  if (!card) return;
  card[fieldName] = Number(card[fieldName] || 0) + 1;
}

function getCallQueue(crm) {
  return crm.consultations
    .filter((item) => ["NEW", "ATTEMPTED"].includes(item.status))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

function getNoShowRecovery(crm) {
  return crm.attendees.filter((item) => item.status === "NO_SHOW");
}

function getHotLeads(crm) {
  return crm.consultations
    .filter((item) => item.source === "postcard" && item.status !== "BOOKED")
    .map((item) => ({
      ...item,
      priority: item.status === "NEW" ? "HIGH" : "MEDIUM",
    }));
}

function dashboardSummary(crm) {
  const today = new Date();
  const next30 = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const openConsultations = crm.consultations.filter((item) => ["NEW", "ATTEMPTED"].includes(item.status)).length;
  const upcomingEvents = crm.events.filter((event) => {
    const at = Date.parse(event.date);
    return Number.isFinite(at) && at >= today.getTime() && at <= next30.getTime();
  }).length;
  const totalScans = crm.postcards.reduce((sum, item) => sum + Number(item.scans || 0), 0);
  const totalConversions = crm.postcards.reduce(
    (sum, item) => sum + Number(item.consultationConversions || 0) + Number(item.seminarConversions || 0),
    0
  );

  return {
    consultationsOpen: openConsultations,
    upcomingEvents,
    attendeesTotal: crm.attendees.length,
    postcardsActive: crm.postcards.filter((item) => item.status === "ACTIVE").length,
    totalScans,
    totalConversions,
    conversionRate: totalScans > 0 ? Number(((totalConversions / totalScans) * 100).toFixed(1)) : 0,
  };
}

async function serveStatic(reqPath, res) {
  const cleanPath = reqPath === "/" ? "/index.html" : reqPath;
  const normalized = decodeURIComponent(cleanPath);

  if (normalized.includes("..") || normalized.startsWith("/backend/")) return false;

  const ext = path.extname(normalized).toLowerCase();
  if (!staticExt.has(ext)) return false;

  const filePath = path.join(rootDir, normalized.slice(1));
  if (!filePath.startsWith(rootDir)) return false;

  try {
    const content = await fs.readFile(filePath);
    const contentType =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".css"
          ? "text/css; charset=utf-8"
          : ext === ".js"
            ? "application/javascript; charset=utf-8"
            : ext === ".svg"
              ? "image/svg+xml"
              : ext === ".png"
                ? "image/png"
                : ext === ".jpg" || ext === ".jpeg"
                  ? "image/jpeg"
                  : ext === ".webp"
                    ? "image/webp"
                    : "application/octet-stream";

    send(res, 200, content, contentType);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { error: "invalid request" });
    return;
  }

  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  try {
    if (req.method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        service: "medicare-pair-crm",
        now: new Date().toISOString(),
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/dashboard") {
      const crm = getCrm();
      sendJson(res, 200, {
        summary: dashboardSummary(crm),
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/events") {
      const crm = getCrm();
      sendJson(res, 200, { items: crm.events.map(eventWithAvailability) });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/events") {
      const body = await readJsonBody(req);
      if (!body.title || !body.date || !body.location) {
        sendJson(res, 400, { error: "title, date, and location are required" });
        return;
      }

      const crm = getCrm();
      const event = {
        id: randomUUID(),
        title: String(body.title),
        date: String(body.date),
        location: String(body.location),
        seatsTotal: Number(body.seatsTotal || 40),
        seatsBooked: Number(body.seatsBooked || 0),
        status: body.status || "OPEN",
        notes: String(body.notes || ""),
      };
      crm.events.push(event);
      setCrm(crm);
      sendJson(res, 201, eventWithAvailability(event));
      return;
    }

    const eventPatchMatch = pathname.match(/^\/api\/admin\/events\/([^/]+)$/);
    if (eventPatchMatch && req.method === "PATCH") {
      const id = eventPatchMatch[1];
      const body = await readJsonBody(req);
      const crm = getCrm();
      const idx = crm.events.findIndex((item) => item.id === id);
      if (idx === -1) {
        sendJson(res, 404, { error: "event not found" });
        return;
      }

      crm.events[idx] = {
        ...crm.events[idx],
        ...body,
      };
      setCrm(crm);
      sendJson(res, 200, eventWithAvailability(crm.events[idx]));
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/consultations") {
      const crm = getCrm();
      sendJson(res, 200, { items: crm.consultations });
      return;
    }

    const consultationPatchMatch = pathname.match(/^\/api\/admin\/consultations\/([^/]+)$/);
    if (consultationPatchMatch && req.method === "PATCH") {
      const id = consultationPatchMatch[1];
      const body = await readJsonBody(req);
      const crm = getCrm();
      const idx = crm.consultations.findIndex((item) => item.id === id);
      if (idx === -1) {
        sendJson(res, 404, { error: "consultation not found" });
        return;
      }

      crm.consultations[idx] = {
        ...crm.consultations[idx],
        ...body,
      };
      setCrm(crm);
      sendJson(res, 200, crm.consultations[idx]);
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/attendees") {
      const crm = getCrm();
      const eventsById = Object.fromEntries(crm.events.map((event) => [event.id, event]));
      const items = crm.attendees.map((item) => ({
        ...item,
        eventTitle: eventsById[item.eventId]?.title || "Unknown event",
      }));
      sendJson(res, 200, { items });
      return;
    }

    const attendeePatchMatch = pathname.match(/^\/api\/admin\/attendees\/([^/]+)$/);
    if (attendeePatchMatch && req.method === "PATCH") {
      const id = attendeePatchMatch[1];
      const body = await readJsonBody(req);
      const crm = getCrm();
      const idx = crm.attendees.findIndex((item) => item.id === id);
      if (idx === -1) {
        sendJson(res, 404, { error: "attendee not found" });
        return;
      }

      crm.attendees[idx] = {
        ...crm.attendees[idx],
        ...body,
      };
      setCrm(crm);
      sendJson(res, 200, crm.attendees[idx]);
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/postcards") {
      const crm = getCrm();
      const items = crm.postcards.map((item) => {
        const scans = Number(item.scans || 0);
        const conversions = Number(item.consultationConversions || 0) + Number(item.seminarConversions || 0);
        const qrUrl = `${url.origin}/track/${encodeURIComponent(item.campaignCode)}/${encodeURIComponent(item.variant)}`;
        return {
          ...item,
          conversions,
          conversionRate: scans > 0 ? Number(((conversions / scans) * 100).toFixed(1)) : 0,
          qrUrl,
        };
      });
      sendJson(res, 200, { items });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/postcards") {
      const body = await readJsonBody(req);
      if (!body.name || !body.campaignCode || !body.variant) {
        sendJson(res, 400, { error: "name, campaignCode, and variant are required" });
        return;
      }

      const crm = getCrm();
      const postcard = {
        id: randomUUID(),
        name: String(body.name),
        campaignCode: String(body.campaignCode).trim().toUpperCase(),
        variant: String(body.variant).trim().toUpperCase(),
        headline: String(body.headline || ""),
        offer: String(body.offer || ""),
        sentCount: Number(body.sentCount || 0),
        scans: 0,
        consultationConversions: 0,
        seminarConversions: 0,
        status: body.status || "ACTIVE",
      };
      crm.postcards.push(postcard);
      setCrm(crm);
      sendJson(res, 201, postcard);
      return;
    }

    const postcardPatchMatch = pathname.match(/^\/api\/admin\/postcards\/([^/]+)$/);
    if (postcardPatchMatch && req.method === "PATCH") {
      const id = postcardPatchMatch[1];
      const body = await readJsonBody(req);
      const crm = getCrm();
      const idx = crm.postcards.findIndex((item) => item.id === id);
      if (idx === -1) {
        sendJson(res, 404, { error: "postcard not found" });
        return;
      }

      crm.postcards[idx] = {
        ...crm.postcards[idx],
        ...body,
      };
      setCrm(crm);
      sendJson(res, 200, crm.postcards[idx]);
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/tasks") {
      const crm = getCrm();
      sendJson(res, 200, { items: crm.tasks });
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/tasks") {
      const body = await readJsonBody(req);
      if (!body.title || !body.owner || !body.dueDate) {
        sendJson(res, 400, { error: "title, owner, dueDate are required" });
        return;
      }

      const crm = getCrm();
      const task = {
        id: randomUUID(),
        title: String(body.title),
        owner: String(body.owner),
        dueDate: String(body.dueDate),
        status: body.status || "OPEN",
        type: body.type || "GENERAL",
      };
      crm.tasks.push(task);
      setCrm(crm);
      sendJson(res, 201, task);
      return;
    }

    const taskPatchMatch = pathname.match(/^\/api\/admin\/tasks\/([^/]+)$/);
    if (taskPatchMatch && req.method === "PATCH") {
      const id = taskPatchMatch[1];
      const body = await readJsonBody(req);
      const crm = getCrm();
      const idx = crm.tasks.findIndex((item) => item.id === id);
      if (idx === -1) {
        sendJson(res, 404, { error: "task not found" });
        return;
      }
      crm.tasks[idx] = {
        ...crm.tasks[idx],
        ...body,
      };
      setCrm(crm);
      sendJson(res, 200, crm.tasks[idx]);
      return;
    }

    if (req.method === "GET" && pathname === "/api/admin/workflows") {
      const crm = getCrm();
      sendJson(res, 200, {
        callQueue: getCallQueue(crm),
        noShowRecovery: getNoShowRecovery(crm),
        hotLeads: getHotLeads(crm),
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/public/consultations") {
      const body = await readJsonBody(req);
      if (!body.name || !body.phone || !body.zip) {
        sendJson(res, 400, { error: "name, phone, and zip are required" });
        return;
      }

      const crm = getCrm();
      const consultation = {
        id: randomUUID(),
        name: String(body.name),
        phone: String(body.phone),
        zip: String(body.zip),
        need: String(body.need || "General Medicare help"),
        timePreference: String(body.timePreference || "Afternoon"),
        status: "NEW",
        assignedTo: body.assignedTo || "Unassigned",
        source: body.source || "website",
        campaignCode: body.campaignCode || "",
        variant: body.variant || "",
        createdAt: new Date().toISOString(),
        notes: "",
      };

      crm.consultations.unshift(consultation);
      updatePostcardMetric(crm, consultation.campaignCode, consultation.variant, "consultationConversions");
      setCrm(crm);
      sendJson(res, 201, { ok: true, item: consultation });
      return;
    }

    if (req.method === "POST" && pathname === "/api/public/seminar-signups") {
      const body = await readJsonBody(req);
      if (!body.name || !body.phone || !body.eventId) {
        sendJson(res, 400, { error: "name, phone, and eventId are required" });
        return;
      }

      const crm = getCrm();
      const event = crm.events.find((item) => item.id === body.eventId);
      if (!event) {
        sendJson(res, 404, { error: "event not found" });
        return;
      }

      if (Number(event.seatsBooked || 0) >= Number(event.seatsTotal || 0)) {
        sendJson(res, 409, { error: "event is full" });
        return;
      }

      event.seatsBooked = Number(event.seatsBooked || 0) + 1;
      const attendee = {
        id: randomUUID(),
        eventId: event.id,
        name: String(body.name),
        phone: String(body.phone),
        status: "REGISTERED",
        source: body.source || "website",
        campaignCode: body.campaignCode || "",
        variant: body.variant || "",
        createdAt: new Date().toISOString(),
      };

      crm.attendees.unshift(attendee);
      updatePostcardMetric(crm, attendee.campaignCode, attendee.variant, "seminarConversions");
      setCrm(crm);
      sendJson(res, 201, { ok: true, item: attendee, event: eventWithAvailability(event) });
      return;
    }

    const trackMatch = pathname.match(/^\/track\/([^/]+)\/([^/]+)$/);
    if (trackMatch && req.method === "GET") {
      const campaignCode = decodeURIComponent(trackMatch[1]).trim().toUpperCase();
      const variant = decodeURIComponent(trackMatch[2]).trim().toUpperCase();
      const crm = getCrm();

      crm.scans.unshift({
        id: randomUUID(),
        campaignCode,
        variant,
        timestamp: new Date().toISOString(),
      });
      updatePostcardMetric(crm, campaignCode, variant, "scans");
      setCrm(crm);

      res.writeHead(302, {
        Location: `/?src=postcard&campaign=${encodeURIComponent(campaignCode)}&variant=${encodeURIComponent(variant)}`,
        "cache-control": "no-store",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && pathname === "/api/connectors") {
      sendJson(res, 200, { items: getConnectors() });
      return;
    }

    if (req.method === "POST" && pathname === "/api/connectors") {
      const body = await readJsonBody(req);
      if (!body.name) {
        sendJson(res, 400, { error: "name is required" });
        return;
      }
      if (!allowedConnectorTypes.has(body.type)) {
        sendJson(res, 400, { error: "type must be csv_url, api_json, or sftp_csv" });
        return;
      }

      const mappingErr = validateMapping(body.mapping);
      if (mappingErr) {
        sendJson(res, 400, { error: mappingErr });
        return;
      }

      const connector = {
        id: randomUUID(),
        name: String(body.name).trim(),
        type: body.type,
        config: body.config || {},
        mapping: body.mapping,
        scheduleMinutes: Number(body.scheduleMinutes || 0),
        enabled: body.enabled !== false,
        createdAt: new Date().toISOString(),
        lastRunAt: "",
        lastRunStatus: "",
        lastRunSummary: null,
        lastRunError: "",
      };

      const connectors = getConnectors();
      connectors.push(connector);
      setConnectors(connectors);

      sendJson(res, 201, connector);
      return;
    }

    const connectorPatchMatch = pathname.match(/^\/api\/connectors\/([^/]+)$/);
    if (connectorPatchMatch && req.method === "PATCH") {
      const id = connectorPatchMatch[1];
      const body = await readJsonBody(req);
      const connectors = getConnectors();
      const idx = connectors.findIndex((item) => item.id === id);
      if (idx === -1) {
        sendJson(res, 404, { error: "connector not found" });
        return;
      }

      const next = {
        ...connectors[idx],
        ...body,
      };

      if (next.mapping) {
        const mappingErr = validateMapping(next.mapping);
        if (mappingErr) {
          sendJson(res, 400, { error: mappingErr });
          return;
        }
      }

      if (!allowedConnectorTypes.has(next.type)) {
        sendJson(res, 400, { error: "type must be csv_url, api_json, or sftp_csv" });
        return;
      }

      connectors[idx] = next;
      setConnectors(connectors);
      sendJson(res, 200, next);
      return;
    }

    const connectorDeleteMatch = pathname.match(/^\/api\/connectors\/([^/]+)$/);
    if (connectorDeleteMatch && req.method === "DELETE") {
      const id = connectorDeleteMatch[1];
      const connectors = getConnectors();
      const next = connectors.filter((item) => item.id !== id);
      if (next.length === connectors.length) {
        sendJson(res, 404, { error: "connector not found" });
        return;
      }
      setConnectors(next);
      sendJson(res, 200, { ok: true });
      return;
    }

    const connectorRunMatch = pathname.match(/^\/api\/connectors\/([^/]+)\/run$/);
    if (connectorRunMatch && req.method === "POST") {
      const id = connectorRunMatch[1];
      const result = await runConnectorImport(id, "manual");
      if (!result.ok) {
        sendJson(res, 400, result);
        return;
      }
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && pathname === "/api/leads") {
      sendJson(res, 200, getLeadQueryResult(url.searchParams));
      return;
    }

    if (req.method === "GET" && pathname === "/api/leads/export.csv") {
      const result = getLeadQueryResult(url.searchParams);
      const headers = [
        "Full Name",
        "Street",
        "Unit",
        "City",
        "State",
        "ZIP",
        "County",
        "Phone",
        "DOB",
        "Age",
        "Provider",
        "Stage",
        "Imported At",
      ];
      const rows = result.items.map(leadToCsvRow);
      const csv = toCsv(headers, rows);
      send(res, 200, csv, "text/csv; charset=utf-8");
      return;
    }

    if (req.method === "POST" && pathname === "/api/leads/mark-mailed") {
      const body = await readJsonBody(req);
      const ids = Array.isArray(body.leadIds) ? body.leadIds : [];
      if (!ids.length) {
        sendJson(res, 400, { error: "leadIds array is required" });
        return;
      }

      const idSet = new Set(ids);
      const leads = getLeads();
      let updated = 0;

      leads.forEach((lead) => {
        if (idSet.has(lead.id) && lead.stage === "READY") {
          lead.stage = "MAILED";
          updated += 1;
        }
      });

      setLeads(leads);
      sendJson(res, 200, { ok: true, updated });
      return;
    }

    if (req.method === "POST" && pathname === "/api/leads/import-csv") {
      const body = await readJsonBody(req);
      const connector = {
        id: "manual-import",
        name: body.providerName || "Manual Import",
        type: "csv_url",
        mapping: body.mapping || {},
      };

      const mappingErr = validateMapping(connector.mapping);
      if (mappingErr) {
        sendJson(res, 400, { error: mappingErr });
        return;
      }

      if (!body.csvText) {
        sendJson(res, 400, { error: "csvText is required" });
        return;
      }

      const rawRecords = parseCsv(String(body.csvText)).records;
      const leads = getLeads();
      const result = importViaConnector(connector, leads, rawRecords);
      setLeads([...result.imported, ...leads]);

      sendJson(res, 200, {
        ok: true,
        fetched: rawRecords.length,
        imported: result.imported.length,
        duplicates: result.duplicates,
        invalid: result.invalid,
      });
      return;
    }

    const served = await serveStatic(pathname, res);
    if (served) return;

    sendJson(res, 404, { error: "not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`Medicare Pair backend running on http://localhost:${PORT}`);
  console.log(`Frontend served at http://localhost:${PORT}/`);
  console.log(`Admin dashboard at http://localhost:${PORT}/admin.html`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

setInterval(() => {
  schedulerTick().catch((error) => {
    console.error("Scheduler tick error:", error);
  });
}, CONNECTOR_TICK_MS);
