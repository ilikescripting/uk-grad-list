const cron = require("node-cron");
const { runIngest } = require("./ingest");

function startScheduler() {
  const minutes = parseInt(process.env.INGEST_INTERVAL_MINUTES || "60", 10);

  // node-cron doesn't support "every N minutes" directly for arbitrary N > 59,
  // so for the default hourly case we use "0 * * * *"; otherwise "*/N * * * *".
  const expr = minutes >= 60 ? "0 * * * *" : `*/${minutes} * * * *`;

  cron.schedule(expr, () => {
    console.log(`[scheduler] running ingest (${new Date().toISOString()})`);
    runIngest();
  });

  console.log(`[scheduler] ingest scheduled with cron "${expr}" (~every ${minutes} min)`);
}

module.exports = { startScheduler };
