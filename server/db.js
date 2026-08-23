const { createClient } = require("@libsql/client");

// TURSO_DATABASE_URL unset -> falls back to a local file, so `npm start`
// still works with zero setup for local development. Set TURSO_DATABASE_URL
// (+ TURSO_AUTH_TOKEN) to point this at a free hosted Turso database instead,
// which is what makes the data survive restarts/redeploys on a free host.
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:./data.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function ensureSchema() {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS jobs (
        id            TEXT PRIMARY KEY,   -- "source:source_id"
        source        TEXT NOT NULL,      -- 'adzuna' | 'reed' | 'greenhouse' | 'lever' | 'ashby'
        source_id     TEXT NOT NULL,
        title         TEXT NOT NULL,
        company       TEXT,
        location      TEXT,
        work_model    TEXT,               -- 'Remote' | 'Hybrid' | 'On Site' | NULL
        job_type      TEXT,               -- 'Internship' | 'Graduate Job'
        category      TEXT,
        tech_stack    TEXT,
        salary_min    REAL,
        salary_max    REAL,
        salary_text   TEXT,
        url           TEXT,
        description   TEXT,
        posted_at     TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at  TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_jobs_title    ON jobs(title)`,
      `CREATE INDEX IF NOT EXISTS idx_jobs_company  ON jobs(company)`,
      `CREATE INDEX IF NOT EXISTS idx_jobs_location ON jobs(location)`,
      `CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category)`,
      `CREATE INDEX IF NOT EXISTS idx_jobs_posted   ON jobs(posted_at)`,
      `CREATE INDEX IF NOT EXISTS idx_jobs_job_type ON jobs(job_type)`,
      `CREATE TABLE IF NOT EXISTS ingest_runs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at  TEXT NOT NULL,
        finished_at TEXT,
        new_jobs    INTEGER DEFAULT 0,
        total_jobs  INTEGER DEFAULT 0,
        status      TEXT DEFAULT 'running',
        error       TEXT
      )`,
    ],
    "write"
  );
}

const UPSERT_SQL = `
INSERT INTO jobs (
  id, source, source_id, title, company, location, work_model, job_type,
  category, tech_stack, salary_min, salary_max, salary_text, url,
  description, posted_at, first_seen_at, last_seen_at
) VALUES (
  :id, :source, :source_id, :title, :company, :location, :work_model, :job_type,
  :category, :tech_stack, :salary_min, :salary_max, :salary_text, :url,
  :description, :posted_at, :now, :now
)
ON CONFLICT(id) DO UPDATE SET
  title        = excluded.title,
  company      = excluded.company,
  location     = excluded.location,
  work_model   = excluded.work_model,
  job_type     = excluded.job_type,
  category     = excluded.category,
  tech_stack   = excluded.tech_stack,
  salary_min   = excluded.salary_min,
  salary_max   = excluded.salary_max,
  salary_text  = excluded.salary_text,
  url          = excluded.url,
  description  = excluded.description,
  posted_at    = excluded.posted_at,
  last_seen_at = excluded.last_seen_at
`;

async function upsertJobs(jobs) {
  if (!jobs.length) return 0;
  const now = new Date().toISOString();

  // Work out how many of these are genuinely new before the upsert batch,
  // since an upsert transaction doesn't tell you that on its own.
  const idArgs = {};
  const idPlaceholders = jobs.map((j, i) => {
    idArgs[`id${i}`] = j.id;
    return `:id${i}`;
  });
  const existingRs = await client.execute({
    sql: `SELECT id FROM jobs WHERE id IN (${idPlaceholders.join(", ")})`,
    args: idArgs,
  });
  const existingIds = new Set(existingRs.rows.map((r) => r.id));
  const newCount = jobs.filter((j) => !existingIds.has(j.id)).length;

  const statements = jobs.map((j) => ({
    sql: UPSERT_SQL,
    args: { ...j, now },
  }));
  await client.batch(statements, "write");

  return newCount;
}

async function countJobs() {
  const rs = await client.execute("SELECT COUNT(*) AS c FROM jobs");
  return Number(rs.rows[0].c);
}

async function startIngestRun() {
  const now = new Date().toISOString();
  const rs = await client.execute({
    sql: "INSERT INTO ingest_runs (started_at, status) VALUES (?, 'running')",
    args: [now],
  });
  return rs.lastInsertRowid;
}

async function finishIngestRun(id, { newJobs, totalJobs, status, error }) {
  await client.execute({
    sql: `UPDATE ingest_runs SET finished_at = ?, new_jobs = ?, total_jobs = ?, status = ?, error = ? WHERE id = ?`,
    args: [new Date().toISOString(), newJobs, totalJobs, status, error || null, id],
  });
}

async function getStats() {
  const totalRs = await client.execute("SELECT COUNT(*) AS c FROM jobs");
  const total = Number(totalRs.rows[0].c);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const newTodayRs = await client.execute({
    sql: "SELECT COUNT(*) AS c FROM jobs WHERE first_seen_at >= ?",
    args: [since],
  });
  const newToday = Number(newTodayRs.rows[0].c);

  const lastRunRs = await client.execute(
    "SELECT finished_at FROM ingest_runs WHERE status = 'ok' ORDER BY id DESC LIMIT 1"
  );
  const lastUpdated = lastRunRs.rows[0]?.finished_at || null;

  return { total_openings: total, new_today: newToday, last_updated: lastUpdated };
}

async function getCategories() {
  const rs = await client.execute(
    "SELECT category, COUNT(*) AS c FROM jobs GROUP BY category ORDER BY c DESC"
  );
  return rs.rows.map((r) => ({ category: r.category, c: Number(r.c) }));
}

async function getJobs({
  title,
  company,
  location,
  work_model,
  category,
  categories, // array
  job_type, // array
  salary_min,
  page = 1,
  page_size = 50,
  sort = "newest",
}) {
  const where = [];
  const args = {};

  if (title) {
    where.push("title LIKE :title");
    args.title = `%${title}%`;
  }
  if (company) {
    where.push("company LIKE :company");
    args.company = `%${company}%`;
  }
  if (location) {
    where.push("location LIKE :location");
    args.location = `%${location}%`;
  }
  if (work_model) {
    where.push("work_model = :work_model");
    args.work_model = work_model;
  }
  if (category) {
    where.push("category = :category");
    args.category = category;
  }
  if (categories && categories.length) {
    const keys = categories.map((c, i) => {
      args[`cat${i}`] = c;
      return `:cat${i}`;
    });
    where.push(`category IN (${keys.join(", ")})`);
  }
  if (job_type && job_type.length) {
    const keys = job_type.map((t, i) => {
      args[`jt${i}`] = t;
      return `:jt${i}`;
    });
    where.push(`job_type IN (${keys.join(", ")})`);
  }
  if (salary_min) {
    where.push("salary_max >= :salary_min");
    args.salary_min = Number(salary_min);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql =
    sort === "salary_desc"
      ? "ORDER BY salary_max IS NULL, salary_max DESC"
      : "ORDER BY posted_at IS NULL, posted_at DESC, first_seen_at DESC";

  const pageNum = Math.max(1, page);
  const pageSize = Math.min(200, Math.max(1, page_size));
  const offset = (pageNum - 1) * pageSize;

  const totalRs = await client.execute({
    sql: `SELECT COUNT(*) AS c FROM jobs ${whereSql}`,
    args,
  });
  const total = Number(totalRs.rows[0].c);

  const rowsRs = await client.execute({
    sql: `SELECT id, title, company, location, work_model, job_type, category,
                 tech_stack, salary_text, url, posted_at, first_seen_at
          FROM jobs ${whereSql} ${orderSql} LIMIT :limit OFFSET :offset`,
    args: { ...args, limit: pageSize, offset },
  });

  return { results: rowsRs.rows, total, page: pageNum, page_size: pageSize };
}

module.exports = {
  ensureSchema,
  upsertJobs,
  countJobs,
  startIngestRun,
  finishIngestRun,
  getStats,
  getCategories,
  getJobs,
};
