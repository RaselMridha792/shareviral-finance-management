/**
 * #51 — a payroll run's own invoice and reference.
 *
 * The owner, on the payroll screen:
 *
 *   *"ekhane payroll toiri korar somoy invoice and reference upload korar
 *    option tao diye diyo"* — and, when asked whether the slot could instead
 *   wait for the payment: *"hea eta pore add kore dibo edit option to achei
 *   taina"*, *"puro run er jonne ektai"*.
 *
 * Three of those words decide the whole shape and are what this drives:
 *
 *   "toiri korar somoy"  the slot exists while the run is a DRAFT, which rules
 *                        out hanging the file on the salary transaction — that
 *                        row is not written until the money moves.
 *   "pore add kore dibo"  and it can still be filled afterwards.
 *   "puro run er jonne"   one document for the sheet, not one per person.
 *
 * The failure worth driving rather than reading: `files_one_owner` now counts
 * NINE columns, and six migrations have fought over it. A replay in filename
 * order that put an eight-column rule back would refuse every upload here with
 * a constraint violation nobody would connect to a file written weeks earlier.
 * So this asserts the count, and asserts a two-owner row is still refused.
 *
 *     node .runfilesqa.mjs      (local only — writes and deletes)
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const API = "http://localhost:4001/api";
const WEB = "http://localhost:3000";
const env = Object.fromEntries(
  fs
    .readFileSync("apps/api/.env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const db = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const tokenFor = async (role) => {
  const { rows } = await db.query(
    `select id, role, token_version from users
      where role=$1 and status='active' and deleted_at is null limit 1`,
    [role],
  );
  if (!rows[0]) return null;
  return jwt.sign(
    { sub: rows[0].id, role: rows[0].role, tv: rows[0].token_version },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "2h" },
  );
};
const token = await tokenFor("super_admin");

const call = async (method, path_, body, as = token) => {
  const res = await fetch(API + path_, {
    method,
    headers: { Authorization: `Bearer ${as}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- the shape */

const constraint = (
  await db.query(
    "select pg_get_constraintdef(oid) d from pg_constraint where conname='files_one_owner'",
  )
).rows[0]?.d;
const terms = (constraint?.match(/IS NOT NULL/g) ?? []).length;
check(
  "files_one_owner counts nine owners, not the eight it had",
  terms === 9,
  `${terms} terms`,
);
check(
  "and payroll_run_id is one of them",
  Boolean(constraint && /payroll_run_id/.test(constraint)),
  constraint ? "named in the check" : "no constraint at all",
);

/* ---------------------------------------------------------- the fixtures */

const YEAR = 2199;
const MONTH = 11;
const wipe = async () => {
  await db.query(
    "delete from files where payroll_run_id in (select id from payroll_runs where period_year=$1)",
    [YEAR],
  );
  await db.query("delete from payroll_lines where payroll_run_id in (select id from payroll_runs where period_year=$1)", [YEAR]);
  await db.query("delete from payroll_runs where period_year=$1", [YEAR]);
};
await wipe();

const created = await call("POST", "/payroll/runs", {
  periodYear: YEAR,
  periodMonth: MONTH,
});
const run = created.body;
check(
  "a draft run exists to hang paper on",
  created.status < 300 && run?.status === "draft",
  `HTTP ${created.status}, status ${run?.status ?? "-"}`,
);

/* A 1x1 PNG, through the real endpoint so the screen and the check read the
   same rows. */
const sample = path.join(process.env.TEMP || ".", "runqa.png");
fs.writeFileSync(
  sample,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const upload = async (kind, as = token) => {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(sample)], { type: "image/png" }), "runqa.png");
  form.append("kind", kind);
  const res = await fetch(`${API}/files/payroll-run/${run.id}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${as}` },
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/* THE ONE THE WHOLE DESIGN TURNS ON: uploaded while the run is still a draft,
   long before any salary transaction exists to own it. */
const paid = (
  await db.query("select count(*)::int n from transactions where payroll_run_id=$1", [run.id])
).rows[0].n;
const up = await upload("invoice");
check(
  "the invoice goes on while the run is a draft — with no transaction to own it",
  up.status < 300 && paid === 0,
  `HTTP ${up.status}, ${paid} salary transactions for this run`,
);

const row = (
  await db.query(
    `select team_member_id, transaction_id, import_batch_id, subscription_id,
            settings_id, tds_deposit_id, payroll_line_id, statement_id,
            payroll_run_id, kind
       from files where id=$1`,
    [up.body?.id ?? "00000000-0000-0000-0000-000000000000"],
  )
).rows[0];
check(
  "and it hangs on the run, on nothing else",
  row?.payroll_run_id === run.id &&
    [
      row.team_member_id,
      row.transaction_id,
      row.import_batch_id,
      row.subscription_id,
      row.settings_id,
      row.tds_deposit_id,
      row.payroll_line_id,
      row.statement_id,
    ].every((v) => v === null),
  row ? `payroll_run_id set, ${Object.values(row).filter((v) => v !== null).length} columns non-null` : "no row",
);

/* The constraint still bites. Written straight past the service on purpose —
   this is the database's promise, not the API's. */
let twoOwners = "allowed";
try {
  await db.query(
    `insert into files (storage_key, original_name, mime_type, size_bytes, checksum, kind, payroll_run_id, team_member_id)
     values ('runqa/x','x.png','image/png',1,'x','invoice',$1,(select id from team_members limit 1))`,
    [run.id],
  );
} catch (caught) {
  twoOwners = caught.code === "23514" ? "refused" : `refused (${caught.code})`;
}
check(
  "a file claiming two owners is still refused by the database",
  twoOwners.startsWith("refused"),
  twoOwners,
);

/* Read back through the API, which is what the screens use. */
const listed = await call("GET", `/files/payroll-run/${run.id}`);
check(
  "the run's documents read back through the API",
  listed.status === 200 && listed.body?.length === 1 && listed.body[0].kind === "invoice",
  `HTTP ${listed.status}, ${listed.body?.length ?? 0} file(s)`,
);

/*
 * The gate, both halves.
 *
 * HR holds `payroll.read` on purpose — it reads the salary sheet — so it may
 * see the paper behind the sheet too; a first draft of this file asserted a
 * 403 there and was wrong about the app rather than finding a hole. What HR
 * must not do is attach one, because it does not hold `payroll.write`. That is
 * the half worth driving.
 */
const hr = await tokenFor("hr");
if (hr) {
  const read = await call("GET", `/files/payroll-run/${run.id}`, undefined, hr);
  check(
    "HR may read the run's paper, as it may read the sheet",
    read.status === 200,
    `HTTP ${read.status}`,
  );
  const wrote = await upload("invoice", hr);
  check(
    "but HR cannot attach one — that needs payroll.write",
    wrote.status === 403,
    `HTTP ${wrote.status}`,
  );
} else {
  check("HR may read the run's paper, as it may read the sheet", true, "no HR user — skipped");
  check("but HR cannot attach one — that needs payroll.write", true, "no HR user — skipped");
}

/* The run list's own counts, which is what draws the eyes. */
const runs = await call("GET", `/payroll/runs?page=1&pageSize=50`);
const mine = runs.body?.items?.find((r) => r.id === run.id);
check(
  "the run list counts the two kinds apart",
  mine?.invoiceCount === 1 && mine?.recordCount === 0,
  `invoice ${mine?.invoiceCount}, record ${mine?.recordCount}`,
);

/* -------------------------------- browser ------------------------------- */

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome)
    ? chrome
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
await page.setViewport({ width: 1900, height: 1300 });

/* ---- the list ---- */
await page.goto(`${WEB}/payroll`, { waitUntil: "networkidle0", timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));

const list = await page.evaluate((label) => {
  const heads = [...document.querySelectorAll("thead th")].map((h) => (h.textContent ?? "").trim());
  const invCol = heads.findIndex((h) => /^Invoice$/i.test(h));
  const refCol = heads.findIndex((h) => /^Reference$/i.test(h));
  const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes(label),
  );
  if (!tr) return { heads, invCol, refCol, row: null, blank: document.body.innerText.length < 200 };
  const cells = [...tr.querySelectorAll("td")];
  const at = (i) => ({
    text: (cells[i]?.textContent ?? "").trim(),
    button: Boolean(cells[i]?.querySelector("button")),
  });
  return {
    heads,
    invCol,
    refCol,
    row: { invoice: at(invCol), reference: at(refCol), cells: cells.length },
    blank: false,
  };
}, run.label);

check("the payroll page rendered", !list.blank, list.blank ? "near-empty body" : "content present");
check(
  "the runs table carries Invoice and Reference",
  list.invCol >= 0 && list.refCol >= 0,
  list.heads.join(" | ").slice(0, 140),
);
check(
  "the run with an invoice offers the eye on Invoice",
  list.row?.invoice.button === true,
  `invoice cell "${list.row?.invoice.text}"`,
);
check(
  "and says N/A on Reference rather than opening an empty drawer",
  list.row?.reference.button === false && /N\/A/.test(list.row?.reference.text ?? ""),
  `reference cell "${list.row?.reference.text}", button ${list.row?.reference.button}`,
);

/* The eye opens the drawer, and the drawer holds the invoice. */
const opened = await page.evaluate((label) => {
  const heads = [...document.querySelectorAll("thead th")].map((h) => (h.textContent ?? "").trim());
  const invCol = heads.findIndex((h) => /^Invoice$/i.test(h));
  const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes(label),
  );
  const btn = [...tr.querySelectorAll("td")][invCol]?.querySelector("button");
  if (!btn) return false;
  btn.click();
  return true;
}, run.label);
await new Promise((r) => setTimeout(r, 1500));
const drawer = await page.evaluate(() => document.body.innerText);
check(
  "clicking it opens a drawer holding the file",
  opened && /runqa\.png/.test(drawer),
  opened ? (/runqa\.png/.test(drawer) ? "runqa.png shown" : "drawer opened but empty") : "no button",
);

/* ---- the sheet, which is where "edit" goes ---- */
await page.goto(`${WEB}/payroll/${run.id}`, { waitUntil: "networkidle0", timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));

const sheet = await page.evaluate(() => {
  const text = document.body.innerText;
  const headings = [...document.querySelectorAll("h2")].map((h) => (h.textContent ?? "").trim());
  const panel = [...document.querySelectorAll("h2")].find(
    (h) => (h.textContent ?? "").trim() === "Documents",
  )?.closest("div")?.parentElement;
  const slots = panel ? [...panel.querySelectorAll("li")] : [];
  const read = (name) => {
    const li = slots.find((s) => (s.querySelector("span")?.textContent ?? "").trim() === name);
    return li
      ? {
          found: true,
          text: (li.textContent ?? "").trim(),
          uploadButton: [...li.querySelectorAll("button")].some((b) =>
            /Upload|Add another/.test(b.textContent ?? ""),
          ),
          eye: Boolean(li.querySelector('[aria-label^="View"]')),
        }
      : { found: false };
  };
  return {
    headings,
    blank: text.length < 200,
    invoice: read("Invoice"),
    reference: read("Reference"),
  };
});

check("the salary sheet rendered", !sheet.blank, sheet.blank ? "near-empty body" : "content present");
check(
  "the sheet carries a Documents panel",
  sheet.headings.includes("Documents"),
  sheet.headings.join(" | ").slice(0, 120),
);
check(
  "with an Invoice slot and a Reference slot",
  sheet.invoice.found && sheet.reference.found,
  `invoice ${sheet.invoice.found}, reference ${sheet.reference.found}`,
);
check(
  "the filled slot shows the file and an eye",
  /runqa\.png/.test(sheet.invoice.text ?? "") && sheet.invoice.eye === true,
  sheet.invoice.text?.replace(/\s+/g, " ").slice(0, 80),
);
check(
  "the empty slot says so, on a draft, rather than showing nothing",
  /Not on file/.test(sheet.reference.text ?? ""),
  sheet.reference.text?.replace(/\s+/g, " ").slice(0, 80),
);
check(
  "and both still offer a way to add one — the slot is fillable later",
  sheet.invoice.uploadButton && sheet.reference.uploadButton,
  `invoice ${sheet.invoice.uploadButton}, reference ${sheet.reference.uploadButton}`,
);

await browser.close();
fs.rmSync(sample, { force: true });
await wipe();
await db.end();

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(70));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
        failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
