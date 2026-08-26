require("dotenv").config();
const fetch = require("node-fetch");
const { upsertJobs, startIngestRun, finishIngestRun, countJobs, ensureSchema } = require("./db");
const { GREENHOUSE_BOARDS, LEVER_BOARDS, ASHBY_BOARDS } = require("./companies");

const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;
const REED_API_KEY = process.env.REED_API_KEY;

// ---------- entry-level classification ----------

const SENIOR_EXCLUDE = /\b(senior|sr\.?|lead|principal|staff|head of|director|vp|chief|manager\b(?!.*trainee)|iii|iv\b|v\b|expert|architect(?!\s*(intern|graduate))|10\+? ?years|5\+? ?years|experienced professional)\b/i;

const ENTRY_INCLUDE = /\b(intern(ship)?|graduate|grad scheme|graduate scheme|entry.?level|junior|trainee|apprentice(ship)?|placement|early career|new grad|year in industry|industrial placement|undergraduate)\b/i;

function isEntryLevel(title, description) {
  const text = `${title} ${description || ""}`;
  if (SENIOR_EXCLUDE.test(title)) return false; // be strict on title
  if (ENTRY_INCLUDE.test(text)) return true;
  return false;
}

// ---------- category classification ----------
// Tech roles get split into narrower categories (rather than one catch-all
// "Software Engineering" bucket) since that's the main thing this build is
// tuned for. Order matters - most specific match wins, so check narrow tech
// categories before the generic ones below them.

const CATEGORY_RULES = [
  // --- tech, split out for anyone filtering specifically on these ---
  ["Data Engineering", /data engineer|etl|data pipeline|analytics engineer/i],
  ["Machine Learning and AI", /machine learning|\bai\b|artificial intelligence|deep learning|\bnlp\b|data scientist|\bml\b engineer/i],
  ["Data Analysis", /data analy|business intelligence|\bbi\b analyst|data insight/i],
  ["Cybersecurity", /cyber ?security|infosec|penetration test|security analyst|soc analyst|application security/i],
  ["DevOps and Cloud", /devops|site reliability|\bsre\b|platform engineer|cloud engineer|infrastructure engineer/i],
  ["QA and Test Engineering", /\bqa\b engineer|quality assurance|test engineer|sdet/i],
  ["Mobile Engineering", /\bios\b (developer|engineer)|android (developer|engineer)|mobile (developer|engineer)|react native|flutter/i],
  ["Frontend Engineering", /front.?end (developer|engineer)|\breact\b developer|ui engineer/i],
  ["Backend Engineering", /back.?end (developer|engineer)|\bapi\b engineer|server.?side developer/i],
  ["Software Engineering", /software|full.?stack|web developer|\.net|java(?!script)?\b|python developer|c\+\+|golang|\bgo\b developer/i],
  // --- non-tech categories ---
  ["Product Management", /product manage|product owner/i],
  ["Business Analyst", /business analyst/i],
  ["Accounting and Finance", /account(ant|ing)|finance|financial analyst|audit|actuari|investment bank|treasury/i],
  ["Consulting", /consult(ant|ing)/i],
  ["Marketing", /marketing|brand|social media|seo|content creator/i],
  ["Creatives and Design", /designer|\bux\b|\bui\b|graphic design|creative/i],
  ["Human Resources", /human resources|\bhr\b|recruit(ment|er)|people (team|partner)/i],
  ["Legal and Compliance", /legal|paralegal|compliance|solicitor/i],
  ["Public Sector and Government", /civil service|government|public sector|council\b/i],
  ["Management and Executive", /management trainee|leadership programme|graduate scheme(?!.*(engineer|develop))/i],
  ["Arts and Entertainment", /media|broadcast|journalis|arts|entertainment|film|music industry/i],
  ["Sales", /\bsales\b|business development/i],
  ["Customer Service and Support", /customer (service|support)|client support/i],
  ["Education and Training", /teaching|education|tutor|trainer\b/i],
  ["Healthcare", /clinical|nhs|healthcare|pharma|nursing/i],
  ["Supply Chain", /supply chain|logistics|procurement|operations analyst/i],
  ["Engineering and Development", /engineer(?!ing and development)/i],
];

// Used for the "Tech roles" quick filter in the UI - any category in this
// set counts as "tech" for that toggle.
const TECH_CATEGORIES = new Set([
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
]);

function categorize(title, description) {
  const text = `${title} ${description || ""}`;
  for (const [cat, re] of CATEGORY_RULES) {
    if (re.test(text)) return cat;
  }
  return "Engineering and Development";
}

function detectWorkModel(text) {
  if (!text) return null;
  if (/\bremote\b/i.test(text)) return "Remote";
  if (/\bhybrid\b/i.test(text)) return "Hybrid";
  if (/\bon.?site\b|\boffice.based\b/i.test(text)) return "On Site";
  return null;
}

// ---------- internship vs. graduate-job classification ----------

const INTERNSHIP_PATTERN = /\b(intern(ship)?|placement|industrial placement|year in industry|summer intern|work experience)\b/i;

function classifyJobType(title, description) {
  const text = `${title} ${description || ""}`;
  if (INTERNSHIP_PATTERN.test(text)) return "Internship";
  return "Graduate Job";
}

// ---------- tech stack tagging (only meaningful for tech categories, but
// harmless to run on everything - returns "" for non-tech listings) ----------

const TECH_STACK_KEYWORDS = [
  "React", "Angular", "Vue", "TypeScript", "JavaScript", "Node.js", "Python",
  "Java", "C++", "C#", "Go", "Rust", "Ruby", "PHP", "Swift", "Kotlin",
  "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "GraphQL",
  "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform",
  "Django", "Flask", "Spring", ".NET", "Next.js",
  "TensorFlow", "PyTorch", "Spark", "Kafka",
];

function extractTechStack(title, description) {
  const text = `${title} ${description || ""}`;
  const found = new Set();
  for (const kw of TECH_STACK_KEYWORDS) {
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) found.add(kw);
  }
  return [...found].join(", ");
}

// ---------- Adzuna ----------
// Docs: https://developer.adzuna.com/docs/search
// Free tier covers "gb" (United Kingdom). Aggregates Indeed/Reed/Totaljobs/etc listings.

async function fetchAdzuna() {
  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
    console.warn("[adzuna] Skipped: ADZUNA_APP_ID / ADZUNA_APP_KEY not set in .env");
    return [];
  }

  const queries = [
    "graduate", "internship", "placement year", "junior",
    // extra tech-specific terms so software/tech roles surface even when
    // the generic queries above miss them
    "graduate software engineer", "software engineer intern", "junior developer",
  ];
  const results = [];

  for (const q of queries) {
    for (let page = 1; page <= 2; page++) {
      const url = new URL(`https://api.adzuna.com/v1/api/jobs/gb/search/${page}`);
      url.searchParams.set("app_id", ADZUNA_APP_ID);
      url.searchParams.set("app_key", ADZUNA_APP_KEY);
      url.searchParams.set("results_per_page", "50");
      url.searchParams.set("what", q);
      url.searchParams.set("sort_by", "date");
      url.searchParams.set("content-type", "application/json");

      try {
        const res = await fetch(url.toString());
        if (!res.ok) {
          console.warn(`[adzuna] ${q} page ${page} -> HTTP ${res.status}`);
          continue;
        }
        const json = await res.json();
        for (const r of json.results || []) {
          results.push(r);
        }
      } catch (err) {
        console.warn(`[adzuna] fetch failed for "${q}" page ${page}:`, err.message);
      }
    }
  }
  return results;
}

function normalizeAdzuna(raw) {
  const title = raw.title || "";
  const description = raw.description || "";
  if (!isEntryLevel(title, description)) return null;

  return {
    id: `adzuna:${raw.id}`,
    source: "adzuna",
    source_id: String(raw.id),
    title,
    company: raw.company?.display_name || null,
    location: raw.location?.display_name || null,
    work_model: detectWorkModel(`${title} ${description}`),
    job_type: classifyJobType(title, description),
    category: categorize(title, description),
    tech_stack: extractTechStack(title, description),
    salary_min: raw.salary_min || null,
    salary_max: raw.salary_max || null,
    salary_text:
      raw.salary_min && raw.salary_max
        ? `£${Math.round(raw.salary_min).toLocaleString()}-£${Math.round(raw.salary_max).toLocaleString()}`
        : null,
    url: raw.redirect_url || null,
    description,
    posted_at: raw.created || null,
  };
}

// ---------- Reed ----------
// Docs: https://www.reed.co.uk/developers/jobseeker
// API key goes in the username slot of HTTP Basic Auth, password left blank.

async function fetchReed() {
  if (!REED_API_KEY) {
    console.warn("[reed] Skipped: REED_API_KEY not set in .env");
    return [];
  }

  const auth = "Basic " + Buffer.from(`${REED_API_KEY}:`).toString("base64");
  const queries = [
    "graduate", "intern", "placement", "junior",
    "graduate software engineer", "software engineer intern", "junior developer",
  ];
  const results = [];

  for (const q of queries) {
    const url = new URL("https://www.reed.co.uk/api/1.0/search");
    url.searchParams.set("keywords", q);
    url.searchParams.set("resultsToTake", "100");

    try {
      const res = await fetch(url.toString(), { headers: { Authorization: auth } });
      if (!res.ok) {
        console.warn(`[reed] ${q} -> HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      for (const r of json.results || []) {
        results.push(r);
      }
    } catch (err) {
      console.warn(`[reed] fetch failed for "${q}":`, err.message);
    }
  }
  return results;
}

function normalizeReed(raw) {
  const title = raw.jobTitle || "";
  const description = raw.jobDescription || "";
  if (!isEntryLevel(title, description)) return null;

  return {
    id: `reed:${raw.jobId}`,
    source: "reed",
    source_id: String(raw.jobId),
    title,
    company: raw.employerName || null,
    location: raw.locationName || null,
    work_model: detectWorkModel(`${title} ${description}`),
    job_type: classifyJobType(title, description),
    category: categorize(title, description),
    tech_stack: extractTechStack(title, description),
    salary_min: raw.minimumSalary || null,
    salary_max: raw.maximumSalary || null,
    salary_text:
      raw.minimumSalary && raw.maximumSalary
        ? `£${Math.round(raw.minimumSalary).toLocaleString()}-£${Math.round(raw.maximumSalary).toLocaleString()}`
        : null,
    url: raw.jobUrl || null,
    description,
    posted_at: raw.date || null,
  };
}

// ---------- Greenhouse (per-company career boards) ----------
// Docs: https://developers.greenhouse.io/job-board.html
// Public, unauthenticated, ToS-friendly - this is Greenhouse's own documented
// job board API, not a scrape. One request per company in GREENHOUSE_BOARDS.

async function fetchGreenhouse() {
  const results = [];
  for (const board of GREENHOUSE_BOARDS) {
    const url = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[greenhouse] ${board} -> HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      for (const job of json.jobs || []) {
        results.push({ ...job, _board: board });
      }
    } catch (err) {
      console.warn(`[greenhouse] fetch failed for "${board}":`, err.message);
    }
  }
  return results;
}

function stripHtml(html) {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeGreenhouse(raw) {
  const title = raw.title || "";
  const description = stripHtml(raw.content);
  if (!isEntryLevel(title, description)) return null;

  const location = raw.location?.name || null;
  // UK-only filter: Greenhouse boards are often global, so keep roles that
  // look UK-based (or remote with no location tag). Loosen/remove this if
  // you add a company that's UK-only anyway.
  if (location && !/united kingdom|\buk\b|london|manchester|edinburgh|bristol|leeds|birmingham|remote/i.test(location)) {
    return null;
  }

  return {
    id: `greenhouse:${raw.id}`,
    source: "greenhouse",
    source_id: String(raw.id),
    title,
    company: raw._board,
    location,
    work_model: detectWorkModel(`${title} ${location} ${description}`),
    job_type: classifyJobType(title, description),
    category: categorize(title, description),
    tech_stack: extractTechStack(title, description),
    salary_min: null,
    salary_max: null,
    salary_text: null, // Greenhouse's public API rarely exposes pay data
    url: raw.absolute_url || null,
    description,
    posted_at: raw.updated_at || raw.first_published || null,
  };
}

// ---------- Lever (per-company career boards) ----------
// Docs: https://github.com/lever/postings-api - Lever's own documented,
// public postings API. Again: not a scrape.

async function fetchLever() {
  const results = [];
  for (const board of LEVER_BOARDS) {
    const url = `https://api.lever.co/v0/postings/${board}?mode=json`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[lever] ${board} -> HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      for (const job of json || []) {
        results.push({ ...job, _board: board });
      }
    } catch (err) {
      console.warn(`[lever] fetch failed for "${board}":`, err.message);
    }
  }
  return results;
}

function normalizeLever(raw) {
  const title = raw.text || "";
  const description = stripHtml(raw.descriptionPlain || raw.description);
  if (!isEntryLevel(title, description)) return null;

  const location = raw.categories?.location || null;
  if (location && !/united kingdom|\buk\b|london|manchester|edinburgh|bristol|leeds|birmingham|remote/i.test(location)) {
    return null;
  }

  return {
    id: `lever:${raw.id}`,
    source: "lever",
    source_id: String(raw.id),
    title,
    company: raw._board,
    location,
    work_model: detectWorkModel(`${title} ${location} ${description}`),
    job_type: classifyJobType(title, description),
    category: categorize(title, description),
    tech_stack: extractTechStack(title, description),
    salary_min: raw.salaryRange?.min || null,
    salary_max: raw.salaryRange?.max || null,
    salary_text:
      raw.salaryRange?.min && raw.salaryRange?.max
        ? `£${Math.round(raw.salaryRange.min).toLocaleString()}-£${Math.round(raw.salaryRange.max).toLocaleString()}`
        : null,
    url: raw.hostedUrl || null,
    description,
    posted_at: raw.createdAt ? new Date(raw.createdAt).toISOString() : null,
  };
}

// ---------- Ashby (per-company career boards) ----------
// Docs: https://developers.ashbyhq.com/docs/public-job-posting-api
// Public, unauthenticated posting API - covers companies like Deliveroo that
// don't use Greenhouse or Lever.

async function fetchAshby() {
  const results = [];
  for (const board of ASHBY_BOARDS) {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[ashby] ${board} -> HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      for (const job of json.jobs || []) {
        results.push({ ...job, _board: board });
      }
    } catch (err) {
      console.warn(`[ashby] fetch failed for "${board}":`, err.message);
    }
  }
  return results;
}

function normalizeAshby(raw) {
  const title = raw.title || "";
  const description = stripHtml(raw.descriptionPlain || raw.description);
  if (!isEntryLevel(title, description)) return null;

  const locations = [raw.location, ...(raw.secondaryLocations || []).map((l) => l.location)]
    .filter(Boolean)
    .join("; ");
  if (locations && !/united kingdom|\buk\b|london|manchester|edinburgh|bristol|leeds|birmingham|remote/i.test(locations)) {
    return null;
  }

  const comp = raw.compensation?.summaryComponents?.[0];

  return {
    id: `ashby:${raw.id}`,
    source: "ashby",
    source_id: String(raw.id),
    title,
    company: raw._board,
    location: locations || null,
    work_model: raw.isRemote ? "Remote" : detectWorkModel(`${title} ${locations} ${description}`),
    job_type: classifyJobType(title, description),
    category: categorize(title, description),
    tech_stack: extractTechStack(title, description),
    salary_min: comp?.minValue || null,
    salary_max: comp?.maxValue || null,
    salary_text:
      comp?.minValue && comp?.maxValue
        ? `£${Math.round(comp.minValue).toLocaleString()}-£${Math.round(comp.maxValue).toLocaleString()}`
        : null,
    url: raw.jobUrl || raw.applyUrl || null,
    description,
    posted_at: raw.publishedAt || null,
  };
}

// ---------- run ----------

async function runIngest() {
  await ensureSchema();
  const runId = await startIngestRun();
  try {
    const [adzunaRaw, reedRaw, greenhouseRaw, leverRaw, ashbyRaw] = await Promise.all([
      fetchAdzuna(),
      fetchReed(),
      fetchGreenhouse(),
      fetchLever(),
      fetchAshby(),
    ]);

    const normalized = [
      ...adzunaRaw.map(normalizeAdzuna),
      ...reedRaw.map(normalizeReed),
      ...greenhouseRaw.map(normalizeGreenhouse),
      ...leverRaw.map(normalizeLever),
      ...ashbyRaw.map(normalizeAshby),
    ].filter(Boolean);

    // de-dupe within this batch by id
    const byId = new Map();
    for (const j of normalized) byId.set(j.id, j);
    const jobs = [...byId.values()];

    const newCount = await upsertJobs(jobs);
    const total = await countJobs();

    await finishIngestRun(runId, { newJobs: newCount, totalJobs: total, status: "ok" });
    console.log(
      `[ingest] done: ${jobs.length} entry-level jobs processed, ${newCount} new, ${total} total in DB`
    );
  } catch (err) {
    await finishIngestRun(runId, { newJobs: 0, totalJobs: 0, status: "error", error: err.message });
    console.error("[ingest] failed:", err);
  }
}

if (require.main === module) {
  runIngest().then(() => process.exit(0));
}

module.exports = {
  runIngest,
  // exported mainly so they're unit-testable in isolation (see test/) -
  // these are pure functions with no network/DB calls, so no mocking needed
  isEntryLevel,
  categorize,
  classifyJobType,
  extractTechStack,
  detectWorkModel,
};
