// Put four signed signatories on whichever period the Reports screen opens on,
// so the block can be looked at rather than described.
//
//   node .sigseed.mjs 2025-08-01 2025-08-31
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import jwt from "jsonwebtoken";
import pg from "pg";

const REPO = "d:/codes/Finance-Management-software";
const BASE = "http://localhost:3000/api";
const [, , start = "2025-08-01", end = "2025-08-31"] = process.argv;

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
const auth = {
  Cookie: `sfm_access=${jwt.sign(
    { sub: rows[0].id, role: rows[0].role, tv: rows[0].token_version },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "2h" },
  )}`,
  "x-requested-with": "finance-web",
};

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}
function signaturePng(width, height, seed) {
  const raw = Buffer.alloc(height * (width * 3 + 1), 0xff);
  // Every scanline starts with its filter type, and 0 means "none". Leaving
  // these at 0xff — which is not a filter type at all — produced a PNG that
  // still decoded to 720x180 and drew as a blank white plate, on screen and in
  // the PDF. The image was never the app's; it was the fixture's.
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  const ink = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = y * (width * 3 + 1) + 1 + x * 3;
    raw[at] = 20;
    raw[at + 1] = 20;
    raw[at + 2] = 30;
  };
  for (let x = 0; x < width; x++) {
    const t = x / width;
    const y =
      height / 2 +
      Math.sin(t * 14 + seed) * (height * 0.28) +
      Math.sin(t * 33 + seed) * (height * 0.1);
    for (let w = -7; w <= 7; w++) ink(x, Math.round(y) + w);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const people = [
  { name: "Mirza Ashiqul Islam", title: "Managing Director" },
  { name: "Farhana Rahman", title: "Head of Finance" },
  { name: "Super Admin", title: "Company Secretary" },
  { name: "Rasel Mridha", title: "Auditor" },
];

const ids = [];
for (let i = 0; i < people.length; i++) {
  // The last one is left without a mark on purpose: a mixed block is the case
  // where a grid either holds its line or does not.
  if (i === people.length - 1) {
    ids.push(null);
    continue;
  }
  const form = new FormData();
  form.append(
    "file",
    new Blob([signaturePng(720, 180, i * 1.7)], { type: "image/png" }),
    `sign-${i}.png`,
  );
  const response = await fetch(
    `${BASE}/reports/statement/signature?${new URLSearchParams({ periodStart: start, periodEnd: end })}`,
    { method: "POST", headers: auth, body: form },
  );
  const body = await response.json();
  if (!body.id) throw new Error(`upload ${i}: ${JSON.stringify(body)}`);
  ids.push(body.id);
}

const saved = await fetch(`${BASE}/reports/statement`, {
  method: "PATCH",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({
    periodStart: start,
    periodEnd: end,
    signatories: people.map((person, i) => ({
      ...person,
      signatureFileId: ids[i],
    })),
  }),
});
console.log(start, "→", end, saved.status, JSON.stringify(ids));
