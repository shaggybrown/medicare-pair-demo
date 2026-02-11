const kpiGridEl = document.getElementById("kpiGrid");
const callQueueEl = document.getElementById("callQueue");
const noShowQueueEl = document.getElementById("noShowQueue");
const hotLeadsEl = document.getElementById("hotLeads");
const consultationRowsEl = document.getElementById("consultationRows");
const attendeeRowsEl = document.getElementById("attendeeRows");
const eventRowsEl = document.getElementById("eventRows");
const taskListEl = document.getElementById("taskList");
const postcardRowsEl = document.getElementById("postcardRows");
const abSummaryEl = document.getElementById("abSummary");
const qrImageEl = document.getElementById("qrImage");
const qrUrlEl = document.getElementById("qrUrl");

const refreshBtn = document.getElementById("refreshBtn");
const eventForm = document.getElementById("eventForm");
const eventStatusEl = document.getElementById("eventStatus");
const taskForm = document.getElementById("taskForm");
const taskStatusEl = document.getElementById("taskStatus");
const postcardForm = document.getElementById("postcardForm");
const postcardStatusEl = document.getElementById("postcardStatus");

const state = {
  dashboard: null,
  workflows: null,
  consultations: [],
  attendees: [],
  events: [],
  tasks: [],
  postcards: [],
};

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${path}`);
  }
  return data;
}

function toShortDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function setStatus(el, message, ok = true) {
  el.textContent = message;
  el.classList.remove("good", "bad");
  el.classList.add(ok ? "good" : "bad");
}

function renderKpis() {
  const s = state.dashboard;
  if (!s) return;

  const cards = [
    ["Open Consultations", s.consultationsOpen],
    ["Upcoming Events (30d)", s.upcomingEvents],
    ["Attendees", s.attendeesTotal],
    ["Active Postcards", s.postcardsActive],
    ["Postcard Scans", s.totalScans],
    ["Scan->Conversion", `${s.conversionRate}%`],
  ];

  kpiGridEl.innerHTML = cards
    .map(
      ([label, value]) => `
      <article class="kpi">
        <p>${label}</p>
        <h3>${value}</h3>
      </article>
    `
    )
    .join("");
}

function renderWorkflows() {
  const workflows = state.workflows;
  if (!workflows) return;

  callQueueEl.innerHTML = workflows.callQueue.length
    ? workflows.callQueue
        .map(
          (item) => `
          <article class="queue-item">
            <strong>${item.name}</strong>
            <p>${item.phone} | ${item.status} | ${item.timePreference}</p>
          </article>
        `
        )
        .join("")
    : "<p>No call queue items.</p>";

  noShowQueueEl.innerHTML = workflows.noShowRecovery.length
    ? workflows.noShowRecovery
        .map(
          (item) => `
          <article class="queue-item">
            <strong>${item.name}</strong>
            <p>${item.phone} | ${item.campaignCode || "website"}</p>
          </article>
        `
        )
        .join("")
    : "<p>No no-show leads.</p>";

  hotLeadsEl.innerHTML = workflows.hotLeads.length
    ? workflows.hotLeads
        .map(
          (item) => `
          <article class="queue-item">
            <strong>${item.name}</strong>
            <p>${item.campaignCode}-${item.variant} | ${item.priority} priority</p>
          </article>
        `
        )
        .join("")
    : "<p>No hot postcard leads.</p>";
}

function renderConsultations() {
  consultationRowsEl.innerHTML = state.consultations
    .map(
      (item) => `
      <tr data-id="${item.id}">
        <td>${item.name}</td>
        <td>${item.phone}</td>
        <td>${item.need}</td>
        <td>
          <select data-mini data-field="status">
            ${["NEW", "ATTEMPTED", "BOOKED", "CLOSED"].map((s) => `<option ${item.status === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </td>
        <td>
          <input data-mini data-field="assignedTo" value="${item.assignedTo || ""}" />
        </td>
        <td>${item.source}${item.campaignCode ? ` (${item.campaignCode}-${item.variant})` : ""}</td>
        <td><button class="btn btn-ghost" data-action="save-consultation">Save</button></td>
      </tr>
    `
    )
    .join("");
}

function renderAttendees() {
  attendeeRowsEl.innerHTML = state.attendees
    .map(
      (item) => `
      <tr data-id="${item.id}">
        <td>${item.name}</td>
        <td>${item.eventTitle}</td>
        <td>${item.phone}</td>
        <td>
          <select data-mini data-field="status">
            ${["REGISTERED", "CONFIRMED", "ATTENDED", "NO_SHOW"].map((s) => `<option ${item.status === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </td>
        <td>${item.source}${item.campaignCode ? ` (${item.campaignCode}-${item.variant})` : ""}</td>
        <td><button class="btn btn-ghost" data-action="save-attendee">Save</button></td>
      </tr>
    `
    )
    .join("");
}

function renderEvents() {
  eventRowsEl.innerHTML = state.events
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .map(
      (event) => `
      <tr>
        <td>${event.title}<br /><small>${event.location}</small></td>
        <td>${toShortDate(event.date)}</td>
        <td>${event.seatsBooked}/${event.seatsTotal} (left ${event.seatsAvailable})</td>
        <td>${event.status}</td>
      </tr>
    `
    )
    .join("");
}

function renderTasks() {
  taskListEl.innerHTML = state.tasks
    .map(
      (task) => `
      <article class="task-item" data-id="${task.id}">
        <strong>${task.title}</strong>
        <p>${task.owner} | Due ${toShortDate(task.dueDate)} | ${task.type}</p>
        <p>Status: ${task.status}</p>
      </article>
    `
    )
    .join("");
}

function renderPostcards() {
  postcardRowsEl.innerHTML = state.postcards
    .map(
      (pc) => `
      <tr>
        <td>${pc.campaignCode}</td>
        <td>${pc.variant}</td>
        <td>${pc.scans}</td>
        <td>${pc.conversions}</td>
        <td>${pc.conversionRate}%</td>
        <td><button class="btn btn-ghost" data-action="show-qr" data-url="${pc.qrUrl}">Show QR</button></td>
      </tr>
    `
    )
    .join("");

  const grouped = new Map();
  state.postcards.forEach((pc) => {
    const key = pc.campaignCode;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(pc);
  });

  abSummaryEl.innerHTML = [...grouped.entries()]
    .map(([campaign, variants]) => {
      const sorted = [...variants].sort((a, b) => b.conversionRate - a.conversionRate);
      const winner = sorted[0];
      return `
        <article class="ab-item">
          <strong>${campaign}</strong>
          <p>Winner: Variant ${winner.variant} at ${winner.conversionRate}% (${winner.conversions}/${winner.scans} scans)</p>
        </article>
      `;
    })
    .join("");
}

async function loadAll() {
  const [dashboard, workflows, consultations, attendees, events, tasks, postcards] = await Promise.all([
    api("api/admin/dashboard"),
    api("api/admin/workflows"),
    api("api/admin/consultations"),
    api("api/admin/attendees"),
    api("api/admin/events"),
    api("api/admin/tasks"),
    api("api/admin/postcards"),
  ]);

  state.dashboard = dashboard.summary;
  state.workflows = workflows;
  state.consultations = consultations.items || [];
  state.attendees = attendees.items || [];
  state.events = events.items || [];
  state.tasks = tasks.items || [];
  state.postcards = postcards.items || [];

  renderKpis();
  renderWorkflows();
  renderConsultations();
  renderAttendees();
  renderEvents();
  renderTasks();
  renderPostcards();
}

async function saveConsultationRow(row) {
  const id = row.dataset.id;
  const status = row.querySelector("[data-field='status']").value;
  const assignedTo = row.querySelector("[data-field='assignedTo']").value.trim();
  await api(`api/admin/consultations/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, assignedTo }),
  });
}

async function saveAttendeeRow(row) {
  const id = row.dataset.id;
  const status = row.querySelector("[data-field='status']").value;
  await api(`api/admin/attendees/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

consultationRowsEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.dataset.action !== "save-consultation") return;
  const row = target.closest("tr");
  if (!row) return;

  try {
    await saveConsultationRow(row);
    await loadAll();
  } catch (error) {
    alert(error.message);
  }
});

attendeeRowsEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.dataset.action !== "save-attendee") return;
  const row = target.closest("tr");
  if (!row) return;

  try {
    await saveAttendeeRow(row);
    await loadAll();
  } catch (error) {
    alert(error.message);
  }
});

postcardRowsEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.dataset.action !== "show-qr") return;

  const url = target.dataset.url;
  if (!url) return;

  qrUrlEl.textContent = url;
  qrImageEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
});

eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await api("api/admin/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: document.getElementById("eventTitle").value,
        date: document.getElementById("eventDate").value,
        location: document.getElementById("eventLocation").value,
        seatsTotal: Number(document.getElementById("eventSeats").value || 40),
        notes: document.getElementById("eventNotes").value,
      }),
    });

    setStatus(eventStatusEl, "Event created.", true);
    eventForm.reset();
    await loadAll();
  } catch (error) {
    setStatus(eventStatusEl, error.message, false);
  }
});

taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await api("api/admin/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: document.getElementById("taskTitle").value,
        owner: document.getElementById("taskOwner").value,
        dueDate: document.getElementById("taskDue").value,
        type: document.getElementById("taskType").value,
      }),
    });

    setStatus(taskStatusEl, "Task added.", true);
    taskForm.reset();
    await loadAll();
  } catch (error) {
    setStatus(taskStatusEl, error.message, false);
  }
});

postcardForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await api("api/admin/postcards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: document.getElementById("pcName").value,
        campaignCode: document.getElementById("pcCampaign").value,
        variant: document.getElementById("pcVariant").value,
        headline: document.getElementById("pcHeadline").value,
        offer: document.getElementById("pcOffer").value,
        sentCount: Number(document.getElementById("pcSent").value || 0),
      }),
    });

    setStatus(postcardStatusEl, "Postcard variant created.", true);
    postcardForm.reset();
    await loadAll();
  } catch (error) {
    setStatus(postcardStatusEl, error.message, false);
  }
});

refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Refreshing...";
  try {
    await loadAll();
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Refresh Data";
  }
});

loadAll().catch((error) => {
  alert(error.message);
});
