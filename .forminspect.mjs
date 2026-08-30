/** What the drawer actually offers, once it is open. */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const REPO = "d:/codes/Finance-Management-software";
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(REPO, "apps/api/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const c = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const u = (
  await c.query(
    "select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1",
  )
).rows[0];
await c.end();

const token = jwt.sign(
  { sub: u.id, role: u.role, tv: u.token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
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
await page.setViewport({ width: 1500, height: 1100 });
await page
  .goto("http://localhost:3000" + (process.argv[2] || "/transactions"), {
    waitUntil: "networkidle0",
    timeout: 120000,
  })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 2200));

const clicked = await page.evaluate(() => {
  const scope = document.querySelector("main") || document.body;
  const b = [...scope.querySelectorAll("button")].find((x) =>
    /^add\b/i.test(x.textContent.trim()),
  );
  if (!b) return null;
  b.click();
  return b.textContent.trim();
});
console.log("clicked: " + clicked);
await new Promise((r) => setTimeout(r, 1600));

const fields = await page.evaluate(() => {
  const one = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, 30);
  return [...document.querySelectorAll("input,select,textarea")]
    .filter((el) => el.offsetParent !== null)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      name: el.getAttribute("name"),
      type: el.getAttribute("type"),
      ph: el.getAttribute("placeholder"),
      label: one(
        el.closest("label")?.innerText ||
          el.parentElement?.parentElement?.querySelector("label,span")?.innerText,
      ),
      required: el.required,
      options:
        el.tagName === "SELECT"
          ? [...el.options].slice(0, 3).map((o) => o.textContent.trim())
          : undefined,
    }));
});

console.log("visible fields:");
for (const f of fields) {
  console.log(
    "   " +
      (f.name || "-").padEnd(16) +
      f.tag.padEnd(9) +
      (f.type || "").padEnd(9) +
      (f.required ? "req " : "    ") +
      (f.label || f.ph || "") +
      (f.options ? "  [" + f.options.join(" / ") + "]" : ""),
  );
}

const buttons = await page.evaluate(() =>
  [...document.querySelectorAll("button")]
    .filter((b) => b.offsetParent !== null)
    .map((b) => b.textContent.trim())
    .filter(Boolean)
    .slice(-8),
);
console.log("   last buttons: " + JSON.stringify(buttons));
await browser.close();
