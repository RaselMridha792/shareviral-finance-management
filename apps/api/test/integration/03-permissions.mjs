/**
 * T3 — the permission matrix, by request rather than by reading the code.
 *
 * The expectation for every cell comes from ROLE_PERMISSIONS in the shared
 * package, so this cannot drift from the app's own definition. What it proves
 * is the part a definition cannot: that the guard actually runs on the route.
 *
 * A 401 is a failure here, not a pass — it means the token was rejected and
 * the permission was never consulted, which would make the whole run green for
 * the wrong reason.
 */
import fs from "node:fs";
import { ROLE_PERMISSIONS } from "@finance/shared";

const API = process.env.API;
const TOK = Object.fromEntries(
  fs.readFileSync(new URL("./roles.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
);

const ROLES = ["super_admin", "ceo", "admin", "finance", "hr"];
const has = (role, permission) => ROLE_PERMISSIONS[role].includes(permission);

/**
 * Every route worth asserting, with the permissions its decorator demands.
 * Writes use a body that is deliberately invalid, so a role that IS allowed
 * through lands on validation (400/422) rather than creating anything — the
 * question here is only whether the door opened.
 */
const ROUTES = [
  ["GET", "/transactions?page=1&pageSize=1", ["transactions.read"]],
  ["POST", "/transactions", ["transactions.write"], {}],
  ["GET", "/accounts", ["accounts.read"]],
  ["POST", "/accounts", ["accounts.write"], {}],
  ["GET", "/categories/tree", ["categories.read"]],
  ["POST", "/categories", ["categories.write"], {}],
  ["GET", "/vendors?page=1&pageSize=1", ["vendors.read"]],
  ["POST", "/vendors", ["vendors.write"], {}],
  ["GET", "/team-members?page=1&pageSize=1", ["team.read"]],
  ["POST", "/team-members", ["team.write"], {}],
  ["GET", "/payroll/runs", ["payroll.read"]],
  ["POST", "/payroll/runs", ["payroll.write"], {}],
  ["GET", "/tds/deposits", ["tds.read"]],
  ["POST", "/tds/deposits", ["tds.write"], {}],
  ["GET", "/income-tax?assessmentYear=2026-2027", ["incometax.read"]],
  ["GET", "/reports/period?from=2026-08-01&to=2026-08-31", ["reports.view"]],
  ["GET", "/audit?page=1&pageSize=1", ["audit.read"]],
  ["GET", "/settings", ["settings.read"]],
  ["PATCH", "/settings", ["settings.write"], {}],
  ["GET", "/users", ["users.manage"]],
  ["GET", "/exports/team-members", ["exports.run", "team.read"]],
  ["GET", "/exports/transactions", ["exports.run", "transactions.read"]],
];

let pass = 0, fail = 0, note = 0;
const ok = (n, d) => { pass++; if (process.env.VERBOSE) console.log(`  PASS  ${n} — ${d}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n} — ${d}`); };

console.log("\nT3 — THE PERMISSION MATRIX\n");

for (const [method, path, needs, body] of ROUTES) {
  const line = [];
  for (const role of ROLES) {
    const token = TOK[role.toUpperCase()];
    const allowed = needs.every((p) => has(role, p));

    const res = await fetch(`${API}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-requested-with": "finance-web" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const label = `${method} ${path} as ${role}`;
    if (res.status === 401) { bad(label, "401 — the token was refused, so the permission was never tested"); line.push(`${role}:401!`); continue; }

    if (allowed) {
      // Through the door is anything but 403. Validation failures are fine:
      // the body was invalid on purpose so nothing is written.
      res.status === 403
        ? bad(label, "403 for a role that holds " + needs.join(" + "))
        : ok(label, String(res.status));
      line.push(`${role}:${res.status}`);
    } else {
      res.status === 403
        ? ok(label, "403 as it should")
        : bad(label, `expected 403, got ${res.status}`);
      line.push(`${role}:${res.status}`);
    }
  }
  console.log(`  ${method.padEnd(5)} ${path.padEnd(48)} ${line.join("  ")}`);
}

/* ------------------------------------------------------------------ */
console.log("\nWhere HR's line is now drawn");

/**
 * The line moved on 2026-08-15 and did not disappear.
 *
 * HR used to be refused every pay figure. The owner decided otherwise — their
 * HR runs pay — so HR now reads and sets compensation and reads the salary
 * sheet. What HR still cannot do is release the money, or see what the company
 * itself holds. Those are the checks worth keeping.
 */
const hr = { authorization: `Bearer ${TOK.HR}`, "x-requested-with": "finance-web" };
const team = await fetch(`${API}/team-members?page=1&pageSize=100`, { headers: hr });
const json = await team.json();
const people = json.items ?? json.data ?? [];
const first = people[0];

if (!first) { note++; console.log("  ????  HR team read — no people to inspect"); }
else {
  const compensation = await fetch(`${API}/team-members/${first.id}/compensation`, { headers: hr });
  compensation.status === 200
    ? console.log("  PASS  HR can read a compensation record — 200, as decided") || pass++
    : bad("HR compensation", `expected 200, got ${compensation.status}`);
}

// Reading the sheet: allowed. Building one or paying it: not.
{
  const read = await fetch(`${API}/payroll/runs`, { headers: hr });
  read.status === 200
    ? console.log("  PASS  HR can open the salary sheet — 200") || pass++
    : bad("HR payroll read", `expected 200, got ${read.status}`);

  const build = await fetch(`${API}/payroll/runs`, {
    method: "POST", headers: { "content-type": "application/json", ...hr },
    body: JSON.stringify({ periodYear: 2026, periodMonth: 12 }),
  });
  build.status === 403
    ? console.log("  PASS  HR cannot create a payroll run — 403") || pass++
    : bad("HR payroll write", `expected 403, got ${build.status}`);
}

// The company's own position stays off HR's screens: knowing every salary is
// not the same as knowing the bank balance or what the CEO sent.
for (const [label, path] of [
  ["the reports", "/reports/period?granularity=month"],
  ["the ledger", "/transactions?page=1&pageSize=1"],
  ["the bank statistics", "/reports/bank-stats?year=2026"],
]) {
  const r = await fetch(`${API}${path}`, { headers: hr });
  r.status === 403
    ? console.log(`  PASS  HR cannot open ${label} — 403`) || pass++
    : bad(`HR and ${label}`, `expected 403, got ${r.status}`);
}

// And the export it IS allowed to run must not carry one either.
const sheet = await fetch(`${API}/exports/team-members`, { headers: hr });
if (sheet.status !== 200) { bad("HR team export", `HTTP ${sheet.status}`); }
else {
  const buf = Buffer.from(await sheet.arrayBuffer());
  fs.writeFileSync(new URL("./hr-team-export.xlsx", import.meta.url), buf);
  console.log(`  PASS  HR can run the team export — ${(buf.length / 1024).toFixed(1)} KB (contents checked in T6)`);
  pass++;
}

console.log(`\n${pass} passed, ${fail} failed, ${note} inconclusive`);
process.exit(fail ? 1 : 0);
