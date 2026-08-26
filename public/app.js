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

// ---------- company logos ----------
// Best-effort only: guesses a domain from the company name and asks
// Clearbit's free logo API for it. When that 404s (guess was wrong, or the
// company just doesn't have a logo there), the onerror handler swaps in a
// plain initial-letter badge instead, so it never shows a broken image icon.

function domainGuess(company) {
  return company.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
}

function companyCellHtml(company) {
  if (!company) return escapeHtml(" - ");
  const domain = domainGuess(company);
  const initial = company.trim()[0]?.toUpperCase() || "?";
  return `
    <span class="company-cell">
      <img class="company-logo" src="https://logo.clearbit.com/${domain}" alt=""
           data-fallback-initial="${escapeHtml(initial)}" />
      <span>${escapeHtml(company)}</span>
    </span>`;
}

function wireLogoFallbacks(container) {
  container.querySelectorAll(".company-logo").forEach((img) => {
    img.addEventListener(
      "error",
      () => {
        const fallback = document.createElement("span");
        fallback.className = "logo-fallback";
        fallback.textContent = img.dataset.fallbackInitial || "?";
        img.replaceWith(fallback);
      },
      { once: true }
    );
  });
}

// ---------- loading skeleton ----------

function skeletonRowsHtml(count = 8) {
  const cellWidths = ["70%", "55%", "50%", "40%", "45%", "35%", "30%", "50%"];
  let rows = "";
  for (let i = 0; i < count; i++) {
    rows +=
      "<tr class=\"skeleton-row\">" +
      cellWidths
        .map((w) => `<td><div class="skeleton-bar" style="width:${w}"></div></td>`)
        .join("") +
      "</tr>";
  }
  return rows;
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

  const select = el("categories");

  // Clear existing options
  select.innerHTML = "";

  // All categories option
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = "All Categories";
  select.appendChild(allOption);

  // Add each category
  data.forEach(({ category, c }) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = `${category} (${c})`;
    select.appendChild(option);
  });

  // Keep dropdown synced with current state
  select.value = state.category;
}

function selectCategory(cat) {
  state.category = cat;
  state.page = 1;
  loadCategories();
  loadJobs();
}

async function loadJobs() {
  const body = el("jobs-body");
  body.innerHTML = skeletonRowsHtml();

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
        const applyBtn = job.url
          ? `<a class="apply-btn" href="${job.url}" target="_blank" rel="noopener">Apply</a>`
          : "";
        const copyBtn = job.url
          ? `<button class="copy-btn" data-url="${escapeHtml(job.url)}" title="Copy link to this listing">Copy</button>`
          : "";
        return `
        <tr>
          <td class="job-title">${escapeHtml(job.title)}${techTags}</td>
          <td class="job-company">${companyCellHtml(job.company)}</td>
          <td class="job-location">${escapeHtml(job.location || " - ")}</td>
          <td>${typeBadge}</td>
          <td>${modelBadge}</td>
          <td class="mono">${escapeHtml(job.salary_text || "N/A")}</td>
          <td class="mono">${timeAgo(job.posted_at || job.first_seen_at)}</td>
          <td class="action-cell">${applyBtn}${copyBtn}</td>
        </tr>`;
      })
      .join("");
    wireLogoFallbacks(body);
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
  el(id).addEventListener("change", () => { state.page = 1; loadJobs(); }); });
  el("categories").addEventListener("change", (e) => { selectCategory(e.target.value);
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

// Delegated so it keeps working after loadJobs() replaces the table body's
// innerHTML on every filter change/page turn.
el("jobs-body").addEventListener("click", async (e) => {
  const btn = e.target.closest(".copy-btn");
  if (!btn) return;
  const url = btn.dataset.url;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    const original = btn.textContent;
    btn.textContent = "Copied!";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove("copied");
    }, 1500);
  } catch (err) {
    console.warn("Clipboard write failed:", err);
  }
});

el("subscribe-form").addEventListener("submit", (e) => {
  e.preventDefault();
  alert("Email alerts aren't wired up yet - see the README for how to add this (e.g. with a mail provider like Resend or Postmark).");
});

// ---------- init ----------

loadStats();
loadCategories();
loadJobs();
setInterval(loadStats, 60_000);