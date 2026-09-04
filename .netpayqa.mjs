/**
 * A typed Net Pay is the Net Pay.
 *
 * The owner, asked where an edited figure should land:
 *
 *   *"net pay ta to automatic calculation hobe eta ok but ami cai ami edit kore
 *    jodi kichu bosai oitai pore actual hobe. like age net pay dhoro 100 taka
 *    ami bosalam 110 taka oi 110 takai db te save hobe and oita dhore
 *    calculation hobe."*
 *
 * So the test is not "can the box be typed in". It is whether the typed figure
 * then behaves as the net EVERYWHERE — the sheet's own total, the salary
 * payment written when the run is paid, the payslip. Each of those is read back
 * out of the database rather than off a response body.
 *
 * `net_amount` is a generated column and stays one; `net_amount_override` is
 * the typed figure. Every reader takes `coalesce(override, net_amount)`, and
 * these checks are what say so.
 *
 *     node .netpayqa.mjs      (local only — builds a run and removes it)
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

const MARK = "NETPAYQA";

const wipe = async () => {
  await db.query(
    `delete from transactions where description like $1 or payroll_run_id in
       (select id from payroll_runs where notes like $1)`,
    [`%${MARK}%`],
  );
  await db.query(
    `delete from payroll_lines where payroll_run_id in
       (select id from payroll_runs where notes like $1)`,
    [`%${MARK}%`],
  );
  await db.query("delete from payroll_runs where notes like $1", [`%${MARK}%`]);
  await db.query("delete from team_members where full_name like $1", [
    `${MARK}%`,
  ]);
  await db.query("delete from accounts where name like $1", [`${MARK}%`]);
};
await wipe();

/* ------------------------------------------------------------- fixtures */

const bank = (
  await call("POST", "/accounts", {
    name: `${MARK} Bank`,
    type: "bank",
    openingBalance: "5000000.00",
    openingBalanceOn: "2026-01-01",
  })
).body;

const made = [];
for (const [i, name] of ["Ayesha", "Bipul"].entries()) {
  const res = await call("POST", "/team-members", {
    fullName: `${MARK} ${name}`,
    engagementType: "employee",
    joinedOn: "2026-01-01",
    currentSalary: String((40000 + i * 10000).toFixed(2)),
  });
  if (res.status === 201) made.push(res.body);
}
check("two people and an account", made.length === 2 && Boolean(bank?.id));

const run = (
  await call("POST", "/payroll/runs", {
    periodYear: 2026,
    periodMonth: 6,
    notes: `${MARK} June 2026`,
  })
).body;
await call("POST", `/payroll/runs/${run.id}/generate-lines`, {});

const lines = async () =>
  (
    await db.query(
      `select l.id, t.full_name,
              l.gross_amount::text gross, l.bonus_amount::text bonus,
              l.other_additions::text plus, l.tds_amount::text tds,
              l.other_deductions::text minus,
              l.net_amount::text arithmetic,
              l.net_amount_override::text typed
         from payroll_lines l join team_members t on t.id = l.team_member_id
        where l.payroll_run_id = $1 order by t.full_name`,
      [run.id],
    )
  ).rows;
const runTotal = async () =>
  (
    await db.query("select total_net::text n from payroll_runs where id = $1", [
      run.id,
    ])
  ).rows[0].n;

let rows = await lines();
check("a sheet with a line each", rows.length === 2, `${rows.length} lines`);

const sums = (r) =>
  (
    Number(r.gross) +
    Number(r.bonus) +
    Number(r.plus) -
    Number(r.tds) -
    Number(r.minus)
  ).toFixed(2);
check(
  "the arithmetic is what the four columns come to",
  rows.every((r) => Number(r.arithmetic).toFixed(2) === sums(r)),
  rows.map((r) => `${Number(r.arithmetic).toFixed(2)}=${sums(r)}`).join(" "),
);
check(
  "and nobody has disagreed with it yet",
  rows.every((r) => r.typed === null),
  rows.map((r) => r.typed ?? "null").join(" "),
);

const arithmeticTotal = rows
  .reduce((n, r) => n + Number(r.arithmetic), 0)
  .toFixed(2);
check(
  "the run's total is the sum of them",
  Number(await runTotal()).toFixed(2) === arithmeticTotal,
  `${await runTotal()} vs ${arithmeticTotal}`,
);

/* ---------------------------- 100 becomes 110 -------------------------- */

const mine = rows[0];
const bumped = (Number(mine.arithmetic) + 1000).toFixed(2);
const typed = await call("PATCH", `/payroll/lines/${mine.id}`, {
  netAmount: bumped,
});
rows = await lines();
const after = rows.find((r) => r.id === mine.id);
check(
  "a typed Net Pay is accepted",
  typed.status === 200,
  `${typed.status}`,
);
check(
  "it is stored as the override, and the arithmetic is untouched beside it",
  after?.typed === bumped && Number(after?.arithmetic).toFixed(2) === sums(after),
  `typed=${after?.typed} arithmetic=${after?.arithmetic}`,
);

/* THE CLAIM: "oita dhore calculation hobe" — everything reads the typed one. */

const expectedTotal = rows
  .reduce((n, r) => n + Number(r.typed ?? r.arithmetic), 0)
  .toFixed(2);
check(
  "the run's total follows the typed figure, not the arithmetic",
  Number(await runTotal()).toFixed(2) === expectedTotal &&
    expectedTotal !== arithmeticTotal,
  `${await runTotal()} — was ${arithmeticTotal}`,
);

const sheet = await call("GET", `/payroll/runs/${run.id}`);
const shown = (sheet.body?.lines ?? []).find((l) => l.id === mine.id);
check(
  "the sheet reads back the typed figure",
  Number(shown?.netAmount).toFixed(2) === bumped,
  `netAmount=${shown?.netAmount}`,
);
check(
  "and says it was typed rather than worked out",
  shown?.netManual === true &&
    (sheet.body?.lines ?? []).some((l) => l.netManual === false),
  `netManual=${shown?.netManual}`,
);

/* -------------------- a component change puts it back ------------------ */

await call("PATCH", `/payroll/lines/${mine.id}`, { bonusAmount: "500.00" });
rows = await lines();
const rebuilt = rows.find((r) => r.id === mine.id);
check(
  "changing a component clears the typed net — the row adds up again",
  rebuilt?.typed === null &&
    Number(rebuilt?.arithmetic).toFixed(2) === sums(rebuilt),
  `typed=${rebuilt?.typed ?? "null"} arithmetic=${rebuilt?.arithmetic}`,
);

/* ----------------------- and it can be typed again --------------------- */

const again = (Number(rebuilt.arithmetic) + 250).toFixed(2);
await call("PATCH", `/payroll/lines/${mine.id}`, { netAmount: again });
rows = await lines();
check(
  "and it can be typed over again",
  rows.find((r) => r.id === mine.id)?.typed === again,
  `typed=${rows.find((r) => r.id === mine.id)?.typed}`,
);

/* ---------------------- emptying it puts the sum back ------------------ */

await call("PATCH", `/payroll/lines/${mine.id}`, { netAmount: null });
rows = await lines();
check(
  "and clearing it goes back to the arithmetic",
  rows.find((r) => r.id === mine.id)?.typed === null,
  `typed=${rows.find((r) => r.id === mine.id)?.typed ?? "null"}`,
);

/* ------------------- a zero net is refused, like an amount ------------- */

const zero = await call("PATCH", `/payroll/lines/${mine.id}`, {
  netAmount: "0.00",
});
check(
  "a Net Pay of nothing is refused — that is a mistype, not a salary",
  zero.status === 400,
  `${zero.status}`,
);

/* ------------- the money that leaves the bank is the typed one --------- */

/*
 * The tax first, THEN the typed net — in that order deliberately. Setting a tax
 * figure is a component change, so doing it afterwards would clear the override
 * and the payment below would prove nothing.
 */
for (const r of rows) {
  await call("PATCH", `/payroll/lines/${r.id}`, { tdsAmount: "0.00" });
}
rows = await lines();
const finalNet = (
  Number(rows.find((r) => r.id === mine.id).arithmetic) + 777
).toFixed(2);
await call("PATCH", `/payroll/lines/${mine.id}`, { netAmount: finalNet });
rows = await lines();
check(
  "the typed net survives up to the moment the run is paid",
  rows.find((r) => r.id === mine.id)?.typed === finalNet,
  `typed=${rows.find((r) => r.id === mine.id)?.typed ?? "null"}`,
);
const payableAfterTax = rows
  .reduce((n, r) => n + Number(r.typed ?? r.arithmetic), 0)
  .toFixed(2);
const arithmeticOnly = rows
  .reduce((n, r) => n + Number(r.arithmetic), 0)
  .toFixed(2);

await call("POST", `/payroll/runs/${run.id}/finalize`, {});
const paid = await call("POST", `/payroll/runs/${run.id}/pay`, {
  paymentDate: "2026-06-30",
  accountId: bank.id,
  paymentMode: "consolidated",
  usdRate: "121.50",
});
const ledger = (
  await db.query(
    `select amount::text a, usd_rate::text r from transactions
      where payroll_run_id = $1 and deleted_at is null`,
    [run.id],
  )
).rows;
check(
  "paying the run leaves the bank with what the sheet says",
  paid.status === 200 &&
    ledger.length === 1 &&
    Number(ledger[0].a).toFixed(2) === payableAfterTax &&
    payableAfterTax !== arithmeticOnly,
  `ledger=${ledger[0]?.a} sheet=${payableAfterTax}, arithmetic alone would be ${arithmeticOnly}`,
);
check(
  "and that ledger row states its rate, like every other",
  ledger[0]?.r === "121.500000",
  `usd_rate=${ledger[0]?.r}`,
);

rows = await lines();
console.log("\n  the sheet, at the end:");
for (const r of rows) {
  console.log(
    `    ${String(r.full_name).replace(MARK + " ", "").padEnd(9)}` +
      ` gross=${String(r.gross).padStart(10)} tds=${String(r.tds).padStart(8)}` +
      ` arithmetic=${String(r.arithmetic).padStart(10)}` +
      ` typed=${r.typed ?? "—"}`,
  );
}
console.log(`    run total_net = ${await runTotal()}   bank paid = ${ledger[0]?.a}`);

/* ----------------------------- and the screen -------------------------- */

const screen = fs.readFileSync(
  "apps/web/src/components/payroll/salary-sheet-screen.tsx",
  "utf8",
);
check(
  "the sheet draws Net Pay as a box, not a figure",
  screen.includes('saveNet(event.target.value)') &&
    screen.includes("key={liveNet}"),
  "editable, and it follows the row",
);
check(
  "and marks a net that was typed",
  screen.includes("line.netManual"),
  "netManual on the cell",
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
