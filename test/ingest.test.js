const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isEntryLevel,
  categorize,
  classifyJobType,
  extractTechStack,
  detectWorkModel,
} = require("../server/ingest");

test("isEntryLevel accepts graduate/intern/junior titles", () => {
  assert.equal(isEntryLevel("Graduate Software Engineer", ""), true);
  assert.equal(isEntryLevel("Summer Software Engineering Intern", ""), true);
  assert.equal(isEntryLevel("Junior Data Analyst", ""), true);
  assert.equal(isEntryLevel("Industrial Placement - Data", ""), true);
});

test("isEntryLevel rejects senior/management titles even with a junior-sounding description", () => {
  assert.equal(
    isEntryLevel("Senior Software Engineer", "join our friendly, junior-supportive team"),
    false
  );
  assert.equal(isEntryLevel("Engineering Manager", ""), false);
  assert.equal(isEntryLevel("Principal Data Scientist", ""), false);
});

test("isEntryLevel rejects roles with no entry-level signal at all", () => {
  assert.equal(isEntryLevel("Software Engineer", "Build things with Python and AWS."), false);
});

test("categorize sorts tech roles into narrow sub-categories, not one bucket", () => {
  assert.equal(categorize("Graduate Frontend Developer", "React and TypeScript"), "Frontend Engineering");
  assert.equal(categorize("Machine Learning Intern", ""), "Machine Learning and AI");
  assert.equal(categorize("DevOps Graduate", ""), "DevOps and Cloud");
  assert.equal(categorize("Graduate Accountant", ""), "Accounting and Finance");
});

test("classifyJobType distinguishes internships from graduate jobs", () => {
  assert.equal(classifyJobType("Summer Internship - Software Engineering", ""), "Internship");
  assert.equal(classifyJobType("Graduate Software Engineer", ""), "Graduate Job");
  assert.equal(classifyJobType("Year in Industry Placement", ""), "Internship");
});

test("extractTechStack finds known keywords and ignores unrelated text", () => {
  const stack = extractTechStack("Graduate Engineer", "We use React, Python and AWS daily.");
  assert.ok(stack.includes("React"));
  assert.ok(stack.includes("Python"));
  assert.ok(stack.includes("AWS"));
  assert.equal(extractTechStack("Graduate Accountant", "Excel and Sage experience preferred"), "");
});

test("detectWorkModel reads Remote/Hybrid/On Site from free text", () => {
  assert.equal(detectWorkModel("Fully remote role"), "Remote");
  assert.equal(detectWorkModel("Hybrid - 2 days in office"), "Hybrid");
  assert.equal(detectWorkModel("On-site in London"), "On Site");
  assert.equal(detectWorkModel("No mention of location type"), null);
});