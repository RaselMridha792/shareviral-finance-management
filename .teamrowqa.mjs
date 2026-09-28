/**
 * Team: a click anywhere on a row opens the person's own page.
 *
 * The owner, 28 Sep 2026: *"team table tay ami jekono jaygay click korlei jate
 * single page a jay. akhon only name er opor click korle single page a jay."*
 * Only the name used to be the way in.
 *
 * Checked here, on the people already in the database — it reads, and creates
 * nothing:
 *   - every row is focusable, carries its person's id as `data-row-id`, shows
 *     the pointer and the row hover, and does not claim a popup;
 *   - a click on EVERY plain cell of a row, and on the initials tile, lands on
 *     `/team/<that id>` and the page there is that person's;
 *   - the tick box ticks and stays; a near miss inside the tick's cell stays;
 *   - the name link keeps its own click (a ctrl-click opens a tab and leaves
 *     this page where it is), and a plain click on it still lands on the page;
 *   - Edit and Move to trash open their own popups and do not navigate;
 *   - a drag that selects text does not navigate;
 *   - Enter on the focused row navigates; Enter on the row's Edit button opens
 *     the form instead;
 *   - no page errors, no HTTP 5xx.
 *
 *     node .teamrowqa.mjs      (needs `npm run dev`: web :3000, api :4001)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:3000";

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
const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const person = (
  await q(`select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`)
)[0];
const token = jwt.sign({ sub: person.id, role: person.role, tv: person.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const members = await q(
  `select id::text, full_name from team_members where deleted_at is null and status in ('active','on_leave')`,
);
const nameOf = new Map(members.map((m) => [m.id, m.full_name]));
await db.end();

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

if (members.length === 0) {
  check("there is somebody on the current team to click", false, "no active or on-leave team members in the local database");
  console.log(`\n0/1 passed`);
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
try {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  const waitFor = (fn, arg, ms = 15000) =>
    page.waitForFunction(fn, { timeout: ms, polling: 100 }, arg).then(() => true).catch(() => false);
  const path = () => page.evaluate(() => location.pathname);
  const ROWS = "main table.table-data tbody tr";

  const openList = async () => {
    await page.goto(`${WEB}/team`, { waitUntil: "networkidle0", timeout: 120000 });
    return waitFor((sel) => document.querySelectorAll(`${sel}[data-row-id]`).length > 0, ROWS);
  };
  /* Lands on the person's page: the address, and their name on it. */
  const landed = async (id) => {
    const at = await waitFor((want) => location.pathname === want, `/team/${id}`, 20000);
    const named = at && (await waitFor((name) => document.querySelector("main")?.innerText.includes(name), nameOf.get(id), 20000));
    return { at, named, path: await path() };
  };
  const closeAll = async () => {
    for (let i = 0; i < 3 && (await page.$("[data-popup], [role='dialog']")); i++) {
      await page.keyboard.press("Escape");
      await settle(300);
    }
  };

  check("the team list loads with its rows", await openList());

  /* What each row says about itself. */
  const rows = await page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].map((tr) => ({
      id: tr.getAttribute("data-row-id"),
      tabIndex: tr.getAttribute("tabindex"),
      haspopup: tr.getAttribute("aria-haspopup"),
      open: tr.hasAttribute("data-row-open"),
      cursor: getComputedStyle(tr).cursor,
      cellCursor: getComputedStyle(tr.querySelector("td:nth-child(3)")).cursor,
    }));
  }, ROWS);
  const ids = rows.map((r) => r.id);
  check(
    "every row carries its person's id as data-row-id",
    rows.length > 0 && ids.every((id) => nameOf.has(id)) && new Set(ids).size === ids.length,
    `${rows.length} rows: ${ids.join(", ")}`,
  );
  check("every row is focusable (tabindex 0)", rows.every((r) => r.tabIndex === "0"), JSON.stringify(rows.map((r) => r.tabIndex)));
  check("every row shows the pointer, on the row and its cells", rows.every((r) => r.cursor === "pointer" && r.cellCursor === "pointer"), JSON.stringify(rows.map((r) => [r.cursor, r.cellCursor])));
  check("no row claims a popup (it opens a page)", rows.every((r) => r.haspopup === null), JSON.stringify(rows.map((r) => r.haspopup)));

  const first = ids[0];
  const row = `${ROWS}[data-row-id="${first}"]`;

  /* The existing hover still paints the row. */
  await page.mouse.move(5, 5);
  await settle(300);
  const bgBefore = await page.$eval(row, (tr) => getComputedStyle(tr).backgroundColor);
  await page.hover(`${row} td:nth-child(3)`);
  await settle(500);
  const bgHover = await page.$eval(row, (tr) => getComputedStyle(tr).backgroundColor);
  check("the row hover still shows under the pointer", bgBefore !== bgHover, `${bgBefore} -> ${bgHover}`);

  /* Every plain cell of the first row: nothing in it that has a click of its own. */
  const plain = await page.evaluate((sel) => {
    return [...document.querySelectorAll(`${sel} > td`)]
      .map((td, i) => ({ n: i + 1, text: (td.innerText ?? "").trim().replace(/\s+/g, " ").slice(0, 30), control: Boolean(td.querySelector("a, button, input, select, textarea, label, [data-row-ignore]")) }))
      .filter((c) => !c.control);
  }, row);
  check("the row has plain cells to click", plain.length >= 5, plain.map((c) => `${c.n}:${c.text}`).join(" | "));
  for (const cell of plain) {
    await openList();
    await page.click(`${row} > td:nth-child(${cell.n})`);
    const got = await landed(first);
    check(`a click on cell ${cell.n} ("${cell.text}") opens the person's page`, got.at && got.named, got.path);
  }

  /* The initials tile sits in the name cell but is not the link. */
  await openList();
  await page.click(`${row} span[aria-hidden="true"]`);
  let got = await landed(first);
  check("a click on the initials tile opens the page", got.at && got.named, got.path);

  /* Another row too, not only the first: the id is per row, not captured once. */
  if (ids.length > 1) {
    const other = ids[ids.length - 1];
    await openList();
    await page.click(`${ROWS}[data-row-id="${other}"] > td:nth-child(${plain[plain.length - 1].n})`);
    got = await landed(other);
    check("a click on another row opens THAT person's page", got.at && got.named, got.path);
  }

  /* The tick box. */
  await openList();
  const hasTick = Boolean(await page.$(`${row} input[type="checkbox"]`));
  if (hasTick) {
    await page.click(`${row} input[type="checkbox"]`);
    await settle(600);
    const ticked = await page.$eval(`${row} input[type="checkbox"]`, (i) => i.checked);
    check("the tick box ticks and does not navigate", ticked === true && (await path()) === "/team", `checked ${ticked}, at ${await path()}`);
    /* A near miss: the top-left corner of the tick's cell, outside its label. */
    const box = await page.$eval(`${row} > td.tick`, (td) => {
      const r = td.getBoundingClientRect();
      const l = td.querySelector("label").getBoundingClientRect();
      return { x: r.left + 3, y: r.top + 3, inLabel: r.left + 3 >= l.left && r.top + 3 >= l.top };
    });
    await page.mouse.click(box.x, box.y);
    await settle(1200);
    const stillTicked = await page.$eval(`${row} input[type="checkbox"]`, (i) => i.checked);
    check("a near miss inside the tick's cell does not navigate either", !box.inLabel && (await path()) === "/team" && stillTicked, `at ${await path()}, still ticked ${stillTicked}`);
  } else {
    check("the tick box exists for a super admin", false, "no checkbox in the row");
  }

  /* The name link keeps its own click. */
  await openList();
  const tabs = new Promise((resolve) => {
    const onTarget = (t) => {
      if (t.type() === "page") {
        browser.off("targetcreated", onTarget);
        resolve(t);
      }
    };
    browser.on("targetcreated", onTarget);
    setTimeout(() => resolve(null), 8000);
  });
  await page.keyboard.down("Control");
  await page.click(`${row} a[href="/team/${first}"]`);
  await page.keyboard.up("Control");
  const tab = await tabs;
  await settle(1200);
  check("a ctrl-click on the name opens a tab and leaves this page where it is", Boolean(tab) && (await path()) === "/team", `new tab ${Boolean(tab)}, at ${await path()}`);
  if (tab) await (await tab.page())?.close().catch(() => undefined);
  await page.click(`${row} a[href="/team/${first}"]`);
  got = await landed(first);
  check("a plain click on the name still opens the page", got.at && got.named, got.path);

  /* Row buttons keep theirs. */
  await openList();
  await page.click(`${row} button[aria-label="Edit"]`);
  let opened = await waitFor(() => Boolean(document.querySelector("[data-popup] form")), undefined, 8000);
  check("Edit opens the person's form and does not navigate", opened && (await path()) === "/team", `form ${opened}, at ${await path()}`);
  await closeAll();
  const trash = await page.$(`${row} button[aria-label="Move to trash"]`);
  if (trash) {
    await trash.click();
    opened = await waitFor(() => Boolean(document.querySelector("[role='dialog']")), undefined, 8000);
    check("Move to trash opens its confirmation and does not navigate", opened && (await path()) === "/team", `dialog ${opened}, at ${await path()}`);
    await closeAll();
  }

  /* A drag that selects text is a selection, not a click. */
  await openList();
  const span = await page.evaluate((sel) => {
    const tds = [...document.querySelectorAll(`${sel} > td`)];
    const td = tds.find((c) => !c.querySelector("a, button, input, label, span") && (c.innerText ?? "").trim().length >= 3);
    if (!td) return null;
    const range = document.createRange();
    range.selectNodeContents(td);
    const r = range.getBoundingClientRect();
    return { x0: r.left + 1, x1: r.right - 1, y: r.top + r.height / 2, text: td.innerText.trim() };
  }, row);
  if (span) {
    await page.mouse.move(span.x0, span.y);
    await page.mouse.down();
    await page.mouse.move(span.x1, span.y, { steps: 8 });
    await page.mouse.up();
    await settle(1200);
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
    check("a drag that selects text does not navigate", selected.length > 0 && (await path()) === "/team", `selected "${selected}", at ${await path()}`);
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
  } else {
    check("a text cell to select from", false, "none found");
  }

  /* The keyboard. */
  await openList();
  await page.focus(`${row} button[aria-label="Edit"]`);
  await page.keyboard.press("Enter");
  opened = await waitFor(() => Boolean(document.querySelector("[data-popup] form")), undefined, 8000);
  check("Enter on the row's Edit button opens the form, not the page", opened && (await path()) === "/team", `form ${opened}, at ${await path()}`);
  await closeAll();
  await page.focus(row);
  const focused = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), row);
  await page.keyboard.press("Enter");
  got = await landed(first);
  check("Enter on the focused row opens the page", focused && got.at && got.named, `focused ${focused}, ${got.path}`);

  check("no page errors, no 5xx on the way", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
