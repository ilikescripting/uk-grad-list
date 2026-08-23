require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const { ensureSchema, getJobs, getStats, getCategories } = require("./db");
const { runIngest } = require("./ingest");
const { startScheduler } = require("./scheduler");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.static(path.join(__dirname, "..", "public")));

// ---------- GET /api/jobs ----------
// Query params: title, company, location, work_model, category, categories
//               (comma list), job_type (comma list), salary_min, page,
//               page_size, sort ('newest' | 'salary_desc')
app.get("/api/jobs", async (req, res) => {
  try {
    const {
      title = "",
      company = "",
      location = "",
      work_model = "",
      category = "",
      categories = "",
      job_type = "",
      salary_min = "",
      page = "1",
      page_size = "50",
      sort = "newest",
    } = req.query;

    const result = await getJobs({
      title,
      company,
      location,
      work_model,
      category,
      categories: categories ? categories.split(",").map((c) => c.trim()).filter(Boolean) : [],
      job_type: job_type ? job_type.split(",").map((t) => t.trim()).filter(Boolean) : [],
      salary_min,
      page: parseInt(page, 10) || 1,
      page_size: parseInt(page_size, 10) || 50,
      sort,
    });

    res.json(result);
  } catch (err) {
    console.error("[api] /api/jobs failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// ---------- GET /api/stats ----------
app.get("/api/stats", async (req, res) => {
  try {
    res.json(await getStats());
  } catch (err) {
    console.error("[api] /api/stats failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// ---------- GET /api/categories ----------
app.get("/api/categories", async (req, res) => {
  try {
    res.json(await getCategories());
  } catch (err) {
    console.error("[api] /api/categories failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

// ---------- POST /api/ingest ----------
// Triggers a fresh pull immediately. Meant to be called by the GitHub
// Actions workflow on an hourly schedule (see .github/workflows), so this
// works even when the host's own cron would be unreliable (e.g. a free
// instance that's asleep). Requires INGEST_SECRET to be set on the server
// and passed back as the x-ingest-secret header - without that, this route
// refuses to run so randoms can't hammer your Adzuna/Reed quota.
app.post("/api/ingest", async (req, res) => {
  const secret = process.env.INGEST_SECRET;
  if (!secret) {
    return res.status(503).json({ error: "INGEST_SECRET is not configured on this server" });
  }
  if (req.get("x-ingest-secret") !== secret) {
    return res.status(401).json({ error: "unauthorized" });
  }

  try {
    await runIngest();
    res.json({ ok: true });
  } catch (err) {
    console.error("[api] /api/ingest failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

async function main() {
  await ensureSchema();

  app.listen(PORT, () => {
    console.log(`UK Grad List running at http://localhost:${PORT}`);

    // Fire-and-forget: populate the DB on boot without blocking the server
    // from answering requests while that first pull is in flight.
    runIngest();

    if (process.env.ENABLE_INTERNAL_CRON !== "false") {
      startScheduler();
    } else {
      console.log(
        "[scheduler] internal cron disabled (ENABLE_INTERNAL_CRON=false) - " +
          "relying on an external trigger (e.g. the GitHub Actions workflow) to hit /api/ingest"
      );
    }
  });
}

main().catch((err) => {
  console.error("[server] fatal startup error:", err);
  process.exit(1);
});
