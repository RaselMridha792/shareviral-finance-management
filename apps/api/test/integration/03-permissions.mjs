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
console.log("\nThe boundary this whole matrix exists for");

// HR must not be able to reach a pay figure by any route it can open.
const hr = { authorization: `Bearer ${TOK.HR}`, "x-requested-with": "finance-web" };
const team = await fetch(`${API}/team-members?page=1&pageSize=100`, { headers: hr });
const json = await team.json();
const people = json.items ?? json.data ?? [];
const first = people[0];

if (!first) { note++; console.log("  ????  HR team read — no people to inspect"); }
else {
  const compensation = await fetch(`${API}/team-members/${first.id}/compensation`, { headers: hr });
  compensation.status === 403
    ? ok("HR compensation", "403") || console.log("  PASS  HR is refused a compensation record — 403")
    : bad("HR compensation", `expected 403, got ${compensation.status}`);

  const current = Object.keys(first).filter((k) => /^(grossSalary|currentSalary|netSalary|compensation|tdsAmount|payroll)/i.test(k));
  current.length
    ? bad("HR team payload", `carries current pay: ${current.join(", ")}`)
    : console.log("  PASS  HR team payload carries no current pay — joiningSalary only, which is the documented exception") || pass++;
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
