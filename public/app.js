const state = {
  page: 1,
  page_size: 25,
  category: "",
};

// Mirrors TECH_CATEGORIES in server/ingest.js - kept in sync manually since
// this is a static list, not worth a round trip to fetch it.
const TECH_CATEGORIES = [
  "Data Engineering",
  "Machine Learning and AI",
  "Data Analysis",
  "Cybersecurity",
  "DevOps and Cloud",
  "QA and Test Engineering",
  "Mobile Engineering",
  "Frontend Engineering",
  "Backend Engineering",
  "Software Engineering",
];

const el = (id) => document.getElementById(id);

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function timeAgo(iso) {
  if (!iso) return " - ";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return " - ";
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function buildQuery() {
  const params = new URLSearchParams();
  const title = el("f-title").value.trim();
  const company = el("f-company").value.trim();
  const location = el("f-location").value.trim();
  const workModel = el("f-work-model").value;
  const sort = el("f-sort").value;
  const techOnly = el("f-tech-only").checked;

  if (title) params.set("title", title);
  if (company) params.set("company", company);
  if (location) params.set("location", location);
  if (workModel) params.set("work_model", workModel);

  if (techOnly) {
    // Tech-only takes priority over a single category pill, since it covers
    // several categories at once.
    params.set("categories", TECH_CATEGORIES.join(","));
  } else if (state.category) {
    params.set("category", state.category);
  }

  const showInternships = el("f-type-internship").checked;
  const showGrad = el("f-type-grad").checked;
  if (showInternships && !showGrad) {
    params.set("job_type", "Internship");
  } else if (showGrad && !showInternships) {
    params.set("job_type", "Graduate Job");
  }
  // if both (or neither) are checked, omit job_type entirely -> API returns both

  if (sort) params.set("sort", sort);
  params.set("page", state.page);
  params.set("page_size", state.page_size);
  return params.toString();
}

async function loadStats() {
  const res = await fetch("/api/stats");
  const data = await res.json();
  el("stat-new").textContent = data.new_today.toLocaleString();
  el("stat-total").textContent = data.total_openings.toLocaleString();
  el("stat-updated").textContent = data.last_updated ? timeAgo(data.last_updated) : "not yet run";
}

async function loadCategories() {
  const res = await fetch("/api/categories");
  const data = await res.json();
  const wrap = el("categories");
  wrap.innerHTML = "";

  const allPill = document.createElement("button");
  allPill.className = "pill" + (state.category === "" ? " active" : "");
  allPill.textContent = "All Categories";
  allPill.onclick = () => selectCategory("");
  wrap.appendChild(allPill);

  data.forEach(({ category, c }) => {
    const pill = document.createElement("button");
    pill.className = "pill" + (state.category === category ? " active" : "");
    pill.textContent = `${category} (${c})`;
    pill.onclick = () => selectCategory(category);
    wrap.appendChild(pill);
  });
}

function selectCategory(cat) {
  state.category = cat;
  state.page = 1;
  loadCategories();
  loadJobs();
}

async function loadJobs() {
  const body = el("jobs-body");
  body.innerHTML = `<tr><td colspan="8" class="empty-row">Loading listings...</td></tr>`;

  const res = await fetch(`/api/jobs?${buildQuery()}`);
  const data = await res.json();

  if (!data.results.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty-row">No listings match those filters yet - try widening your search, or run the ingest job if the database is empty.</td></tr>`;
  } else {
    body.innerHTML = data.results
      .map((job) => {
        const modelBadge = job.work_model
          ? `<span class="badge ${job.work_model === "Remote" ? "remote" : ""}">${job.work_model}</span>`
          : " - ";
        const typeBadge = job.job_type
          ? `<span class="badge ${job.job_type === "Internship" ? "internship" : ""}">${job.job_type}</span>`
          : " - ";
        const techTags = job.tech_stack
          ? `<div class="tech-tags">${job.tech_stack
              .split(",")
              .map((t) => `<span class="tech-tag">${escapeHtml(t.trim())}</span>`)
              .join("")}</div>`
          : "";
        return `
        <tr>
          <td class="job-title">${escapeHtml(job.title)}${techTags}</td>
          <td class="job-company">${escapeHtml(job.company || " - ")}</td>
          <td class="job-location">${escapeHtml(job.location || " - ")}</td>
          <td>${typeBadge}</td>
          <td>${modelBadge}</td>
          <td class="mono">${escapeHtml(job.salary_text || "N/A")}</td>
          <td class="mono">${timeAgo(job.posted_at || job.first_seen_at)}</td>
          <td>${job.url ? `<a class="apply-btn" href="${job.url}" target="_blank" rel="noopener">Apply</a>` : ""}</td>
        </tr>`;
      })
      .join("");
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size));
  el("page-info").textContent = `Page ${data.page} of ${totalPages} · ${data.total.toLocaleString()} results`;
  el("prev-page").disabled = data.page <= 1;
  el("next-page").disabled = data.page >= totalPages;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------- wire up events ----------

["f-title", "f-company", "f-location"].forEach((id) => {
  el(id).addEventListener("input", debounce(() => { state.page = 1; loadJobs(); }, 350));
});
["f-work-model", "f-sort", "f-type-internship", "f-type-grad", "f-tech-only"].forEach((id) => {
  el(id).addEventListener("change", () => { state.page = 1; loadJobs(); });
});

el("f-clear").addEventListener("click", () => {
  el("f-title").value = "";
  el("f-company").value = "";
  el("f-location").value = "";
  el("f-work-model").value = "";
  el("f-sort").value = "newest";
  el("f-type-internship").checked = true;
  el("f-type-grad").checked = true;
  el("f-tech-only").checked = false;
  state.category = "";
  state.page = 1;
  loadCategories();
  loadJobs();
});

el("prev-page").addEventListener("click", () => { if (state.page > 1) { state.page--; loadJobs(); } });
el("next-page").addEventListener("click", () => { state.page++; loadJobs(); });

el("subscribe-form").addEventListener("submit", (e) => {
  e.preventDefault();
  alert("Email alerts aren't wired up yet - see the README for how to add this (e.g. with a mail provider like Resend or Postmark).");
});

// ---------- init ----------

loadStats();
loadCategories();
loadJobs();
setInterval(loadStats, 60_000);
