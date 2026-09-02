/**
 * The payslip's two signature blocks, level in all four states.
 *
 * The owner: *"payslip er duita same height a nei left er ta ektu nice namiye
 * diyo also prepared by je ache onar signature upload korar option rekhe diyo
 * settings a."*
 *
 * The two asks are one fix. The right block carried 26pt of signature plus a
 * 2pt gap above its rule and the left carried nothing, so the rules sat 28pt
 * apart on a document where they read as a pair. Giving the left block its own
 * mark — and reserving the same height when either is unsigned — levels them
 * without moving anything by a magic number.
 *
 * FOUR STATES, and a fix that only handles one of them is the bug wearing a
 * different hat: neither signed, prepared-by only, authorised only, both. The
 * rules must be level in every one, so all four are driven.
 *
 * Measured with `getBoundingClientRect`, because "they look level" is exactly
 * the claim a screenshot makes and a diff cannot check.
 *
 *     node .payslipsignqa.mjs      (local only — writes and deletes)
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import zlibModule from "node:zlib";
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
const call = async (method, path_, body) => {
  const res = await fetch(API + path_, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- fixtures */

const YEAR = 2026;
const MONTH = 4;
const wipe = async () => {
  const runs = (
    await db.query(
      "select id from payroll_runs where period_year=$1 and period_month=$2",
      [YEAR, MONTH],
    )
  ).rows.map((r) => r.id);
  for (const id of runs) {
    await db.query("delete from payroll_lines where payroll_run_id=$1", [id]);
    await db.query("delete from payroll_runs where id=$1", [id]);
  }
  const people = (
    await db.query("select id from team_members where full_name like 'SIGNQA %'")
  ).rows.map((r) => r.id);
  for (const id of people) {
    await db.query("delete from payroll_lines where team_member_id=$1", [id]);
    await db.query("delete from compensation_history where team_member_id=$1", [id]);
    await db.query("delete from team_members where id=$1", [id]);
  }
};

/* Signatures already on file belong to the company, not to this test. They are
   put back exactly as they were. */
const settingsFiles = async () =>
  (
    await db.query(
      `select id, kind from files
        where settings_id is not null and deleted_at is null
          and kind in ('signature','prepared_signature')`,
    )
  ).rows;
const original = await settingsFiles();
const hide = async () =>
  db.query(
    `update files set deleted_at = now()
      where settings_id is not null and deleted_at is null
        and kind in ('signature','prepared_signature')`,
  );
const restoreOriginals = async () => {
  await db.query(
    `delete from files where settings_id is not null and kind in ('signature','prepared_signature')
       and id <> all($1::uuid[])`,
    [original.map((r) => r.id)],
  );
  if (original.length) {
    await db.query(
      `update files set deleted_at = null where id = any($1::uuid[])`,
      [original.map((r) => r.id)],
    );
  }
};

await wipe();
await hide();

const member = (
  await call("POST", "/team-members", {
    fullName: "SIGNQA Person",
    engagementType: "employee",
    joinedOn: "2024-01-01",
  })
).body;
await call("POST", `/team-members/${member.id}/compensation`, {
  grossAmount: "200000.00",
  effectiveFrom: "2024-01-01",
});
const run = (
  await call("POST", "/payroll/runs", { periodYear: YEAR, periodMonth: MONTH })
).body;
await call("POST", `/payroll/runs/${run.id}/generate-lines`, {});
const line = (
  await db.query(
    "select id from payroll_lines where payroll_run_id=$1 limit 1",
    [run.id],
  )
).rows[0];
await db.query(
  "update payroll_lines set is_paid = true, paid_on = '2026-04-30' where id=$1",
  [line.id],
);
check("a paid payslip exists to read", Boolean(line?.id), line?.id ?? "none");

/*
 * A signature-SHAPED PNG, built rather than pasted.
 *
 * The app refuses anything that is not one: at least 300px wide and between
 * 1.5:1 and 8:1, "wider than it is tall". The 1x1 placeholder every other
 * harness here uses was refused with a 400, and the first run of this file read
 * that as the upload being broken. 600x100 is 6:1 — a signature's shape.
 */
const pngOf = (width, height) => {
  const zlib = zlibModule;
  const raw = Buffer.alloc((width * 4 + 1) * height, 0);
  /* One filter byte per row, then transparent RGBA pixels. Content does not
     matter; the header does, and that is what is being checked. */
  const idat = zlib.deflateSync(raw);
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};
const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

const sample = path.join(process.env.TEMP || ".", "signqa.png");
fs.writeFileSync(sample, pngOf(600, 100));
const uploadSignature = async (kind) => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([fs.readFileSync(sample)], { type: "image/png" }),
    "signqa.png",
  );
  form.append("kind", kind);
  const res = await fetch(`${API}/files/signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return res.status;
};

/* -------------------------------- browser ------------------------------ */

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
await page.setViewport({ width: 1400, height: 1400 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/** The top of each block's rule, which is what has to be level. */
const measure = async () => {
  await page.goto(`${WEB}/payroll/${line.id}/payslip`, {
    waitUntil: "networkidle0",
    timeout: 120000,
  });
  await settle(2600);
  return page.evaluate(() => {
    const section = document.querySelector(".slip-signatures");
    if (!section) return null;
    const blocks = [...section.children];
    const ruleTop = (block) => {
      const rule = block.querySelector(".slip-sign-rule");
      return rule ? Math.round(rule.getBoundingClientRect().top) : null;
    };
    return {
      left: ruleTop(blocks[0]),
      right: ruleTop(blocks[1]),
      leftImages: blocks[0].querySelectorAll("img").length,
      rightImages: blocks[1].querySelectorAll("img").length,
    };
  });
};

const level = (m, label) => {
  /* A point of rounding is not a misalignment; twenty-eight is. */
  const gap = Math.abs((m?.left ?? 0) - (m?.right ?? 0));
  check(
    `the two rules are level — ${label}`,
    m !== null && gap <= 1,
    m === null
      ? "no signature block on the page"
      : `left ${m.left}, right ${m.right}, ${gap}px apart`,
  );
};

let m = await measure();
level(m, "neither signed");
check(
  "and neither block draws an image when nothing is uploaded",
  m?.leftImages === 0 && m?.rightImages === 0,
  `left ${m?.leftImages}, right ${m?.rightImages}`,
);

const up1 = await uploadSignature("prepared_signature");
check("a prepared-by signature uploads", up1 < 300, `HTTP ${up1}`);
m = await measure();
level(m, "prepared-by only");
check(
  "the prepared-by mark is drawn in the LEFT block",
  m?.leftImages === 1 && m?.rightImages === 0,
  `left ${m?.leftImages}, right ${m?.rightImages}`,
);

const up2 = await uploadSignature("signature");
check("an authorised signature uploads too", up2 < 300, `HTTP ${up2}`);
m = await measure();
level(m, "both signed");
check(
  "each block draws its own, and only its own",
  m?.leftImages === 1 && m?.rightImages === 1,
  `left ${m?.leftImages}, right ${m?.rightImages}`,
);

/* The fourth state: authorised only, which is where this started. */
await db.query(
  `update files set deleted_at = now()
    where settings_id is not null and kind='prepared_signature' and deleted_at is null`,
);
m = await measure();
level(m, "authorised only — the state the owner photographed");
check(
  "the left block reserves the space rather than riding up",
  m?.leftImages === 0 && m?.rightImages === 1,
  `left ${m?.leftImages}, right ${m?.rightImages}`,
);

/* And each is singular: a second upload replaces rather than adds. */
await uploadSignature("prepared_signature");
await uploadSignature("prepared_signature");
const many = (
  await db.query(
    `select count(*)::int n from files
      where settings_id is not null and kind='prepared_signature' and deleted_at is null`,
  )
).rows[0].n;
check(
  "uploading a second prepared-by mark replaces the first, never adds",
  many === 1,
  `${many} on file — two would mean the slip had to choose`,
);

await browser.close();
fs.rmSync(sample, { force: true });
await wipe();
await restoreOriginals();
const back = await settingsFiles();
check(
  "the company's own signatures are exactly as they were",
  back.length === original.length &&
    back.every((r) => original.some((o) => o.id === r.id)),
  `${original.length} before, ${back.length} after`,
);
await db.end();

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(70));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
        failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
