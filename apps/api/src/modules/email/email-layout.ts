/**
 * The shape every message from this app arrives in.
 *
 * Email is not a browser. Flexbox, grid and external stylesheets are gone by
 * the time this lands, `<style>` is stripped outright by some clients, and
 * Outlook lays out with Word. So: nested tables, inline styles on every
 * element that needs one, and nothing structural that depends on CSS working.
 *
 * The mark is drawn rather than fetched. An `<img>` would be blocked by
 * default in a good half of inboxes and the header would arrive as an empty
 * box — so the lime tile and its arrow are a table cell and a character, which
 * render whether or not somebody has clicked "show images". It is the idea of
 * the mark rather than the artwork, and it is the version that is always there.
 */

const INK = "#18181b";
const LIME = "#bfff00";
const PAPER = "#f4f4f5";
const MUTED = "#71717a";
const LINE = "#e4e4e7";

/** Text that never shows, but is what an inbox list previews. */
function preheader(text: string): string {
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(text)}</div>`;
}

/**
 * Wrap a message body in the header, the card and the footer.
 *
 * `preview` is the line an inbox shows beside the subject. Without one, clients
 * pull the first text they find — which here would be the word "ShareViral"
 * repeated out of the header, on every message this app has ever sent.
 */
export function layout(args: {
  preview: string;
  heading: string;
  body: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(args.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER};-webkit-font-smoothing:antialiased">
${preheader(args.preview)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAPER}">
  <tr>
    <td align="center" style="padding:28px 12px">

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%">

        <!-- The header band -->
        <tr>
          <td bgcolor="${INK}" style="background:${INK};border-radius:14px 14px 0 0;padding:22px 28px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="40" style="width:40px">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td bgcolor="${LIME}" align="center" height="40"
                          style="width:40px;height:40px;background:${LIME};border-radius:11px;
                                 font-family:Segoe UI Symbol,Arial,sans-serif;font-size:21px;
                                 line-height:40px;color:${INK};font-weight:700">&#8599;</td>
                    </tr>
                  </table>
                </td>
                <td style="padding-left:14px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
                  <div style="font-size:17px;font-weight:600;color:#ffffff;letter-spacing:-.01em;line-height:1.2">ShareViral</div>
                  <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${LIME};line-height:1.4">Finance</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- The message -->
        <tr>
          <td bgcolor="#ffffff" style="background:#ffffff;padding:28px;
                     font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                     font-size:15px;line-height:1.55;color:${INK}">
            ${args.body}
          </td>
        </tr>

        <!-- The footer -->
        <tr>
          <td bgcolor="#ffffff" style="background:#ffffff;border-top:1px solid ${LINE};
                     border-radius:0 0 14px 14px;padding:16px 28px;
                     font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                     font-size:12px;line-height:1.5;color:${MUTED}">
            Sent automatically by ShareViral Finance.<br>
            Who receives these is set in Settings &rarr; Email.
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** A row of the detail table: a grey label and its value. */
export function detailRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:7px 16px 7px 0;color:${MUTED};font-size:14px;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td>
    <td style="padding:7px 0;font-size:14px;font-weight:500;color:${INK};vertical-align:top">${value}</td>
  </tr>`;
}

/** The detail table itself, on its own tinted panel. */
export function detailPanel(rows: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                 style="background:${PAPER};border-radius:10px;margin:18px 0 0">
    <tr><td style="padding:6px 18px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>
    </td></tr>
  </table>`;
}

/**
 * A button that survives Outlook.
 *
 * A styled `<a>` alone loses its padding and background there, which turns the
 * one thing the message is asking somebody to do back into ordinary blue text.
 * A table cell with the colour on it, and the link filling the cell, holds.
 */
export function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0">
    <tr>
      <td bgcolor="${INK}" style="background:${INK};border-radius:9px">
        <a href="${escapeHtml(href)}"
           style="display:inline-block;padding:11px 20px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                  font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

/**
 * Anything a person typed goes through here before it reaches the message.
 *
 * Tool and plan names are free text. Nothing in this app has an apostrophe in
 * a plan name today, which is the argument for doing this now rather than
 * after something does.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
