// One signatory, then two, three, four — where does the grid land each time?
//
// Throwaway. Assumes .sigcheck.mjs has already uploaded four signatures to the
// current month; this only re-saves the signatory list and re-reads the PDF.
//
//   node .siggrid.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import jwt from "jsonwebtoken";
import pg from "pg";

const REPO = "d:/codes/Finance-Management-software";
const BASE = "http://localhost:3000/api";
const SHEET = { width: 595.28, height: 841.89 };
const FIGURES = SHEET.height - 182;
const BOX_WIDTH = (SHEET.width - 61 * 2 - 11.4) / 2;

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
const { rows: users } = await db.query(
  `select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`,
);
const token = jwt.sign(
  { sub: users[0].id, role: users[0].role, tv: users[0].token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);
const auth = {
  Cookie: `sfm_access=${token}`,
  "x-requested-with": "finance-web",
};

const statement = await fetch(`${BASE}/reports/statement?granularity=month`, {
  headers: auth,
}).then((r) => r.json());
const period = statement.period;

await db.end();

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
  // Filter type per scanline. 0xff is not one, and a PNG carrying it still
  // decodes to the right size and draws as a blank plate.
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

async function uploadSignature(seed) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([signaturePng(seed)], { type: "image/png" }),
    `grid-${seed}.png`,
  );
  const response = await fetch(
    `${BASE}/reports/statement/signature?${new URLSearchParams({
      periodStart: period.start,
      periodEnd: period.end,
    })}`,
    { method: "POST", headers: auth, body: form },
  );
  return (await response.json()).id ?? null;
}

const people = [
  { name: "Mirza Ashiqul Islam", title: "Managing Director" },
  { name: "Farhana Rahman", title: "Head of Finance" },
  { name: "Super Admin", title: "Company Secretary" },
  { name: "Rasel Mridha", title: "Auditor" },
];

function boxesIn(pdf) {
  const latin = pdf.toString("latin1");
  const out = [];
  let at = 0;
  for (;;) {
    const start = latin.indexOf("stream", at);
    if (start < 0) break;
    let from = start + "stream".length;
    if (latin[from] === "\r") from++;
    if (latin[from] === "\n") from++;
    const end = latin.indexOf("endstream", from);
    if (end < 0) break;
    try {
      const page = zlib
        .inflateSync(pdf.subarray(from, end))
        .toString("latin1");
      // Only the page that draws a signature. `figureBoxes` elsewhere in
      // the document uses the same box width, and counting those made a
      // one-signatory statement look like it had three boxes in two rows.
      if (/\/I\d+\s+Do/.test(page)) {
        out.push(
          ...[
            ...page.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re/g),
          ]
            .map((m) => ({
              x: Number(m[1]),
              top: Number(m[2]),
              w: Number(m[3]),
              h: Number(m[4]),
            }))
            .filter((r) => Math.abs(r.w - BOX_WIDTH) < 1),
        );
      }
    } catch {
      // Not a deflated content stream.
    }
    at = end + "endstream".length;
  }
  return out;
}

const table = [];
for (let n = 1; n <= 4; n++) {
  // Fresh every round: a save prunes the signatures it does not name, so last
  // round's ids are gone by now.
  const signatures = [];
  for (let i = 0; i < n; i++) {
    // The last one deliberately without a mark, so a mixed block is exercised
    // too: the rules must still line up across the row.
    signatures.push(i === n - 1 && n > 1 ? null : await uploadSignature(i * 1.7));
  }

  await fetch(`${BASE}/reports/statement`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      periodStart: period.start,
      periodEnd: period.end,
      signatories: people.slice(0, n).map((person, i) => ({
        ...person,
        signatureFileId: signatures[i],
      })),
    }),
  });

  const pdf = Buffer.from(
    await fetch(`${BASE}/exports/statement.pdf?granularity=month`, {
      headers: auth,
    }).then((r) => r.arrayBuffer()),
  );
  fs.mkdirSync(path.join(REPO, ".sigcheck-out"), { recursive: true });
  fs.writeFileSync(
    path.join(REPO, ".sigcheck-out", `statement-${n}.pdf`),
    pdf,
  );

  const boxes = boxesIn(pdf);
  const tops = [...new Set(boxes.map((b) => b.top.toFixed(1)))];
  const bottom = Math.max(...boxes.map((b) => b.top + b.h));
  const rules = [...new Set(boxes.map((b) => (b.top + 68).toFixed(1)))];
  table.push({
    signatories: n,
    boxes: boxes.length,
    rows: tops.length,
    "row tops": tops.join(", "),
    "grid ends": bottom.toFixed(1),
    "figures at": FIGURES.toFixed(1),
    verdict: bottom <= FIGURES ? `clear by ${(FIGURES - bottom).toFixed(1)}` : "OVERLAP",
    "rule heights": rules.join(", "),
  });
}

console.table(table);
