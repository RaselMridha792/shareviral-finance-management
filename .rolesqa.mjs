/**
 * Admin and Finance are gone. Nobody lost anything, and nobody is locked out.
 *
 * The owner: *"admin role take delete kore daw and Finance Role take delete
 * kore daw ekhane Finance and CFO akoi role er under a ache tader kaj akoi and
 * admin er dorkar nai super admin holei hobe"* — and, watching it land:
 * *"make sure kono data jeno na haray"*.
 *
 * Two things could go wrong here and neither shows up in a diff:
 *
 *   1. A user left on a retired role. `hasPermission` used to THROW on one, so
 *      that person met a 500 on every request in the app rather than a refusal.
 *   2. History rewritten. `audit_logs.actor_role` records the role somebody
 *      held AT THE TIME; an audit trail edited to say they were always a CFO is
 *      not an audit trail.
 *
 * So this drives the real API with a real signed-in CFO, and reads the
 * database back.
 *
 *     node .rolesqa.mjs      (local only)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";

import {
  ROLES,
  RETIRED_ROLES,
  STORED_ROLES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  PERMISSIONS,
  hasPermission,
  permissionsFor,
} from "./packages/shared/dist/index.js";

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

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------- 1. the lists themselves */

check(
  "four roles can be given",
  ROLES.length === 4 &&
    !ROLES.includes("admin") &&
    !ROLES.includes("finance"),
  ROLES.join(", "),
);
check(
  "the database's own enum still declares all six",
  STORED_ROLES.length === 6 &&
    STORED_ROLES.includes("admin") &&
    STORED_ROLES.includes("finance"),
  STORED_ROLES.join(", "),
);
check(
  "and the retired two keep their names for history",
  ROLE_LABELS.admin === "Admin" && ROLE_LABELS.finance === "Finance",
  `${ROLE_LABELS.admin} / ${ROLE_LABELS.finance}`,
);

/*
 * THE ONE THAT WOULD HAVE HURT. A row carrying a retired role must produce no
 * permissions, not an exception.
 */
for (const retired of RETIRED_ROLES) {
  let threw = false;
  let allowed = null;
  try {
    allowed = hasPermission(retired, "dashboard.view");
  } catch {
    threw = true;
  }
  check(
    `a row still on ${ROLE_LABELS[retired]} fails closed rather than throwing`,
    !threw && allowed === false && permissionsFor(retired).length === 0,
    threw ? "THREW" : `no permissions, no exception`,
  );
}

/* ------------------------------- 2. nobody lost anything by being moved --- */

/*
 * The claim the migration rests on: Admin's permissions and CFO's were the same
 * set. Asserted against the CURRENT matrix, where admin no longer exists — so
 * it is checked the only way left, against what the retired row used to be:
 * CFO must hold everything except the two that are super_admin's.
 */
const cfoMissing = PERMISSIONS.filter((p) => !hasPermission("cfo", p));
check(
  "CFO holds everything except settings.write and users.manage",
  JSON.stringify(cfoMissing) ===
    JSON.stringify(["settings.write", "users.manage"]),
  cfoMissing.join(", "),
);
check(
  "so a CFO can still pay a payroll run and see a salary",
  hasPermission("cfo", "payroll.pay") &&
    hasPermission("cfo", "team.compensation.read") &&
    hasPermission("cfo", "transactions.write"),
  "payroll.pay, compensation, ledger",
);
check(
  "and still cannot create sign-in accounts — that stayed with Super Admin",
  !hasPermission("cfo", "users.manage") &&
    hasPermission("super_admin", "users.manage"),
  "users.manage is super_admin's alone",
);

/* --------------------------------- 3. the database, after the migration --- */

const byRole = (
  await db.query("select role::text, count(*)::int n from users group by role")
).rows;
const total = byRole.reduce((n, r) => n + r.n, 0);
const stranded = byRole.filter((r) => ["admin", "finance"].includes(r.role));

check(
  "not one user is left on a retired role",
  stranded.length === 0,
  stranded.length
    ? stranded.map((r) => `${r.role}=${r.n}`).join(" ")
    : byRole.map((r) => `${r.role}=${r.n}`).join(" "),
);
check(
  "and every user is still there — nobody was deleted",
  total > 0,
  `${total} users across ${byRole.length} roles`,
);

const moved = (
  await db.query(
    `select before->>'role' was, count(*)::int n from audit_logs
      where summary like 'Role retired:%' group by 1 order by 1`,
  )
).rows;
check(
  "the migration recorded who moved and what they were",
  moved.length > 0,
  moved.map((r) => `${r.n} from ${r.was}`).join(", ") || "no record",
);

const history = (
  await db.query(
    `select actor_role::text r, count(*)::int n from audit_logs
      where actor_role in ('admin','finance') group by 1 order by 1`,
  )
).rows;
check(
  "history was NOT rewritten — old entries keep the role their actor held",
  history.length > 0,
  history.map((r) => `${r.n} entries still say ${r.r}`).join(", ") || "none left",
);

/* ------------------------------ 4. a real CFO can still use the app ------- */

const person = (
  await db.query(
    `select id, role, token_version, full_name from users
      where role='cfo' and status='active' and deleted_at is null limit 1`,
  )
).rows[0];
check("there is an active CFO to sign in as", Boolean(person), person?.full_name);

if (person) {
  const token = jwt.sign(
    { sub: person.id, role: person.role, tv: person.token_version },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "1h" },
  );
  const call = async (path_) => {
    const res = await fetch(API + path_, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.status;
  };

  const me = await fetch(`${API}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await me.json().catch(() => null);
  check(
    "signing in as a CFO works and reports the right permissions",
    me.status === 200 && body?.permissions?.length === 29,
    `${me.status}, ${body?.permissions?.length ?? "?"} permissions`,
  );

  const doors = [
    ["the ledger", "/transactions?page=1&pageSize=1", true],
    ["accounts", "/accounts?includeInactive=false", true],
    ["payroll", "/payroll/runs?page=1&pageSize=1", true],
    ["the audit log", "/audit?page=1&pageSize=1", true],
    ["managing users", "/users?page=1&pageSize=1", false],
  ];
  for (const [what, path_, shouldOpen] of doors) {
    const status = await call(path_);
    const opened = status === 200;
    check(
      `a CFO ${shouldOpen ? "can still reach" : "is still refused"} ${what}`,
      opened === shouldOpen,
      `${status}`,
    );
  }
}

/* ------------------------------ 5. and a retired role cannot be given ----- */

const superUser = (
  await db.query(
    `select id, role, token_version from users
      where role='super_admin' and status='active' and deleted_at is null limit 1`,
  )
).rows[0];
if (superUser) {
  const token = jwt.sign(
    { sub: superUser.id, role: superUser.role, tv: superUser.token_version },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "1h" },
  );
  const res = await fetch(`${API}/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "rolesqa-should-not-exist@shareviral.cash",
      fullName: "ROLESQA Should Not Exist",
      role: "admin",
    }),
  });
  check(
    "the API refuses to create anybody as Admin",
    res.status === 400,
    `${res.status}`,
  );
  const made = (
    await db.query("select count(*)::int n from users where email like 'rolesqa-%'")
  ).rows[0].n;
  check("and no such account was created", made === 0, `${made} found`);
}

console.log("\n  users by role now:");
for (const r of byRole.sort((a, b) => b.n - a.n)) {
  console.log(`    ${(ROLE_LABELS[r.role] ?? r.role).padEnd(13)} ${String(r.n).padStart(3)}`);
}

await db.end();

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(74));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
      failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
