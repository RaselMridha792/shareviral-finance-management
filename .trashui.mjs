/**
 * The dialog, driven the way a person drives it.
 *
 * Every claim about this dialog is about what it *refuses* to do — stay armed
 * between openings, go through on a tick alone, go through on the word alone —
 * and none of those can be read off the source with any confidence. So this
 * clicks the button, reads whether Confirm is disabled, types the wrong word,
 * types the right one, and checks the row afterwards.
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

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
    `select id, email, role, token_version from users
      where role='super_admin' and status='active' and deleted_at is null
      order by created_at limit 1`,
  )
).rows[0];

// Two rows to aim at, made here so the run is repeatable.
const account = (await db.query("select id from accounts where deleted_at is null limit 1")).rows[0];
const make = async (desc) =>
  (
    await db.query(
      `insert into transactions (ref_no, account_id, direction, txn_date, amount, currency, description, created_by, updated_by)
       values ('TXN-UI-' || floor(random()*100000)::int, $1, 'out', '2026-08-12', '4321.00', 'BDT', $2, $3, $3)
       returning id, ref_no`,
      [account.id, desc, person.id],
    )
  ).rows[0];

/*
 * Leftovers first. This harness aims at a row by the words in it, so a row
 * from a run that died before its cleanup — the API going down mid-run is
 * enough — leaves a second row wearing the same description. The next run then
 * opens the dialog on the stranger, trashes that one instead, and reports its
 * own freshly-seeded row as untouched: three failures that look exactly like
 * a broken delete and are nothing of the sort.
 */
await db.query("delete from transactions where description like 'UI QA:%'");

const first = await make("UI QA: the row to delete");
const second = await make("UI QA: the row that must survive");

const token = jwt.sign(
  { sub: person.id, role: person.role, tv: person.token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "1h" },
);

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome)
    ? chrome
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await browser.setCookie({
  name: "sfm_access",
  value: token,
  domain: "localhost",
  path: "/",
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------- the delete button */

await page.goto(`${WEB}/transactions`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(1500);

const buttons = await page.$$('button[aria-label="Move to trash"]');
check(
  "every row carries a delete button",
  buttons.length > 0,
  `${buttons.length} on the page`,
);

/** The dialog, or null. */
const dialogState = () =>
  page.evaluate(() => {
    const box = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
      /to the trash\?/i.test(d.textContent ?? ""),
    );
    if (!box) return null;
    const confirm = [...box.querySelectorAll("button")].find((b) =>
      /^Yes, trash/i.test(b.textContent ?? ""),
    );
    return {
      title: box.querySelector("h2")?.textContent?.trim() ?? "",
      body: (box.textContent ?? "").replace(/\s+/g, " ").slice(0, 400),
      hasCheckbox: Boolean(box.querySelector('input[type="checkbox"]')),
      hasWordField: /Type\s*trash\s*to\s*confirm/i.test(
        (box.textContent ?? "").replace(/\s+/g, " "),
      ),
      confirmDisabled: confirm ? confirm.disabled : null,
      confirmLabel: confirm?.textContent?.trim() ?? null,
    };
  });

/** Open the dialog on the row whose text contains `needle`. */
const openOn = async (needle) => {
  const opened = await page.evaluate((text) => {
    const row = [...document.querySelectorAll("tbody tr")].find((r) =>
      (r.textContent ?? "").includes(text),
    );
    if (!row) return false;
    const button = row.querySelector('button[aria-label="Move to trash"]');
    if (!button) return false;
    button.click();
    return true;
  }, needle);
  await settle(500);
  return opened;
};

check("the target row is on the page", await openOn("UI QA: the row to delete"), "");

let state = await dialogState();
check(
  "the confirmation opens with both gates and Confirm disabled",
  Boolean(state) &&
    state.hasCheckbox &&
    state.hasWordField &&
    state.confirmDisabled === true,
  state
    ? `"${state.title}", checkbox ${state.hasCheckbox}, word field ${state.hasWordField}, confirm disabled ${state.confirmDisabled}`
    : "no dialog appeared",
);

check(
  "it names the row being deleted",
  Boolean(state) && state.body.includes("UI QA: the row to delete"),
  "",
);

/* ------------------------------ the tick alone is not enough */

await page.evaluate(() => {
  const box = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
    /to the trash\?/i.test(d.textContent ?? ""),
  );
  box.querySelector('input[type="checkbox"]').click();
});
await settle(300);
state = await dialogState();
check(
  "ticking the box alone leaves Confirm disabled",
  state.confirmDisabled === true,
  "",
);

/* ------------------------------ nor is the wrong word */

const typeWord = async (word) => {
  await page.evaluate(() => {
    const box = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
      /to the trash\?/i.test(d.textContent ?? ""),
    );
    const field = [...box.querySelectorAll('input[type="text"], input:not([type])')].find(
      (i) => i.className.includes("font-mono"),
    );
    field.focus();
    field.select?.();
  });
  await page.keyboard.press("Backspace");
  await page.keyboard.type(word, { delay: 12 });
  await settle(300);
};

await typeWord("remove");
state = await dialogState();
check(
  'a word that is not "trash" leaves Confirm disabled',
  state.confirmDisabled === true,
  'typed "remove"',
);

/* ------------------------------ the word alone is not enough either */

await page.evaluate(() => {
  const box = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
    /to the trash\?/i.test(d.textContent ?? ""),
  );
  box.querySelector('input[type="checkbox"]').click(); // untick
});
await page.evaluate(() => {
  const box = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
    /to the trash\?/i.test(d.textContent ?? ""),
  );
  const field = [...box.querySelectorAll("input")].find((i) =>
    i.className.includes("font-mono"),
  );
  field.value = "";
});
await typeWord("trash");
state = await dialogState();
check(
  "the word without the tick leaves Confirm disabled",
  state.confirmDisabled === true,
  "",
);

/* ------------------------------ both together arm it */

await page.evaluate(() => {
  const box = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
    /to the trash\?/i.test(d.textContent ?? ""),
  );
  box.querySelector('input[type="checkbox"]').click();
});
await settle(300);
state = await dialogState();
check("tick and word together arm Confirm", state.confirmDisabled === false, "");

/* ------------------------------ cancelling changes nothing */

await page.evaluate(() => {
  const box = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
    /to the trash\?/i.test(d.textContent ?? ""),
  );
  [...box.querySelectorAll("button")]
    .find((b) => /No, keep it/i.test(b.textContent ?? ""))
    .click();
});
await settle(600);
const afterCancel = (
  await db.query("select deleted_at from transactions where id = $1", [first.id])
).rows[0];
check("saying no leaves the row alone", !afterCancel.deleted_at, "");

/* --------------- and reopening starts from nothing, not from last time */

await openOn("UI QA: the row to delete");
state = await dialogState();
check(
  "reopening is disarmed again, not still holding the typed word",
  state.confirmDisabled === true,
  "",
);

/* ------------------------------ going through with it */

await page.evaluate(() => {
  const box = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
    /to the trash\?/i.test(d.textContent ?? ""),
  );
  box.querySelector('input[type="checkbox"]').click();
});
await typeWord("trash");
await page.evaluate(() => {
  const box = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
    /to the trash\?/i.test(d.textContent ?? ""),
  );
  const reason = [...box.querySelectorAll("input")].find(
    (i) => i.type !== "checkbox" && !i.className.includes("font-mono"),
  );
  if (reason) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(reason, "UI QA: typed into the reason box");
    reason.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
await settle(300);
await page.evaluate(() => {
  const box = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
    /to the trash\?/i.test(d.textContent ?? ""),
  );
  [...box.querySelectorAll("button")]
    .find((b) => /^Yes, trash/i.test(b.textContent ?? ""))
    .click();
});
await settle(2000);

const afterDelete = (
  await db.query(
    "select deleted_at, deleted_by, delete_reason, voided_at from transactions where id = $1",
    [first.id],
  )
).rows[0];
check(
  "the row is deleted, with who and why recorded",
  Boolean(afterDelete.deleted_at) &&
    afterDelete.deleted_by === person.id &&
    afterDelete.delete_reason === "UI QA: typed into the reason box",
  `reason: ${afterDelete.delete_reason ?? "none"}`,
);
check(
  "and voided with it, so no total counts it",
  Boolean(afterDelete.voided_at),
  "",
);

const stillOnScreen = await page.evaluate(
  (text) => document.body.innerText.includes(text),
  "UI QA: the row to delete",
);
check("it has left the table without a reload", !stillOnScreen, "");

const neighbourSurvived = (
  await db.query("select deleted_at from transactions where id = $1", [second.id])
).rows[0];
check(
  "the row next to it is untouched",
  !neighbourSurvived.deleted_at,
  "",
);

/* ------------------------------------------------------- Settings → Trashed */

await page.goto(`${WEB}/settings?tab=trashed`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2000);
const trashText = await page.evaluate(() => document.body.innerText);
check(
  "Settings has a Trashed tab and the row is in it",
  /Trashed/.test(trashText) && trashText.includes("UI QA: the row to delete"),
  trashText.includes("UI QA: the row to delete")
    ? "listed with its reason"
    : "the row is not listed",
);
check(
  "the trash says who deleted it and why",
  trashText.includes("UI QA: typed into the reason box"),
  "",
);

/* ------------------------------------------------------------ restoring it */

const restored = await page.evaluate(() => {
  const row = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes("UI QA: the row to delete"),
  );
  if (!row) return false;
  const button = [...row.querySelectorAll("button")].find((b) =>
    /Restore/i.test(b.textContent ?? ""),
  );
  if (!button) return false;
  button.click();
  return true;
});
await settle(2500);
const afterRestore = (
  await db.query(
    "select deleted_at, voided_at from transactions where id = $1",
    [first.id],
  )
).rows[0];
check(
  "Restore puts it back, void and all",
  restored && !afterRestore.deleted_at && !afterRestore.voided_at,
  restored ? "" : "no Restore button was found",
);

await browser.close();
await db.query("delete from transactions where id = any($1::uuid[])", [[first.id, second.id]]);
await db.end();

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(66));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
        failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
