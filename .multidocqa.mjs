/**
 * One clip, several papers — and a slider to move between them.
 *
 * The owner: *"multiple documents upload korar option thakte hobe ... multiple
 * documents hole slider or different type er method use korba"*.
 *
 * An invoice can be two pages photographed separately; a bank slip can be the
 * confirmation and the statement line. The clip used to keep whichever was
 * chosen last and silently drop the other, which is the worst of the three
 * possible behaviours: it looks like it worked.
 *
 * So this attaches three files to one clip, checks all three are listed and
 * all three reach the server, and drives the slider from the first to the
 * third and back round to the first.
 *
 *     node .multidocqa.mjs      (local only — writes and deletes)
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
    `select id, role, token_version from users
      where role='super_admin' and status='active' and deleted_at is null limit 1`,
  )
).rows[0];
const token = jwt.sign(
  { sub: person.id, role: person.role, tv: person.token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* Three distinguishable PNGs on disk. */
const NAMES = ["mdq-page-one.png", "mdq-page-two.png", "mdq-page-three.png"];
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAF0lEQVR42mP8z8BQz0AEYBxVSF+FAAsLBAF6r4OeAAAAAElFTkSuQmCC",
  "base64",
);
for (const n of NAMES) fs.writeFileSync(n, PNG);

const wipe = async () => {
  await db.query(
    "delete from files where transaction_id in (select id from transactions where description like 'MDQ%')",
  );
  await db.query("delete from transactions where description like 'MDQ%'");
};
await wipe();

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
await page.setViewport({ width: 1700, height: 1300 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${WEB}/expenses/other`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2400);
await page.evaluate(() => {
  const main = document.querySelector("main") ?? document.body;
  [...main.querySelectorAll("button, a")]
    .find((b) => /^Add expense$/i.test((b.textContent ?? "").trim()))
    ?.click();
});
await settle(1700);

const drawer = await page.$('[role="dialog"]');
check("the expense drawer opens", Boolean(drawer), "");

/* Three files onto the FIRST clip (the invoice). */
const inputs = await page.$$('[role="dialog"] input[type="file"]');
check("the drawer has clips to attach to", inputs.length >= 1, `${inputs.length} file inputs`);

const allowsMany = await page.evaluate(() => {
  const el = document.querySelector(
    '[role="dialog"] input[type="file"]',
  );
  return el?.multiple ?? null;
});
check(
  "THE ASK: a clip accepts more than one file at a time",
  allowsMany === true,
  `multiple ${allowsMany}`,
);

for (const n of NAMES) {
  const fresh = await page.$$(
    '[role="dialog"] input[type="file"]',
  );
  await fresh[0].uploadFile(n);
  await settle(700);
}

const listed = await page.evaluate((names) => {
  const d = document.querySelector('[role="dialog"]');
  const text = (d?.textContent ?? "").replace(/\s+/g, " ");
  return names.map((n) => text.includes(n));
}, NAMES);
check(
  "THE ASK: all three are listed, not just the last one",
  listed.every(Boolean),
  NAMES.map((n, i) => `${n}:${listed[i] ? "yes" : "NO"}`).join(" "),
);

const eyeLabel = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  const b = [...(d?.querySelectorAll("button") ?? [])].find((x) =>
    /^Preview /i.test(x.getAttribute("aria-label") ?? ""),
  );
  return b?.getAttribute("aria-label") ?? null;
});
check(
  "the eye says how many are behind it",
  /Preview 3 documents/i.test(eyeLabel ?? ""),
  eyeLabel ?? "no eye",
);

/* ------------------------------ the slider ----------------------------- */

await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  [...(d?.querySelectorAll("button") ?? [])]
    .find((x) => /^Preview /i.test(x.getAttribute("aria-label") ?? ""))
    ?.click();
});
await settle(1600);

const readSlider = () =>
  page.evaluate(() => {
    const group = document.querySelector('[aria-label="Move between the documents"]');
    return {
      shown: Boolean(group),
      text: (group?.textContent ?? "").replace(/\s+/g, " ").trim(),
    };
  });

const first = await readSlider();
check(
  "THE ASK: a slider appears, and says where you are",
  first.shown && /1 of 3/.test(first.text),
  first.text || "no slider",
);

const next = async () => {
  await page.evaluate(() => {
    document.querySelector('button[aria-label="Next document"]')?.click();
  });
  await settle(900);
  return readSlider();
};

const second = await next();
check("moving forward reaches the second", /2 of 3/.test(second.text), second.text);
const third = await next();
check("and the third", /3 of 3/.test(third.text), third.text);
const wrapped = await next();
check(
  "and wraps round to the first, rather than stopping dead",
  /1 of 3/.test(wrapped.text),
  wrapped.text,
);

const back = await page.evaluate(() => {
  document.querySelector('button[aria-label="Previous document"]')?.click();
  return true;
});
await settle(900);
const backwards = await readSlider();
check(
  "and goes backwards too",
  back && /3 of 3/.test(backwards.text),
  backwards.text,
);

/* --------------------- and all three actually go up -------------------- */

/*
 * The viewer's own Close, not Escape. Both the viewer and the drawer listen
 * for Escape, so one press shut them both and the save below then clicked a
 * "Record it" that was no longer on the page — the drawer read as closed,
 * which looked like a successful save and reported as a failed upload.
 */
await page.evaluate(() => {
  /*
   * The LAST dialog holding a picture, not the first.
   *
   * The viewer is rendered inside the drawer, so the drawer also "contains an
   * img" and matched first — and the drawer's own backdrop is a
   * <button aria-label="Close">, so this clicked the drawer shut instead of
   * the viewer. Every check afterwards then measured a page with no drawer on
   * it and reported the upload as broken.
   */
  const viewers = [...document.querySelectorAll('[role="dialog"]')].filter(
    (d) => d.querySelector("img, iframe"),
  );
  const viewer = viewers[viewers.length - 1];
  [...(viewer?.querySelectorAll("button") ?? [])]
    .find((b) => (b.getAttribute("aria-label") ?? "") === "Close")
    ?.click();
});
await settle(900);

/*
 * The drawer must still be open. Closing the viewer by clicking its backdrop
 * closed the drawer as well, and every check after it then passed or failed
 * for reasons that had nothing to do with uploads.
 */
const drawerSurvived = await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')];
  return {
    viewerGone: !dialogs.some((d) => d.querySelector("img, iframe")),
    drawerOpen: dialogs.some((d) => d.querySelector('[name="amount"]')),
  };
});
check(
  "the viewer closed and the drawer stayed open",
  drawerSurvived.viewerGone && drawerSurvived.drawerOpen,
  JSON.stringify(drawerSurvived),
);

/*
 * The form is submitted by reading `new FormData(form)`, so the hidden inputs
 * behind the category and account pickers can be filled directly — the DOM is
 * what FormData reads. The account already defaults to one; the category has
 * no default and the entry is refused without it, which is why the first
 * attempt saved nothing and reported it as a failure to upload.
 */
const catId = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0].id;

await page.evaluate(
  ({ categoryId, today }) => {
    const d = document.querySelector('[role="dialog"]');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    const set = (name, value) => {
      const el = d?.querySelector(`[name="${name}"]`);
      if (!el) return;
      setter?.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("txnDate", today);
    set("description", "MDQ three papers on one entry");
    set("amount", "1200");
    void categoryId;
  },
  {
    categoryId: catId,
    today: (await db.query(
      "select (now() at time zone 'Asia/Dhaka')::date::text d",
    )).rows[0].d,
  },
);
await settle(600);

/*
 * The category is chosen through its own control, not by writing to the hidden
 * input. `CategorySelect` is React-controlled and re-renders from state, so a
 * value poked into the DOM is overwritten before submit — the entry was
 * refused for want of a category and the drawer simply stayed open.
 */
await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  [...(d?.querySelectorAll("button") ?? [])]
    .find((b) => /Choose a category/i.test((b.textContent ?? "").trim()))
    ?.click();
});
await settle(1400);
const pickedCategory = await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')];
  const picker = dialogs[dialogs.length - 1];
  const option = [...(picker?.querySelectorAll("button") ?? [])].find((b) => {
    const t = (b.textContent ?? "").trim();
    return t && !/cancel|close|choose|new|add/i.test(t) && t.length < 40;
  });
  if (!option) return null;
  const label = (option.textContent ?? "").trim();
  option.click();
  return label;
});
await settle(1200);
check(
  "a category can be chosen",
  Boolean(pickedCategory),
  pickedCategory ?? "no category option found",
);

await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  [...(d?.querySelectorAll("button") ?? [])]
    .find((b) => /^(Record it|Save|Add)/i.test((b.textContent ?? "").trim()))
    ?.click();
});
await settle(4000);

/* What the drawer said, if it refused. Guessing at a silent failure is how
   the last two attempts were spent. */
const afterSave = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  return {
    stillOpen: Boolean(d),
    text: (d?.textContent ?? "").replace(/\s+/g, " ").slice(-300),
  };
});
check(
  "the drawer closed after Record it",
  !afterSave.stillOpen,
  afterSave.stillOpen ? afterSave.text : "closed",
);

const entry = (
  await db.query(
    "select id from transactions where description like 'MDQ%' limit 1",
  )
).rows[0];
check(
  "the entry itself was recorded",
  Boolean(entry),
  entry ? entry.id : "no MDQ transaction — the form did not submit",
);

const stored = (
  await db.query(
    `select count(*)::int n from files
      where transaction_id in (select id from transactions where description like 'MDQ%')`,
  )
).rows[0].n;
check(
  "THE ASK: all three reach the server, not one",
  stored === 3,
  `${stored} file(s) stored (expected 3)`,
);

await browser.close();
for (const n of NAMES) fs.unlinkSync(n);
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
