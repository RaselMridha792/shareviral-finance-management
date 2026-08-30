// Is there actually ink in the PDF's signature, or just a white plate?
//
// The geometry script proves a box was drawn and an image was placed in it. It
// cannot tell a signature from a blank rectangle — which mattered, because the
// first fixture wrote an invalid PNG filter byte and produced exactly that.
//
// PDFKit passes a truecolour PNG's IDAT straight through as a FlateDecode
// image with /Predictor 15, so the scanlines come back out with their PNG
// filter bytes intact. Inflate, un-filter, count the dark pixels.
//
//   node .pdfink.mjs .sigcheck-out/statement.pdf
import fs from "node:fs";
import zlib from "node:zlib";

const file = process.argv[2] ?? ".sigcheck-out/statement.pdf";
const bytes = fs.readFileSync(file);
const latin = bytes.toString("latin1");

/** Every image XObject: its declared size, and the bytes of its stream. */
function imageObjects(buffer, text) {
  const found = [];
  const re = /<<([^>]*?\/Subtype\s*\/Image[\s\S]*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(text))) {
    const dict = m[1];
    const width = Number(/\/Width (\d+)/.exec(dict)?.[1] ?? 0);
    const height = Number(/\/Height (\d+)/.exec(dict)?.[1] ?? 0);
    const colours = Number(/\/Colors (\d+)/.exec(dict)?.[1] ?? 3);
    const from = m.index + m[0].length;
    const end = text.indexOf("endstream", from);
    if (!width || !height || end < 0) continue;
    found.push({
      width,
      height,
      colours,
      data: buffer.subarray(from, end),
      filter: /\/DCTDecode/.test(dict) ? "DCTDecode" : "FlateDecode",
      predictor: Number(/\/Predictor (\d+)/.exec(dict)?.[1] ?? 0),
    });
  }
  return found;
}

/** Undo the PNG row filters, so the pixels are pixels again. */
function unfilter(raw, width, height, colours) {
  const stride = width * colours;
  const out = Buffer.alloc(stride * height);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const type = raw[at++];
    const row = raw.subarray(at, at + stride);
    at += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const here = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= colours ? here[x - colours] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= colours ? prev[x - colours] : 0;
      let value = row[x];
      if (type === 1) value += a;
      else if (type === 2) value += b;
      else if (type === 3) value += (a + b) >> 1;
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      here[x] = value & 0xff;
    }
  }
  return out;
}

const images = imageObjects(bytes, latin);
console.log(`${images.length} image XObjects in ${file}\n`);

const table = images.map((image, index) => {
  if (image.filter !== "FlateDecode") {
    return { image: index + 1, note: image.filter };
  }
  let dark = 0;
  let total = 0;
  try {
    const raw = zlib.inflateSync(image.data);
    const pixels =
      image.predictor >= 10
        ? unfilter(raw, image.width, image.height, image.colours)
        : raw;
    for (let i = 0; i + 2 < pixels.length; i += image.colours) {
      total++;
      if ((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 < 128) dark++;
    }
  } catch (error) {
    return { image: index + 1, note: String(error).slice(0, 40) };
  }
  return {
    image: index + 1,
    size: `${image.width}x${image.height}`,
    predictor: image.predictor,
    "dark pixels": dark,
    "% of the plate": `${((dark / total) * 100).toFixed(1)}%`,
    verdict: dark > 0 ? "ink" : "BLANK",
  };
});

console.table(table);
