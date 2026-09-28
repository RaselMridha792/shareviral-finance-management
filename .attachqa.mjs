/**
 * One attach is one file — and a table, its popup and its edit form agree
 * about what is attached.
 *
 * The owner, on Cash In: "cash in page a edit a click korar por ekhane invoice
 * and Reference preview dekhacchena and eksathe multiple add hoye geche edit
 * mode theke remove o kora jacchena. ... invoice upload korar poreo ekhane N/A
 * dekhacche table a kintu view te gele eta abar dekha jacche popup a. ...
 * entire application er sob jaygay ei bugs ta check korbe."
 *
 * Three faults, checked on every screen that holds an invoice and a reference:
 *
 *   (i)   a table cell reading N/A while a file is attached (Cash In's Invoice
 *         column read only the typed number, which nobody types any more);
 *   (ii)  an edit form blind to what is already attached, with no way to take
 *         a file off;
 *   (iii) one attach producing two files — the form said "No invoice
 *         attached" over an entry carrying one, so it was attached again.
 *
 * Driven through the real forms: an entry is created with one invoice and one
 * reference, the database is asked how many of each it holds, the table cells
 * and the row's popup are read, the edit form is opened and must list both,
 * the same file picked again must be refused, one file is taken off (and the
 * database, the table and the popup must all say so), Cancel must change
 * nothing, and a save with no change must not duplicate anything.
 *
 * Screens: Cash In (and its row on the account's register — the table All
 * transactions draws — and on the bank statement), Other expenses (the ledger
 * form every register and heading page edits in), Money Transfer (no edit form
 * by design: the pair is voided and recorded again), and AI tools and
 * subscriptions (the plan is created through the API; its edit form is what
 * is driven). The TDS challan form needs a payroll line with tax, and the
 * local books have none — it is reported as not reachable, not as passed.
 *
 *     node .attachqa.mjs      (local only — creates rows and files, and
 *                              deletes every one of them, with their audit
 *                              rows, on the way out)
 *
 * Needs `npm run dev` running (web :3000, api :4001).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = process.env.WEB ?? "http://localhost:3000";
const API = process.env.API ?? "http://localhost:4001/api";
const MARK = "ATTACHQA";

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
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const admin = (
  await q(
    `select id, role, token_version from users where role = 'super_admin' and status = 'active' and deleted_at is null order by created_at limit 1`,
  )
)[0];
const token = jwt.sign({ sub: admin.id, role: admin.role, tv: admin.token_version }, env.JWT_ACCESS_SECRET, {
  expiresIn: "1h",
});
const today = (await q(`select (now() at time zone 'Asia/Dhaka')::date::text d`))[0].d;

/* ------------------------------------------------------------ fixtures */

/*
 * Distinct bytes per file. A 2x2 PNG with the file's own name written after
 * IEND: still a PNG to the sniffer, which reads the header, and a different
 * checksum for every name.
 */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAF0lEQVR42mP8z8BQz0AEYBxVSF+FAAsLBAF6r4OeAAAAAElFTkSuQmCC",
  "base64",
);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "attachqa-"));
const fixture = (name) => {
  const where = path.join(dir, name);
  fs.writeFileSync(where, Buffer.concat([PNG, Buffer.from(`\n${name}\n`)]));
  return where;
};

/* --------------------------------------------------------------- cleanup */

async function wipe() {
  const txns = (await q(`select id from transactions where description like $1`, [`${MARK}%`])).map((r) => r.id);
  const charges = txns.length
    ? (await q(`select id from transactions where charge_for_id = any($1::uuid[])`, [txns])).map((r) => r.id)
    : [];
  const allTx = [...txns, ...charges];
  const subs = (await q(`select id from subscriptions where tool_name like $1`, [`${MARK}%`])).map((r) => r.id);
  const files = await q(
    `select id, deleted_at from files
      where transaction_id = any($1::uuid[]) or subscription_id = any($2::uuid[])
         or original_name like 'attachqa-%'`,
    [allTx, subs],
  );
  // Live ones through the API first, so their bytes leave the disk too.
  for (const f of files.filter((f) => !f.deleted_at)) {
    await fetch(`${API}/files/${f.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}`, "X-Requested-With": "finance-web" },
    }).catch(() => undefined);
  }
  const ids = [...allTx, ...subs, ...files.map((f) => f.id)];
  if (ids.length) await q(`delete from audit_logs where entity_id = any($1::text[])`, [ids]);
  if (files.length) await q(`delete from files where id = any($1::uuid[])`, [files.map((f) => f.id)]);
  if (charges.length) await q(`delete from transactions where id = any($1::uuid[])`, [charges]);
  if (txns.length) await q(`delete from transactions where id = any($1::uuid[])`, [txns]);
  if (subs.length) {
    await q(`delete from subscription_users where subscription_id = any($1::uuid[])`, [subs]);
    await q(`delete from subscriptions where id = any($1::uuid[])`, [subs]);
  }
}
await wipe();

/* --------------------------------------------------------------- checks */

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/** Live files on one owner, by kind. */
async function liveFiles(column, id) {
  const rows = await q(
    `select id, kind::text, original_name from files where ${column} = $1 and deleted_at is null order by created_at`,
    [id],
  );
  const by = (kinds) => rows.filter((r) => kinds.includes(r.kind));
  return {
    all: rows,
    invoice: by(["invoice"]),
    record: by(["bank_statement", "receipt", "other"]),
  };
}

/* --------------------------------------------------------------- browser */

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const errors = [];
let page;

const open = async (url) => {
  await page.goto(`${WEB}${url}`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(900);
};
const clickText = (re, scope = "main") =>
  page.evaluate(
    (source, scope) => {
      const rx = new RegExp(source, "i");
      const root = scope === "popup" ? [...document.querySelectorAll("[data-popup]")].pop() : document.querySelector(scope);
      const b = [...(root?.querySelectorAll("button, a") ?? [])].find((x) => rx.test((x.textContent ?? "").trim()));
      b?.click();
      return Boolean(b);
    },
    re.source,
    scope,
  );
const popupCount = () => page.evaluate(() => document.querySelectorAll("[data-popup]").length);
const waitClosed = async () => {
  await page.waitForFunction(() => !document.querySelector("[data-popup]"), { timeout: 30000 }).catch(() => undefined);
  await settle(1200);
};

/** A form value, set the way React hears it. Scoped to the top popup. */
const setField = (name, value) =>
  page.evaluate(
    (n, v) => {
      const p = [...document.querySelectorAll("[data-popup]")].pop();
      const el = p?.querySelector(`input[name="${n}"], textarea[name="${n}"], select[name="${n}"]`);
      if (!el) return false;
      let proto = Object.getPrototypeOf(el);
      let d = null;
      while (proto && !d) {
        d = Object.getOwnPropertyDescriptor(proto, "value");
        if (d && !d.set) d = null;
        if (!d) proto = Object.getPrototypeOf(proto);
      }
      d.set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    name,
    value,
  );

/** The same, for a box with no name — found by its field's label. */
const setByLabel = (label, value) =>
  page.evaluate(
    (label, v) => {
      const p = [...document.querySelectorAll("[data-popup]")].pop();
      const field = [...(p?.querySelectorAll("label") ?? [])].find((l) => l.firstElementChild?.textContent.trim().replace(/\*$/, "").trim() === label);
      const el = field?.querySelector("input");
      if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    label,
    value,
  );

/** The account, picked through its combobox — a hidden input React never hears. */
async function chooseAccount(name) {
  await page.evaluate(() => {
    const p = [...document.querySelectorAll("[data-popup]")].pop();
    p?.querySelector('input[name="accountId"]')?.parentElement?.querySelector('button[role="combobox"]')?.click();
  });
  await settle(800);
  await page.evaluate((name) => {
    const p = [...document.querySelectorAll("[data-popup]")].pop();
    [...(p?.querySelectorAll('button[role="option"]') ?? [])]
      .find((b) => (b.querySelector("span span")?.textContent ?? "").trim() === name)
      ?.click();
  }, name);
  await settle(800);
  return page.evaluate(() => [...document.querySelectorAll("[data-popup]")].pop()?.querySelector('input[name="accountId"]')?.value ?? null);
}

/** What one clip in the open form shows. */
const slots = () =>
  page.evaluate(() => {
    const p = [...document.querySelectorAll("[data-popup]")].pop();
    if (!p) return null;
    const read = (label) => {
      const field = [...p.querySelectorAll("label")].find((l) => l.firstElementChild?.textContent.trim() === label);
      if (!field) return null;
      return {
        stored: [...field.querySelectorAll('[data-attached="stored"]')].map((s) => ({
          name: s.querySelector("span")?.textContent.trim(),
          id: s.getAttribute("data-file-id"),
          removing: s.hasAttribute("data-removing"),
          eye: Boolean(s.querySelector('button[aria-label^="Preview"]')),
        })),
        picked: [...field.querySelectorAll('[data-attached="picked"]')].map((s) => s.querySelector("span")?.textContent.trim()),
        text: field.textContent.replace(/\s+/g, " ").trim(),
      };
    };
    return {
      title: p.querySelector("h2")?.textContent.trim(),
      invoice: read("Invoice"),
      reference: read("Reference"),
      buttons: [...p.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean),
    };
  });

/** The hidden file input inside one clip. */
async function slotInput(label) {
  const handle = await page.evaluateHandle((label) => {
    const p = [...document.querySelectorAll("[data-popup]")].pop();
    const field = [...(p?.querySelectorAll("label") ?? [])].find((l) => l.firstElementChild?.textContent.trim() === label);
    return field?.querySelector('input[type="file"]') ?? null;
  }, label);
  return handle.asElement();
}
async function attach(label, file) {
  const input = await slotInput(label);
  if (!input) return false;
  await input.uploadFile(file);
  await settle(700);
  return true;
}
/** Clicks a button inside one clip, by its aria-label. */
const clipButton = (label, aria, scope = "stored") =>
  page.evaluate(
    (label, aria, scope) => {
      const p = [...document.querySelectorAll("[data-popup]")].pop();
      const field = [...(p?.querySelectorAll("label") ?? [])].find((l) => l.firstElementChild?.textContent.trim() === label);
      const b = field?.querySelector(`[data-attached="${scope}"] button[aria-label="${aria}"]`);
      b?.click();
      return Boolean(b);
    },
    label,
    aria,
    scope,
  );

const save = async () => {
  const clicked = await clickText(/^(Save changes|Save|Add it|Record it|Record the transfer)$/, "popup");
  await waitClosed();
  return clicked;
};
const cancel = async () => {
  const clicked = await clickText(/^Cancel$/, "popup");
  await waitClosed();
  return clicked;
};

/** One table cell, by its column heading. */
const cell = (rowId, heading) =>
  page.evaluate(
    (rowId, heading) => {
      const row = document.querySelector(`main tr[data-row-id="${rowId}"]`);
      if (!row) return null;
      const heads = [...row.closest("table").querySelectorAll("thead th")].map((th) => th.textContent.trim());
      const i = heads.indexOf(heading);
      if (i < 0) return `(no ${heading} column)`;
      return (row.children[i]?.textContent ?? "").replace(/\s+/g, " ").trim();
    },
    rowId,
    heading,
  );

/** Opens a row's popup by clicking a plain cell in it, and reads its Paperwork. */
async function popupOf(rowId, heading = "Date") {
  const index = await page.evaluate(
    (rowId, heading) => {
      const row = document.querySelector(`main tr[data-row-id="${rowId}"]`);
      if (!row) return -1;
      return [...row.closest("table").querySelectorAll("thead th")].map((th) => th.textContent.trim()).indexOf(heading);
    },
    rowId,
    heading,
  );
  if (index < 0) return null;
  const td = await page.$(`main tr[data-row-id="${rowId}"] > td:nth-child(${index + 1})`);
  await td.click();
  await settle(800);
  return page.evaluate(() => {
    const p = [...document.querySelectorAll("[data-popup]")].pop();
    if (!p) return null;
    const out = { title: p.querySelector("h2")?.textContent.trim() };
    for (const div of p.querySelectorAll("dl > div")) {
      const dt = div.querySelector("dt")?.textContent.trim();
      if (dt) out[dt] = div.querySelector("dd")?.textContent.replace(/\s+/g, " ").trim();
    }
    return out;
  });
}
/** From the open popup: click a paperwork row's View and count what opens. */
async function viewFromPopup(label) {
  const clicked = await page.evaluate((label) => {
    const p = [...document.querySelectorAll("[data-popup]")].pop();
    const row = [...(p?.querySelectorAll("dl > div") ?? [])].find((d) => d.querySelector("dt")?.textContent.trim() === label);
    const b = [...(row?.querySelectorAll("button") ?? [])].find((x) => /View/.test(x.textContent ?? ""));
    b?.click();
    return Boolean(b);
  }, label);
  if (!clicked) return null;
  await page.waitForFunction(
    () => {
      const d = document.querySelector('[role="dialog"][aria-label^="Documents attached"]');
      return d && !/Looking/.test(d.textContent ?? "");
    },
    { timeout: 15000 },
  ).catch(() => undefined);
  const shown = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label^="Documents attached"]');
    return d ? d.querySelectorAll("figure").length : null;
  });
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label^="Documents attached"]');
    [...(d?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "Close")?.click();
  });
  await settle(400);
  return shown;
}
const closePopup = async () => {
  await page.keyboard.press("Escape");
  await settle(500);
};
const rowEdit = async (rowId) => {
  const clicked = await page.evaluate((rowId) => {
    const b = document.querySelector(`main tr[data-row-id="${rowId}"] button[aria-label="Edit"]`);
    b?.click();
    return Boolean(b && !b.disabled);
  }, rowId);
  await settle(1500);
  return clicked;
};

/**
 * The whole edit cycle on one record, through its own form.
 *
 * `reopen` puts the screen back and opens the edit form; `table` reads the two
 * cells; `popup` reads the popup (or null where the screen has none); `owner`
 * is the column the files hang on.
 */
async function editCycle({ label, owner, ownerId, reopen, table, popup, files }) {
  /* --- the form shows what is on file ---------------------------------- */
  await reopen();
  let s = await slots();
  check(
    `${label}: the edit form opens`,
    Boolean(s?.invoice && s?.reference),
    s ? s.title : "no form",
  );
  if (!s?.invoice) return;
  check(
    `${label}: the Invoice clip lists the invoice already on file`,
    s.invoice.stored.length === 1 && s.invoice.stored[0].name === path.basename(files.invoice) && !/No invoice attached/.test(s.invoice.text),
    JSON.stringify(s.invoice.stored.map((x) => x.name)) + ` | "${s.invoice.text.slice(0, 80)}"`,
  );
  check(
    `${label}: the Reference clip lists the reference already on file`,
    s.reference.stored.length === 1 && s.reference.stored[0].name === path.basename(files.reference) && !/No reference attached/.test(s.reference.text),
    JSON.stringify(s.reference.stored.map((x) => x.name)),
  );
  check(`${label}: each has an eye to open it`, s.invoice.stored.every((x) => x.eye) && s.reference.stored.every((x) => x.eye));
  // SHOT_DIR=<folder> keeps a picture of each edit form as it opens, for a
  // person to look at; the checks above do not depend on it.
  if (process.env.SHOT_DIR) {
    await page.screenshot({ path: path.join(process.env.SHOT_DIR, `attachqa-${label.replace(/\W+/g, "-").toLowerCase()}-edit.png`) });
  }

  // The eye opens the stored file itself.
  const storedId = s.invoice.stored[0].id;
  await page.evaluate(() => {
    const p = [...document.querySelectorAll("[data-popup]")].pop();
    const field = [...p.querySelectorAll("label")].find((l) => l.firstElementChild?.textContent.trim() === "Invoice");
    field.querySelector('[data-attached="stored"] button[aria-label^="Preview"]')?.click();
  });
  await settle(1200);
  const previewed = await page.evaluate(
    (id) => Boolean([...document.querySelectorAll("img, iframe")].find((el) => (el.getAttribute("src") ?? "").includes(`/files/${id}/content`))),
    storedId,
  );
  check(`${label}: the eye shows the stored invoice`, previewed);
  await page.evaluate(() => {
    const viewers = [...document.querySelectorAll('[role="dialog"]')].filter((d) => d.querySelector("img, iframe") && !d.hasAttribute("data-popup"));
    [...(viewers.pop()?.querySelectorAll("button") ?? [])].find((b) => b.getAttribute("aria-label") === "Close")?.click();
  });
  await settle(600);

  /* --- the same file again is refused ---------------------------------- */
  await attach("Invoice", files.invoice);
  s = await slots();
  check(
    `${label}: picking the same invoice again is refused, not added`,
    s.invoice.picked.length === 0 && /already attached/i.test(s.invoice.text),
    `picked ${JSON.stringify(s.invoice.picked)}`,
  );

  /* --- Cancel changes nothing ------------------------------------------ */
  await clipButton("Reference", `Remove ${path.basename(files.reference)}`);
  s = await slots();
  check(
    `${label}: the cross marks the reference, struck through, until save`,
    s.reference.stored[0]?.removing === true,
  );
  await cancel();
  let live = await liveFiles(owner, ownerId);
  check(
    `${label}: Cancel keeps it`,
    live.record.length === 1 && live.invoice.length === 1,
    `${live.invoice.length} invoice, ${live.record.length} reference`,
  );

  /* --- a save with nothing changed duplicates nothing ------------------- */
  await reopen();
  await save();
  live = await liveFiles(owner, ownerId);
  check(
    `${label}: saving without touching the clips adds nothing`,
    live.invoice.length === 1 && live.record.length === 1,
    `${live.invoice.length} invoice, ${live.record.length} reference`,
  );

  /* --- remove the invoice ------------------------------------------------ */
  await reopen();
  const marked = await clipButton("Invoice", `Remove ${path.basename(files.invoice)}`);
  s = await slots();
  check(`${label}: the invoice can be marked to come off`, marked && s.invoice.stored[0]?.removing === true);
  await save();
  live = await liveFiles(owner, ownerId);
  check(
    `${label}: saved, the invoice is gone from the database and the reference stays`,
    live.invoice.length === 0 && live.record.length === 1,
    `${live.invoice.length} invoice, ${live.record.length} reference`,
  );
  const cells = await table();
  check(
    `${label}: the table then reads N/A for Invoice and View for Reference`,
    cells.invoice === "N/A" && /View/.test(cells.reference ?? ""),
    JSON.stringify(cells),
  );
  if (popup) {
    const shown = await popup();
    check(
      `${label}: and the popup agrees`,
      shown && shown.Invoice === "N/A" && /1 attached/.test(shown.Reference ?? ""),
      shown ? `Invoice "${shown.Invoice}", Reference "${shown.Reference}"` : "no popup",
    );
    await closePopup();
  }

  /* --- a replacement goes on as one file --------------------------------- */
  await reopen();
  s = await slots();
  check(`${label}: the form now says no invoice is attached`, /No invoice attached/.test(s.invoice.text) && s.invoice.stored.length === 0);
  await attach("Invoice", files.second);
  await save();
  live = await liveFiles(owner, ownerId);
  check(
    `${label}: a new invoice attached in edit goes up once`,
    live.invoice.length === 1 && live.invoice[0].original_name === path.basename(files.second) && live.record.length === 1,
    live.all.map((f) => `${f.kind}:${f.original_name}`).join(", "),
  );
  const after = await table();
  check(`${label}: and the Invoice cell shows it`, /View/.test(after.invoice ?? ""), JSON.stringify(after));
}

try {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
  page = await context.newPage();
  await page.setViewport({ width: 1600, height: 1100 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));

  const bdt = await q(
    `select a.id, a.name,
            a.opening_balance + coalesce(sum(t.signed_amount) filter (where t.voided_at is null and t.deleted_at is null), 0) as balance
       from accounts a left join transactions t on t.account_id = a.id
      where a.currency = 'BDT' and a.is_active and a.deleted_at is null and a.name !~ 'QA( |$)'
      group by a.id order by balance desc limit 2`,
  );
  if (bdt.length < 2) throw new Error("needs two active taka accounts");

  /* ================================================================ Cash In */
  console.log("\nCash In");
  const cash = {
    invoice: fixture("attachqa-cash-invoice.png"),
    reference: fixture("attachqa-cash-reference.png"),
    second: fixture("attachqa-cash-invoice-2.png"),
  };
  await open("/accounts/cash-in");
  await clickText(/^Add cash$/);
  await page.waitForSelector("[data-popup] form#cash-in-form", { timeout: 20000 });
  check("Cash In: the new form is titled Add cash", (await slots())?.title === "Add cash");
  const cashAccount = await chooseAccount(bdt[0].name);
  await setField("txnDate", today);
  await setField("description", `${MARK} cash in`);
  await setField("amount", "5000");
  await setField("usdRate", "122.50");
  await attach("Invoice", cash.invoice);
  await attach("Reference", cash.reference);
  let s = await slots();
  check(
    "Cash In: one picked file on each clip before saving",
    s.invoice.picked.length === 1 && s.reference.picked.length === 1,
    `${s.invoice.picked} / ${s.reference.picked}`,
  );
  await save();
  const cashRow = (await q(`select id, ref_no from transactions where description = $1 and deleted_at is null`, [`${MARK} cash in`]))[0];
  check("Cash In: the entry is recorded", Boolean(cashRow) && cashAccount === bdt[0].id, cashRow?.ref_no ?? "not saved");
  if (cashRow) {
    let live = await liveFiles("transaction_id", cashRow.id);
    check(
      "Cash In: exactly ONE invoice and ONE reference stored",
      live.invoice.length === 1 && live.record.length === 1 && live.all.length === 2,
      live.all.map((f) => `${f.kind}:${f.original_name}`).join(", "),
    );

    await open("/accounts/cash-in");
    const cashTable = async () => {
      await open("/accounts/cash-in");
      return { invoice: await cell(cashRow.id, "Invoice"), reference: await cell(cashRow.id, "Reference") };
    };
    const cells = await cashTable();
    check(
      "Cash In: the table shows the invoice — View, not N/A — and the reference",
      /View/.test(cells.invoice ?? "") && /View/.test(cells.reference ?? ""),
      JSON.stringify(cells),
    );
    const shown = await popupOf(cashRow.id);
    check(
      "Cash In: the popup agrees — 1 attached of each",
      /^1 attached/.test(shown?.Invoice ?? "") && /^1 attached/.test(shown?.Reference ?? ""),
      shown ? `Invoice "${shown.Invoice}", Reference "${shown.Reference}"` : "no popup",
    );
    check("Cash In: the popup's invoice View opens one document", (await viewFromPopup("Invoice")) === 1);
    check("Cash In: the popup's reference View opens one document", (await viewFromPopup("Reference")) === 1);
    await closePopup();

    /* The same row on the account's register (the table All transactions
       draws) and on the bank statement. */
    await open(`/accounts/${bdt[0].id}/register?from=${today}&to=${today}`);
    const reg = { invoice: await cell(cashRow.id, "Invoice"), reference: await cell(cashRow.id, "Reference") };
    check(
      "Register (All transactions' table): the same row shows both",
      /View/.test(reg.invoice ?? "") && /View/.test(reg.reference ?? ""),
      JSON.stringify(reg),
    );
    await open(`/statement?account=${bdt[0].id}&from=${today}&to=${today}`);
    const stmt = await cell(cashRow.id, "Invoice");
    check("Bank statement: the Invoice column shows it — not N/A", /View/.test(stmt ?? ""), JSON.stringify(stmt));
    const stmtPopup = await popupOf(cashRow.id);
    check("Bank statement: the popup agrees", /^1 attached/.test(stmtPopup?.Invoice ?? ""), stmtPopup?.Invoice);
    check("Bank statement: its invoice View opens only the invoice", (await viewFromPopup("Invoice")) === 1);
    await closePopup();

    await open("/accounts/cash-in");
    await rowEdit(cashRow.id);
    s = await slots();
    check(
      "Cash In: a correction is titled Edit, and saves with Save changes",
      /^Edit TXN-/.test(s?.title ?? "") && s.buttons.includes("Save changes") && !s.buttons.includes("Add it"),
      `${s?.title} | ${s?.buttons.slice(-3).join(", ")}`,
    );
    await cancel();

    await editCycle({
      label: "Cash In",
      owner: "transaction_id",
      ownerId: cashRow.id,
      files: cash,
      reopen: async () => {
        await open("/accounts/cash-in");
        await rowEdit(cashRow.id);
      },
      table: cashTable,
      popup: async () => {
        await open("/accounts/cash-in");
        return popupOf(cashRow.id);
      },
    });
  }

  /* ======================================================== Other expenses */
  console.log("\nOther expenses (the ledger form — registers, headings, All transactions)");
  const exp = {
    invoice: fixture("attachqa-exp-invoice.png"),
    reference: fixture("attachqa-exp-reference.png"),
    second: fixture("attachqa-exp-invoice-2.png"),
  };
  await open("/expenses/other");
  await clickText(/^Add expense$/);
  await page.waitForSelector("[data-popup] form#txn-form", { timeout: 20000 });
  await chooseAccount(bdt[0].name);
  await setField("txnDate", today);
  await setField("description", `${MARK} expense`);
  await setField("amount", "300");
  await setField("usdRate", "122.50");
  await page.evaluate(() => {
    const p = [...document.querySelectorAll("[data-popup]")].pop();
    [...p.querySelectorAll("button")].find((b) => /Choose a category/i.test(b.textContent ?? ""))?.click();
  });
  await settle(1200);
  await page.evaluate(() => {
    const picker = [...document.querySelectorAll('[role="dialog"]')].pop();
    [...(picker?.querySelectorAll("button") ?? [])]
      .find((b) => {
        const t = (b.textContent ?? "").trim();
        return t && !/cancel|close|choose|new|add/i.test(t) && t.length < 40;
      })
      ?.click();
  });
  await settle(1000);
  await attach("Invoice", exp.invoice);
  await attach("Reference", exp.reference);
  await save();
  const expRow = (await q(`select id, ref_no from transactions where description = $1 and deleted_at is null`, [`${MARK} expense`]))[0];
  check("Other expenses: the entry is recorded", Boolean(expRow), expRow?.ref_no ?? "not saved");
  if (expRow) {
    const live = await liveFiles("transaction_id", expRow.id);
    check(
      "Other expenses: exactly ONE invoice and ONE reference stored",
      live.invoice.length === 1 && live.record.length === 1 && live.all.length === 2,
      live.all.map((f) => `${f.kind}:${f.original_name}`).join(", "),
    );
    const expTable = async () => {
      await open("/expenses/other");
      return { invoice: await cell(expRow.id, "Invoice"), reference: await cell(expRow.id, "Reference") };
    };
    const cells = await expTable();
    check(
      "Other expenses: the table shows the invoice — View, not N/A — and the reference",
      /View/.test(cells.invoice ?? "") && /View/.test(cells.reference ?? ""),
      JSON.stringify(cells),
    );
    const shown = await popupOf(expRow.id);
    check(
      "Other expenses: the popup agrees",
      /^1 attached/.test(shown?.Invoice ?? "") && /^1 attached/.test(shown?.Reference ?? ""),
      shown ? `Invoice "${shown.Invoice}", Reference "${shown.Reference}"` : "no popup",
    );
    await closePopup();
    await open("/expenses/other");
    await rowEdit(expRow.id);
    s = await slots();
    check(
      "Other expenses: the edit form no longer lists the files a second time below the clips",
      !/Documents on this entry/.test(await page.evaluate(() => [...document.querySelectorAll("[data-popup]")].pop()?.textContent ?? "")),
    );
    await cancel();

    await editCycle({
      label: "Other expenses",
      owner: "transaction_id",
      ownerId: expRow.id,
      files: exp,
      reopen: async () => {
        await open("/expenses/other");
        await rowEdit(expRow.id);
      },
      table: expTable,
      popup: async () => {
        await open("/expenses/other");
        return popupOf(expRow.id);
      },
    });
  }

  /* ========================================================= Money Transfer */
  console.log("\nMoney Transfer (no edit form: a wrong transfer is voided and recorded again)");
  const xfer = {
    invoice: fixture("attachqa-xfer-invoice.png"),
    reference: fixture("attachqa-xfer-reference.png"),
  };
  await open("/transfers");
  await clickText(/^(Move money|Add a transfer|New transfer)$/);
  await page.waitForSelector("[data-popup] form#transfer-form", { timeout: 20000 });
  await setField("fromAccountId", bdt[0].id);
  await settle(300);
  await setField("toAccountId", bdt[1].id);
  await setField("txnDate", today);
  await setField("description", `${MARK} transfer`);
  await setField("amount", "100");
  check("Money Transfer: the rate box is filled", await setByLabel("USD rate", "122.50"));
  await attach("Invoice", xfer.invoice);
  await attach("Reference", xfer.reference);
  s = await slots();
  check(
    "Money Transfer: one picked file on each clip",
    s.invoice.picked.length === 1 && s.reference.picked.length === 1,
    `${s.invoice.picked} / ${s.reference.picked}`,
  );
  await save();
  const outRow = (
    await q(`select id from transactions where description = $1 and direction = 'out' and deleted_at is null`, [`${MARK} transfer`])
  )[0];
  check("Money Transfer: the pair is recorded", Boolean(outRow));
  if (outRow) {
    const live = await liveFiles("transaction_id", outRow.id);
    check(
      "Money Transfer: exactly ONE invoice and ONE reference stored",
      live.invoice.length === 1 && live.record.length === 1 && live.all.length === 2,
      live.all.map((f) => `${f.kind}:${f.original_name}`).join(", "),
    );
    await open("/transfers");
    const cells = { invoice: await cell(outRow.id, "Invoice"), reference: await cell(outRow.id, "Reference") };
    check(
      "Money Transfer: the table shows both",
      /View/.test(cells.invoice ?? "") && /View/.test(cells.reference ?? ""),
      JSON.stringify(cells),
    );
    const shown = await popupOf(outRow.id);
    check(
      "Money Transfer: the popup agrees",
      /^1 attached/.test(shown?.Invoice ?? "") && /^1 attached/.test(shown?.Reference ?? ""),
      shown ? `Invoice "${shown.Invoice}", Reference "${shown.Reference}"` : "no popup",
    );
    await closePopup();
  }

  /* ======================================================== Subscriptions */
  console.log("\nAI tools and subscriptions (plan created through the API; its edit form driven)");
  const sub = {
    invoice: fixture("attachqa-sub-invoice.png"),
    reference: fixture("attachqa-sub-reference.png"),
    second: fixture("attachqa-sub-invoice-2.png"),
  };
  const created = await fetch(`${API}/subscriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Requested-With": "finance-web" },
    body: JSON.stringify({
      toolName: `${MARK} Tool`,
      planName: "Pro",
      category: "ai_tool",
      status: "active",
      costUsd: "20.00",
      usdRate: "122.50",
      billingCycle: "monthly",
      startDate: today,
    }),
  });
  const plan = await created.json().catch(() => null);
  check("Subscriptions: a plan to edit", created.status < 300 && Boolean(plan?.id), `HTTP ${created.status}`);
  if (plan?.id) {
    for (const [file, kind] of [
      [sub.invoice, "invoice"],
      [sub.reference, "bank_statement"],
    ]) {
      const form = new FormData();
      form.append("file", new Blob([fs.readFileSync(file)], { type: "image/png" }), path.basename(file));
      form.append("kind", kind);
      await fetch(`${API}/files/subscription/${plan.id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "X-Requested-With": "finance-web" },
        body: form,
      });
    }
    const live = await liveFiles("subscription_id", plan.id);
    check("Subscriptions: one invoice and one bank record on it", live.invoice.length === 1 && live.record.length === 1);
    const subTable = async () => {
      await open("/subscriptions");
      await settle(800);
      return { invoice: await cell(plan.id, "Invoice"), reference: await cell(plan.id, "Reference") };
    };
    const cells = await subTable();
    check(
      "Subscriptions: the table shows both",
      /View/.test(cells.invoice ?? "") && /View/.test(cells.reference ?? ""),
      JSON.stringify(cells),
    );
    await editCycle({
      label: "Subscriptions",
      owner: "subscription_id",
      ownerId: plan.id,
      files: sub,
      reopen: async () => {
        await open("/subscriptions");
        await settle(800);
        await rowEdit(plan.id);
      },
      table: subTable,
      popup: null,
    });
  }

  /* ================================================================== TDS */
  const taxed = (await q(`select count(*)::int n from payroll_lines where tds_amount > 0`))[0].n;
  console.log(
    taxed
      ? `\nTDS: ${taxed} taxed payroll line(s) exist, but this harness does not write challans onto real rows — checked by hand.`
      : "\nTDS: not reachable locally — no payroll line carries tax, so the challan form cannot be opened.",
  );

  check("no page errors and no 5xx on the way", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  await wipe();
  await db.end();
  fs.rmSync(dir, { recursive: true, force: true });
}

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
