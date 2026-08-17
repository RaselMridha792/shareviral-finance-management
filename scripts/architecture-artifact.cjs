// One document, two places it has to render.
//
// The real file is apps/web/public/architecture.html - a whole HTML document,
// served by the app behind a login. The published artifact is the same page,
// but the artifact host supplies its own doctype/html/head/body skeleton and
// wraps whatever you give it, so a second full document nested inside the
// first renders as garbage.
//
// So the artifact copy is GENERATED, never hand-edited. Edit the page in
// apps/web/public/, run this, and republish. The two cannot drift, because
// only one of them is ever written by a person.
//
//     node scripts/architecture-artifact.cjs [out.html]
//
// Writes the stripped copy to the given path, or to a temp file, and prints
// where. It is a publish artefact either way and has no business in git.
const fs = require("fs");
const os = require("os");
const path = require("path");

const src = path.join(__dirname, "..", "apps", "web", "public", "architecture.html");
const html = fs.readFileSync(src, "utf8");

const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1];

// Everything the host supplies itself is dropped. <title> is kept: the host
// scans the first 8KB for one and uses it to name the artifact.
const keep = [
  (head.match(/<title>[\s\S]*?<\/title>/) || [""])[0],
  ...(head.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []),
].join("\n");

const out =
  process.argv[2] || path.join(os.tmpdir(), "sfm-architecture.artifact.html");
fs.writeFileSync(out, keep + "\n" + body.trim() + "\n");

console.log(out);
console.log(
  "  " +
    Math.round(fs.statSync(out).size / 1024) +
    "KB, " +
    (keep.match(/<style/g) || []).length +
    " style blocks, " +
    (body.match(/<section/g) || []).length +
    " sections",
);
