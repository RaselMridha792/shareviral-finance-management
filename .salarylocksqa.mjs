/**
 * The three locks the owner asked for on the salary history.
 *
 * All three were written down as "not reachable from any screen, yours to
 * decide". He decided: do all three. Each is small; two of them are one line;
 * the third is the one that had to be handled carefully, because its migration
 * and its code cannot be separated.
 *
 *   1  `compensation_effective_idx` becomes PARTIAL, so a trashed row stops
 *      holding its date. `setCompensation`'s ON CONFLICT gains a matching
 *      `targetWhere` in the same deploy — a target with no `where` cannot infer
 *      a partial index, so a mismatch makes EVERY salary save fail. That is what
 *      this file exists to prove did not happen.
 *
 *   2  restoring a salary row that has no end date is REFUSED when the person
 *      already has one in force. Two open rows and nothing on screen saying
 *      which one pays is the one shape of this bug that reaches money.
 *
 *   3  `backfillCompensationFromJoining` stops counting trashed rows, so
 *      somebody whose only salary row was thrown away is visible to the action
 *      that exists to repair exactly that.
 *
 *     node .salarylocksqa.mjs      (local only — writes and deletes)
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
const call = async (method, path, body) => {
  const res = await fetch(API + path, {
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

const wipe = async () => {
  const people = (
    await db.query("select id from team_members where full_name like 'LOCKQA %'")
  ).rows.map((r) => r.id);
  for (const id of people) {
    await db.query("delete from payroll_lines where team_member_id=$1", [id]);
    await db.query("delete from compensation_history where team_member_id=$1", [id]);
    await db.query("delete from team_members where id=$1", [id]);
  }
  return people.length;
};
await wipe();

/* ------------------------- 1. the index, and the saves ----------------- */

const idx = (
  await db.query(
    "select indexdef from pg_indexes where indexname='compensation_effective_idx'",
  )
).rows[0];
check(
  "1: the salary index is now partial on deleted_at",
  Boolean(idx) && /deleted_at IS NULL/i.test(idx.indexdef),
  idx ? idx.indexdef.slice(idx.indexdef.indexOf("WHERE")) || "no WHERE" : "missing",
);

const member = (
  await call("POST", "/team-members", {
    fullName: "LOCKQA Person",
    engagementType: "employee",
    joinedOn: "2024-01-01",
  })
).body;

/*
 * THE RISK THIS WHOLE PAIR CARRIES. If the ON CONFLICT target and the index
 * disagree, Postgres refuses with "no unique or exclusion constraint matching
 * the ON CONFLICT specification" and every one of these fails. Three saves: a
 * first figure, a second on a different date, and a rewrite of the first date —
 * which is the branch that actually takes the conflict.
 */
const first = await call("POST", `/team-members/${member.id}/compensation`, {
  grossAmount: "50000.00",
  effectiveFrom: "2024-01-01",
  changeReason: "LOCKQA hired",
});
const second = await call("POST", `/team-members/${member.id}/compensation`, {
  grossAmount: "60000.00",
  effectiveFrom: "2025-01-01",
  changeReason: "LOCKQA raise",
});
const rewrite = await call("POST", `/team-members/${member.id}/compensation`, {
  grossAmount: "55000.00",
  effectiveFrom: "2024-01-01",
  changeReason: "LOCKQA corrected",
});
check(
  "1: a first salary saves",
  first.status < 300,
  `HTTP ${first.status} ${JSON.stringify(first.body?.message ?? "").slice(0, 70)}`,
);
check(
  "1: a later salary saves",
  second.status < 300,
  `HTTP ${second.status} ${JSON.stringify(second.body?.message ?? "").slice(0, 70)}`,
);
check(
  "1: THE CONFLICT BRANCH — rewriting an existing date still works",
  rewrite.status < 300,
  `HTTP ${rewrite.status} ${JSON.stringify(rewrite.body?.message ?? "").slice(0, 90)}`,
);
const corrected = (
  await db.query(
    "select gross_amount::text g from compensation_history where team_member_id=$1 and effective_from='2024-01-01' and deleted_at is null",
    [member.id],
  )
).rows;
check(
  "1: and it overwrote rather than adding a second row for that date",
  corrected.length === 1 && corrected[0].g === "55000.00",
  `${corrected.length} live row(s) on that date, ${corrected[0]?.g}`,
);

/* A trashed row no longer owns its date: the same date can be used again, and
   the trashed row must STAY trashed rather than being revived. */
const oldRow = (
  await db.query(
    "select id from compensation_history where team_member_id=$1 and effective_from='2024-01-01'",
    [member.id],
  )
).rows[0];
await call("POST", `/trash/compensation/${oldRow.id}`, { reason: "LOCKQA bin" });
const afterTrash = await call(
  "POST",
  `/team-members/${member.id}/compensation`,
  {
    grossAmount: "51000.00",
    effectiveFrom: "2024-01-01",
    changeReason: "LOCKQA typed again on a trashed date",
  },
);
const onThatDate = (
  await db.query(
    `select gross_amount::text g, deleted_at is not null trashed
       from compensation_history where team_member_id=$1 and effective_from='2024-01-01'
      order by trashed`,
    [member.id],
  )
).rows;
check(
  "1: a trashed row no longer blocks its date",
  afterTrash.status < 300,
  `HTTP ${afterTrash.status}`,
);
check(
  "1: the new figure is LIVE and the trashed one stayed in the trash",
  onThatDate.length === 2 &&
    onThatDate[0].trashed === false &&
    onThatDate[0].g === "51000.00" &&
    onThatDate[1].trashed === true,
  onThatDate.map((r) => `${r.g}${r.trashed ? " (trashed)" : " (live)"}`).join(", "),
);

/* ----------------------- 2. restore checks the overlap ----------------- */

/*
 * Build the exact collision: trash the row that is in force, record a different
 * one while it is gone, then try to bring the first back.
 */
const open = (
  await db.query(
    "select id from compensation_history where team_member_id=$1 and effective_to is null and deleted_at is null limit 1",
    [member.id],
  )
).rows[0];
await call("POST", `/trash/compensation/${open.id}`, { reason: "LOCKQA open" });
await call("POST", `/team-members/${member.id}/compensation`, {
  grossAmount: "70000.00",
  effectiveFrom: "2026-01-01",
  changeReason: "LOCKQA replacement while the other was away",
});
const restore = await call("POST", `/trash/compensation/${open.id}/restore`, {});
check(
  "2: restoring an open salary row is REFUSED when one is already in force",
  restore.status === 400,
  `HTTP ${restore.status} ${JSON.stringify(restore.body?.message ?? "").slice(0, 110)}`,
);
const stillOne = (
  await db.query(
    "select count(*)::int n from compensation_history where team_member_id=$1 and deleted_at is null and effective_to is null",
    [member.id],
  )
).rows[0].n;
check(
  "2: so the person still has exactly ONE salary in force",
  stillOne === 1,
  `${stillOne} open row(s)`,
);

/* And a CLOSED row still restores — the guard must not refuse everything. */
const closed = (
  await db.query(
    "select id from compensation_history where team_member_id=$1 and effective_to is not null and deleted_at is not null limit 1",
    [member.id],
  )
).rows[0];
/*
 * Two different closed rows, because the partial index made these two cases
 * different and the first version of this file only checked one.
 *
 *   a date somebody has TAKEN since  -> refused, with a sentence. This used to
 *      be a 23505 reaching the browser as "Internal server error" — the very
 *      class of bug the index was meant to close, arriving through the door the
 *      index itself opened.
 *   a date still FREE                -> comes back, because the guard is about
 *      collisions and not about restore.
 */
if (closed) {
  const blocked = await call("POST", `/trash/compensation/${closed.id}/restore`, {});
  check(
    "2: restoring onto a date something else now holds is refused, not a 500",
    blocked.status === 400,
    `HTTP ${blocked.status} ${JSON.stringify(blocked.body?.message ?? "").slice(0, 100)}`,
  );
} else {
  check("2: a closed trashed row exists to try", false, "none to try");
}

/*
 * And one whose date is genuinely free still comes back.
 *
 * TWO figures, not one. `setCompensation` closes the previous OPEN row only
 * when its date is earlier than the new one, so a single row dated before
 * everything else stays open — and the first version of this fixture then hit
 * the "already has one in force" guard and looked like a product fault. The
 * second figure is what closes the first.
 */
await call("POST", `/team-members/${member.id}/compensation`, {
  grossAmount: "80000.00",
  effectiveFrom: "2023-01-01",
  changeReason: "LOCKQA an older figure",
});
await call("POST", `/team-members/${member.id}/compensation`, {
  grossAmount: "85000.00",
  effectiveFrom: "2023-06-01",
  changeReason: "LOCKQA which closes the one above",
});
const freeId = (
  await db.query(
    "select id from compensation_history where team_member_id=$1 and effective_from='2023-01-01' limit 1",
    [member.id],
  )
).rows[0]?.id;
await call("POST", `/trash/compensation/${freeId}`, { reason: "LOCKQA free date" });
const back = await call("POST", `/trash/compensation/${freeId}/restore`, {});
check(
  "2: and a row whose date is still free comes back fine",
  back.status < 300,
  `HTTP ${back.status} ${JSON.stringify(back.body?.message ?? "").slice(0, 90)}`,
);

/* ------------------ 3. the repair action can see them again ------------ */

const lonely = (
  await call("POST", "/team-members", {
    fullName: "LOCKQA Lonely",
    engagementType: "employee",
    joinedOn: "2024-06-01",
    joiningSalary: "40000.00",
  })
).body;
await call("POST", `/team-members/${lonely.id}/compensation`, {
  grossAmount: "40000.00",
  effectiveFrom: "2024-06-01",
});
const onlyRow = (
  await db.query(
    "select id from compensation_history where team_member_id=$1 and deleted_at is null limit 1",
    [lonely.id],
  )
).rows[0];
await call("POST", `/trash/compensation/${onlyRow.id}`, {
  reason: "LOCKQA their only salary",
});

const repair = await call("POST", "/team-members/compensation/from-joining-salary", {});
const named = JSON.stringify(repair.body ?? {});
check(
  "3: the repair action now SEES somebody whose only salary was trashed",
  repair.status < 300 && named.includes("LOCKQA Lonely"),
  repair.status >= 300
    ? `HTTP ${repair.status}`
    : named.includes("LOCKQA Lonely")
      ? "named in the result"
      : `not named — ${named.slice(0, 120)}`,
);
const repaired = (
  await db.query(
    "select count(*)::int n from compensation_history where team_member_id=$1 and deleted_at is null",
    [lonely.id],
  )
).rows[0].n;
check(
  "3: and gave them their salary back",
  repaired === 1,
  `${repaired} live row(s)`,
);

const removed = await wipe();
check("the fixtures are removed again", removed === 2, `${removed} people`);
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
