// Where things actually landed on the closing page.
//
// Throwaway. Inflates the PDF's content streams and reads the drawing
// operators back out, so the signature grid is measured rather than eyeballed.
//
// PDFKit installs a top-left coordinate system on every page, so the numbers
// in a `re` or a text matrix are already measured down from the top of the
// sheet. No inversion here — trying one is what made the first run of this
// script report the second row of boxes above the first.
//
//   node .pdfgeom.mjs .sigcheck-out/statement.pdf
import fs from "node:fs";
import zlib from "node:zlib";

const file = process.argv[2] ?? ".sigcheck-out/statement.pdf";
const bytes = fs.readFileSync(file);
const SHEET = { width: 595.28, height: 841.89 };
/** What the closing page anchors its big figures at, off the foot. */
const FIGURES_FROM_BOTTOM = 182;
const BOX_WIDTH = (SHEET.width - 61 * 2 - 11.4) / 2;

function streams(buffer) {
  const out = [];
  const latin = buffer.toString("latin1");
  let at = 0;
  for (;;) {
    const start = latin.indexOf("stream", at);
    if (start < 0) break;
    let from = start + "stream".length;
    if (latin[from] === "\r") from++;
    if (latin[from] === "\n") from++;
    const end = latin.indexOf("endstream", from);
    if (end < 0) break;
    try {
      out.push(zlib.inflateSync(buffer.subarray(from, end)).toString("latin1"));
    } catch {
      // An image's own stream, or something not deflated. Fine to skip.
    }
    // Past the whole keyword. Landing inside "endstream" makes the next scan
    // find its own tail, and every stream after it reads misaligned — which
    // showed up as one inflated stream out of thirty-one.
    at = end + "endstream".length;
  }
  return out;
}

const all = streams(bytes);
const closing = all.filter((s) => /\/I\d+\s+Do/.test(s));
console.log(
  `${all.length} inflated streams; ${closing.length} place an image`,
);

for (const page of closing) {
  const rects = [...page.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re/g)]
    .map((m) => ({
      x: Number(m[1]),
      top: Number(m[2]),
      w: Number(m[3]),
      h: Number(m[4]),
    }))
    .filter((r) => r.w > 40 && r.h > 10 && r.w < SHEET.width - 10);

  console.log("\n--- boxes and plates ---");
  console.table(
    rects.map((r) => ({
      what: Math.abs(r.w - BOX_WIDTH) < 1 ? "signature box" : "paper plate",
      x: r.x.toFixed(1),
      top: r.top.toFixed(1),
      bottom: (r.top + r.h).toFixed(1),
      width: r.w.toFixed(1),
      height: r.h.toFixed(1),
    })),
  );

  console.log("--- images ---");
  const images = [
    ...page.matchAll(
      /([-\d.]+) 0 0 ([-\d.]+) ([-\d.]+) ([-\d.]+) cm\s*\/(I\d+) Do/g,
    ),
  ].map((m) => ({
    image: m[5],
    width: Number(m[1]).toFixed(1),
    height: Math.abs(Number(m[2])).toFixed(1),
    x: Number(m[3]).toFixed(1),
    top: (Number(m[4]) - Math.abs(Number(m[2]))).toFixed(1),
  }));
  console.table(images);

  console.log("--- text, top to bottom ---");
  const lines = [];
  const re = /1 0 0 1 ([-\d.]+) ([-\d.]+) Tm([\s\S]{0,900}?)(?=1 0 0 1 |ET)/g;
  let m;
  while ((m = re.exec(page))) {
    const shown = [...m[3].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)]
      .map((t) => t[1])
      .join("")
      .replace(/\\(\d{3})/g, "?")
      .slice(0, 40);
    if (shown.trim()) {
      lines.push({ x: Number(m[1]).toFixed(1), y: Number(m[2]), text: shown });
    }
  }
  console.table(
    lines
      .sort((a, b) => a.y - b.y)
      .map((l) => ({ ...l, y: l.y.toFixed(1) })),
  );

  const boxes = rects.filter((r) => Math.abs(r.w - BOX_WIDTH) < 1);
  const gridTop = Math.min(...boxes.map((r) => r.top));
  const gridBottom = Math.max(...boxes.map((r) => r.top + r.h));
  const figures = SHEET.height - FIGURES_FROM_BOTTOM;
  const belowGrid = lines.filter((l) => l.y > gridBottom).sort((a, b) => a.y - b.y)[0];

  console.log(
    `\ngrid   ${gridTop.toFixed(1)} → ${gridBottom.toFixed(1)}` +
      `   (${boxes.length} boxes)` +
      `\nfigures anchor at ${figures.toFixed(1)}; first text under the grid at ` +
      `${belowGrid ? belowGrid.y.toFixed(1) : "—"} ("${belowGrid?.text ?? ""}")` +
      `\n${gridBottom <= figures ? "CLEAR" : "OVERLAP"} — ` +
      `${Math.abs(figures - gridBottom).toFixed(1)}pt ` +
      `${gridBottom <= figures ? "of room left" : "past the anchor"}`,
  );
}
