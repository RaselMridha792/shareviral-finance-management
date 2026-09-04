/**
 * The tax: worked out AND typeable over, at the same time.
 *
 * The owner, on a marked screenshot of the salary sheet:
 *
 *   *"ekhane tds ta editable koro. etato auto fill hobe eksathe ami duita
 *    feature cai. mane auto calculate hoye tds bosbe ami caile karota edit o
 *    korte parbo."*
 *
 * `updatePayrollLineSchema` refused `tdsAmount` on purpose, and its comment
 * said why: *"a screen that let somebody type over it would make the stored
 * working a lie"*. That objection is about typing over a figure while still
 * claiming a rule produced it — so the line now records WHICH of the two it
 * holds, and both halves can be true at once.
 *
 * The failure this exists to catch is the one that would make the feature look
 * broken rather than absent: type a tax, then correct a working day, and the
 * recompute quietly puts the rule's figure back. Nothing errors. The box just
 * forgets. So the sequence below is deliberately type → edit something else →
 * read it back, and the last assertion is that the typed figure survived.
 *
 *     node .tdseditqa.mjs      (local only — writes and deletes)
 */
import fs from "node:fs";
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

const person = (
  await db.query(
    `select id, role, token_version from users
      where role='super_admin' and status='active' and deleted_at is null limit 1`,
  )
).rows[0];
const token = jwt.sign(
  { sub: person.id, role: person.role, tv: person.token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);
const call = async (method, path_, body) => {
  const res = await fetch(API + path_, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- fixtures */

const MARK = "TDSQA";
const YEAR = 2198;
const MONTH = 7;
const wipe = async () => {
  await db.query(
    "delete from payroll_lines where payroll_run_id in (select id from payroll_runs where period_year=$1)",
    [YEAR],
  );
  await db.query("delete from payroll_runs where period_year=$1", [YEAR]);
  await db.query(
    "delete from compensation_history where team_member_id in (select id from team_members where full_name like $1)",
    [`${MARK}%`],
  );
  await db.query("delete from team_members where full_name like $1", [`${MARK}%`]);
};
await wipe();

const member = (
  await call("POST", "/team-members", {
    fullName: `${MARK} Person`,
    engagementType: "employee",
    joinedOn: "2024-01-01",
  })
).body;
await call("POST", `/team-members/${member.id}/compensation`, {
  grossAmount: "100000.00",
  effectiveFrom: "2024-01-01",
  changeReason: `${MARK} hired`,
});

const run = (
  await call("POST", "/payroll/runs", { periodYear: YEAR, periodMonth: MONTH })
).body;
await call("POST", `/payroll/runs/${run.id}/members`, {
  teamMemberIds: [member.id],
});
await call("POST", `/payroll/runs/${run.id}/generate-lines`, {});

const lineOf = async () =>
  (
    await db.query(
      `select id, gross_amount::text gross, tds_amount::text tds, tds_manual,
              tds_basis is not null has_basis, net_amount::text net, working_days
         from payroll_lines where payroll_run_id=$1 limit 1`,
      [run.id],
    )
  ).rows[0];

const built = await lineOf();
check(
  "a draft sheet exists with one line on it",
  Boolean(built?.id),
  built ? `gross ${built.gross}, tax ${built.tds}` : "no line",
);
check(
  "and its tax starts out worked out, not typed",
  built?.tds_manual === false,
  `tds_manual ${built?.tds_manual}`,
);

/* ---------------- whole taka, and a box on every row -------------------- */

/*
 * The owner, on a sheet full of figures like 52,258.06: *"ami kono employee er
 * salary te to eirokom decimal kono number deinai"*. Asked whether the tax
 * should round with the rest, he said it should. So a pro-rated month has to
 * come out whole from end to end.
 */
await call("PATCH", `/payroll/lines/${built.id}`, { workingDays: 18 });
const prorated = await lineOf();
const wholeTaka = (v) => /\.00$/.test(String(v));
check(
  "a pro-rated gross lands on a whole taka",
  wholeTaka(prorated?.gross),
  `gross ${prorated?.gross} for 18 of ${new Date(YEAR, MONTH, 0).getDate()} days`,
);
check(
  "and so does the net beside it",
  wholeTaka(prorated?.net),
  `net ${prorated?.net}`,
);

await call("POST", `/payroll/runs/${run.id}/recalculate-tds`, {});
const taxed = await lineOf();
check(
  "the tax the rule works out is a whole taka too",
  wholeTaka(taxed?.tds),
  `tds ${taxed?.tds}`,
);
check(
  "so nothing on the row carries a paisa",
  wholeTaka(taxed?.gross) && wholeTaka(taxed?.tds) && wholeTaka(taxed?.net),
  `${taxed?.gross} − ${taxed?.tds} = ${taxed?.net}`,
);

/* And the parts still sum to exactly the gross they were split from. */
const parts = (
  await db.query(
    "select earnings_breakdown from payroll_lines where id=$1",
    [built.id],
  )
).rows[0]?.earnings_breakdown;
const partsSum = (parts ?? []).reduce((t, p) => t + Number(p.amount), 0);
check(
  "the parts add up to the gross, to the paisa, and are whole themselves",
  (parts ?? []).length > 0 &&
    partsSum.toFixed(2) === Number(taxed.gross).toFixed(2) &&
    (parts ?? []).every((p) => wholeTaka(p.amount)),
  `${(parts ?? []).map((p) => p.amount).join(" + ")} = ${partsSum.toFixed(2)} vs gross ${taxed.gross}`,
);


/*
 * Handed back exactly as it was found: a full month, owned by the rule. The
 * checks below tell a story in order — type a tax, edit around it, put the
 * rule back — and a block that left the row pro-rated and hand-typed made
 * three of them measure a state nobody set.
 */
await call("PATCH", `/payroll/lines/${built.id}`, { workingDays: null });
await call("POST", `/payroll/runs/${run.id}/recalculate-tds`, {});

/* ------------------------------------------- 1. the field takes a figure */

const typedValue = "7777.00";
const typed = await call("PATCH", `/payroll/lines/${built.id}`, {
  tdsAmount: typedValue,
});
check(
  "the tax field accepts a typed figure — it used to be refused outright",
  typed.status < 300,
  `HTTP ${typed.status}${typed.status >= 300 ? ` ${JSON.stringify(typed.body).slice(0, 120)}` : ""}`,
);

const afterType = await lineOf();
check(
  "the figure is stored as typed",
  afterType?.tds === typedValue,
  `${afterType?.tds}`,
);
check(
  "and the line is marked as hand-typed",
  afterType?.tds_manual === true,
  `tds_manual ${afterType?.tds_manual}`,
);
check(
  "the rule's working is cleared with it — a typed figure claims no rule",
  afterType?.has_basis === false,
  `basis ${afterType?.has_basis ? "still stored" : "cleared"}`,
);
check(
  "net pay re-figures from the typed tax",
  afterType?.net === (Number(afterType.gross) - Number(typedValue)).toFixed(2),
  `net ${afterType?.net} against gross ${afterType?.gross} − ${typedValue}`,
);

/* ------------------------------ 2. THE ONE THAT WOULD LOOK LIKE A BUG    */

const daysEdit = await call("PATCH", `/payroll/lines/${built.id}`, {
  workingDays: 20,
});
const afterDays = await lineOf();
check(
  "changing the working days still re-figures the gross",
  Number(afterDays?.gross) < Number(afterType.gross) && afterDays?.working_days === 20,
  `gross ${afterType.gross} → ${afterDays?.gross}, days ${afterDays?.working_days}`,
);
check(
  "but the typed tax survives it — this is the whole point of the mark",
  afterDays?.tds === typedValue && afterDays?.tds_manual === true,
  `tax ${afterDays?.tds}, typed ${afterDays?.tds_manual}`,
);
check(
  "and the app says so rather than leaving it unexplained",
  /typed by hand/i.test(daysEdit.body?.warning ?? ""),
  daysEdit.body?.warning ?? "no warning returned",
);

const grossEdit = await call("PATCH", `/payroll/lines/${built.id}`, {
  grossAmount: "120000.00",
});
const afterGross = await lineOf();
check(
  "a gross typed straight in does not overwrite the tax either",
  afterGross?.tds === typedValue && afterGross?.gross === "120000.00",
  `gross ${afterGross?.gross}, tax ${afterGross?.tds}`,
);
check(
  "the warning comes back on that path too",
  /typed by hand/i.test(grossEdit.body?.warning ?? "") ||
    /% of gross/.test(grossEdit.body?.warning ?? ""),
  grossEdit.body?.warning ?? "no warning returned",
);

/* --------------------------------- 3. the one deliberate way back ------ */

const again = await call("POST", `/payroll/runs/${run.id}/recalculate-tds`, {});
const afterAgain = await lineOf();
check(
  "'Work out the tax again' does replace a typed figure",
  afterAgain?.tds !== typedValue,
  `${typedValue} → ${afterAgain?.tds}`,
);
check(
  "and clears the mark, so the rule owns the figure again",
  afterAgain?.tds_manual === false,
  `tds_manual ${afterAgain?.tds_manual}`,
);
check(
  "it reports how many typed figures it replaced, rather than swallowing it",
  /hand-typed/.test(again.body?.message ?? ""),
  again.body?.message ?? "no message",
);

/* -------------------------- 4. and the lock still holds ---------------- */

await call("PATCH", `/payroll/lines/${built.id}`, { tdsAmount: "5555.00" });
await call("POST", `/payroll/runs/${run.id}/finalize`, {});
const locked = await call("PATCH", `/payroll/lines/${built.id}`, {
  tdsAmount: "1.00",
});
check(
  "a finalised sheet refuses a typed tax like every other figure",
  locked.status >= 400 && /finalised/i.test(locked.body?.message ?? ""),
  `HTTP ${locked.status} ${locked.body?.message ?? ""}`.slice(0, 90),
);
await call("POST", `/payroll/runs/${run.id}/reopen`, {});

/* -------------------------------- the screen --------------------------- */

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
await page.goto(`${WEB}/payroll/${run.id}`, { waitUntil: "networkidle0", timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));

const sheet = await page.evaluate((mark) => {
  const heads = [...document.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").trim(),
  );
  const tdsCol = heads.findIndex((h) => /^TDS$/i.test(h));
  const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes(mark),
  );
  if (!tr) return { blank: document.body.innerText.length < 300, heads, tdsCol, cell: null };
  const cell = [...tr.querySelectorAll("td")][tdsCol];
  const input = cell?.querySelector("input");
  return {
    blank: false,
    heads,
    tdsCol,
    cell: {
      hasInput: Boolean(input),
      value: input?.value ?? (cell?.textContent ?? "").trim(),
      title: input?.getAttribute("title") ?? "",
      marked: /decoration-dotted|border-warning/.test(input?.className ?? ""),
      readOnly: input?.readOnly ?? null,
    },
  };
}, MARK);

check("the salary sheet rendered", !sheet.blank, sheet.blank ? "near-empty" : "content present");
check(
  "the TDS column is there and its cell is now a box you can type in",
  sheet.tdsCol >= 0 && sheet.cell?.hasInput === true,
  `column ${sheet.tdsCol}, input ${sheet.cell?.hasInput}`,
);
check(
  "the box holds the line's own figure",
  sheet.cell?.value === "5555.00",
  `"${sheet.cell?.value}"`,
);
check(
  "a hand-typed figure is visibly marked as one",
  sheet.cell?.marked === true,
  sheet.cell?.marked ? "dotted amber" : "no mark drawn",
);
check(
  "and says on hover what it is and how to undo it",
  /typed by hand/i.test(sheet.cell?.title ?? ""),
  sheet.cell?.title ?? "no title",
);

/*
 * The box has to be BIG ENOUGH TO USE, which is a different claim from being
 * present. The owner found rows he could not click into — *"jader tds 0 tader
 * okhane edit kora jacchena"* — and it was the working button beside it taking
 * the width in a 112px column. Measured, because a screenshot of a 4px input
 * looks like no input at all and a diff shows neither.
 */
const tdsBox = await page.evaluate((col, mark) => {
  const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes(mark),
  );
  const cell = [...tr.querySelectorAll("td")][col];
  const input = cell?.querySelector("input");
  const button = cell?.querySelector("button");
  return {
    inputWidth: input ? Math.round(input.getBoundingClientRect().width) : 0,
    buttonWidth: button ? Math.round(button.getBoundingClientRect().width) : 0,
    readOnly: input ? input.readOnly : null,
  };
}, sheet.tdsCol, MARK);
check(
  "the tax box is wide enough to type in, even beside the working button",
  tdsBox.inputWidth >= 60,
  `input ${tdsBox.inputWidth}px, button ${tdsBox.buttonWidth}px`,
);
check(
  "and the working button still fits beside it rather than instead of it",
  tdsBox.buttonWidth === 0 || tdsBox.buttonWidth >= 16,
  `button ${tdsBox.buttonWidth}px`,
);

/*
 * Net Pay follows the boxes AS THEY ARE TYPED.
 *
 * The owner read a gross of 116,078 sitting beside a net of 116,129 and called
 * it wrong arithmetic — and he was right about the screen: the net was the one
 * from the last save. Typed here WITHOUT blurring, so nothing is saved and the
 * only thing that can have moved is the figure on screen.
 */
const liveNet = await page.evaluate((mark, tdsCol) => {
  /* By COLUMN, not by the value that happens to be in the box. Gross sits
     immediately left of TDS and Net Pay immediately right of Other −, and the
     first draft hunted for a literal "100000.00" that several earlier edits
     had already changed. */
  const heads = [...document.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").trim(),
  );
  const netCol = heads.findIndex((h) => /^Net Pay$/i.test(h));
  const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes(mark),
  );
  const cells = [...tr.querySelectorAll("td")];
  const netBefore = (cells[netCol]?.textContent ?? "").trim();
  const grossInput = cells[tdsCol - 1]?.querySelector("input");
  if (!grossInput || netCol < 0) return { found: false, netBefore, netCol };
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  grossInput.focus();
  setter.call(grossInput, (Number(grossInput.value) * 2).toFixed(2));
  grossInput.dispatchEvent(new Event("input", { bubbles: true }));
  return { found: true, netBefore, netCol };
}, MARK, sheet.tdsCol);
await new Promise((r) => setTimeout(r, 500));
const netAfter = await page.evaluate((mark, netCol) => {
  const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes(mark),
  );
  const cells = [...tr.querySelectorAll("td")];
  return (cells[netCol]?.textContent ?? "").trim();
}, MARK, liveNet.netCol);
check(
  "Net Pay moves with the gross as it is typed, before anything is saved",
  liveNet.found && netAfter !== liveNet.netBefore,
  `${liveNet.netBefore} → ${netAfter} (the gross box doubled, unsaved)`,
);

/* Put it back, so the save below is the one the next checks expect. */
await page.evaluate(() => {
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement)) return;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(el, el.defaultValue);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.blur();
});
await new Promise((r) => setTimeout(r, 1200));

/* Typed on the page rather than through the API — the box has to actually
   save, which is a different claim from the endpoint accepting a body. */
const throughTheScreen = await page.evaluate((col, mark) => {
  const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes(mark),
  );
  const input = [...tr.querySelectorAll("td")][col]?.querySelector("input");
  if (!input) return false;
  /* Focus FIRST. `blur()` on an element that was never focused does nothing at
     all — no event, no React onBlur, no save — and the first run of this file
     reported the cell not saving when what had not happened was the blur. */
  input.focus();
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(input, "4242.00");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.blur();
  return document.activeElement !== input;
}, sheet.tdsCol, MARK);
await new Promise((r) => setTimeout(r, 2000));

const afterScreen = await lineOf();
check(
  "typing in the cell and leaving it saves the figure",
  throughTheScreen && afterScreen?.tds === "4242.00",
  `typed ${throughTheScreen}, stored ${afterScreen?.tds}`,
);

/* Finalised: the box goes, the figure stays. */
await call("POST", `/payroll/runs/${run.id}/finalize`, {});
await page.reload({ waitUntil: "networkidle0", timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
const finalised = await page.evaluate((col, mark) => {
  const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes(mark),
  );
  const cell = [...tr.querySelectorAll("td")][col];
  return {
    hasInput: Boolean(cell?.querySelector("input")),
    text: (cell?.textContent ?? "").trim(),
  };
}, sheet.tdsCol, MARK);
check(
  "once finalised the box is gone and the figure is read-only",
  finalised.hasInput === false && /4,?242/.test(finalised.text),
  `input ${finalised.hasInput}, shows "${finalised.text}"`,
);

await browser.close();
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
