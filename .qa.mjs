/**
 * One page, asked the same questions every time.
 *
 *     node .qa.mjs /                       one page, as super_admin
 *     node .qa.mjs /team --roles           the same page as every role
 *
 * The point of a harness rather than a look around: a page examined by hand
 * gets whatever attention was left at the time, and the twentieth screen gets
 * less than the first. These checks are the ones that caught real faults in
 * this codebase — a heading that never got its alignment, a pager numbering in
 * twenties while asking for fifty, a filter wired to nothing, a table dragging
 * the whole page sideways, a feature shipped against a database that lacked
 * its column.
 *
 * It reads. It opens drawers and closes them again, which is the only way to
 * find one that renders wrong, but it submits nothing and saves nothing.
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const REPO = "d:/codes/Finance-Management-software";
const WEB = "http://localhost:3000";

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(REPO, "apps/api/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const args = process.argv.slice(2);
const routes = args.filter((a) => !a.startsWith("--"));
const allRoles = args.includes("--roles");

const db = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const people = (
  await db.query(
    `select distinct on (role) id, email, role, token_version
       from users where status='active' and deleted_at is null
      order by role, created_at`,
  )
).rows;
await db.end();

const chosen = allRoles
  ? people
  : people.filter((p) => p.role === "super_admin");

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome)
    ? chrome
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--no-sandbox"],
});

const problems = [];
const note = (route, role, kind, detail) =>
  problems.push({ route, role, kind, detail });

for (const person of chosen) {
  const token = jwt.sign(
    { sub: person.id, role: person.role, tv: person.token_version },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "2h" },
  );
  await browser.setCookie({
    name: "sfm_access",
    value: token,
    domain: "localhost",
    path: "/",
  });

  for (const route of routes) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 950 });

    // Everything the page complains about, kept rather than swallowed.
    const consoleErrors = [];
    const failedRequests = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160));
    });
    page.on("requestfailed", (r) =>
      failedRequests.push(`${r.method()} ${r.url().slice(0, 90)}`),
    );
    page.on("response", (r) => {
      if (r.status() >= 400 && r.url().includes("/api/")) {
        failedRequests.push(`${r.status()} ${r.url().replace(/.*\/api/, "")}`);
      }
    });

    await page
      .goto(WEB + route, { waitUntil: "networkidle0", timeout: 120000 })
      .catch((e) => note(route, person.role, "load", e.message.slice(0, 80)));
    await new Promise((r) => setTimeout(r, 2200));

    const landed = new URL(page.url()).pathname;
    const report = await page.evaluate(() => {
      const text = document.body.innerText;
      const tables = [...document.querySelectorAll(".table-data")].map((t) => {
        const heads = [...t.querySelectorAll("thead th")].map((th) =>
          th.textContent.trim(),
        );
        /*
         * The first row that is actually a row.
         *
         * An empty table draws one cell spanning every column — "Nothing on
         * this account in that period" — and counting its cells against the
         * headings reported every empty screen in the app as having lost five
         * columns.
         */
        const first = [...t.querySelectorAll("tbody tr")].find(
          (r) => !r.querySelector("td[colspan]"),
        );
        return {
          heads: heads.filter(Boolean).length,
          cells: first ? first.querySelectorAll("td").length : 0,
          rows: t.querySelectorAll("tbody tr").length,
          /*
           * Where the ink lands, not what `text-align` says.
           *
           * A money column headed left over figures set right is the
           * specificity trap that shipped here four times, so it is worth
           * checking — but the computed style is the wrong instrument. These
           * cells right-align their contents in three different ways: an
           * `<input class="col-amount">`, a flex row with `justify-end`, and a
           * column of two lines with `items-end`. Reading `text-align` off the
           * `<td>` called all three misaligned and reported six columns on the
           * salary sheet, five of which sit exactly where they should.
           *
           * A Range gives the text's own box. If a heading's right edge and
           * its column's right edge agree to within a few pixels, they line up,
           * however that was achieved.
           */
          misaligned: (() => {
            const inkRight = (el) => {
              const r = document.createRange();
              r.selectNodeContents(el);
              const b = r.getBoundingClientRect();
              return b.width ? b.right : null;
            };
            const body = [...t.querySelectorAll("tbody tr")].find(
              (r) => !r.querySelector("td[colspan]"),
            );
            if (!body) return 0;
            return [...t.querySelectorAll("thead th")].filter((th, i) => {
              if (!th.textContent.trim()) return false;
              if (getComputedStyle(th).textAlign !== "right") return false;
              const cell = body.children[i];
              if (!cell) return false;
              const edge = cell.getBoundingClientRect().right;
              const h = inkRight(th);
              const c2 = inkRight(cell);
              if (h === null || c2 === null) return false;
              return Math.abs((edge - h) - (edge - c2)) > 12;
            }).length;
          })(),
        };
      });

      return {
        title: document.querySelector("h1")?.textContent?.trim() ?? null,
        sideways:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        tables,
        buttons: [...document.querySelectorAll("button")]
          .map((b) => b.textContent.trim())
          .filter((t) => t && t.length < 40),
        deadLinks: [...document.querySelectorAll("a")].filter((a) => {
          const h = a.getAttribute("href");
          return !h || h === "#" || h === "";
        }).length,
        emptyish: /couldn.t load|failed|error|no rows|nothing yet|none found/i.test(
          text,
        ),
        pager: /of \d+|\d+ of \d+/i.test(text),
      };
    });

    /* ---- the questions ------------------------------------------------- */

    if (landed !== route.split("?")[0]) {
      note(route, person.role, "redirected", `landed on ${landed}`);
    }
    if (!report.title) note(route, person.role, "no heading", "no <h1>");
    if (report.sideways > 0) {
      note(route, person.role, "scrolls sideways", `${report.sideways}px`);
    }
    if (report.deadLinks > 0) {
      note(route, person.role, "dead links", `${report.deadLinks} with no href`);
    }
    for (const [i, t] of report.tables.entries()) {
      if (t.heads > 0 && t.cells > 0 && t.heads > t.cells) {
        note(
          route,
          person.role,
          "column count",
          `table ${i + 1}: ${t.heads} headings, ${t.cells} cells`,
        );
      }
      if (t.misaligned > 0) {
        note(
          route,
          person.role,
          "alignment",
          `table ${i + 1}: ${t.misaligned} heading(s) not aligned with their column`,
        );
      }
    }
    for (const e of consoleErrors.slice(0, 4)) {
      note(route, person.role, "console", e);
    }
    for (const f of [...new Set(failedRequests)].slice(0, 4)) {
      note(route, person.role, "request", f);
    }

    console.log(
      `${route}  [${person.role}]  ` +
        `${report.title ? `"${report.title.replace(/^\w+_\w+/, "")}"` : "NO HEADING"}  ` +
        `tables=${report.tables.length} ` +
        `rows=${report.tables.map((t) => t.rows).join("/") || "-"} ` +
        `buttons=${report.buttons.length} ` +
        `sideways=${report.sideways}` +
        (report.pager ? " pager" : "") +
        (report.emptyish ? "  <- says something is empty or failed" : ""),
    );

    await page.close();
  }
}

await browser.close();

console.log("\n" + "=".repeat(70));
if (problems.length === 0) {
  console.log("nothing flagged");
} else {
  console.log(`${problems.length} thing(s) to look at:\n`);
  for (const p of problems) {
    console.log(`  ${p.route} [${p.role}]  ${p.kind}: ${p.detail}`);
  }
}
