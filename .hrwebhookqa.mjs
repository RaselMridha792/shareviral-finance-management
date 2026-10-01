/**
 * #128 — finance tells the HR portal about decisions as they are made.
 *
 * A stand-in for the HR portal's door (Brief 7) listens on :4099 and the dev
 * API is pointed at it through apps/api/.env:
 *
 *     HR_WEBHOOK_URL=http://localhost:4099/api/finance/webhook/decisions
 *     HR_WEBHOOK_SECRET=local-webhook-secret-for-the-harness-only
 *
 * (the harness refuses to run, and says so, if the API is not.) Every
 * decision is made through the API as the roles themselves; what the stand-in
 * received is compared with what the status routes answer for the same ids.
 *
 *   - an arrival is not a decision: nothing is sent;
 *   - a hold, a refusal, a put-back and an approval each send one call, with
 *     the secret in its header and exactly the status row as the body;
 *   - a paid spend, and a one-off put on a sheet by its build, send again
 *     with the money's moment (appliedAt);
 *   - the #121 decision route sends too; HR's own withdraw does not;
 *   - no retries: written 0, a 401, a 500 are each one call;
 *   - the HR portal slow or down never slows or breaks a decision;
 *   - the pop-up and the Approve drawer tell a correction from a raise: the
 *     same figure starting that date (nothing written), the same figure from
 *     earlier (a row of its own, pay unchanged), a date before a later change
 *     (it holds until then) — and the approval's notice names only the
 *     sheets the change reaches.
 *
 *     node .hrwebhookqa.mjs      (needs `npm run dev`: web :3000, api :4001)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const API = "http://localhost:4001/api";
const WEB = "http://localhost:3000";
const PORT = 4099;
const SECRET = "local-webhook-secret-for-the-harness-only";
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
if (
  env.HR_WEBHOOK_SECRET !== SECRET ||
  !String(env.HR_WEBHOOK_URL ?? "").includes(`:${PORT}/`)
) {
  console.log(
    `apps/api/.env must point the webhook at this harness (see the header), and the API restarted.`,
  );
  process.exit(2);
}
const db = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const who = async (role) =>
  (
    await q(
      `select id, role, token_version, full_name from users where role = $1 and status = 'active' and deleted_at is null order by created_at limit 1`,
      [role],
    )
  )[0];
const tokenFor = (u) =>
  jwt.sign(
    { sub: u.id, role: u.role, tv: u.token_version },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "1h" },
  );
const users = {
  super_admin: await who("super_admin"),
  cfo: await who("cfo"),
  hr: await who("hr"),
};
const as = (user) => async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${tokenFor(user)}`,
      "X-Requested-With": "finance-web",
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const hr = as(users.hr);
const decider = users.cfo ?? users.super_admin;
const fin = as(decider);
const admin = as(users.super_admin);

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(
    `  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
};
const msg = (r) => `${r.status} ${r.body?.message ?? ""}`.slice(0, 200);
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value || Date.now() > end) return value;
    await settle(150);
  }
};

/* ---- the stand-in for the HR portal ---------------------------------- */
const received = [];
let mode = {
  status: 200,
  body: (rows) => ({ written: rows.length }),
  delay: 0,
};
let server;
const listen = () =>
  new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", async () => {
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        received.push({
          at: Date.now(),
          path: req.url,
          method: req.method,
          secret: req.headers["x-finance-secret"],
          type: req.headers["content-type"],
          body: parsed,
        });
        if (mode.delay) await settle(mode.delay);
        res.writeHead(mode.status, { "content-type": "application/json" });
        res.end(JSON.stringify(mode.body(Array.isArray(parsed) ? parsed : [])));
      });
    });
    server.listen(PORT, resolve);
  });
const close = () => new Promise((resolve) => server.close(resolve));
await listen();

/** The calls that named this id, since the index given. */
const callsFor = (externalId, since = 0) =>
  received
    .slice(since)
    .filter(
      (call) =>
        Array.isArray(call.body) &&
        call.body.some((row) => row.externalId === externalId),
    );
const rowIn = (call, externalId) =>
  call.body.find((row) => row.externalId === externalId);

const MARK = `HRWH${Date.now().toString(36)}`;
const YEAR = 2034;
async function wipe() {
  const members = (
    await q(`select id from team_members where full_name like $1`, [
      `${MARK} %`,
    ])
  ).map((r) => r.id);
  const runs = (
    await q(`select id from payroll_runs where notes = $1`, [MARK])
  ).map((r) => r.id);
  const reqIds = members.length
    ? (
        await q(
          `select id::text from compensation_requests where team_member_id = any($1::uuid[]) union all select id::text from payroll_one_offs where team_member_id = any($1::uuid[])`,
          [members],
        )
      ).map((r) => r.id)
    : [];
  const budgetIds = (
    await q(
      `select id::text from hr_budget_periods where category_name like $1 union all select id::text from hr_budget_spends where purpose like $1`,
      [`${MARK}%`],
    )
  ).map((r) => r.id);
  const ids = [...members, ...runs, ...reqIds, ...budgetIds];
  if (ids.length)
    await q(`delete from audit_logs where entity_id::text = any($1)`, [ids]);
  await q(`delete from notifications where title like $1 or body like $1`, [
    `%${MARK}%`,
  ]);
  if (members.length) {
    await q(
      `delete from compensation_requests where team_member_id = any($1::uuid[])`,
      [members],
    );
    await q(
      `delete from payroll_one_offs where team_member_id = any($1::uuid[])`,
      [members],
    );
  }
  await q(`delete from hr_budget_spends where purpose like $1`, [`${MARK}%`]);
  await q(`delete from hr_budget_periods where category_name like $1`, [
    `${MARK}%`,
  ]);
  if (runs.length) {
    await q(
      `delete from payroll_lines where payroll_run_id = any($1::uuid[])`,
      [runs],
    );
    await q(`delete from payroll_runs where id = any($1::uuid[])`, [runs]);
  }
  if (members.length) {
    await q(
      `delete from payroll_lines where team_member_id = any($1::uuid[])`,
      [members],
    );
    await q(
      `delete from compensation_history where team_member_id = any($1::uuid[])`,
      [members],
    );
    await q(`delete from team_members where id = any($1::uuid[])`, [members]);
  }
}
const payChange = (externalId, teamMemberId, over = {}) => ({
  externalId,
  teamMemberId,
  grossAmount: "75000.00",
  effectiveFrom: `${YEAR}-03-01`,
  changeReason: "Promotion",
  hrNote: null,
  requestedByName: "Nusrat (HR)",
  hrApprovedByName: null,
  hrApprovedAt: null,
  ...over,
});
const reqId = async (table, externalId) =>
  (
    await q(`select id::text from ${table} where external_id = $1`, [
      externalId,
    ])
  )[0]?.id;
const statusOf = async (route, externalId) =>
  (await hr("GET", `/hr-requests/${route}/status?externalIds=${externalId}`))
    .body?.[0];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const txnIds = [];

try {
  await wipe();
  const add = async (name, joiningSalary) => {
    const r = await fin("POST", "/team-members", {
      fullName: `${MARK} ${name}`,
      joinedOn: `${YEAR}-01-01`,
      joiningSalary,
    });
    if (r.status !== 201) throw new Error(`member: ${msg(r)}`);
    return r.body.id;
  };
  const A = await add("Anika Rahman", "60000");
  const B = await add("Bashir Ahmed", "40000");
  /* No salary on file at all: a sheet leaves her out. */
  const C = await add("Chandni Akter");

  /* ------------------------------------------------------------------ */
  console.log("\nA pay change, decided four ways");
  const P1 = crypto.randomUUID();
  let mark = received.length;
  await hr("POST", "/hr-requests/pay-changes", payChange(P1, A));
  await settle(1500);
  check(
    "its arrival is not a decision: nothing sent",
    callsFor(P1, mark).length === 0,
    String(callsFor(P1, mark).length),
  );
  const p1 = await reqId("compensation_requests", P1);

  mark = received.length;
  await fin("POST", `/hr-requests/pay_change/${p1}/decision`, {
    decision: "held",
    note: "Send the signed letter",
  });
  const held = await until(() => callsFor(P1, mark)[0]);
  const heldStatus = await statusOf("pay-changes", P1);
  check(
    "a hold: one call, to the door, with the secret and JSON",
    Boolean(held) &&
      held.method === "POST" &&
      held.path === "/api/finance/webhook/decisions" &&
      held.secret === SECRET &&
      /application\/json/.test(held.type ?? ""),
    held ? `${held.method} ${held.path} ${held.type}` : "none",
  );
  check(
    "…its body is exactly what the status route answers",
    held &&
      same(rowIn(held, P1), heldStatus) &&
      rowIn(held, P1)?.state === "held",
    JSON.stringify(held ? rowIn(held, P1) : null),
  );

  mark = received.length;
  await fin("POST", `/hr-requests/pay_change/${p1}/decision`, {
    decision: "refused",
    note: "Not this year",
  });
  const refused = await until(() => callsFor(P1, mark)[0]);
  check(
    "a refusal: sent as rejected, with the note and a name",
    refused &&
      rowIn(refused, P1).state === "rejected" &&
      rowIn(refused, P1).note === "Not this year" &&
      rowIn(refused, P1).decidedByName === decider.full_name,
    JSON.stringify(refused ? rowIn(refused, P1) : null),
  );

  mark = received.length;
  await fin("POST", `/hr-requests/pay_change/${p1}/decision`, {
    decision: "received",
  });
  const back = await until(() => callsFor(P1, mark)[0]);
  check(
    "put back: sent as pending, not 'received'",
    back &&
      rowIn(back, P1).state === "pending" &&
      rowIn(back, P1).decidedByName === null,
    JSON.stringify(back ? rowIn(back, P1) : null),
  );

  mark = received.length;
  mode = {
    status: 200,
    body: (rows) => ({ written: rows.length }),
    delay: 4000,
  };
  const t0 = Date.now();
  const approve = await fin("POST", `/hr-requests/pay_change/${p1}/decision`, {
    decision: "approved",
  });
  const took = Date.now() - t0;
  check(
    "the HR portal taking 4s does not slow the approval",
    approve.status === 200 && took < 3000,
    `${approve.status} in ${took}ms`,
  );
  const approved = await until(() => callsFor(P1, mark)[0]);
  const approvedStatus = await statusOf("pay-changes", P1);
  check(
    "approved: sent with when it was decided and when it was applied",
    approved &&
      same(rowIn(approved, P1), approvedStatus) &&
      rowIn(approved, P1).state === "approved" &&
      /Z$/.test(rowIn(approved, P1).appliedAt ?? ""),
    JSON.stringify(approved ? rowIn(approved, P1) : null),
  );
  await settle(4500);
  mode = { status: 200, body: (rows) => ({ written: rows.length }), delay: 0 };

  /* ------------------------------------------------------------------ */
  console.log("\nNo retries, and never in the way");
  /* Held on purpose below; withdrawn again before a sheet is built, since a
     held pay change rightly holds the sheet up (#125). */
  const heldIds = [];
  for (const [label, next] of [
    ["written 0", { status: 200, body: () => ({ written: 0 }), delay: 0 }],
    [
      "a 401",
      { status: 401, body: () => ({ message: "Unauthorized" }), delay: 0 },
    ],
    ["a 500", { status: 500, body: () => ({ message: "down" }), delay: 0 }],
  ]) {
    mode = next;
    const id = crypto.randomUUID();
    heldIds.push(id);
    await hr(
      "POST",
      "/hr-requests/pay-changes",
      payChange(id, B, {
        effectiveFrom: `${YEAR}-06-01`,
        grossAmount: "41000.00",
      }),
    );
    const rid = await reqId("compensation_requests", id);
    mark = received.length;
    const r = await fin("POST", `/hr-requests/pay_change/${rid}/decision`, {
      decision: "held",
      note: "Wait",
    });
    await until(() => callsFor(id, mark).length > 0);
    await settle(2500);
    check(
      `${label}: the decision stands, and exactly one call`,
      r.status === 200 && callsFor(id, mark).length === 1,
      `${r.status} calls=${callsFor(id, mark).length}`,
    );
  }
  mode = { status: 200, body: (rows) => ({ written: rows.length }), delay: 0 };
  await close();
  const downId = crypto.randomUUID();
  heldIds.push(downId);
  await hr(
    "POST",
    "/hr-requests/pay-changes",
    payChange(downId, B, {
      effectiveFrom: `${YEAR}-07-01`,
      grossAmount: "42000.00",
    }),
  );
  const downRid = await reqId("compensation_requests", downId);
  const t1 = Date.now();
  const whileDown = await fin(
    "POST",
    `/hr-requests/pay_change/${downRid}/decision`,
    { decision: "held", note: "Wait" },
  );
  check(
    "the HR portal down: the decision stands, at once",
    whileDown.status === 200 && Date.now() - t1 < 3000,
    `${whileDown.status} in ${Date.now() - t1}ms`,
  );
  await listen();

  /* ------------------------------------------------------------------ */
  console.log("\nBudgets and spends, and the money moving");
  const PB = crypto.randomUUID();
  const SP = crypto.randomUUID();
  await hr("POST", "/hr-budget/periods", {
    externalId: PB,
    categoryName: `${MARK} Training`,
    startsOn: `${YEAR}-03-01`,
    endsOn: `${YEAR}-06-30`,
    amount: "100000",
    note: null,
    recordedByName: "Nusrat (HR)",
  });
  await hr("POST", "/hr-budget/spends", {
    externalId: SP,
    budgetExternalId: PB,
    spentOn: `${YEAR}-03-10`,
    amount: "1200.50",
    purpose: `${MARK} Course fees`,
    teamMemberId: null,
    employeeName: null,
    hrStatus: "proposed",
    hrApprovedByName: null,
    hrApprovedAt: null,
    recordedByName: "Nusrat (HR)",
    hasReceipt: false,
  });
  const pb = await reqId("hr_budget_periods", PB);
  const sp = await reqId("hr_budget_spends", SP);
  mark = received.length;
  await fin("POST", `/hr-budget/periods/${pb}/decision`, {
    decision: "approved",
    note: null,
  });
  const oldRoute = await until(() => callsFor(PB, mark)[0]);
  check(
    "the #121 decision route sends too (a budget, no appliedAt)",
    oldRoute &&
      rowIn(oldRoute, PB).state === "approved" &&
      rowIn(oldRoute, PB).appliedAt === null,
    JSON.stringify(oldRoute ? rowIn(oldRoute, PB) : null),
  );
  mark = received.length;
  await fin("POST", `/hr-requests/spend/${sp}/decision`, {
    decision: "approved",
  });
  const spendOk = await until(() => callsFor(SP, mark)[0]);
  check(
    "a spend approved: approved, not yet paid",
    spendOk &&
      rowIn(spendOk, SP).state === "approved" &&
      rowIn(spendOk, SP).appliedAt === null,
    JSON.stringify(spendOk ? rowIn(spendOk, SP) : null),
  );
  const account = (
    await q(
      `select id::text from accounts where deleted_at is null and type in ('bank','cash') order by created_at limit 1`,
    )
  )[0]?.id;
  const category = (
    await q(
      `select id::text from categories where is_active and parent_id is not null and kind in ('out','both') limit 1`,
    )
  )[0]?.id;
  mark = received.length;
  const paid = await fin("POST", `/hr-budget/spends/${sp}/pay`, {
    accountId: account,
    categoryId: category,
    txnDate: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
    }).format(new Date()),
    usdRate: "121.50",
    description: `HR: ${MARK} Course fees`,
    notes: null,
  });
  if (paid.body?.transactionId) txnIds.push(paid.body.transactionId);
  const paidCall = await until(() => callsFor(SP, mark)[0]);
  check(
    "paid: sent again, now with when the money moved",
    paid.status === 200 &&
      paidCall &&
      rowIn(paidCall, SP).appliedAt !== null &&
      same(rowIn(paidCall, SP), await statusOf("spends", SP)),
    JSON.stringify(paidCall ? rowIn(paidCall, SP) : null),
  );

  const O1 = crypto.randomUUID();
  await hr("POST", "/payroll/one-offs", {
    externalId: O1,
    teamMemberId: B,
    periodYear: YEAR,
    periodMonth: 8,
    amount: "5000.00",
    note: `${MARK} Award`,
  });
  const o1 = await reqId("payroll_one_offs", O1);
  mark = received.length;
  await fin("POST", `/hr-requests/one_off/${o1}/decision`, {
    decision: "approved",
  });
  const ooApproved = await until(() => callsFor(O1, mark)[0]);
  check(
    "a one-off approved with no sheet yet: approved, appliedAt empty",
    ooApproved && rowIn(ooApproved, O1).appliedAt === null,
    JSON.stringify(ooApproved ? rowIn(ooApproved, O1) : null),
  );
  for (const id of heldIds)
    await hr("POST", `/hr-requests/pay-changes/${id}/withdraw`, {
      note: "Harness",
    });
  mark = received.length;
  const run = await fin("POST", "/payroll/runs", {
    periodYear: YEAR,
    periodMonth: 8,
    notes: MARK,
  });
  await fin("POST", `/payroll/runs/${run.body?.id}/members`, {
    teamMemberIds: [B],
  });
  const onSheet = await until(() => callsFor(O1, mark)[0]);
  check(
    "the sheet built with Bashir on it: sent again, with appliedAt",
    run.status === 201 && onSheet && rowIn(onSheet, O1).appliedAt !== null,
    `${run.status} ${JSON.stringify(onSheet ? rowIn(onSheet, O1) : null)}`,
  );

  const W = crypto.randomUUID();
  await hr("POST", "/payroll/one-offs", {
    externalId: W,
    teamMemberId: B,
    periodYear: YEAR,
    periodMonth: 9,
    amount: "700.00",
    note: `${MARK} Snacks`,
  });
  mark = received.length;
  const wd = await hr("POST", `/hr-requests/one-offs/${W}/withdraw`, {});
  await settle(2500);
  check(
    "HR's own withdraw sends nothing back to HR",
    wd.status === 200 && callsFor(W, mark).length === 0,
    `${wd.status} calls=${callsFor(W, mark).length}`,
  );

  /* ------------------------------------------------------------------ */
  console.log("\nA correction is not read as a raise");
  /* Anika: 60,000 from 1 Jan (her joining salary), 75,000 from 1 Mar (P1). */
  const joiningRow = (
    await q(
      `select id::text, change_reason, created_by::text by from compensation_history where team_member_id = $1 and effective_from = $2 and deleted_at is null`,
      [A, `${YEAR}-01-01`],
    )
  )[0];
  const SAME = crypto.randomUUID();
  await hr(
    "POST",
    "/hr-requests/pay-changes",
    payChange(SAME, A, {
      grossAmount: "60000.00",
      effectiveFrom: `${YEAR}-01-01`,
      changeReason: "Resent: the two apps disagreed",
    }),
  );
  const sameId = await reqId("compensation_requests", SAME);
  const sameDetail = (await fin("GET", `/hr-requests/pay_change/${sameId}`))
    .body;
  // Everything here is dated 2034, so nothing is paid "today" yet.
  check(
    "the same figure on file: 60,000 from 1 Jan, a later change from 1 Mar, nothing paid today",
    sameDetail?.onFileAmount === "60000.00" &&
      sameDetail?.onFileFrom === `${YEAR}-01-01` &&
      sameDetail?.currentAmount === null &&
      sameDetail?.nextChangeOn === `${YEAR}-03-01`,
    JSON.stringify({
      onFile: sameDetail?.onFileAmount,
      from: sameDetail?.onFileFrom,
      current: sameDetail?.currentAmount,
      next: sameDetail?.nextChangeOn,
    }),
  );
  const EARLY = crypto.randomUUID();
  await hr(
    "POST",
    "/hr-requests/pay-changes",
    payChange(EARLY, A, {
      grossAmount: "65000.00",
      effectiveFrom: `${YEAR}-02-01`,
    }),
  );
  const earlyId = await reqId("compensation_requests", EARLY);
  const earlyDetail = (await fin("GET", `/hr-requests/pay_change/${earlyId}`))
    .body;
  check(
    "a date before a later change: 60,000 on file for it, the next change from 1 Mar",
    earlyDetail?.onFileAmount === "60000.00" &&
      earlyDetail?.nextChangeOn === `${YEAR}-03-01`,
    JSON.stringify({
      onFile: earlyDetail?.onFileAmount,
      next: earlyDetail?.nextChangeOn,
    }),
  );

  /* The pop-up and the approval drawer, in a browser. */
  const inBrowser = async (work) => {
    const browser = await puppeteer.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
    });
    try {
      const context = await browser.createBrowserContext();
      await context.setCookie({
        name: "sfm_access",
        value: tokenFor(decider),
        domain: "localhost",
        path: "/",
      });
      const page = await context.newPage();
      await page.setViewport({ width: 1440, height: 1000 });
      const popupOf = async (id) => {
        await page.goto(`${WEB}/hr-requests?kind=pay_change&open=${id}`, {
          waitUntil: "networkidle0",
          timeout: 120000,
        });
        await page.waitForFunction(
          () =>
            document
              .querySelector("[data-popup]")
              ?.textContent.includes("On file for that date"),
          { timeout: 20000 },
        );
        await until(() =>
          page.evaluate(() =>
            document
              .querySelector("[data-popup]")
              ?.textContent.includes("History"),
          ),
        );
        return page.evaluate(
          () => document.querySelector("[data-popup]").textContent,
        );
      };
      /* Approve, pressed in the pop-up: what the drawer says once it has
         read the figures, and whether its button is ready. `between` runs
         after the pop-up is drawn and before Approve is pressed. */
      const drawerOf = async (id, between) => {
        await popupOf(id);
        if (between) await between();
        await page.click('[data-hrr-action="approve"]');
        await page.waitForFunction(
          () => {
            const said =
              document.querySelector("[data-hrr-consequence]")?.textContent ??
              "";
            return said !== "" && !said.startsWith("Reading");
          },
          { timeout: 20000 },
        );
        return page.evaluate(() => ({
          said: document.querySelector("[data-hrr-consequence]").textContent,
          ready: !document.querySelector("[data-hrr-submit]").disabled,
        }));
      };
      return await work({ popupOf, drawerOf, page });
    } finally {
      await browser.close();
    }
  };

  /* The pop-up, while both wait. */
  await inBrowser(async ({ popupOf, drawerOf }) => {
    const samePopup = await popupOf(sameId);
    check(
      "its pop-up: the figure is already on file, approving leaves the record as it is, nothing paid today",
      /already this figure/.test(samePopup) &&
        /leaves the salary record as it is/.test(samePopup) &&
        /Paid todayNone on record/.test(samePopup),
      samePopup.slice(0, 200),
    );
    const earlyPopup = await popupOf(earlyId);
    check(
      "the earlier date's pop-up: it stops at the next change, 01/03/2034",
      /There is a later change on file, from 01\/03\/2034/.test(earlyPopup) &&
        /until then/.test(earlyPopup) &&
        !/already this figure/.test(earlyPopup),
      earlyPopup.slice(0, 200),
    );
    const sameDrawer = await drawerOf(sameId);
    check(
      "Approve on it says the salary record is left as it is, not that one is written",
      sameDrawer.ready &&
        /leaves the salary record as it is/.test(sameDrawer.said) &&
        !/writes the new salary/.test(sameDrawer.said),
      sameDrawer.said,
    );
    const earlyDrawer = await drawerOf(earlyId);
    check(
      "Approve on the earlier date says it holds until the change from 01/03/2034",
      earlyDrawer.ready &&
        /until the later change on file from 01\/03\/2034/.test(
          earlyDrawer.said,
        ),
      earlyDrawer.said,
    );
  });

  /* Approving them. */
  let mark2 = received.length;
  const sameOk = await fin(
    "POST",
    `/hr-requests/pay_change/${sameId}/decision`,
    { decision: "approved" },
  );
  const joiningAfter = (
    await q(
      `select id::text, change_reason, created_by::text by from compensation_history where team_member_id = $1 and effective_from = $2 and deleted_at is null`,
      [A, `${YEAR}-01-01`],
    )
  )[0];
  const sameRow = (
    await q(
      `select status, applied_at, compensation_id::text comp from compensation_requests where external_id = $1`,
      [SAME],
    )
  )[0];
  const sameAudit =
    (
      await q(
        `select summary from audit_logs where entity_table = 'compensation_requests' and entity_id = $1 order by occurred_at desc limit 1`,
        [sameId],
      )
    )[0]?.summary ?? "";
  check(
    "approving the same figure leaves the joining row exactly as it was, and says so",
    sameOk.status === 200 &&
      /left as it was/.test(sameOk.body?.notice ?? "") &&
      joiningAfter?.change_reason === joiningRow?.change_reason &&
      joiningAfter?.by === joiningRow?.by &&
      sameRow?.status === "approved" &&
      Boolean(sameRow?.applied_at) &&
      sameRow?.comp === joiningRow?.id &&
      /already on file from that date/.test(sameAudit),
    `${sameOk.body?.notice} | ${joiningAfter?.change_reason} | ${sameAudit}`,
  );
  const sameSent = await until(() => callsFor(SAME, mark2)[0]);
  check(
    "…and HR still hears it approved, with appliedAt",
    sameSent &&
      rowIn(sameSent, SAME).state === "approved" &&
      rowIn(sameSent, SAME).appliedAt !== null,
    JSON.stringify(sameSent ? rowIn(sameSent, SAME) : null),
  );

  const earlyOk = await fin(
    "POST",
    `/hr-requests/pay_change/${earlyId}/decision`,
    { decision: "approved" },
  );
  check(
    "…and its notice names no sheet past that change — August 2034 is not its",
    earlyOk.status === 200 && !/August 2034/.test(earlyOk.body?.notice ?? ""),
    `${earlyOk.status} ${earlyOk.body?.notice}`,
  );
  const earlyAudit =
    (
      await q(
        `select summary from audit_logs where entity_table = 'compensation_requests' and entity_id = $1 order by occurred_at desc limit 1`,
        [earlyId],
      )
    )[0]?.summary ?? "";
  const feb = (
    await q(
      `select gross_amount::text g from compensation_history where team_member_id = $1 and effective_from = $2 and deleted_at is null`,
      [A, `${YEAR}-02-01`],
    )
  )[0];
  check(
    "approving the earlier date writes 65,000 from 1 Feb and records what it was",
    feb?.g === "65000.00" &&
      /was ৳60,000\.00 from 01\/01\/2034/.test(earlyAudit),
    `${feb?.g} | ${earlyAudit}`,
  );

  const FIX = crypto.randomUUID();
  await hr(
    "POST",
    "/hr-requests/pay-changes",
    payChange(FIX, A, {
      grossAmount: "70000.00",
      effectiveFrom: `${YEAR}-03-01`,
      changeReason: "Corrected March figure",
    }),
  );
  const fixId = await reqId("compensation_requests", FIX);
  const fixOk = await fin("POST", `/hr-requests/pay_change/${fixId}/decision`, {
    decision: "approved",
  });
  check(
    "the March correction reaches every sheet after it: its notice names August 2034",
    fixOk.status === 200 && /August 2034/.test(fixOk.body?.notice ?? ""),
    `${fixOk.status} ${fixOk.body?.notice}`,
  );
  const fixAudit =
    (
      await q(
        `select summary from audit_logs where entity_table = 'compensation_requests' and entity_id = $1 order by occurred_at desc limit 1`,
        [fixId],
      )
    )[0]?.summary ?? "";
  const march = (
    await q(
      `select gross_amount::text g from compensation_history where team_member_id = $1 and effective_from = $2 and deleted_at is null`,
      [A, `${YEAR}-03-01`],
    )
  )[0];
  check(
    "a same-date correction: 1 Mar is 70,000 now, and the history keeps the 75,000 it replaced",
    march?.g === "70000.00" &&
      /replacing ৳75,000\.00 that was on file from that date/.test(fixAudit),
    `${march?.g} | ${fixAudit}`,
  );

  console.log("\nThe same figure from a later date is a record of its own");
  const LATER = crypto.randomUUID();
  await hr(
    "POST",
    "/hr-requests/pay-changes",
    payChange(LATER, A, {
      grossAmount: "70000.00",
      effectiveFrom: `${YEAR}-05-01`,
      changeReason: "Resent: the same figure from May",
    }),
  );
  const laterId = await reqId("compensation_requests", LATER);
  const laterDetail = (await fin("GET", `/hr-requests/pay_change/${laterId}`))
    .body;
  check(
    "on file for 1 May: 70,000, from 1 Mar",
    laterDetail?.onFileAmount === "70000.00" &&
      laterDetail?.onFileFrom === `${YEAR}-03-01`,
    JSON.stringify({
      onFile: laterDetail?.onFileAmount,
      from: laterDetail?.onFileFrom,
    }),
  );
  await inBrowser(async ({ popupOf, drawerOf }) => {
    const popup = await popupOf(laterId);
    check(
      "its pop-up: the same figure from 01/03/2034, a record of its own from 01/05/2034, pay unchanged",
      /already this figure, from 01\/03\/2034/.test(popup) &&
        /adds a record of its own from 01\/05\/2034/.test(popup) &&
        /pay does not change/.test(popup) &&
        !/leaves the salary record as it is/.test(popup),
      popup.slice(0, 300),
    );
    const drawer = await drawerOf(laterId);
    check(
      "Approve on it says pay does not change and a record of its own is added",
      drawer.ready &&
        /pay does not change/.test(drawer.said) &&
        /salary record of its own from 01\/05\/2034/.test(drawer.said),
      drawer.said,
    );
  });
  const marchRow = (
    await q(
      `select id::text from compensation_history where team_member_id = $1 and effective_from = $2 and deleted_at is null`,
      [A, `${YEAR}-03-01`],
    )
  )[0];
  const laterOk = await fin(
    "POST",
    `/hr-requests/pay_change/${laterId}/decision`,
    { decision: "approved" },
  );
  const may = (
    await q(
      `select id::text, gross_amount::text g from compensation_history where team_member_id = $1 and effective_from = $2 and deleted_at is null`,
      [A, `${YEAR}-05-01`],
    )
  )[0];
  const laterRow = (
    await q(
      `select compensation_id::text comp from compensation_requests where external_id = $1`,
      [LATER],
    )
  )[0];
  const laterAudit =
    (
      await q(
        `select summary from audit_logs where entity_table = 'compensation_requests' and entity_id = $1 order by occurred_at desc limit 1`,
        [laterId],
      )
    )[0]?.summary ?? "";
  check(
    "approving it writes 70,000 from 1 May as a row of its own, says pay does not change — and that August's draft does not have her on it",
    laterOk.status === 200 &&
      may?.g === "70000.00" &&
      laterRow?.comp === may?.id &&
      laterRow?.comp !== marchRow?.id &&
      /was ৳70,000\.00 from 01\/03\/2034/.test(laterAudit) &&
      /^Pay does not change: the same figure was already on file from 01\/03\/2034\. It is kept as a salary record of its own from 01\/05\/2034\. August 2034 was built without them on it/.test(
        laterOk.body?.notice ?? "",
      ),
    `${laterOk.status} ${laterOk.body?.notice} | ${may?.g} | ${laterAudit}`,
  );

  console.log("\nWhat the notice says about the sheets a change reaches");
  /* A cut: 68,000 from 20 Jun, under the 70,000 on file from 1 May. The
     August 2034 draft is in its reach. */
  const MID = crypto.randomUUID();
  await hr(
    "POST",
    "/hr-requests/pay-changes",
    payChange(MID, A, {
      grossAmount: "68000.00",
      effectiveFrom: `${YEAR}-06-20`,
      changeReason: "Corrected down",
    }),
  );
  const midId = await reqId("compensation_requests", MID);
  const midOk = await fin("POST", `/hr-requests/pay_change/${midId}/decision`, {
    decision: "approved",
  });
  /* The August 2034 draft has only Bashir on it: what it holds for Anika
     is nothing, whatever her salary record says. */
  check(
    "a cut, on a draft she is not on: named as built without her — not at her record's figure",
    midOk.status === 200 &&
      /^August 2034 was built without them on it — press Build list on it to use this figure\.$/.test(
        midOk.body?.notice ?? "",
      ),
    `${midOk.status} ${midOk.body?.notice}`,
  );

  /* An old revision from 5 Jun, sent again after the 20 Jun change: June's
     sheet takes the 20 Jun figure, so this one reaches no month at all. */
  const OLD = crypto.randomUUID();
  await hr(
    "POST",
    "/hr-requests/pay-changes",
    payChange(OLD, A, {
      grossAmount: "67000.00",
      effectiveFrom: `${YEAR}-06-05`,
      changeReason: "Resent: an old revision",
    }),
  );
  const oldId = await reqId("compensation_requests", OLD);
  const oldDetail = (await fin("GET", `/hr-requests/pay_change/${oldId}`)).body;
  check(
    "a later change in its own month: the next change is 20 Jun, and no sheet is reached",
    oldDetail?.nextChangeOn === `${YEAR}-06-20` &&
      Array.isArray(oldDetail?.sheets) &&
      oldDetail.sheets.length === 0,
    JSON.stringify({
      next: oldDetail?.nextChangeOn,
      sheets: oldDetail?.sheets,
    }),
  );

  /* HR sends a waiting request again while finance has it open. */
  const STALE = crypto.randomUUID();
  await hr(
    "POST",
    "/hr-requests/pay-changes",
    payChange(STALE, B, {
      grossAmount: "41000.00",
      effectiveFrom: `${YEAR}-09-01`,
    }),
  );
  const staleId = await reqId("compensation_requests", STALE);

  await inBrowser(async ({ popupOf, drawerOf, page }) => {
    const popup = await popupOf(oldId);
    check(
      "its pop-up: pay does not change, and the 20 Jun change decides that month",
      /Pay does not change: the later change on file from 20\/06\/2034 starts in the same month/.test(
        popup,
      ) &&
        /None — the change on file from 20\/06\/2034 decides that month/.test(
          popup,
        ),
      popup.slice(0, 400),
    );
    const drawer = await drawerOf(oldId);
    check(
      "Approve on it says pay does not change",
      drawer.ready &&
        /Pay does not change/.test(drawer.said) &&
        !/writes the new salary/.test(drawer.said),
      drawer.said,
    );
    const stale = await drawerOf(staleId, () =>
      hr(
        "POST",
        "/hr-requests/pay-changes",
        payChange(STALE, B, {
          grossAmount: "42000.00",
          effectiveFrom: `${YEAR}-09-01`,
        }),
      ),
    );
    check(
      "sent again while it was open: the drawer says what it is now, and Approve stays off",
      !stale.ready &&
        /changed since it was shown: HR sent it again as ৳42,000\.00 from 01\/09\/2034/.test(
          stale.said,
        ),
      `ready=${stale.ready} ${stale.said}`,
    );
    /* Closing it reloads the list, so pressing Approve again on the row
       starts from what HR sent rather than from the same stale row. */
    await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === "Cancel")
        ?.click(),
    );
    const relisted = await until(() =>
      page.evaluate(
        (id) =>
          document
            .querySelector(`[data-hrr-row="${id}"]`)
            ?.textContent.includes("42,000.00") ?? false,
        staleId,
      ),
    );
    check(
      "…and closing it reloads the list, which now shows what HR sent",
      relisted,
      String(relisted),
    );
  });
  await hr("POST", `/hr-requests/pay-changes/${STALE}/withdraw`, {
    note: "Harness",
  });

  const oldOk = await fin("POST", `/hr-requests/pay_change/${oldId}/decision`, {
    decision: "approved",
  });
  const june5 = (
    await q(
      `select gross_amount::text g from compensation_history where team_member_id = $1 and effective_from = $2 and deleted_at is null`,
      [A, `${YEAR}-06-05`],
    )
  )[0];
  check(
    "approving it keeps 67,000 from 5 Jun on the record, says pay does not change, and names no sheet",
    oldOk.status === 200 &&
      june5?.g === "67000.00" &&
      /Pay does not change: the later change on file from 20\/06\/2034/.test(
        oldOk.body?.notice ?? "",
      ) &&
      !/August 2034/.test(oldOk.body?.notice ?? ""),
    `${oldOk.status} ${oldOk.body?.notice} | ${june5?.g}`,
  );

  /* Nothing on file: Chandni has no salary, so the August draft left her
     out — it is not "the old figure". */
  const NONE = crypto.randomUUID();
  await hr(
    "POST",
    "/hr-requests/pay-changes",
    payChange(NONE, C, {
      grossAmount: "45000.00",
      effectiveFrom: `${YEAR}-07-01`,
    }),
  );
  const noneId = await reqId("compensation_requests", NONE);
  const noneOk = await fin(
    "POST",
    `/hr-requests/pay_change/${noneId}/decision`,
    { decision: "approved" },
  );
  check(
    "no salary on file: the draft is named as built without her",
    noneOk.status === 200 &&
      /^August 2034 was built without them on it/.test(
        noneOk.body?.notice ?? "",
      ),
    `${noneOk.status} ${noneOk.body?.notice}`,
  );

  /* Bashir IS on the August 2034 draft, at the 40,000 it was built with. */
  const DRAFTB = crypto.randomUUID();
  await hr(
    "POST",
    "/hr-requests/pay-changes",
    payChange(DRAFTB, B, {
      grossAmount: "45000.00",
      effectiveFrom: `${YEAR}-08-01`,
    }),
  );
  const draftBId = await reqId("compensation_requests", DRAFTB);
  const draftBOk = await fin(
    "POST",
    `/hr-requests/pay_change/${draftBId}/decision`,
    { decision: "approved" },
  );
  check(
    "a draft he is on: named with what it holds for him, 40,000",
    draftBOk.status === 200 &&
      /^August 2034 was built at ৳40,000\.00 for them — press Build list on it to use this figure\.$/.test(
        draftBOk.body?.notice ?? "",
      ),
    `${draftBOk.status} ${draftBOk.body?.notice}`,
  );

  /* Finalised, it still holds 40,000 for him — not the 45,000 his record
     now says — and no money has moved: reopen, not "overpaid". */
  const locked = await fin("POST", `/payroll/runs/${run.body?.id}/finalize`);
  const FINB = crypto.randomUUID();
  await hr(
    "POST",
    "/hr-requests/pay-changes",
    payChange(FINB, B, {
      grossAmount: "38000.00",
      effectiveFrom: `${YEAR}-08-01`,
      changeReason: "Corrected down",
    }),
  );
  const finBId = await reqId("compensation_requests", FINB);
  const finBOk = await fin(
    "POST",
    `/hr-requests/pay_change/${finBId}/decision`,
    { decision: "approved" },
  );
  check(
    "finalised, not paid: what the sheet holds, and reopen before paying — never 'overpaid'",
    [200, 201].includes(locked.status) &&
      finBOk.status === 200 &&
      /^August 2034 is finalised at ৳40,000\.00 for them but not marked paid — if the money has not gone to the bank yet, reopen it and press Build list to use this figure\.$/.test(
        finBOk.body?.notice ?? "",
      ),
    `${msg(locked)} | ${finBOk.status} ${finBOk.body?.notice}`,
  );
} finally {
  for (const id of txnIds) {
    await admin("POST", `/trash/transaction/${id}`, { reason: "harness" });
    await admin("DELETE", `/trash/transaction/${id}`);
  }
  await wipe();
  const left = await q(
    `select (select count(*) from team_members where full_name like $1)::int m, (select count(*) from payroll_runs where notes = $2)::int r`,
    [`${MARK} %`, MARK],
  );
  check(
    "cleaned up",
    left[0].m === 0 && left[0].r === 0,
    JSON.stringify(left[0]),
  );
  await db.end();
  if (server?.listening) await close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
