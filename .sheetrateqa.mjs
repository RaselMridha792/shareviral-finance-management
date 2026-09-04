/**
 * One rate for the sheet, filled onto every row.
 *
 * The owner: *"payroll table a net pay tao editable rakho. also dollar rate
 * prottek sarite thakuk tarporeo opore ek jaygay rakho jekhane rakhle table er
 * sobgula field a auto fill hobe caile edit o korte parbe."*
 *
 * The FX RATE column read N/A on every line, because a rate had to be typed
 * into each of seventeen boxes and nobody had. This drives the new endpoint
 * and reads `payroll_lines.fx_rate` BACK OUT OF THE TABLE, since a 200 says
 * the request was accepted and nothing about what landed in the column.
 *
 * What it has to get right, and each is a check:
 *   - it fills the empty rows;
 *   - it LEAVES ALONE a row that already states its own rate, unless asked;
 *   - "Replace every row" does overwrite it;
 *   - a line stays individually editable afterwards;
 *   - a finalised sheet refuses the lot, like every other figure on it.
 *
 *     node .sheetrateqa.mjs      (local only — builds a run and removes it)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";

const API = "http://localhost:4001/api";
const env = Object.fromEntries(
  fs
    .readFileSync("apps/api/.env", "utf8")
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
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const MARK = "SHEETRATEQA";

const wipe = async () => {
  await db.query(
    `delete from payroll_lines where payroll_run_id in
       (select id from payroll_runs where notes like $1)`,
    [`%${MARK}%`],
  );
  await db.query("delete from payroll_runs where notes like $1", [`%${MARK}%`]);
  await db.query(`delete from team_members where full_name like $1`, [
    `${MARK}%`,
  ]);
};
await wipe();

/* --------------------------------------------------------- three people */

const made = [];
for (const [i, name] of ["Ayesha", "Bipul", "Cathy"].entries()) {
  const res = await call("POST", "/team-members", {
    fullName: `${MARK} ${name}`,
    engagementType: "employee",
    joinedOn: "2026-01-01",
    currentSalary: String((30000 + i * 5000).toFixed(2)),
  });
  if (res.status === 201) made.push(res.body);
  else
    console.log(
      "    team create said",
      res.status,
      JSON.stringify(res.body).slice(0, 220),
    );
}
check("three people on the payroll", made.length === 3, `${made.length} created`);

/* ----------------------------------------------------------- the sheet */

const run = (
  await call("POST", "/payroll/runs", {
    periodYear: 2026,
    periodMonth: 7,
    notes: `${MARK} July 2026`,
  })
).body;
check(
  "a draft sheet",
  Boolean(run?.id),
  run?.id ? run.status : JSON.stringify(run).slice(0, 200),
);

if (run?.id) {
  const built = await call("POST", `/payroll/runs/${run.id}/generate-lines`, {});
  const lineRows = async () =>
    (
      await db.query(
        `select l.id, t.full_name, l.fx_rate::text r, l.is_paid
           from payroll_lines l join team_members t on t.id = l.team_member_id
          where l.payroll_run_id = $1 order by t.full_name`,
        [run.id],
      )
    ).rows;
  let rows = await lineRows();
  check(
    "with a line for everybody",
    rows.length >= 3,
    `${rows.length} lines (build said ${built.status})`,
  );
  check(
    "and not one of them states a rate — the N/A the owner saw",
    rows.every((r) => r.r === null),
    rows.map((r) => r.r ?? "N/A").join(" "),
  );

  /* ------------------- one line is given its own rate ------------------ */

  const mine = rows[0];
  await call("PATCH", `/payroll/lines/${mine.id}`, { fxRate: "119.00" });
  rows = await lineRows();
  check(
    "one person's rate typed by hand",
    rows.find((r) => r.id === mine.id)?.r === "119.000000",
    rows.find((r) => r.id === mine.id)?.r ?? "null",
  );

  /* ------------------- the sheet rate fills the rest ------------------- */

  const empty = rows.filter((r) => r.r === null).length;
  const filled = await call("POST", `/payroll/runs/${run.id}/fx-rate`, {
    fxRate: "122.77",
  });
  rows = await lineRows();
  check(
    "the sheet rate fills the empty rows",
    filled.status === 200 && filled.body?.filled === empty,
    `filled=${filled.body?.filled} of ${empty} empty`,
  );
  check(
    "and leaves the hand-typed one alone",
    rows.find((r) => r.id === mine.id)?.r === "119.000000",
    rows.map((r) => r.r).join(" "),
  );
  check(
    "every row now states a rate — no N/A left",
    rows.every((r) => r.r !== null),
    rows.map((r) => Number(r.r).toFixed(2)).join(" "),
  );

  /* ------------------- replace really does replace --------------------- */

  const replaced = await call("POST", `/payroll/runs/${run.id}/fx-rate`, {
    fxRate: "125.00",
    overwrite: true,
  });
  rows = await lineRows();
  check(
    "Replace every row overwrites the hand-typed one too",
    replaced.status === 200 && rows.every((r) => r.r === "125.000000"),
    rows.map((r) => Number(r.r).toFixed(2)).join(" "),
  );

  /* ------------------- a row is still its own -------------------------- */

  await call("PATCH", `/payroll/lines/${mine.id}`, { fxRate: "130.00" });
  rows = await lineRows();
  check(
    "and a single row can still be changed after a fill",
    rows.find((r) => r.id === mine.id)?.r === "130.000000" &&
      rows.filter((r) => r.id !== mine.id).every((r) => r.r === "125.000000"),
    rows.map((r) => Number(r.r).toFixed(2)).join(" "),
  );

  /* ------------------- a finalised sheet is finalised ------------------ */

  for (const r of rows) {
    await call("PATCH", `/payroll/lines/${r.id}`, { tdsAmount: "0.00" });
  }
  const locked = await call("POST", `/payroll/runs/${run.id}/finalize`, {});
  const afterLock = await call("POST", `/payroll/runs/${run.id}/fx-rate`, {
    fxRate: "999.00",
  });
  rows = await lineRows();
  check(
    "a finalised sheet refuses the fill, like every other figure on it",
    locked.status === 200 && afterLock.status === 400,
    `finalize=${locked.status} fill=${afterLock.status}`,
  );
  check(
    "and nothing moved when it was refused",
    rows.every((r) => r.r !== "999.000000"),
    rows.map((r) => Number(r.r).toFixed(2)).join(" "),
  );

  console.log("\n  the FX RATE column, end to end:");
  for (const r of rows) {
    console.log(
      `    ${String(r.full_name).replace(MARK + " ", "").padEnd(10)} fx_rate=${r.r ?? "N/A"}`,
    );
  }
}

/* ----------------------------- and the screen asks for it -------------- */

const screen = fs.readFileSync(
  "apps/web/src/components/payroll/salary-sheet-screen.tsx",
  "utf8",
);
check(
  "the sheet draws one rate box above the table",
  screen.includes("USD rate for this sheet") &&
    screen.includes("Fill the empty rows") &&
    screen.includes("Replace every row"),
  "box, fill and replace",
);
check(
  "and it only appears while the sheet is a draft",
  /\{canWrite && draft \? \(\s*<div className="flex flex-wrap items-end gap-3 border-b/.test(
    screen,
  ),
  "guarded by canWrite && draft",
);

await wipe();
await db.end();

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(72));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
      failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
