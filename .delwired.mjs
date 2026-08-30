/**
 * Which screens are wired for deleting, and which are half-wired.
 *
 * The half-wired case is the one worth a script: a delete button whose dialog
 * was never rendered looks completely normal until somebody presses it and
 * nothing happens. It happened once on the way here, on a screen whose diff
 * looked exactly like the two that were right.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "apps/web/src/components";
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".tsx")) files.push(p);
  }
};
walk(ROOT);

const rows = [];
for (const f of files) {
  const t = fs.readFileSync(f, "utf8");
  // A screen counts if it draws a table, ends rows with the shared actions,
  // or renders the shared transaction table on somebody else's behalf.
  const hasTable =
    t.includes("table-data") ||
    t.includes("<RowActions") ||
    t.includes("<TransactionTable");
  if (!hasTable) continue;
  const button = /onDelete=\{/.test(t) || /del\.ask/.test(t);
  const dialog = /del\.dialog/.test(t) || /<DeleteDialog/.test(t);
  const passesThrough = /onDelete\?:/.test(t); // a table component, not a screen
  rows.push({
    file: f.split(path.sep).join("/").replace(ROOT + "/", "").replace(".tsx", ""),
    button,
    dialog,
    passesThrough,
  });
}

/*
 * `passesThrough` is checked first, and that ordering is the whole fix.
 *
 * A table component declares `onDelete?:` and hands it to RowActions; its
 * dialog belongs to whichever screen rendered it, so judging it on having no
 * dialog of its own reported the one correctly-built component in the app as
 * broken. Which is the failure mode of a checking script: it disagrees with a
 * right answer, somebody "fixes" the right answer, and now it is wrong.
 */
const state = (r) =>
  // Its own dialog first: a screen can both declare `onDelete?:` for an inner
  // table it renders and own the dialog itself, and judging it on the prop
  // alone reported a fully wired screen as merely passing the job along.
  r.button && r.dialog ? "wired" :
  r.passesThrough ? "passes it on" :
  r.button && r.dialog ? "wired" :
  r.button && !r.dialog ? "HALF - button, no dialog" :
  !r.button && r.dialog ? "wired (its own dialog)" :
  "not wired yet";

console.log(`\n${rows.length} screens with a table\n`);
for (const r of rows.sort((a, b) => state(a).localeCompare(state(b)) || a.file.localeCompare(b.file))) {
  console.log(`  ${state(r).padEnd(26)} ${r.file}`);
}
const half = rows.filter((r) => state(r).startsWith("HALF"));
console.log(half.length ? `\n  ${half.length} half-wired` : "\n  nothing half-wired");
process.exit(half.length ? 1 : 0);
