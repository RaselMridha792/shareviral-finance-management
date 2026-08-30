/**
 * Which reads of a deletable table have not been taught to skip the trash.
 *
 * Adding `deleted_at is null` in forty places by hand is exactly the job where
 * one gets missed, and a missed one is invisible: the query still runs, the
 * page still renders, and a row somebody deleted is quietly still in the
 * answer. So the list is produced rather than remembered.
 *
 *     node .delfilter.mjs           every unfiltered read, by table
 *     node .delfilter.mjs fxRates   just that one
 *
 * A "read" is a `.from(table)` or a `from ${table}` in raw SQL. It is filtered
 * if the statement it belongs to mentions the table's `deletedAt` — or, for a
 * money table, `voidedAt`, since deleting sets both and every voided-row filter
 * therefore already excludes deleted ones. That second rule is the whole point
 * of the design and is why this report is as short as it is.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "apps/api/src";

/** Drizzle name -> whether deleting also voids it. */
const TABLES = {
  transactions: { voids: true },
  accounts: { voids: false },
  categories: { voids: false },
  vendors: { voids: false },
  teamMembers: { voids: false },
  compensationHistory: { voids: false },
  payrollRuns: { voids: false },
  subscriptions: { voids: false },
  tdsDeposits: { voids: false },
  withholdingReturns: { voids: false },
  incomeTaxRecords: { voids: false },
  fxRates: { voids: false },
  statements: { voids: false },
  importBatches: { voids: false },
  users: { voids: false },
};

const only = process.argv[2];

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".spec.ts")) files.push(p);
  }
};
walk(ROOT);

/**
 * The statement a `.from()` belongs to.
 *
 * Not the line — a Drizzle query spans eight of them and the filter is always
 * on a different one from the `.from`. Walking out to the enclosing `await` or
 * `const` and forward to the balanced end of it is what makes "is this one
 * filtered" answerable at all.
 */
function statementAround(text, at) {
  let start = at;
  while (start > 0) {
    const nl = text.lastIndexOf("\n", start - 1);
    if (nl < 0) { start = 0; break; }
    const line = text.slice(nl + 1, start);
    if (/^\s*(const|let|await|return|this\.|\)|\}|=>)/.test(line) && !/^\s*\./.test(line)) {
      start = nl + 1;
      break;
    }
    start = nl;
  }
  // Forward to the first line that ends the chain: a `;` at depth zero.
  let depth = 0;
  let i = at;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth <= 0) break;
  }
  return text.slice(start, Math.min(i + 1, text.length));
}

const findings = [];
let checked = 0;

for (const file of files) {
  if (file.includes("db\\schema") || file.includes("db/schema")) continue;
  if (file.includes("modules\\trash") || file.includes("modules/trash")) continue;
  const text = fs.readFileSync(file, "utf8");

  for (const [table, meta] of Object.entries(TABLES)) {
    if (only && table !== only) continue;
    const pattern = new RegExp(`\\.from\\(${table}\\)|from \\$\\{${table}\\}`, "g");
    let m;
    while ((m = pattern.exec(text))) {
      checked++;
      const stmt = statementAround(text, m.index);
      const filtered =
        stmt.includes(`${table}.deletedAt`) ||
        stmt.includes("deleted_at") ||
        (meta.voids &&
          (stmt.includes(`${table}.voidedAt`) || stmt.includes("voided_at")));
      if (!filtered) {
        const line = text.slice(0, m.index).split("\n").length;
        findings.push({
          table,
          file: file.replace(/\\/g, "/"),
          line,
          snippet: stmt.split("\n").slice(0, 3).join(" ").replace(/\s+/g, " ").slice(0, 90),
        });
      }
    }
  }
}

console.log(`\n${checked} reads of a deletable table\n`);
if (findings.length === 0) {
  console.log("  every one of them skips the trash");
} else {
  const byTable = {};
  for (const f of findings) (byTable[f.table] ??= []).push(f);
  for (const [table, rows] of Object.entries(byTable)) {
    console.log(`  ${table} — ${rows.length} unfiltered`);
    for (const r of rows) console.log(`      ${r.file}:${r.line}  ${r.snippet}`);
  }
  console.log(`\n  ${findings.length} of ${checked}`);
}
