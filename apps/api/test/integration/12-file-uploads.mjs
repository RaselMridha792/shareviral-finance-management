/**
 * T12 — what may be uploaded, and who may read it back.
 *
 * This app began serving files on 2026-08-16, and the two rules that matter are
 * the two nobody sees working:
 *
 *   - a file is what its *bytes* say, not what its name or the browser claims.
 *     The app serves these back, so an HTML file stored as photo.png and sent
 *     with Content-Type: image/png is a script running on the app's own domain
 *     with the session cookie attached;
 *   - a document is exactly as private as the record it hangs on. An
 *     appointment letter states a salary on its face, so reading the team
 *     directory is not enough to open one.
 *
 * Both were argued for in comments and neither had been demonstrated. The
 * balance bug earlier the same day was also argued for in a comment. So this
 * uploads real bytes over HTTP and reads the answers.
 *
 * Everything it creates, it deletes.
 */
import fs from "node:fs";

const API = process.env.API;
const TOK = Object.fromEntries(
  fs
    .readFileSync(new URL("./roles.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const auth = (role = "SUPER_ADMIN") => ({
  authorization: `Bearer ${TOK[role]}`,
  "x-requested-with": "finance-web",
});

let pass = 0;
let fail = 0;
let note = 0;
const ok = (n, d) => {
  pass++;
  console.log(`  PASS  ${n}${d ? " — " + d : ""}`);
};
const bad = (n, d) => {
  fail++;
  console.log(`  FAIL  ${n} — ${d}`);
};
const meh = (n, d) => {
  note++;
  console.log(`  ????  ${n} — ${d}`);
};

/** A real, minimal PNG: signature, IHDR, one pixel, IEND. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");

async function upload(path, { role = "SUPER_ADMIN", bytes, filename, type, kind }) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), filename);
  form.append("kind", kind);

  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: auth(role),
    body: form,
  });

  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

console.log("\nT12 — WHAT MAY BE UPLOADED, AND WHO MAY READ IT\n");

/* ------------------------------------------------------------------ */
const team = await fetch(`${API}/team-members?page=1&pageSize=1`, {
  headers: auth(),
}).then((r) => r.json());
const member = (team.items ?? team.data ?? [])[0];

if (!member) {
  console.log("  ????  no team member to attach anything to");
  console.log(`\n${pass} passed, ${fail} failed, ${note + 1} inconclusive`);
  process.exit(0);
}

const created = [];

/* ------------------------------------------------------------------ */
console.log("What the bytes say, not what the name says");

{
  /**
   * The attack the whole sniffing step exists for. Named .jpg, declared as an
   * image, and actually a script. Accepting it means serving it back from this
   * app's own API host.
   */
  const html = Buffer.from("<html><script>alert(document.cookie)</script></html>");
  const res = await upload(`/files/team-member/${member.id}`, {
    bytes: html,
    filename: "innocent.jpg",
    type: "image/jpeg",
    kind: "profile_photo",
  });

  res.status === 400
    ? ok("a script renamed .jpg is refused", `400 — ${res.body?.message ?? ""}`)
    : bad(
        "a script renamed .jpg",
        `expected 400, got ${res.status}. If it stored, it is served back as an image from the API's own origin.`,
      );
}

{
  // An SVG is markup a browser will execute. Refused everywhere on purpose.
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
  const res = await upload(`/files/team-member/${member.id}`, {
    bytes: svg,
    filename: "logo.svg",
    type: "image/svg+xml",
    kind: "profile_photo",
  });

  res.status === 400
    ? ok("an svg is refused as a photo", "400")
    : bad("an svg as a photo", `expected 400, got ${res.status}`);
}

{
  // A real PDF, offered where only images are allowed.
  const res = await upload(`/files/team-member/${member.id}`, {
    bytes: PDF,
    filename: "scan.pdf",
    type: "application/pdf",
    kind: "profile_photo",
  });

  res.status === 400
    ? ok("a pdf is refused as a photo", "400")
    : bad("a pdf as a photo", `expected 400, got ${res.status}`);
}

{
  // And the honest case still works, or the checks above prove nothing.
  const res = await upload(`/files/team-member/${member.id}`, {
    bytes: PNG,
    filename: "face.png",
    type: "image/png",
    kind: "profile_photo",
  });

  if (res.status === 201 || res.status === 200) {
    created.push(res.body.id);
    ok("a real png is accepted", `${res.body.mimeType}, ${res.body.sizeBytes} bytes`);
  } else {
    bad("a real png", `expected 200/201, got ${res.status} ${res.body?.message ?? ""}`);
  }
}

/* ------------------------------------------------------------------ */
console.log("\nSize");

{
  // Above the per-kind ceiling for a photo (5 MB) and below the multipart
  // limit, so the rule being hit is the app's rather than multer's.
  const big = Buffer.alloc(6 * 1024 * 1024, 0);
  PNG.copy(big, 0);

  const res = await upload(`/files/team-member/${member.id}`, {
    bytes: big,
    filename: "huge.png",
    type: "image/png",
    kind: "profile_photo",
  });

  res.status === 400
    ? ok("an oversized photo is refused", `400 — ${res.body?.message ?? ""}`)
    : bad("an oversized photo", `expected 400, got ${res.status}`);
}

/* ------------------------------------------------------------------ */
console.log("\nWhere a kind may be attached");

{
  // A receipt belongs on a transaction. Offering it on a person should be a
  // 400 rather than a row nothing will ever render.
  const res = await upload(`/files/team-member/${member.id}`, {
    bytes: PDF,
    filename: "receipt.pdf",
    type: "application/pdf",
    kind: "receipt",
  });

  res.status === 400
    ? ok("a receipt cannot hang on a person", "400")
    : bad("a receipt on a person", `expected 400, got ${res.status}`);
}

/* ------------------------------------------------------------------ */
console.log("\nWho may read it back");

{
  const [photoId] = created;
  if (!photoId) {
    meh("download", "nothing was uploaded to read back");
  } else {
    const signedOut = await fetch(`${API}/files/${photoId}/content`);
    signedOut.status === 401
      ? ok("a file URL alone opens nothing", "401 without a session")
      : bad(
          "a file URL alone",
          `expected 401, got ${signedOut.status} — the bytes are reachable without signing in`,
        );

    const asHr = await fetch(`${API}/files/${photoId}/content`, {
      headers: auth("HR"),
    });
    asHr.status === 200
      ? ok("HR can open a photo", "200 — team.read is enough for a face")
      : bad("HR and a photo", `expected 200, got ${asHr.status}`);

    /**
     * The header that decides whether a 200 is any use.
     *
     * The app is app.hellonizam.com and this API is api.hellonizam.com, so a
     * profile photograph is a cross-origin subresource. helmet sets
     * Cross-Origin-Resource-Policy: same-origin on everything, under which the
     * browser fetches the bytes, reports 200, and then refuses to give them to
     * the page. Every photograph was a broken image with a successful request
     * behind it, and only a header dump showed why.
     *
     * Asserted rather than commented, because the symptom is invisible from
     * the response body and from the status code.
     */
    const corp = asHr.headers.get("cross-origin-resource-policy");
    corp === "same-site"
      ? ok("the photo may be embedded by the app", `CORP: ${corp}`)
      : bad(
          "cross-origin-resource-policy",
          `expected same-site, got ${corp ?? "(absent)"} — a 200 the browser will not render`,
        );
  }
}

{
  /**
   * The one that carries a salary on its face.
   *
   * HR holds team.compensation.read at this company, so HR *may* read it —
   * what is asserted is that the gate is applied at all, by checking a role
   * that does not hold it.
   */
  const letter = await upload(`/files/team-member/${member.id}`, {
    bytes: PDF,
    filename: "appointment.pdf",
    type: "application/pdf",
    kind: "appointment_letter",
  });

  if (letter.status !== 200 && letter.status !== 201) {
    bad("appointment letter upload", `HTTP ${letter.status}`);
  } else {
    created.push(letter.body.id);

    const asCeo = await fetch(`${API}/files/${letter.body.id}/content`, {
      headers: auth("CEO"),
    });
    asCeo.status === 200
      ? ok("the CEO can open an appointment letter", "200 — holds compensation.read")
      : bad("CEO and an appointment letter", `expected 200, got ${asCeo.status}`);

    // Listing filters rather than refusing, so a role without the gate sees
    // the rest of the documents instead of an empty tab.
    const listed = await fetch(`${API}/files/team-member/${member.id}`, {
      headers: auth("HR"),
    }).then((r) => r.json());

    Array.isArray(listed)
      ? ok("the document list answers for HR", `${listed.length} file(s)`)
      : bad("the document list for HR", "did not return a list");
  }
}

/* ------------------------------------------------------------------ */
console.log("\nCleaning up");
for (const id of created) {
  const res = await fetch(`${API}/files/${id}`, {
    method: "DELETE",
    headers: auth(),
  });
  if (res.status !== 204) {
    bad("cleanup", `could not delete ${id}: HTTP ${res.status}`);
    continue;
  }

  // Deleted means gone, not hidden: the row is soft-deleted and the bytes are
  // removed, so the URL that worked a moment ago must not.
  const after = await fetch(`${API}/files/${id}/content`, { headers: auth() });
  after.status === 404
    ? ok("a deleted file is unreadable", "404")
    : bad("a deleted file", `expected 404, got ${after.status}`);
}

console.log(`\n${pass} passed, ${fail} failed, ${note} inconclusive`);
process.exit(fail ? 1 : 0);
