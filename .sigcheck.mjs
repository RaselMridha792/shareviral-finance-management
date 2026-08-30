// Does a statement signature actually go up, come back, and print?
//
// Throwaway. Mints a super_admin token, builds real PNGs, and drives the live
// dev API: the refusals, the upload, the save, and the PDF that comes out.
//
//   node .sigcheck.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import jwt from "jsonwebtoken";
import pg from "pg";

const REPO = "d:/codes/Finance-Management-software";
const OUT = path.join(REPO, ".sigcheck-out");
const BASE = "http://localhost:3000/api";

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
  `select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`,
);
const token = jwt.sign(
  { sub: rows[0].id, role: rows[0].role, tv: rows[0].token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);
// The cookie, plus the header CsrfGuard wants on anything that mutates.
const auth = {
  Cookie: `sfm_access=${token}`,
  "x-requested-with": "finance-web",
};

/* --- PNGs, written by hand ------------------------------------------------ */

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

/** A wide, short scrawl in black ink on white — what a scanned signature is. */
function signaturePng(width, height, { interlaced = false, seed = 0 } = {}) {
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
    for (let w = -2; w <= 2; w++) ink(x, Math.round(y) + w);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  ihdr[12] = interlaced ? 1 : 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --- the drive ------------------------------------------------------------ */

const results = [];
const say = (label, detail) => {
  results.push({ check: label, result: detail });
  console.log(`${label.padEnd(52)} ${detail}`);
};

async function upload(period, bytes, name) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), name);
  const search = new URLSearchParams({
    periodStart: period.start,
    periodEnd: period.end,
  });
  const response = await fetch(
    `${BASE}/reports/statement/signature?${search}`,
    { method: "POST", headers: auth, body: form },
  );
  return { status: response.status, body: await response.json() };
}

const statement = await fetch(
  `${BASE}/reports/statement?granularity=month`,
  { headers: auth },
).then((r) => r.json());
const period = statement.period;
say("period under test", `${period.label} (${period.start} → ${period.end})`);

/* Refusals first, so a pass is not a check that never ran. */
const tooNarrow = await upload(period, signaturePng(200, 80), "narrow.png");
say(
  "refuses a 200px-wide scan",
  `${tooNarrow.status} — ${tooNarrow.body.message ?? ""}`.slice(0, 96),
);

const square = await upload(period, signaturePng(600, 600), "square.png");
say(
  "refuses a square",
  `${square.status} — ${square.body.message ?? ""}`.slice(0, 96),
);

const interlaced = await upload(
  period,
  signaturePng(600, 160, { interlaced: true }),
  "interlaced.png",
);
say(
  "refuses an interlaced PNG",
  `${interlaced.status} — ${interlaced.body.message ?? ""}`.slice(0, 96),
);

const notAnImage = await (async () => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([Buffer.from("%PDF-1.4 not really")], { type: "image/png" }),
    "lying.png",
  );
  const search = new URLSearchParams({
    periodStart: period.start,
    periodEnd: period.end,
  });
  const response = await fetch(
    `${BASE}/reports/statement/signature?${search}`,
    { method: "POST", headers: auth, body: form },
  );
  return { status: response.status, body: await response.json() };
})();
say(
  "refuses a file whose bytes are not the type claimed",
  `${notAnImage.status} — ${notAnImage.body.message ?? ""}`.slice(0, 96),
);

/* Then four that should land. */
const uploaded = [];
for (let i = 0; i < 4; i++) {
  const ok = await upload(
    period,
    signaturePng(720, 180, { seed: i * 1.7 }),
    `sign-${i}.png`,
  );
  if (ok.status !== 201 && ok.status !== 200) {
    say(`upload ${i + 1}`, `FAILED ${ok.status} ${JSON.stringify(ok.body)}`);
    break;
  }
  uploaded.push(ok.body.id);
}
say(
  "four signatures uploaded",
  `${uploaded.length} of 4, distinct ids: ${new Set(uploaded).size}`,
);

const people = [
  { name: "Mirza Ashiqul Islam", title: "Managing Director" },
  { name: "Farhana Rahman", title: "Head of Finance" },
  { name: "Super Admin", title: "Company Secretary" },
  { name: "Rasel Mridha", title: "Auditor" },
];
const saved = await fetch(`${BASE}/reports/statement`, {
  method: "PATCH",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({
    periodStart: period.start,
    periodEnd: period.end,
    signatories: people.map((person, i) => ({
      ...person,
      signatureFileId: uploaded[i] ?? null,
    })),
  }),
});
const savedBody = await saved.json();
say(
  "saved four signatories with their file ids",
  `${saved.status} — ${(savedBody.signatories ?? []).filter((p) => p.signatureFileId).length} carry a signature`,
);

/* A file belonging to another period must not be accepted onto this one. */
const foreign = await fetch(`${BASE}/reports/statement`, {
  method: "PATCH",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({
    periodStart: period.start,
    periodEnd: period.end,
    signatories: [
      {
        name: "Somebody Else",
        title: "Impostor",
        signatureFileId: "00000000-0000-4000-8000-000000000000",
      },
    ],
  }),
});
say(
  "refuses a signature that is not this statement's",
  `${foreign.status} — ${((await foreign.json()).message ?? "").slice(0, 70)}`,
);

/* Put the real four back, then read the document. */
await fetch(`${BASE}/reports/statement`, {
  method: "PATCH",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({
    periodStart: period.start,
    periodEnd: period.end,
    signatories: people.map((person, i) => ({
      ...person,
      signatureFileId: uploaded[i] ?? null,
    })),
  }),
});

const rebuilt = await fetch(
  `${BASE}/reports/statement?granularity=month`,
  { headers: auth },
).then((r) => r.json());
say(
  "the statement reads them back",
  rebuilt.signatories
    .map((p) => `${p.name.split(" ")[0]}${p.signatureFileId ? "+sig" : "-"}`)
    .join(", "),
);

const pdf = await fetch(
  `${BASE}/exports/statement.pdf?granularity=month`,
  { headers: auth },
);
const bytes = Buffer.from(await pdf.arrayBuffer());
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "statement.pdf"), bytes);
say(
  "the statement PDF builds",
  `${pdf.status}, ${(bytes.length / 1024).toFixed(0)} KB`,
);

// Four embedded images means four signatures reached the page. PDFKit writes
// one image XObject per distinct image, so counting them is counting marks.
const images = (bytes.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? [])
  .length;
say("image XObjects in the file", String(images));

fs.writeFileSync(
  path.join(OUT, "checks.json"),
  JSON.stringify(results, null, 2),
);
await db.end();
console.log(`\nPDF at ${path.join(OUT, "statement.pdf")}`);
