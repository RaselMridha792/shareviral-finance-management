/*
 * What actually renders when the app points at a file on the API host?
 *
 * Two questions, both measured rather than reasoned about:
 *   - the PDF viewer's iframe (the owner's bug: "refused to connect");
 *   - an <img> at the same origin, which X-Frame-Options does not govern but
 *     Cross-Origin-Resource-Policy: same-origin might.
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

await db.query(
  `delete from files where team_member_id in
     (select id from team_members where full_name like 'FVQA %')`,
);
await db.query("delete from team_members where full_name like 'FVQA %'");
const member = (
  await db.query(
    `insert into team_members (full_name, engagement_type, designation, status, joined_on, created_by, updated_by)
     values ('FVQA Papers', 'employee', 'Tester', 'active', '2026-01-01', $1, $1) returning id`,
    [person.id],
  )
).rows[0].id;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF",
);
const upload = async (kind, name, bytes, mime) => {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), name);
  form.append("kind", kind);
  const res = await fetch(`${API}/files/team-member/${member}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return (await res.json().catch(() => null))?.id;
};
const photoId = await upload("profile_photo", "fvqa.png", PNG, "image/png");
const cvId = await upload("cv", "fvqa-cv.pdf", PDF, "application/pdf");

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1100 });
/*
 * The decisive signal. A refused frame and a successfully-loaded cross-origin
 * frame BOTH throw on contentDocument, so reading that proves nothing; the
 * browser's own refusal message is what separates them, and it is the exact
 * sentence the owner saw on screen.
 */
const refusals = [];
page.on("console", (m) => {
  const t = m.text();
  if (/Refused to (display|frame)|X-Frame-Options|frame-ancestors/i.test(t)) {
    refusals.push(t.slice(0, 160));
  }
});
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${WEB}/team/${member}`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);

// 1. The photo — does an <img> at the API host actually paint?
const img = await page.evaluate(async (id) => {
  const src = `http://localhost:4001/api/files/${id}/content`;
  const el = new Image();
  el.src = src;
  const out = await new Promise((resolve) => {
    el.onload = () => resolve({ loaded: true, w: el.naturalWidth });
    el.onerror = () => resolve({ loaded: false, w: 0 });
    setTimeout(() => resolve({ loaded: false, w: -1, timedOut: true }), 6000);
  });
  return out;
}, photoId);
console.log("img from the API host:", JSON.stringify(img));

// 2. The PDF — frame it exactly as DocumentViewer does today.
const framed = await page.evaluate(async (id) => {
  const f = document.createElement("iframe");
  f.src = `http://localhost:4001/api/files/${id}/content?inline=1`;
  document.body.appendChild(f);
  await new Promise((r) => setTimeout(r, 3500));
  let reachable = false;
  try {
    reachable = Boolean(f.contentDocument && f.contentDocument.body);
  } catch {
    reachable = false; // cross-origin but LOADED reads as an exception
  }
  // A frame the browser refused leaves an about:blank-ish empty document that
  // IS reachable; a frame that loaded cross-origin throws instead.
  return { sameOriginReadable: reachable };
}, cvId);
console.log("iframe straight at the API:", JSON.stringify(framed));
console.log("  browser refusals:", refusals.length ? refusals.join(" | ") : "none");

// 3. The blob route, which is what the ledger dialog uses.
const viaBlob = await page.evaluate(async (id) => {
  const res = await fetch(
    `http://localhost:4001/api/files/${id}/content?inline=1`,
    { credentials: "include" },
  );
  if (!res.ok) return { ok: false, status: res.status };
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const f = document.createElement("iframe");
  f.src = url;
  document.body.appendChild(f);
  await new Promise((r) => setTimeout(r, 2500));
  let painted = false;
  try {
    painted = Boolean(f.contentDocument);
  } catch {
    painted = true; // a real cross-origin-ish document
  }
  return { ok: true, type: blob.type, bytes: blob.size, painted };
}, cvId);
console.log("via a blob URL:", JSON.stringify(viaBlob));

await browser.close();
await db.query(`delete from files where team_member_id = $1`, [member]);
await db.query("delete from team_members where id = $1", [member]);
await db.end();
