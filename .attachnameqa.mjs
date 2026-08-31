/**
 * The name of a file you just attached, on all four forms that take one.
 *
 * The owner: *"upload document gular name color change hobe."* The whole row
 * was `text-muted-foreground`, so the file somebody had just chosen looked
 * exactly like the hint underneath telling them to choose one.
 *
 * Colour is the one thing a diff cannot settle. `text-foreground` in the source
 * proves nothing about what the browser paints — a parent's colour, a more
 * specific rule, or a token that resolves to nearly the same value all leave
 * the class in place and the screen unchanged. So this attaches a real file and
 * asks the browser for the computed colour of the NAME and of the HINT beside
 * it, and requires them to be different.
 *
 * Four forms, because `Attach` is copied into four files and a change to three
 * of them is worse than a change to none.
 *
 *     node .attachnameqa.mjs      (local only — attaches, saves nothing)
 */
import fs from "node:fs";
import path from "node:path";
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
await db.end();

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* A real file, with a long enough name to be worth truncating. */
const dir = process.env.TEMP || ".";
const sample = path.join(dir, "Tohibar_Academy_Technology_Invoice_August.png");
/* A 1x1 PNG. Small on purpose: the point is the name, not the bytes. */
fs.writeFileSync(
  sample,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
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
await page.setViewport({ width: 1700, height: 1300 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * oklab again — the app's tokens are oklch, so `getComputedStyle` answers in
 * oklab and a naive string compare of two different-looking colours can still
 * be the right answer. Lightness is the first number; a name that is meant to
 * step forward has to differ from the caption beside it by more than rounding.
 */
const lightnessOf = (value) => {
  const s = String(value ?? "");
  /* `lab(95.93 …)` on 0-100, `oklab(0.95 …)` on 0-1. The first parser handled
     only oklab, so every real colour fell through to the rgb branch, found no
     rgb, and returned null — two nulls compare equal and the check reported
     two visibly different colours as identical. */
  const lab = /oklab\(\s*([\d.]+)/.exec(s);
  if (lab) return Number(lab[1]);
  const cie = /(?:^|\s)lab\(\s*([\d.]+)/.exec(s);
  if (cie) return Number(cie[1]) / 100;
  const rgb = /rgba?\(([^)]+)\)/.exec(s);
  if (!rgb) return null;
  const [r, g, b] = rgb[1].split(",").map((n) => Number(n.trim()));
  /* Rough relative luminance is enough to tell a caption from content. */
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

const FORMS = [
  {
    label: "Cash in",
    url: `${WEB}/accounts/cash-in`,
    open: /^Add cash$|^Record cash in$|^Add cash in$/i,
  },
  {
    /*
      Other expenses, not All transactions.

      `TransactionForm` — and its own copy of `Attach` — is opened from the
      register, Other expenses and the category pages. All transactions has no
      Add button at all: an entry is recorded where it belongs, not on the list
      that shows every one of them. The first version of this harness looked
      for one there and reported the drawer as broken.
    */
    label: "Other expenses",
    url: `${WEB}/expenses/other`,
    open: /^Add expense$/i,
  },
  {
    label: "Money transfer",
    url: `${WEB}/transfers`,
    open: /^Move money$|^Add a transfer$|^New transfer$/i,
  },
  {
    label: "AI tools and subscriptions",
    url: `${WEB}/subscriptions`,
    open: /^Add a subscription$/i,
  },
];

for (const form of FORMS) {
  await page.goto(form.url, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(2600);

  const opened = await page.evaluate((source) => {
    const re = new RegExp(source.slice(1, source.lastIndexOf("/")), "i");
    const btn = [...document.querySelectorAll("button")].find((b) =>
      re.test((b.textContent ?? "").trim()),
    );
    if (!btn) {
      return {
        ok: false,
        buttons: [...document.querySelectorAll("button")]
          .map((b) => (b.textContent ?? "").trim())
          .filter(Boolean)
          .slice(0, 40),
      };
    }
    btn.click();
    return { ok: true };
  }, String(form.open));
  if (!opened.ok) {
    check(
      `${form.label}: the drawer opens`,
      false,
      `no button matched — page had ${JSON.stringify(opened.buttons)}`,
    );
    continue;
  }
  await settle(1600);

  /* The hidden file input inside the drawer, first one — the invoice slot. */
  const input = await page.$('[role="dialog"] input[type="file"]');
  if (!input) {
    check(`${form.label}: the drawer has a file slot`, false, "no file input");
    continue;
  }
  await input.uploadFile(sample);
  await settle(1400);

  const measured = await page.evaluate((fileName) => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
    /* The element whose OWN text is the file name. */
    const name = [...dialog.querySelectorAll("span,p")].find(
      (el) => el.children.length === 0 && (el.textContent ?? "").trim() === fileName,
    );
    if (!name) {
      return {
        found: false,
        text: (dialog?.textContent ?? "").replace(/\s+/g, " ").slice(0, 220),
      };
    }
    /* The nearest caption: the field hint, which is the thing it used to be
       indistinguishable from. */
    const field = name.closest("label") ?? dialog;
    let hint = [...field.querySelectorAll("span,p")].find(
      (el) =>
        el !== name &&
        el.children.length === 0 &&
        /Attach|attach|number to type|statement calls it/.test(el.textContent ?? ""),
    );
    /*
      Not every slot sits inside a `Field` with a hint — the subscription
      screenshot picker is written inline and has none. Falling back to any
      muted caption in the drawer keeps the comparison honest instead of
      returning null, which is what made two visibly different colours compare
      as "the same".
    */
    if (!hint) {
      hint = [...dialog.querySelectorAll("span,p")].find(
        (el) =>
          el !== name &&
          el.children.length === 0 &&
          (el.textContent ?? "").trim().length > 8 &&
          /text-muted-foreground/.test(String(el.className)),
      );
    }
    const cs = getComputedStyle(name);
    return {
      found: true,
      nameColor: cs.color,
      nameWeight: cs.fontWeight,
      hintColor: hint ? getComputedStyle(hint).color : null,
      hintText: (hint?.textContent ?? "").slice(0, 50),
    };
  }, path.basename(sample));

  check(
    `${form.label}: the attached file's name is on screen`,
    measured.found,
    measured.found ? "" : measured.text,
  );
  if (!measured.found) continue;

  check(
    `${form.label}: the name is not the same colour as the hint beside it`,
    measured.hintColor !== null &&
      measured.nameColor !== measured.hintColor &&
      Math.abs(
        (lightnessOf(measured.nameColor) ?? 0) -
          (lightnessOf(measured.hintColor) ?? 0),
      ) > 0.05,
    `name ${measured.nameColor} vs hint ${measured.hintColor} ("${measured.hintText}")`,
  );
  check(
    `${form.label}: and it carries more weight than the caption`,
    Number(measured.nameWeight) >= 500,
    `font-weight ${measured.nameWeight}`,
  );
}

await browser.close();
fs.rmSync(sample, { force: true });

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(70));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
        failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
