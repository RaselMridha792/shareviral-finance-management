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
const db = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const { rows } = await db.query(
  "select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1",
);
await db.end();
const token = jwt.sign(
  { sub: rows[0].id, role: rows[0].role, tv: rows[0].token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome) ? chrome : edge,
  headless: "new",
  args: ["--no-sandbox"],
});
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const out = process.argv[2] || "statement.png";
await page.goto("http://localhost:3000/statement", { waitUntil: "networkidle0", timeout: 90000 });
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: out, fullPage: true });
// And the last page, where the pager and the closing line meet the short page.
for (let i = 0; i < 2; i += 1) {
  await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .find((b) => b.innerText.trim() === "Next")
      ?.click(),
  );
  await new Promise((r) => setTimeout(r, 400));
}
await page.screenshot({ path: out.replace(".png", "-last.png"), fullPage: true });
await browser.close();
console.log("shot", out);
