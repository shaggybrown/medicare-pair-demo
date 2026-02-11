const fs = require("node:fs");
const path = require("node:path");

const dataDir = path.join(__dirname, "..", "data");
const connectorsFile = path.join(dataDir, "connectors.json");
const leadsFile = path.join(dataDir, "leads.json");
const crmFile = path.join(dataDir, "crm.json");

function ensureDataFiles() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(connectorsFile)) fs.writeFileSync(connectorsFile, "[]\n", "utf8");
  if (!fs.existsSync(leadsFile)) fs.writeFileSync(leadsFile, "[]\n", "utf8");
  if (!fs.existsSync(crmFile)) fs.writeFileSync(crmFile, `${JSON.stringify(seedCrmData(), null, 2)}\n`, "utf8");
}

function readJson(filePath, fallback) {
  ensureDataFiles();
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDataFiles();
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function getConnectors() {
  return readJson(connectorsFile, []);
}

function setConnectors(connectors) {
  writeJson(connectorsFile, connectors);
}

function getLeads() {
  return readJson(leadsFile, []);
}

function setLeads(leads) {
  writeJson(leadsFile, leads);
}

function seedCrmData() {
  const now = new Date();
  const iso = (offsetDays) => new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000).toISOString();

  return {
    events: [
      {
        id: "evt-1001",
        title: "Medicare Basics Seminar",
        date: iso(7),
        location: "Lorain Community Center",
        seatsTotal: 40,
        seatsBooked: 26,
        status: "OPEN",
        notes: "Educational only. No plan enrollment during seminar.",
      },
      {
        id: "evt-1002",
        title: "Turning 65 Workshop",
        date: iso(18),
        location: "Avon Library Meeting Room",
        seatsTotal: 35,
        seatsBooked: 12,
        status: "OPEN",
        notes: "Focus on enrollment deadlines.",
      },
    ],
    consultations: [
      {
        id: "con-2001",
        name: "Patricia Jenkins",
        phone: "(440) 555-1012",
        zip: "44011",
        need: "Turning 65 soon",
        timePreference: "Morning",
        status: "NEW",
        assignedTo: "Joe",
        source: "postcard",
        campaignCode: "SPRING65",
        variant: "A",
        createdAt: iso(-1),
        notes: "",
      },
      {
        id: "con-2002",
        name: "Ronald Banks",
        phone: "(216) 555-7781",
        zip: "44035",
        need: "Prescription costs",
        timePreference: "Afternoon",
        status: "ATTEMPTED",
        assignedTo: "MaryBeth",
        source: "website",
        campaignCode: "",
        variant: "",
        createdAt: iso(-2),
        notes: "Left voicemail.",
      },
      {
        id: "con-2003",
        name: "Deborah Bryant",
        phone: "(440) 555-4381",
        zip: "44052",
        need: "Changing plans",
        timePreference: "Evening",
        status: "BOOKED",
        assignedTo: "Joe",
        source: "seminar",
        campaignCode: "",
        variant: "",
        createdAt: iso(-4),
        notes: "Booked for next Tuesday.",
      },
    ],
    attendees: [
      {
        id: "att-3001",
        eventId: "evt-1001",
        name: "Gregory Gaines",
        phone: "(440) 555-2201",
        status: "REGISTERED",
        source: "postcard",
        campaignCode: "SPRING65",
        variant: "B",
        createdAt: iso(-3),
      },
      {
        id: "att-3002",
        eventId: "evt-1001",
        name: "Anita Collins",
        phone: "(440) 555-2219",
        status: "CONFIRMED",
        source: "website",
        campaignCode: "",
        variant: "",
        createdAt: iso(-2),
      },
      {
        id: "att-3003",
        eventId: "evt-1002",
        name: "Jerome Adler",
        phone: "(440) 555-9782",
        status: "NO_SHOW",
        source: "postcard",
        campaignCode: "WINTERRESET",
        variant: "A",
        createdAt: iso(-7),
      },
    ],
    postcards: [
      {
        id: "pc-4001",
        name: "Spring Turning 65",
        campaignCode: "SPRING65",
        variant: "A",
        headline: "Turning 65 Soon?",
        offer: "Free 1-on-1 Medicare review",
        sentCount: 2500,
        scans: 196,
        consultationConversions: 42,
        seminarConversions: 19,
        status: "ACTIVE",
      },
      {
        id: "pc-4002",
        name: "Spring Turning 65",
        campaignCode: "SPRING65",
        variant: "B",
        headline: "Avoid Medicare Mistakes",
        offer: "Reserve your seminar seat",
        sentCount: 2500,
        scans: 154,
        consultationConversions: 28,
        seminarConversions: 31,
        status: "ACTIVE",
      },
      {
        id: "pc-4003",
        name: "Winter Reactivation",
        campaignCode: "WINTERRESET",
        variant: "A",
        headline: "Review Your Medicare Plan",
        offer: "Annual plan checkup",
        sentCount: 1800,
        scans: 88,
        consultationConversions: 17,
        seminarConversions: 4,
        status: "PAUSED",
      },
    ],
    scans: [
      {
        id: "scan-5001",
        campaignCode: "SPRING65",
        variant: "A",
        timestamp: iso(-1),
      },
      {
        id: "scan-5002",
        campaignCode: "SPRING65",
        variant: "B",
        timestamp: iso(-1),
      },
      {
        id: "scan-5003",
        campaignCode: "WINTERRESET",
        variant: "A",
        timestamp: iso(-5),
      },
    ],
    tasks: [
      {
        id: "tsk-6001",
        title: "Call Patricia Jenkins for consultation confirmation",
        owner: "Joe",
        dueDate: iso(0),
        status: "OPEN",
        type: "CALL",
      },
      {
        id: "tsk-6002",
        title: "Follow up with Jerome Adler no-show",
        owner: "MaryBeth",
        dueDate: iso(1),
        status: "OPEN",
        type: "NO_SHOW_RECOVERY",
      },
    ],
  };
}

function getCrm() {
  const existing = readJson(crmFile, null);
  if (existing && typeof existing === "object") return existing;
  const seeded = seedCrmData();
  writeJson(crmFile, seeded);
  return seeded;
}

function setCrm(crm) {
  writeJson(crmFile, crm);
}

module.exports = {
  ensureDataFiles,
  getConnectors,
  setConnectors,
  getLeads,
  setLeads,
  getCrm,
  setCrm,
};
