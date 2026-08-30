/** A picture of the register's last page — the pager under the card. */
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
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ];
    }),
);

const c = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const { rows: users } = await c.query(
  "select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1",
);
const { rows: accounts } = await c.query(`
  select a.id, a.name, count(t.id)::int as rows
  from accounts a left join transactions t on t.account_id = a.id
  group by a.id, a.name having count(t.id) > 0 order by count(t.id) desc limit 1
`);
await c.end();

const token = jwt.sign(
  { sub: users[0].id, role: users[0].role, tv: users[0].token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const b = await puppeteer.launch({
  executablePath: fs.existsSync(chrome)
    ? chrome
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await b.setCookie({
  name: "sfm_access",
  value: token,
  domain: "localhost",
  path: "/",
});
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 1400 });
await p.goto(`http://localhost:3000/accounts/${accounts[0].id}/register`, {
  waitUntil: "networkidle0",
  timeout: 90000,
});
await new Promise((r) => setTimeout(r, 500));
await p.screenshot({ path: "regpage-1.png", fullPage: true });

const next = async () => {
  await p.evaluate(() =>
    [...document.querySelectorAll("button")]
      .find((btn) => btn.innerText.trim() === "Next")
      ?.click(),
  );
  await new Promise((r) => setTimeout(r, 400));
};
await next();
await next();
await p.screenshot({ path: "regpage-3.png", fullPage: true });
await b.close();
console.log("wrote regpage-1.png and regpage-3.png");
