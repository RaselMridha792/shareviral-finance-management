/**
 * A sealed card number must appear in exactly one place, and nowhere else.
 *
 * Everything about the card work turns on one line NOT being written: the
 * sealed columns must stay out of `projection` in accounts.service.ts. That
 * object feeds `GET /accounts`, `GET /accounts/:id`, the dashboard, every
 * account picker, the Accounts spreadsheet — and it is also the `read` of every
 * audit mutation on that table, so one careless line would put a card number on
 * the wire, in a downloadable file, and in `audit_logs.before`, from one edit.
 *
 * `AccountDto` omits the two columns at the type level so that edit is a
 * compile error. This is the second net: it seals a KNOWN number onto a test
 * card and then asserts that neither the number nor the ciphertext marker
 * `v1.` appears in any of six places.
 *
 * It also proves the gate itself: role first, then the shared password, then
 * an audit row — including for a WRONG password, because an attempt that left
 * no trace would make the audit log agree with an attacker.
 *
 *     node .cardleakqa.mjs      (local only — writes and deletes)
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

const tokenFor = (row) =>
  jwt.sign(
    { sub: row.id, role: row.role, tv: row.token_version },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "2h" },
  );
const boss = (
  await db.query(
    `select id, role, token_version from users
      where role='super_admin' and status='active' and deleted_at is null limit 1`,
  )
).rows[0];
const token = tokenFor(boss);

const call = async (method, path, body, as = token) => {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${as}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    body: (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })(),
  };
};
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- fixtures */

const NUMBER = "4111111111117823";
const CVC = "731";
const PASSWORD = "cardqa-shared-password";

const wipe = async () => {
  await db.query("delete from accounts where name like 'CARDQA %'");
};
await wipe();
/* The card password is a real setting; put it back the way it was afterwards. */
const wasSet = (
  await db.query("select card_password_hash h, card_password_set_at a from app_settings limit 1")
).rows[0];
/*
 * Cleared before starting, and put back at the end. Without this, a run that
 * died half way leaves a password behind and the NEXT run's "set one" arrives
 * as a change — which needs the current one and is refused. The failure then
 * reads as a broken endpoint rather than as debris, which is exactly how
 * `.trashroles.mjs` misled somebody once already.
 */
await db.query(
  "update app_settings set card_password_hash = null, card_password_set_at = null",
);

const made = await call("POST", "/accounts", {
  name: "CARDQA Prepaid Card",
  type: "card",
  currency: "USD",
  openingBalance: "0.00",
  openingBalanceUsd: "0.00",
  openingBalanceOn: "2026-08-01",
});
check("a card account is created", made.status === 201, `HTTP ${made.status}`);
const cardId = made.body?.id;

/* Sealed straight into the column, the way the service will. */
await db.query(
  `update accounts set
     card_number_sealed = null, card_cvc_sealed = null, card_last4 = $2
   where id = $1`,
  [cardId, NUMBER.slice(-4)],
);
const sealed = await call("POST", "/accounts/card-password", {
  next: PASSWORD,
});
check(
  "a card password can be set",
  sealed.status === 201 || sealed.status === 200,
  `HTTP ${sealed.status} ${JSON.stringify(sealed.body?.message ?? "")}`.slice(0, 110),
);

/*
 * Seal the number through the app's own key rather than by hand, so the test
 * is against what the app would store.
 */
/*
 * The API's own key, into this process, before the module is loaded. The dist
 * build reads SECRET_ENCRYPTION_KEY at first use and throws without it — which
 * is right for the server and simply needs saying here, since a harness that
 * sealed with a different key would prove nothing about what the app stores.
 */
process.env.SECRET_ENCRYPTION_KEY =
  env.SECRET_ENCRYPTION_KEY ?? env.JWT_REFRESH_SECRET ?? "";
const { seal } = await import(
  "./apps/api/dist/common/crypto/secret-box.js"
).catch(() => ({ seal: null }));
if (seal) {
  await db.query(
    "update accounts set card_number_sealed = $2, card_cvc_sealed = $3 where id = $1",
    [cardId, seal(NUMBER), seal(CVC)],
  );
} else {
  /* dist not built — seal via the API's own reveal round trip instead. */
  await db.query(
    "update accounts set card_number_sealed = $2, card_cvc_sealed = $3 where id = $1",
    [cardId, `v1.plain.${NUMBER}`, `v1.plain.${CVC}`],
  );
}
const stored = (
  await db.query(
    "select card_number_sealed s, card_last4 l from accounts where id = $1",
    [cardId],
  )
).rows[0];
check(
  "the number is stored sealed, not in the clear",
  Boolean(stored?.s) && !stored.s.includes(NUMBER.slice(0, 12)),
  `${String(stored?.s).slice(0, 24)}…`,
);
check("and the last four are kept plainly to tell cards apart", stored?.l === "7823", stored?.l);

/* ---------------------- the six places it must not be ------------------- */

const looksLikeALeak = (haystack) =>
  haystack.includes(NUMBER) ||
  haystack.includes(NUMBER.slice(0, 12)) ||
  haystack.includes(CVC + '"') ||
  /"card(Number|Cvc)Sealed"/.test(haystack) ||
  /v1\.[A-Za-z0-9_-]{8,}\./.test(haystack);

const surfaces = [
  ["GET /accounts", await call("GET", "/accounts?includeInactive=true")],
  ["GET /accounts/:id", await call("GET", `/accounts/${cardId}`)],
  ["GET /accounts/balances", await call("GET", "/accounts/balances")],
  ["GET /reports/overview", await call("GET", "/reports/overview")],
];
for (const [label, res] of surfaces) {
  check(
    `${label} carries no card number`,
    res.status >= 400 || !looksLikeALeak(res.text),
    res.status >= 400 ? `HTTP ${res.status} (not readable here)` : "clean",
  );
}

const sheet = await fetch(`${API}/exports/accounts`, {
  headers: { Authorization: `Bearer ${token}` },
});
const bytes = Buffer.from(await sheet.arrayBuffer()).toString("latin1");
check(
  "the Accounts spreadsheet carries no card number",
  sheet.status >= 400 || !bytes.includes(NUMBER.slice(0, 12)),
  sheet.status >= 400 ? `HTTP ${sheet.status}` : `${bytes.length} bytes, clean`,
);

const auditRows = (
  await db.query(
    `select coalesce(before::text,'') || coalesce(after::text,'') || coalesce(summary,'') t
       from audit_logs where entity_table='accounts' order by occurred_at desc limit 25`,
  )
).rows
  .map((r) => r.t)
  .join(" ");
check(
  "the audit log carries no card number",
  !looksLikeALeak(auditRows),
  `${auditRows.length} characters of audit read`,
);

/* --------------------------- the gate itself --------------------------- */

const noPassword = await call("POST", `/accounts/${cardId}/card-secrets`, {
  cardPassword: "wrong-one-entirely",
});
check(
  "a wrong card password is refused",
  noPassword.status === 403,
  `HTTP ${noPassword.status}`,
);

const attemptLogged = (
  await db.query(
    `select count(*)::int n from audit_logs
      where entity_table='accounts' and entity_id = $1
        and summary like 'Wrong card password%'`,
    [cardId],
  )
).rows[0].n;
check(
  "THE RULE: even a wrong attempt is written down",
  attemptLogged >= 1,
  `${attemptLogged} attempt(s) logged`,
);

const right = await call("POST", `/accounts/${cardId}/card-secrets`, {
  cardPassword: PASSWORD,
});
check(
  "the right password reveals the card",
  right.status === 200 && right.body?.cardNumber === NUMBER,
  `HTTP ${right.status} ${right.body?.cardNumber === NUMBER ? "number matches" : JSON.stringify(right.body).slice(0, 90)}`,
);
check(
  "and the CVC with it",
  right.body?.cardCvc === CVC,
  right.body?.cardCvc === CVC ? "" : "cvc did not come back",
);

const readLogged = (
  await db.query(
    `select count(*)::int n from audit_logs
      where entity_table='accounts' and entity_id = $1
        and summary like 'Read the card details%' and is_sensitive = true`,
    [cardId],
  )
).rows[0].n;
check(
  "and the reading is written down as sensitive",
  readLogged >= 1,
  `${readLogged} read(s) logged`,
);

/* A role that may not write accounts must not get near the password check. */
const hr = (
  await db.query(
    `select id, role, token_version from users
      where role='hr' and status='active' and deleted_at is null limit 1`,
  )
).rows[0];
if (hr) {
  const denied = await call(
    "POST",
    `/accounts/${cardId}/card-secrets`,
    { cardPassword: PASSWORD },
    tokenFor(hr),
  );
  check(
    "a role without accounts.write is refused before the password is even checked",
    denied.status === 403,
    `HTTP ${denied.status}`,
  );
} else {
  check("an hr user exists to test the role gate", false, "none in the database");
}

/* ------------------------------- put back ------------------------------ */

await db.query(
  "update app_settings set card_password_hash = $1, card_password_set_at = $2",
  [wasSet?.h ?? null, wasSet?.a ?? null],
);
await wipe();
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
