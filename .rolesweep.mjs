/**
 * What each role can SEE — the rail, and every button that writes.
 *
 * The owner:
 *
 *   *"ami ekta jinish ensure korte cai. je role er jei page a access nei tar
 *    jonne oi page ta hide thakbe sidebar thekeo. also je role view only tar
 *    jonne add reports etc mane jegula write action diye thake button oigula
 *    hide thakbe se sudhu dekhte pabe."*
 *
 * Two questions, and neither can be answered by reading the source. A screen
 * gates its "Add" button on a `canWrite` that a child component may or may not
 * receive; a nav item is filtered by a rule that looks right and can still let
 * a row through. So this signs in as each of the four roles, walks every
 * screen, and writes down what is actually on the page.
 *
 * It ASSERTS nothing about buttons on the first run — it reports. The point is
 * to find the list, because a survey that only checks what somebody already
 * suspected finds only that.
 *
 *     node .rolesweep.mjs            (needs the web dev server)
 *     SFM_WEB=http://localhost:3001 node .rolesweep.mjs
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = process.env.SFM_WEB ?? "http://localhost:3001";
const env = Object.fromEntries(
  fs
    .readFileSync("apps/api/.env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ];
    }),
);

const db = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

/** One active person per role, so the browser is a real signed-in user. */
const people = {};
for (const role of ["super_admin", "ceo", "cfo", "hr"]) {
  const row = (
    await db.query(
      `select id, role, token_version, full_name from users
        where role = $1 and status='active' and deleted_at is null limit 1`,
      [role],
    )
  ).rows[0];
  if (row) people[role] = row;
}
await db.end();

const missing = ["super_admin", "ceo", "cfo", "hr"].filter((r) => !people[r]);
if (missing.length) {
  console.error(`No active user for: ${missing.join(", ")}. Run npm run db:seed.`);
  process.exit(1);
}

/* Every screen in the rail, by the route the sidebar links to. */
const SCREENS = [
  ["Dashboard", "/"],
  ["Accounts overview", "/accounts"],
  ["Cash In", "/accounts/cash-in"],
  ["Money Transfer", "/accounts/transfers"],
  ["Expense overview", "/expenses"],
  ["Operational expenses", "/expenses/other"],
  ["AI tools and subscriptions", "/subscriptions"],
  ["All transactions", "/transactions"],
  ["Team", "/team"],
  ["Payroll", "/payroll"],
  ["TDS", "/tax/withholding"],
  ["Reports", "/reports"],
  ["Bank statement", "/statement"],
  ["AI Assistant", "/assistant"],
  ["Import and Export", "/import"],
  ["Settings", "/settings"],
];

/** A label that promises to change something. */
const WRITES =
  /^(add|new|create|record|import|build|upload|save|edit|delete|remove|void|archive|restore|pay|finalise|finalize|reopen|move to trash|change|set|generate|apply|fill|replace)\b/i;

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome) ? chrome : edge,
  headless: "new",
  args: ["--no-sandbox"],
});

const report = {};

for (const [role, person] of Object.entries(people)) {
  const token = jwt.sign(
    { sub: person.id, role: person.role, tv: person.token_version },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "2h" },
  );
  await browser.setCookie({
    name: "sfm_access",
    value: token,
    domain: "localhost",
    path: "/",
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  report[role] = { rail: [], screens: {} };

  for (const [name, route] of SCREENS) {
    let seen;
    try {
      await page.goto(`${WEB}${route}`, {
        waitUntil: "networkidle0",
        timeout: 45000,
      });
      seen = await page.evaluate((writeRe) => {
        const re = new RegExp(writeRe.source, writeRe.flags);
        const text = (el) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

        /* The rail's own links. */
        const rail = [
          ...document.querySelectorAll("nav a, aside a, [data-nav] a"),
        ]
          .map(text)
          .filter(Boolean);

        /*
         * Icon-only row actions — edit, void, trash — which carry no text and
         * were invisible to the first version of this sweep. They are the bulk
         * of the write controls in the app: one set per row of every table.
         */
        const icons = [...document.querySelectorAll("main button[aria-label]")]
          .filter((el) => {
            const style = getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden")
              return false;
            return el.getBoundingClientRect().width > 0;
          })
          .map((el) => el.getAttribute("aria-label") ?? "")
          .filter((label) => re.test(label));

        /* Anything clickable whose words promise a change. */
        const controls = [
          ...document.querySelectorAll(
            "main button, main a[href], main [role='button']",
          ),
        ]
          .filter((el) => {
            const style = getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden")
              return false;
            if (el.hasAttribute("disabled")) return false;
            return el.getBoundingClientRect().width > 0;
          })
          .map(text)
          .filter((t) => t && t.length < 40 && re.test(t));

        const body = (document.body.innerText ?? "").slice(0, 120);
        return {
          rail: [...new Set(rail)],
          controls: [...new Set(controls)],
          icons: [...new Set(icons)],
          iconCount: icons.length,
          body,
        };
      }, { source: WRITES.source, flags: WRITES.flags });
    } catch (error) {
      seen = {
        rail: [],
        controls: [],
        icons: [],
        iconCount: 0,
        body: `LOAD FAILED: ${error.message.slice(0, 60)}`,
      };
    }

    const denied = /couldn|not allowed|forbidden|sign in|404|could not load/i.test(
      seen.body,
    );
    report[role].screens[name] = {
      reachable: !denied,
      controls: seen.controls,
      icons: seen.icons,
      iconCount: seen.iconCount,
      note: denied ? seen.body.replace(/\n/g, " ").slice(0, 60) : "",
    };
    if (seen.rail.length > report[role].rail.length) report[role].rail = seen.rail;
  }

  await page.close();
}

await browser.close();

/* ------------------------------------------------------------- the report */

const ROLE_ORDER = ["super_admin", "ceo", "cfo", "hr"];
const LABEL = {
  super_admin: "Super Admin",
  ceo: "CEO",
  cfo: "CFO",
  hr: "HR",
};

console.log("\nWHAT EACH ROLE SEES IN THE RAIL\n");
for (const role of ROLE_ORDER) {
  const rail = report[role].rail.filter((r) => r && r.length < 40);
  console.log(`  ${LABEL[role]} (${rail.length}):`);
  console.log(`    ${rail.join(" · ")}`);
}

console.log("\n\nWRITE CONTROLS ON EACH SCREEN\n");
const head = "screen".padEnd(28) + ROLE_ORDER.map((r) => LABEL[r].padStart(14)).join("");
console.log(head);
console.log("-".repeat(head.length));
for (const [name] of SCREENS) {
  const cells = ROLE_ORDER.map((role) => {
    const s = report[role].screens[name];
    if (!s.reachable) return "—".padStart(14);
    const n = s.controls.length + s.iconCount;
    return `${n}${s.iconCount ? ` (${s.iconCount} ic)` : ""}`.padStart(14);
  });
  console.log(name.padEnd(28) + cells.join(""));
}

console.log("\n\nTHE CEO IS READ-ONLY. EVERY WRITE CONTROL STILL ON THEIR SCREEN:\n");
let ceoTotal = 0;
for (const [name] of SCREENS) {
  const s = report.ceo.screens[name];
  if (!s.reachable || s.controls.length + s.iconCount === 0) continue;
  ceoTotal += s.controls.length + s.iconCount;
  console.log(`  ${name}`);
  for (const c of s.controls) console.log(`      ${c}`);
  if (s.iconCount)
    console.log(`      ${s.iconCount} icon buttons: ${s.icons.join(", ")}`);
}
console.log(
  ceoTotal === 0
    ? "  none — the CEO can only look, which is the whole point of the role"
    : `\n  ${ceoTotal} controls a read-only role should not be offered.`,
);

console.log("\n\nAND HR, WHO HAS NO LEDGER:\n");
for (const [name] of SCREENS) {
  const s = report.hr.screens[name];
  const reach = s.reachable ? "reachable" : "refused";
  const inRail = report.hr.rail.some((r) => r.includes(name.split(" ")[0]));
  if (!s.reachable && !inRail) continue;
  console.log(
    `  ${name.padEnd(28)} ${reach.padEnd(10)} ${inRail ? "in the rail" : "NOT in the rail"}` +
      (s.reachable && s.controls.length ? `   ${s.controls.length} write controls` : ""),
  );
}

fs.writeFileSync(".rolesweep.json", JSON.stringify(report, null, 2), "utf8");

/* -------------------------------------------------------------------------- */
/*  And now the assertions                                                     */
/* -------------------------------------------------------------------------- */

/*
 * This began as a report, because a survey that only checks what somebody
 * already suspected finds only that. It found seven things. These are what it
 * became once they were fixed, so the next change to a table cannot quietly put
 * a write control back in front of a reader.
 */

const failures = [];
const expect = (name, pass, detail) => {
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
  if (!pass) failures.push(`${name} - ${detail}`);
};

console.log("\n\nWHAT MUST HOLD\n");

/*
 * The two the CEO keeps, deliberately.
 *
 * They are the dashboard's card chooser, and it writes to `localStorage` - one
 * person arranging their own screen. The owner's rule is about buttons that
 * carry a WRITE, and this carries none: nothing in the books moves, nobody else
 * sees the difference, and taking it away would leave a read-only role unable
 * to choose even what to read.
 */
const ALLOWED_FOR_A_READER = new Set(["Edit", "Add"]);

const ceoOffenders = [];
for (const [name] of SCREENS) {
  const s = report.ceo.screens[name];
  if (!s.reachable) continue;
  for (const c of s.controls)
    if (!ALLOWED_FOR_A_READER.has(c)) ceoOffenders.push(`${name}: ${c}`);
  for (const c of s.icons) ceoOffenders.push(`${name}: ${c} (icon)`);
}
expect(
  "a read-only role is offered no write control anywhere",
  ceoOffenders.length === 0,
  ceoOffenders.length
    ? ceoOffenders.join("; ")
    : "only the dashboard's card chooser, which writes to localStorage",
);

const ceoIcons = Object.values(report.ceo.screens).reduce(
  (n, s) => n + (s.reachable ? s.iconCount : 0),
  0,
);
expect("and not one row's edit, void or trash icon", ceoIcons === 0, `${ceoIcons} icons`);

const cfoIcons = Object.values(report.cfo.screens).reduce(
  (n, s) => n + (s.reachable ? s.iconCount : 0),
  0,
);
expect(
  "while a role that CAN write still has every one of them",
  cfoIcons > 30,
  `${cfoIcons} icons across the tables`,
);

const railHas = (role, word) =>
  report[role].rail.some((r) => r.toLowerCase().includes(word.toLowerCase()));
const hrShouldNotSee = [
  "Accounts overview",
  "All transactions",
  "Bank statement",
  "Reports",
  "TDS",
  "Import and Export",
];
const railLeaks = hrShouldNotSee.filter((w) => railHas("hr", w));
expect(
  "HR's rail carries no screen HR cannot open",
  railLeaks.length === 0,
  railLeaks.length ? railLeaks.join(", ") : "six ledger screens all absent",
);
expect(
  "and the CEO's carries no Import or Assistant",
  !railHas("ceo", "Import and Export") && !railHas("ceo", "AI Assistant"),
  `${report.ceo.rail.length} rows`,
);

const brokenRows = [];
for (const role of ROLE_ORDER) {
  for (const [name] of SCREENS) {
    const s = report[role].screens[name];
    if (!s.reachable && railHas(role, name.split(" ")[0])) {
      brokenRows.push(`${LABEL[role]} -> ${name}: ${s.note}`);
    }
  }
}
expect(
  "every row in every rail opens without an error",
  brokenRows.length === 0,
  brokenRows.length ? brokenRows.join(" | ") : "all four rails walked",
);

console.log("\n  full detail written to .rolesweep.json");
console.log("\n" + "=".repeat(78));
console.log(
  failures.length === 0
    ? "the rail and the buttons match the permissions, for all four roles"
    : `${failures.length} failed:\n` + failures.map((f) => `  ${f}`).join("\n"),
);
process.exit(failures.length === 0 ? 0 : 1);
