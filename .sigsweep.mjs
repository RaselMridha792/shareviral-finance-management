// Upload a signature, never save it, then save the statement — does the stray
// file go?
//
//   node .sigsweep.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import jwt from "jsonwebtoken";
import pg from "pg";

const REPO = "d:/codes/Finance-Management-software";
const BASE = "http://localhost:3000/api";
const START = "2025-08-01";
const END = "2025-08-31";

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
function signaturePng(seed) {
  const width = 720;
  const height = 180;
  const raw = Buffer.alloc(height * (width * 3 + 1), 0xff);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  for (let x = 0; x < width; x++) {
    const y = Math.round(height / 2 + Math.sin((x / width) * 14 + seed) * 50);
    for (let w = -7; w <= 7; w++) {
      const at = (y + w) * (width * 3 + 1) + 1 + x * 3;
      if (at > 0 && at < raw.length - 3) {
        raw[at] = 20;
        raw[at + 1] = 20;
        raw[at + 2] = 30;
      }
    }
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

async function upload(seed) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([signaturePng(seed)], { type: "image/png" }),
    `abandoned-${seed}.png`,
  );
  const response = await fetch(
    `${BASE}/reports/statement/signature?${new URLSearchParams({ periodStart: START, periodEnd: END })}`,
    { method: "POST", headers: auth, body: form },
  );
  return (await response.json()).id;
}

const live = async () =>
  (
    await db.query(
      `select count(*)::int as n from files f
         join statements s on s.id = f.statement_id
        where f.kind='statement_signature' and f.deleted_at is null
          and s.period_start=$1 and s.period_end=$2`,
      [START, END],
    )
  ).rows[0].n;

const onDisk = () => {
  const root = env.UPLOAD_DIR || path.join(REPO, "apps/api/uploads");
  let n = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else n++;
    }
  };
  try {
    walk(root);
  } catch {
    return -1;
  }
  return n;
};

// The one that will be kept, and two that will be abandoned.
const keep = await upload(0.3);
await upload(1.1);
await upload(2.4);
console.log("after three uploads:", await live(), "live,", onDisk(), "on disk");

const saved = await fetch(`${BASE}/reports/statement`, {
  method: "PATCH",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({
    periodStart: START,
    periodEnd: END,
    signatories: [
      {
        name: "Mirza Ashiqul Islam",
        title: "Managing Director",
        signatureFileId: keep,
      },
    ],
  }),
});
console.log("save:", saved.status);
console.log("after the save:  ", await live(), "live,", onDisk(), "on disk");

const kept = await db.query(
  `select id from files where id = $1 and deleted_at is null`,
  [keep],
);
console.log(
  kept.rowCount === 1
    ? "the one the statement names survived"
    : "THE KEPT SIGNATURE WAS DELETED",
);
await db.end();
