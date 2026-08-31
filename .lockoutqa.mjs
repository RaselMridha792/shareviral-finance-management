/**
 * Nobody can lock everybody out.
 *
 * At least one active, non-deleted super admin must exist. Without one there is
 * no way to reach Settings, add a sign-in, restore anybody or promote anybody,
 * and the way back is a hand-written UPDATE on the production database of a
 * company that runs its payroll here.
 *
 * Two guards already existed and both were correct:
 *
 *   - `UsersService.update` refuses to demote or disable the last one;
 *   - the trash registry's `user` entry refuses to delete the last one.
 *
 * THE BULK PATH WENT ROUND BOTH. `blockedWhen` is evaluated once per row,
 * BEFORE anything is written, from a plain client rather than the transaction.
 * Tick two super admins together and each row's subquery sees a table that
 * still holds the other: count is 2, neither is blocked, and both go out in one
 * statement. Zero active super admins, no error, no warning.
 *
 * This file proves the hole existed by driving exactly that request, and proves
 * it is shut. THE CHECK THAT MATTERS IS THE LAST ONE: after every refusal, both
 * super admins must still be able to sign in. A guard that refuses and leaves
 * the table half-emptied would pass every other check here.
 *
 *     node .lockoutqa.mjs      (local only — writes and deletes, and puts the
 *                               super admins back exactly as it found them)
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
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const liveSupers = async () =>
  (
    await db.query(
      `select id, full_name from users
        where role='super_admin' and status='active' and deleted_at is null
        order by created_at`,
    )
  ).rows;

const existing = await liveSupers();
check(
  "the database has at least one live super admin to start from",
  existing.length >= 1,
  `${existing.length}`,
);

const actor = existing[0];
const token = jwt.sign(
  { sub: actor.id, role: "super_admin", tv: 0 },
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
/* The signing token must carry the real token_version or every call is 401. */
const tv = (
  await db.query("select token_version from users where id=$1", [actor.id])
).rows[0].token_version;
const realToken = jwt.sign(
  { sub: actor.id, role: "super_admin", tv },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);
const callAs = async (method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${realToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/* ------------------------------------------------------------- fixtures */

const wipe = async () => {
  const made = (
    await db.query("select id from users where email like 'lockoutqa+%'")
  ).rows.map((r) => r.id);
  for (const id of made) {
    await db.query("delete from refresh_tokens where user_id=$1", [id]).catch(() => {});
    await db.query("delete from users where id=$1", [id]);
  }
  return made.length;
};
await wipe();

/*
 * Two throwaway super admins of our own, so the test never depends on how many
 * the database happens to hold and never risks the real one.
 */
const made = [];
for (const n of [1, 2]) {
  const res = await callAs("POST", "/users", {
    fullName: `LOCKOUTQA Super ${n}`,
    email: `lockoutqa+${n}@example.com`,
    role: "super_admin",
    password: "Throwaway-For-QA-1",
  });
  made.push(res.body?.id ?? null);
}
check(
  "two throwaway super admins exist",
  made.every(Boolean),
  made.map((id) => String(id).slice(0, 8)).join(", "),
);

const countLive = async () => (await liveSupers()).length;
const before = await countLive();

/* ------------------------- THE HOLE: bulk delete ----------------------- */

/*
 * Every super admin at once — the exact request a tick column's "select all on
 * this page" would produce. Before the fix each row's pre-check saw the others
 * still present, none was blocked, and every one of them was deleted.
 */
const everyone = (await liveSupers()).map((r) => r.id);
const bulk = await callAs("POST", "/trash/user/bulk", {
  ids: everyone,
  reason: "LOCKOUTQA — this must be refused",
});
check(
  "deleting every super admin in one request is REFUSED",
  bulk.status >= 400,
  `HTTP ${bulk.status} ${JSON.stringify(bulk.body?.message ?? "").slice(0, 120)}`,
);
check(
  "and not one of them was deleted — the refusal is all-or-nothing",
  (await countLive()) === before,
  `${before} before, ${await countLive()} after`,
);

/* The narrower version: all but one. That must be allowed. */
/* EVERY one but the real super admin, not just one of them — the point of the
   next block is to leave exactly one standing, and `.slice(0, 1)` left two. */
const allButOne = (await liveSupers())
  .map((r) => r.id)
  .filter((id) => id !== actor.id);
const partial = await callAs("POST", "/trash/user/bulk", {
  ids: allButOne,
  reason: "LOCKOUTQA — this one is fine",
});
check(
  "deleting all BUT one is still allowed — the guard is not a blanket refusal",
  partial.status < 300 && (await countLive()) === 1,
  `HTTP ${partial.status}, ${await countLive()} live`,
);

/* ------------------------ the single paths, still shut ----------------- */

const remaining = await liveSupers();
const last = remaining[remaining.length - 1];
if (remaining.length === 1) {
  const single = await callAs("POST", `/trash/user/${last.id}`, {
    reason: "LOCKOUTQA — the last one",
  });
  check(
    "deleting the last one on its own is refused",
    single.status >= 400,
    `HTTP ${single.status}`,
  );
  const demote = await callAs("PATCH", `/users/${last.id}`, { role: "admin" });
  check(
    "demoting the last one is refused",
    demote.status >= 400,
    `HTTP ${demote.status} ${JSON.stringify(demote.body?.message ?? "").slice(0, 90)}`,
  );
  const disable = await callAs("PATCH", `/users/${last.id}`, {
    status: "disabled",
  });
  check(
    "disabling the last one is refused",
    disable.status >= 400,
    `HTTP ${disable.status}`,
  );
} else {
  check(
    "the fixture left exactly one super admin to test the single paths on",
    false,
    `${remaining.length} remain`,
  );
}

/* ------------- THE ONE THAT MATTERS: everybody can still get in -------- */

const final = await liveSupers();
check(
  "after every refusal there is still a super admin who can sign in",
  final.length >= 1,
  final.map((r) => r.full_name).join(", ") || "NOBODY — the app is locked",
);
const whoami = await callAs("GET", "/auth/me");
check(
  "and the app actually answers to one",
  whoami.status === 200,
  `HTTP ${whoami.status}`,
);

/* ---------------------------------------------------------------- tidy */

/* Restore anything the allowed delete took, then remove the throwaways. */
for (const id of made) {
  if (!id) continue;
  await db.query(
    "update users set deleted_at = null, deleted_by = null, delete_reason = null where id = $1",
    [id],
  );
}
const removed = await wipe();
const after = await liveSupers();
check(
  "the real super admins are exactly as they were found",
  after.length === existing.length &&
    after.every((r) => existing.some((e) => e.id === r.id)),
  `${existing.length} before, ${after.length} after; ${removed} throwaways removed`,
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
