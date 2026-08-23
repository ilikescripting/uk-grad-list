// Add/remove companies here to control which employers' career pages get
// pulled in alongside Adzuna/Reed. Each entry just needs the company's
// "board token" - the slug that appears in their careers URL.
//
// HOW TO FIND A COMPANY'S TOKEN:
//   Greenhouse - go to the company's "Careers" page, click through to an
//   individual job. The URL will look like:
//     https://job-boards.greenhouse.io/<TOKEN>/jobs/1234567
//     or the older https://boards.greenhouse.io/<TOKEN>/jobs/1234567
//   Both work with the same public JSON API either way.
//
//   Lever - same idea, look for:
//     https://jobs.lever.co/<TOKEN>/<posting-id>
//     or https://jobs.eu.lever.co/<TOKEN>/<posting-id> (EU-hosted boards)
//
//   Ashby - look for:
//     https://jobs.ashbyhq.com/<TOKEN>
//
// Not every company uses Greenhouse, Lever or Ashby - plenty use Workday,
// SmartRecruiters, or a fully custom site. Those need their own connector
// (see README "If you want more coverage later" section) since their API
// shapes differ.
//
// The entries below are verified real board tokens as a starting point,
// weighted toward tech employers since that's the primary use case this
// build is tuned for. Swap in whichever UK employers you actually care
// about - the more you add, the more this replaces LinkedIn browsing.

const GREENHOUSE_BOARDS = [
  "monzo", // Monzo - fintech, posts junior/early-career engineering roles
  "rothesaylife", // Rothesay - runs an annual UK graduate programme (finance, not tech)
  "bottomlinetechnologies", // Bottomline Technologies - UK grad scheme, incl. engineering (Theale HQ)
  "blenheimchalcot", // Blenheim Chalcot - UK digital venture builder, graduate programme
  // Good next adds if you're tech-focused: "revolut", "wise", "cleo",
  // "gocardless", "improbable", "checkout" - verify each token first by
  // visiting the company's careers page and checking a live job URL.
];

const LEVER_BOARDS = [
  "palantir", // Palantir - hires SWE interns/new grads into their London office
  // Add more Lever-hosted UK/tech employers here, same pattern.
];

const ASHBY_BOARDS = [
  "deliveroo", // Deliveroo - London-based, posts SWE/data internships and grad roles
  // Add more Ashby-hosted employers here, same pattern.
];

module.exports = { GREENHOUSE_BOARDS, LEVER_BOARDS, ASHBY_BOARDS };
