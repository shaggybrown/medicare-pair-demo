const finderForm = document.getElementById("finderForm");
const recommendationEl = document.getElementById("recommendation");
const fitMeterEl = document.getElementById("fitMeter");
const chipsEl = document.getElementById("chips");
const optionRowsEl = document.getElementById("optionRows");
const annualCostStatEl = document.getElementById("annualCostStat");
const confidenceStatEl = document.getElementById("confidenceStat");
const readinessStatEl = document.getElementById("readinessStat");
const timelineEl = document.getElementById("timeline");
const seminarForm = document.getElementById("seminarForm");
const seminarStatusEl = document.getElementById("seminarStatus");
const consultForm = document.getElementById("consultForm");
const consultStatusEl = document.getElementById("consultStatus");
const seatsLeftEl = document.getElementById("seatsLeft");
const countdownEl = document.getElementById("countdown");
const glossaryListEl = document.getElementById("glossaryList");
const seminarEventEl = document.getElementById("seminarEvent");
const eventSummaryEl = document.getElementById("eventSummary");
const sourceBannerEl = document.getElementById("sourceBanner");
const teamPhotoEl = document.getElementById("teamPhoto");

const state = {
  events: [],
  selectedEventId: "",
};

const glossaryItems = [
  {
    term: "Original Medicare",
    text: "Federal Medicare coverage through Part A and Part B. Many people add a Part D drug plan and a Medicare Supplement.",
  },
  {
    term: "Medicare Advantage",
    text: "An alternative to Original Medicare offered by private plans with network rules and annual out-of-pocket limits.",
  },
  {
    term: "Part D",
    text: "Prescription drug coverage. Enrolling late can lead to penalties if you did not have creditable coverage.",
  },
  {
    term: "Initial Enrollment Period",
    text: "A 7-month window around your 65th birthday month. This is when many people first enroll to avoid penalties.",
  },
  {
    term: "Medicare Supplement (Medigap)",
    text: "Private coverage that helps pay costs not fully covered by Original Medicare.",
  },
];

function toCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function addMonths(date, months) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function fmtDate(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getAttribution() {
  const params = new URLSearchParams(window.location.search);
  return {
    source: params.get("src") || "website",
    campaignCode: (params.get("campaign") || "").toUpperCase(),
    variant: (params.get("variant") || "").toUpperCase(),
  };
}

function renderSourceBanner() {
  const attribution = getAttribution();
  if (attribution.source !== "postcard" || !attribution.campaignCode) return;
  sourceBannerEl.classList.remove("hidden");
  sourceBannerEl.innerHTML = `Welcome from postcard campaign <strong>${attribution.campaignCode}-${attribution.variant || "A"}</strong>. Reserve your seminar seat or consultation below.`;
}

function calcCosts(inputs) {
  const medigapBase = 170 + Math.max(0, (inputs.age - 65) * 3);
  const partD = 35 + inputs.prescriptions * 4;
  const originalAnnual = Math.round((medigapBase + partD + 185) * 12);

  const advantagePremium = inputs.budget === "low" ? 12 : inputs.budget === "medium" ? 38 : 70;
  const drugSpend = 17 * inputs.prescriptions;
  const riskSpend = inputs.doctorPriority === "high" ? 3200 : inputs.doctorPriority === "medium" ? 2600 : 2100;
  const advantageAnnual = Math.round((advantagePremium + drugSpend) * 12 + riskSpend);

  return {
    originalAnnual,
    advantageAnnual,
    originalMonthly: Math.round(originalAnnual / 12),
    advantageMonthly: Math.round(advantageAnnual / 12),
  };
}

function buildRecommendation(inputs) {
  let originalScore = 0;
  let advantageScore = 0;

  if (inputs.doctorPriority === "high") originalScore += 3;
  if (inputs.doctorPriority === "medium") {
    originalScore += 1;
    advantageScore += 1;
  }
  if (inputs.doctorPriority === "low") advantageScore += 2;

  if (inputs.budget === "low") advantageScore += 3;
  if (inputs.budget === "medium") {
    originalScore += 1;
    advantageScore += 1;
  }
  if (inputs.budget === "high") originalScore += 2;

  if (inputs.prescriptions >= 5) originalScore += 2;
  if (inputs.prescriptions <= 2) advantageScore += 1;

  if (inputs.travel === "yes") originalScore += 2;
  if (inputs.travel === "no") advantageScore += 1;

  const costs = calcCosts(inputs);
  const rec = originalScore >= advantageScore ? "Original Medicare + Supplement" : "Medicare Advantage";
  const confidence = Math.min(96, 55 + Math.abs(originalScore - advantageScore) * 7);
  const annualCost = rec === "Original Medicare + Supplement" ? costs.originalAnnual : costs.advantageAnnual;

  recommendationEl.innerHTML = `<strong>${rec}</strong> is likely your best starting path. Book a consultation so Joe or MaryBeth can confirm county-specific plan details.`;
  fitMeterEl.style.width = `${confidence}%`;
  annualCostStatEl.textContent = toCurrency(annualCost);
  confidenceStatEl.textContent = `${confidence}%`;

  chipsEl.innerHTML = [
    `Age ${inputs.age}`,
    `${inputs.prescriptions} prescriptions`,
    `Doctor priority: ${inputs.doctorPriority}`,
    inputs.travel === "yes" ? "Travels often" : "Mostly local care",
  ]
    .map((chip) => `<span class="chip">${chip}</span>`)
    .join("");

  optionRowsEl.innerHTML = `
    <tr>
      <td>Original Medicare + Supplement + Part D</td>
      <td>${toCurrency(costs.originalMonthly)}</td>
      <td>High flexibility</td>
      <td>Lower surprise costs</td>
    </tr>
    <tr>
      <td>Medicare Advantage</td>
      <td>${toCurrency(costs.advantageMonthly)}</td>
      <td>Network-based</td>
      <td>Can be higher in heavy-use years</td>
    </tr>
  `;
}

function renderTimeline(birthDateInput) {
  const birthDate = new Date(`${birthDateInput}T12:00:00`);
  if (Number.isNaN(birthDate.getTime())) {
    timelineEl.innerHTML = "<p>Add your birth date to calculate your Medicare enrollment window.</p>";
    return;
  }

  const sixtyFifth = new Date(birthDate);
  sixtyFifth.setFullYear(birthDate.getFullYear() + 65);
  const iepStart = startOfMonth(addMonths(sixtyFifth, -3));
  const iepEnd = endOfMonth(addMonths(sixtyFifth, 3));

  timelineEl.innerHTML = `
    <article class="timeline-item">
      <h4>Initial Enrollment Opens</h4>
      <p>${fmtDate(iepStart)} (3 months before your 65th birthday month)</p>
    </article>
    <article class="timeline-item">
      <h4>Your 65th Birthday Month</h4>
      <p>${sixtyFifth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</p>
    </article>
    <article class="timeline-item">
      <h4>Initial Enrollment Closes</h4>
      <p>${fmtDate(iepEnd)} (3 months after your 65th birthday month)</p>
    </article>
    <article class="timeline-item">
      <h4>Annual Enrollment Period</h4>
      <p>October 15 - December 7 each year</p>
    </article>
  `;
}

function updateActionProgress() {
  const score =
    Number(localStorage.getItem("finderUsed") === "yes") +
    Number(localStorage.getItem("consultSubmitted") === "yes") +
    Number(localStorage.getItem("seminarSubmitted") === "yes");
  readinessStatEl.textContent = `${Math.round((score / 3) * 100)}%`;
}

function renderGlossary() {
  glossaryListEl.innerHTML = glossaryItems
    .map(
      (item) => `
      <details>
        <summary>${item.term}</summary>
        <p>${item.text}</p>
      </details>
    `
    )
    .join("");
}

function setupRevealAnimations() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
}

function initBirthDate() {
  const today = new Date();
  const defaultBirth = new Date(today.getFullYear() - 67, today.getMonth(), 15);
  document.getElementById("birthDate").value = defaultBirth.toISOString().split("T")[0];
}

function updateSeminarDetails() {
  const event = state.events.find((item) => item.id === seminarEventEl.value);
  if (!event) {
    eventSummaryEl.textContent = "No open events";
    seatsLeftEl.textContent = "0";
    countdownEl.textContent = "--";
    return;
  }

  state.selectedEventId = event.id;
  eventSummaryEl.textContent = `${event.title} | ${new Date(event.date).toLocaleString()} | ${event.location}`;
  seatsLeftEl.textContent = String(event.seatsAvailable ?? Math.max(0, event.seatsTotal - event.seatsBooked));

  const diff = Date.parse(event.date) - Date.now();
  if (diff <= 0) {
    countdownEl.textContent = "Starting soon";
    return;
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diff / (1000 * 60)) % 60);
  countdownEl.textContent = `${days}d ${hours}h ${mins}m`;
}

async function loadEvents() {
  try {
    const response = await fetch("api/admin/events");
    if (!response.ok) throw new Error("failed to load events");

    const data = await response.json();
    state.events = (data.items || [])
      .filter((item) => item.status === "OPEN")
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

    seminarEventEl.innerHTML = state.events
      .map((event) => {
        const label = `${event.title} - ${new Date(event.date).toLocaleString()} (${event.location})`;
        return `<option value="${event.id}">${label}</option>`;
      })
      .join("");

    if (!state.events.length) {
      seminarEventEl.innerHTML = "<option value=''>No open events</option>";
      seminarEventEl.disabled = true;
    }

    updateSeminarDetails();
  } catch {
    eventSummaryEl.textContent = "Could not load seminar events right now.";
  }
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

finderForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const inputs = {
    age: Number(document.getElementById("age").value || 67),
    doctorPriority: document.getElementById("doctorPriority").value,
    prescriptions: Number(document.getElementById("prescriptions").value || 0),
    budget: document.getElementById("budget").value,
    travel: document.getElementById("travel").value,
    birthDate: document.getElementById("birthDate").value,
  };

  buildRecommendation(inputs);
  renderTimeline(inputs.birthDate);
  localStorage.setItem("finderUsed", "yes");
  updateActionProgress();
});

seminarEventEl.addEventListener("change", updateSeminarDetails);

seminarForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("seminarName").value.trim();
  const phone = document.getElementById("seminarPhone").value.trim();

  if (!state.selectedEventId) {
    seminarStatusEl.style.color = "#a0392d";
    seminarStatusEl.textContent = "Please choose an available event.";
    return;
  }

  try {
    const attribution = getAttribution();
    const payload = {
      name,
      phone,
      eventId: state.selectedEventId,
      source: attribution.source,
      campaignCode: attribution.campaignCode,
      variant: attribution.variant,
    };

    const result = await postJson("api/public/seminar-signups", payload);
    seminarStatusEl.style.color = "#1e8e5a";
    seminarStatusEl.textContent = `${name}, your seminar seat is reserved. We will call ${phone} to confirm details.`;

    localStorage.setItem("seminarSubmitted", "yes");
    updateActionProgress();

    const target = state.events.find((item) => item.id === state.selectedEventId);
    if (target && result.event) {
      target.seatsAvailable = result.event.seatsAvailable;
      target.seatsBooked = result.event.seatsBooked;
      updateSeminarDetails();
    }

    seminarForm.reset();
  } catch (error) {
    seminarStatusEl.style.color = "#a0392d";
    seminarStatusEl.textContent = error.message;
  }
});

consultForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = document.getElementById("consultName").value.trim();
  const phone = document.getElementById("consultPhone").value.trim();
  const zip = document.getElementById("consultZip").value.trim();
  const timePreference = document.getElementById("consultTime").value;
  const need = document.getElementById("consultNeed").value;

  try {
    const attribution = getAttribution();
    await postJson("api/public/consultations", {
      name,
      phone,
      zip,
      timePreference,
      need,
      source: attribution.source,
      campaignCode: attribution.campaignCode,
      variant: attribution.variant,
    });

    consultStatusEl.style.color = "#1e8e5a";
    consultStatusEl.textContent = `Thank you, ${name}. Joe or MaryBeth will call ${phone} (${timePreference}) within 1 business day.`;

    localStorage.setItem("consultSubmitted", "yes");
    updateActionProgress();
    consultForm.reset();
  } catch (error) {
    consultStatusEl.style.color = "#a0392d";
    consultStatusEl.textContent = error.message;
  }
});

teamPhotoEl.addEventListener("error", () => {
  teamPhotoEl.src =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='560'%3E%3Crect width='100%25' height='100%25' fill='%23dbe8f5'/%3E%3Ctext x='50%25' y='48%25' text-anchor='middle' font-size='30' font-family='Arial' fill='%23345674'%3EAdd image at /assets/joe-marybeth.png%3C/text%3E%3C/svg%3E";
});

initBirthDate();
renderGlossary();
setupRevealAnimations();
renderSourceBanner();
updateActionProgress();
finderForm.requestSubmit();
loadEvents();
setInterval(updateSeminarDetails, 60000);
