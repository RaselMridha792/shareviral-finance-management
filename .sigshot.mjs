// The Signed by block, as somebody actually sees it.
//
//   node .sigshot.mjs
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const REPO = "d:/codes/Finance-Management-software";
const OUT = path.join(REPO, ".sigcheck-out");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(REPO, "apps/api/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i).trim(),
        l.slice(i + 1).trim().replace(/^["']|["']$/g, ""),
      ];
    }),
);

const db = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const { rows } = await db.query(
  `select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`,
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
await browser.setCookie({
  name: "sfm_access",
  value: token,
  domain: "localhost",
  path: "/",
});

fs.mkdirSync(OUT, { recursive: true });

for (const width of [1440, 640, 390]) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 1100, deviceScaleFactor: 2 });
  await page.goto("http://localhost:3000/reports", {
    waitUntil: "networkidle0",
    timeout: 90000,
  });
  await new Promise((r) => setTimeout(r, 1200));

  const found = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h3")].find(
      (h) => h.textContent?.trim() === "Signed by",
    );
    if (!heading) return null;
    const block = heading.closest("div")?.parentElement?.parentElement;
    block?.scrollIntoView({ block: "center" });
    const cards = [
      ...(block?.querySelectorAll("img") ?? []),
    ].map((img) => ({
      alt: img.alt,
      width: img.clientWidth,
      height: img.clientHeight,
      // Zero means the bytes never arrived, which looks exactly like a blank
      // plate and is a completely different bug.
      natural: `${img.naturalWidth}x${img.naturalHeight}`,
      complete: img.complete,
    }));
    const rect = block?.getBoundingClientRect();
    return {
      images: cards,
      inputs: block?.querySelectorAll("input:not([type=file])").length ?? 0,
      uploaders: block?.querySelectorAll("input[type=file]").length ?? 0,
      overflows: (block?.scrollWidth ?? 0) > (block?.clientWidth ?? 0) + 1,
      box: rect
        ? { top: Math.round(rect.top), height: Math.round(rect.height), width: Math.round(rect.width) }
        : null,
    };
  });

  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({
    path: path.join(OUT, `signed-by-${width}.png`),
    fullPage: false,
  });

  // And one close-up of a single card, because "is there ink on the plate" is
  // not a question a 1440px screenshot can answer.
  const card = await page.evaluateHandle(() => {
    const img = document.querySelector('img[alt$="signature"]');
    return img?.closest("div.flex.flex-col.gap-2") ?? img;
  });
  if (card) {
    await card.asElement()?.screenshot({
      path: path.join(OUT, `signed-by-card-${width}.png`),
    });
  }
  console.log(width, JSON.stringify(found));
  await page.close();
}

await browser.close();
console.log(`shots in ${OUT}`);
