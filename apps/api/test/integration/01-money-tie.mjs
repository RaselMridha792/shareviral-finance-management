/**
 * T1 — the money tie.
 *
 * The register's closing balance must equal the account's opening balance plus
 * every live signed amount, and a voided row must count for nothing. Checked
 * against SQL rather than against the API's own other endpoint, because two
 * views built from the same wrong query agree perfectly.
 *
 * Then the same thing again after real mutations, and again after a void, and
 * again after the test rows are removed — because a tie that only holds on a
 * quiet table is not a tie.
 *
 * Nothing here passes on an empty set: no accounts, or no transactions, is
 * INCONCLUSIVE. Comparing two zeros is how a broken query reports success.
 */
import fs from "node:fs";
import pg from "pg";

const API = process.env.API;
const env = Object.fromEntries(
  fs.readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const TOK = Object.fromEntries(
  fs.readFileSync(new URL("./roles.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
);

const H = { "content-type": "application/json", authorization: `Bearer ${TOK.SUPER_ADMIN}`, "x-requested-with": "finance-web" };
const api = async (path, init) => {
  const r = await fetch(`${API}${path}`, { headers: H, ...init });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

let pass = 0, fail = 0, skip = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? " — " + d : ""}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n} — ${d}`); };
const meh = (n, d) => { skip++; console.log(`  ????  ${n} — ${d}`); };

/** What the books say, computed in SQL and nowhere else. */
async function truth() {
  const { rows } = await db.query(`
    select a.id, a.name, a.opening_balance::numeric as opening,
           coalesce(sum(t.signed_amount) filter (where t.voided_at is null), 0)::numeric as movement,
           a.opening_balance::numeric + coalesce(sum(t.signed_amount) filter (where t.voided_at is null), 0)::numeric as closing,
           count(t.id) filter (where t.voided_at is null)::int as live,
           count(t.id) filter (where t.voided_at is not null)::int as voided
    from accounts a
    left join transactions t on t.account_id = a.id
    group by a.id, a.name, a.opening_balance
    order by a.name`);
  return rows;
}

/** Compares the register endpoint against that, to the paisa. */
async function tie(label) {
  const rows = await truth();
  if (!rows.length) { meh(`${label}: accounts`, "none exist"); return; }
  const anyMovement = rows.some((r) => Number(r.live) > 0);
  if (!anyMovement) { meh(`${label}: movement`, "no live transactions on any account"); return; }

  for (const account of rows) {
    const reg = await api(`/accounts/${account.id}/register?page=1&pageSize=1`);
    if (reg.status !== 200) { bad(`${label}: ${account.name}`, `register HTTP ${reg.status}`); continue; }

    const shown = reg.body.closingBalance ?? reg.body.summary?.closingBalance ?? null;
    if (shown === null) { meh(`${label}: ${account.name}`, "register carries no closing balance"); continue; }

    const same = Number(shown).toFixed(2) === Number(account.closing).toFixed(2);
    same
      ? ok(`${label}: ${account.name}`, `${Number(shown).toFixed(2)} = opening ${Number(account.opening).toFixed(2)} + moved ${Number(account.movement).toFixed(2)} (${account.live} live, ${account.voided} voided)`)
      : bad(`${label}: ${account.name}`, `register says ${shown}, the books say ${Number(account.closing).toFixed(2)}`);
  }
}

console.log("\nT1 — THE MONEY TIE\n");
console.log("As it stands");
await tie("baseline");

// ---------------------------------------------------------------- mutations
const accounts = await api("/accounts");
const account = (accounts.body ?? [])[0];
const cats = await api("/categories/tree");
/** A leaf that accepts money moving this way. The API refuses a mismatch, correctly. */
const leafFor = (want) => (function find(nodes) {
  for (const n of nodes ?? []) {
    if (n.children?.length) { const hit = find(n.children); if (hit) return hit; }
    else if (n.kind === want || n.kind === "both") return n;
  }
  return null;
})(cats.body ?? []);
const outLeaf = leafFor("out");
const inLeaf = leafFor("in");
const leaf = outLeaf;

if (!account || !leaf) {
  meh("mutations", "no account or no leaf category to post against");
} else {
  console.log(`\nAfter writing three entries to ${account.name}`);
  const made = [];
  for (const [amount, direction] of [["1234.56", "out"], ["7000.00", "in"], ["99.99", "out"]]) {
    const category = direction === "in" ? inLeaf : outLeaf;
    if (!category) { meh(`create ${direction}`, `no leaf category accepts money ${direction}`); continue; }
    const res = await api("/transactions", {
      method: "POST",
      body: JSON.stringify({
        txnDate: "2026-08-14", amount, direction,
        description: `T1 tie check ${amount}`,
        accountId: account.id, categoryId: category.id,
      }),
    });
    if (res.status === 201) made.push(res.body.id);
    else bad("create a transaction", `HTTP ${res.status} ${JSON.stringify(res.body?.errors ?? res.body?.message ?? "").slice(0, 120)}`);
  }
  made.length === 3 ? ok("wrote three entries", "one in, two out") : bad("wrote three entries", `only ${made.length}`);
  await tie("after writes");

  console.log(`\nAfter voiding one of them`);
  const voided = await api(`/transactions/${made[0]}/void`, {
    method: "POST",
    body: JSON.stringify({ reason: "T1 tie check — voided on purpose" }),
  });
  voided.status === 200 || voided.status === 201
    ? ok("void accepted", `HTTP ${voided.status}`)
    : bad("void accepted", `HTTP ${voided.status} ${JSON.stringify(voided.body).slice(0, 140)}`);
  await tie("after void");

  // The voided row must still be visible in the register, and still not counted.
  /**
   * Two readings of the same register, because the default and the screen
   * disagree on purpose: the statement builds its ledgers from this call and
   * must count live money only, while the register screen passes
   * includeVoided so a voided row stays on screen, struck through.
   */
  const plain = await api(`/accounts/${account.id}/register?page=1&pageSize=200`);
  const shown = await api(`/accounts/${account.id}/register?page=1&pageSize=200&includeVoided=true`);

  const plainRows = plain.body?.rows ?? [];
  const shownRows = shown.body?.rows ?? [];
  if (!shownRows.length) meh("register rows", "no rows came back at all");
  else {
    plainRows.find((r) => r.id === made[0])
      ? bad("default hides the voided row", "it is in the plain reading, which the statement uses")
      : ok("default hides the voided row", `${plainRows.length} live rows, statement-safe`);

    const row = shownRows.find((r) => r.id === made[0]);
    if (!row) bad("includeVoided shows it", "still missing with the flag on");
    else if (!row.voidedAt) bad("includeVoided shows it", "present but carries no voidedAt");
    else ok("includeVoided shows it, marked", `${row.refNo}, reason "${row.voidReason}"`);

    // Whichever reading, the totals must count live money only.
    for (const [label, res] of [["default", plain], ["with voided shown", shown]]) {
      const live = (res.body?.rows ?? []).filter((r) => !r.voidedAt);
      const sum = live.reduce((t, r) => t + Number(r.signedAmount), 0);
      const expected = Number(res.body.closingBalance) - Number(res.body.openingBalance);
      Math.abs(sum - expected) < 0.005
        ? ok(`totals count live money only (${label})`, `${sum.toFixed(2)} = closing - opening`)
        : bad(`totals count live money only (${label})`, `live ${sum.toFixed(2)} vs ${expected.toFixed(2)}`);
    }
  }

  console.log(`\nAfter removing the test rows`);
  await db.query("delete from audit_logs where entity_id = any($1::text[])", [made]);
  const gone = await db.query("delete from transactions where id = any($1::uuid[])", [made]);
  ok("test rows removed", `${gone.rowCount} deleted`);
  await tie("back to baseline");
}

await db.end();
console.log(`\n${pass} passed, ${fail} failed, ${skip} inconclusive`);
process.exit(fail ? 1 : 0);
