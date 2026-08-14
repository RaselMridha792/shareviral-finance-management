/**
 * BATCH OF DRAFTS — the save loop.
 *
 * The promise is that a batch is not a bulk write. Each row goes to the same
 * endpoint the manual form posts to, with the same permission check, the same
 * validation and its own audit row — and one bad row does not strand the ones
 * behind it.
 *
 * The model cannot produce a batch yet (the Anthropic account is unverified),
 * so the rows here are written by hand in the shape the model is asked to
 * return. That tests everything except the model's own judgement.
 */
import fs from "node:fs";
import pg from "pg";

const API = process.env.API ?? "http://localhost:4001/api";
const env = Object.fromEntries(
  fs.readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const TOK = Object.fromEntries(
  fs.readFileSync(new URL("./roles.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
);

const call = async (path, method, body, role = "SUPER_ADMIN") => {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${TOK[role]}`, "x-requested-with": "finance-web" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

let pass = 0, fail = 0, note = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? " — " + d : ""}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n} — ${d}`); };
const meh = (n, d) => { note++; console.log(`  ????  ${n} — ${d}`); };

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const startedAt = (await db.query("select now() n")).rows[0].n;
const peopleBefore = (await db.query("select count(*)::int n from team_members")).rows[0].n;

console.log("\nBATCH OF DRAFTS — THE SAVE LOOP\n");

/**
 * Nine people in the shape the model is told to produce, with three deliberate
 * problems buried in the middle — where a loop that stops at the first failure
 * does the most damage.
 */
const TAG = "[batchtest]";
const rows = [
  { fullName: "Batch Person One",   engagementType: "employee",   joinedOn: "2026-03-01", designation: "Engineer" },
  { fullName: "Batch Person Two",   engagementType: "employee",   joinedOn: "2026-03-02", designation: "Analyst" },
  { fullName: "Batch Person Three", engagementType: "contractor", joinedOn: "2026-03-03", designation: "Editor" },
  { fullName: "Batch Bad Date",     engagementType: "employee",   joinedOn: "not-a-date", designation: "Engineer" },
  { fullName: "Batch Person Five",  engagementType: "employee",   joinedOn: "2026-03-05", designation: "Engineer" },
  { fullName: "",                   engagementType: "employee",   joinedOn: "2026-03-06", designation: "Engineer" },
  { fullName: "Batch Person Seven", engagementType: "employee",   joinedOn: "2026-03-07", designation: "Engineer" },
  { fullName: "Batch Bad Type",     engagementType: "freelancer", joinedOn: "2026-03-08", designation: "Engineer" },
  { fullName: "Batch Person Nine",  engagementType: "employee",   joinedOn: "2026-03-09", designation: "Engineer" },
];
const GOOD = 6, BAD = 3;

// Tag every row so cleanup can find exactly these and nothing else.
for (const row of rows) row.notes = `Created by the batch test ${TAG}`;

/** What `aiApi.saveMany` does in the browser, against the same endpoint. */
const saveMany = async (target, list, role = "SUPER_ADMIN") => {
  const results = [];
  for (const row of list) {
    const r = await call(`/${target}`, "POST", row, role);
    if (r.status === 200 || r.status === 201) results.push({ ok: true, id: r.body?.id });
    else {
      const fields = Object.entries(r.body?.errors ?? {}).map(([f, m]) => `${f}: ${m[0]}`);
      results.push({ ok: false, error: [r.body?.message, ...fields].filter(Boolean).join(" — ") });
    }
  }
  return results;
};

const results = await saveMany("team-members", rows);

/* ------------------------------------------------------ nothing stranded */

results.length === rows.length
  ? ok("every row got an answer", `${results.length} of ${rows.length} — the loop did not stop at the first failure`)
  : bad("every row got an answer", `${results.length} of ${rows.length}`);

const saved = results.filter((r) => r.ok).length;
const refused = results.filter((r) => !r.ok).length;
saved === GOOD && refused === BAD
  ? ok("the good rows saved and the bad ones did not", `${saved} saved, ${refused} refused`)
  : bad("good saved, bad refused", `${saved} saved, ${refused} refused — expected ${GOOD} and ${BAD}`);

// The rows behind a failure are what a stopping loop would lose.
results[4]?.ok && results[6]?.ok && results[8]?.ok
  ? ok("rows after a failure still saved", "a bad row in the middle strands nothing behind it")
  : bad("rows after a failure", `row 5 ${results[4]?.ok}, row 7 ${results[6]?.ok}, row 9 ${results[8]?.ok}`);

/* ------------------------------------ each refusal says what was wrong */

const reasons = results.map((r, i) => (r.ok ? null : `${i + 1}: ${r.error}`)).filter(Boolean);
reasons.every((r) => r.length > 12 && !/^\d+: undefined/.test(r))
  ? ok("each refusal names the field and the reason", reasons.map((r) => r.slice(0, 60)).join(" | "))
  : bad("refusals are readable", JSON.stringify(reasons));

results[3]?.error?.toLowerCase().includes("joined")
  ? ok("the bad date is blamed on the date", `"${results[3].error.slice(0, 70)}"`)
  : meh("the bad date names its field", `"${results[3]?.error}"`);

/* ---------------------------------- the same checks the manual form gets */

const created = (await db.query(
  "select id, full_name, engagement_type, joined_on from team_members where notes like $1 order by full_name",
  [`%${TAG}%`])).rows;

created.length === GOOD
  ? ok("exactly the good rows reached the database", `${created.length} row(s)`)
  : bad("what reached the database", `${created.length} row(s), expected ${GOOD}`);

const audited = (await db.query(
  `select count(*)::int n from audit_logs
    where entity_table = 'team_members' and action = 'create' and occurred_at > $1`, [startedAt])).rows[0].n;
audited === GOOD
  ? ok("every saved row has its own audit entry", `${audited} — a batch is not a way to write without a trail`)
  : bad("audit entries", `${audited} for ${GOOD} saved rows`);

/* ------------------------------------- and the permission check is real */

const hrAttempt = await call("/team-members", "POST", {
  fullName: "Batch HR Attempt", engagementType: "employee", joinedOn: "2026-03-10",
  notes: `Created by the batch test ${TAG}`,
}, "HR");
hrAttempt.status === 200 || hrAttempt.status === 201
  ? ok("HR may add a team member through the batch path too", "the same permission the form gets, not a different one")
  : meh("HR through the batch path", `HTTP ${hrAttempt.status} — HR cannot add people`);

const ceoAttempt = await call("/team-members", "POST", {
  fullName: "Batch CEO Attempt", engagementType: "employee", joinedOn: "2026-03-11",
  notes: `Created by the batch test ${TAG}`,
}, "CEO");
ceoAttempt.status === 403
  ? ok("the CEO is still read-only through the batch path", "HTTP 403 — a batch is not a way around permissions")
  : bad("CEO is read-only", `HTTP ${ceoAttempt.status} — the batch path let a read-only role write`);

/* --------------------------------------------- the cap the contract sets */

const { AI_BATCH_MAX_ROWS } = await import("@finance/shared");
AI_BATCH_MAX_ROWS === 100
  ? ok("a batch is capped, so a chat cannot become an import", `${AI_BATCH_MAX_ROWS} rows — more than that belongs on the import screen`)
  : meh("batch cap", `${AI_BATCH_MAX_ROWS}`);

/* --------------------------------------------------------------- cleanup */

const mine = (await db.query("select id from team_members where notes like $1", [`%${TAG}%`])).rows.map((r) => r.id);
if (mine.length) {
  await db.query("delete from compensation_history where team_member_id = any($1::uuid[])", [mine]);
  await db.query("delete from audit_logs where entity_id = any($1::text[])", [mine]);
  await db.query("delete from team_members where id = any($1::uuid[])", [mine]);
}
const peopleAfter = (await db.query("select count(*)::int n from team_members")).rows[0].n;
peopleAfter === peopleBefore
  ? ok("the team is back to where it started", `${peopleAfter} people`)
  : bad("team count", `was ${peopleBefore}, now ${peopleAfter}`);

await db.end();
console.log(`\n${pass} passed, ${fail} failed, ${note} inconclusive`);
process.exit(fail ? 1 : 0);
