# Brief — the Assistant, made strong: knowledge first, then power, then where it lives

**For:** the Claude sessions that build this, one piece per session.
**From:** the planning session, 2 Oct 2026, from the owner's own words and two answers.
Read SESSIONS #130–#133 and the three earlier briefs in this folder first. Each new session
takes the **next unfinished piece below**. SESSIONS.md says which are done.

## What the owner asked (2 Oct)

> "Ai ke powerful banao sob knowledge daw. dorkar hole or jonne instructions set ready kore
> rakho oke training dewar jonne … sobceye main kotha holo ami caina ai assistant khub beshi
> vul koruk. or kache puro application er knowledge memory thakle o vul kom korbe."

The mistake that prompted it: the owner told the Assistant to buy an AI subscription. It
recorded a plain payment. The app keeps AI tools and subscriptions as their own part, with
their own category. **All transactions shows the record; the AI tools and subscriptions
page shows nothing.** "Ei type er vul gulato kora jabena."

**The owner's order:** train it, make it powerful and finish the integrations first
(Part A). Everything else comes after (Part B).

**The owner's two decisions:**
1. **Saving: confirm in chat, then it saves.** The Assistant prepares the record and shows
   a summary. The person presses Confirm in the chat and it is saved, through the same
   endpoint, schema, permissions and audit trail as the form. It never saves by itself.
2. **Tokens: a report and an optional monthly limit.**

## The rule over all of it

**Wrong is worse than slow.** Every piece adds its cases to `.assistantbar.mjs` and reports
invention as a number, which must be zero: an account, a category, a figure or a module
nobody named. Nothing here is done until it has been measured on the live model, not on a
stand-in.

---

## Part A — first

### A1. The model (urgent: before 16 Oct 2026)

`gemini-2.5-pro` is retired on Agent Platform between 16 and 20 Oct 2026. The owner's
project lists `gemini-3.8-flash` (not a preview) and `gemini-3.1-pro-preview`. The details
are at the end of `2026-10-02-assistant-complete-drafts.md`.
- Add both.
- Run the bar on both.
- Offer what never invents. If both pass, prefer the one that is not a preview.
- Make it the default for Gemini.

### A2. Knowledge — "training", which here means what it is told and what it can read

A model cannot be trained by us. What it knows about this company is what the app puts in
front of it. Three things:

1. **A map of the application, kept in the code, next to the modules it describes.** For
   every part of the app, the map says:
   - what the part is for;
   - which records belong there and not in the general ledger;
   - which screen and endpoint record them;
   - what the Assistant can do there (draft, read, or only point to the screen).

   The parts: accounts, transactions, transfers, expenses, vendors, **AI tools and
   subscriptions**, team, payroll, TDS, income tax, HR budget, HR requests, bank advice,
   bank statements and reconciliation, invoices, reports.

   Write it by reading each module, not from memory. Keep a test that fails when a module
   has no entry.
2. **Routing before drafting.**
   - The Assistant first decides which part of the app a request belongs to, from the map.
   - If it can draft there, it drafts **that** kind of record.
   - If it cannot, it says so and names the screen. It never files it as a plain payment.
   - The owner's case is the first test: "buy/renew an AI subscription" must land on the
     plan in AI tools and subscriptions, and show on that page.
   - Find out how a plan's charges are recorded and linked. Add the target or the link.
     Check on the page itself that the record appears there.
3. **An instruction set the owner can edit: "Instructions for the Assistant".**
   - It is plain text, written in the owner's own words. Example: "Claude, ChatGPT, Gemini
     kena = AI tools & subscriptions".
   - It sits beside the corrections the app already remembers (`ai_corrections`).
   - It is stored in the database. **That is a schema change, and it travels alone.**
   - It is shown and edited in the Assistant's settings, with a size limit, and changes go
     to the audit log.
   - It is placed in the stable part of the prompt, after the map. The owner's rules can
     add to the map, but they cannot unlock a permission.

**Reading more.** Widen the look-up tools (`ai-tools.ts`) to every part the map lists:
subscriptions and their charges, payroll runs, TDS, invoices, HR requests and budget, bank
advice. Each one is gated on the asker's own permission, as the existing ones are.

### A3. Files and links

- **Uploaded files.** PDF, CSV and Excel are read already. Confirm each on the live model.
- **Links.** A pasted Google Sheet, Doc or Drive file link is read with the service account
  (step 3 of `2026-10-01-google-connections.md`).
  - A sheet becomes the same headers-and-rows attachment as an upload.
  - A doc becomes text.
  - A Drive link to an .xlsx, .csv or .pdf is fetched and read as an upload.
  - A file that was not shared: "Share this file with <service account email> first."

### A4. Power — confirm in chat, then it saves

- The draft card in the chat gets **Confirm and save**.
- The server validates the record against the target's own schema again, and posts it to
  the same endpoint as the person, with the person's permissions.
- The audit row says who saved it, and that it came through the Assistant.
- For several drafts at once (a file), show the count and the total. Confirm one by one, or
  all together after that summary.
- Not offered: deleting, voiding, payroll finalising or paying, settings, anything about
  users. The map says "point to the screen" for those.
- After a save, the reply names what was saved and where it now shows, with a link.

---

## Part B — after Part A

### B1. Who may use it

Only Super Admin and CFO. `ai.use` comes off every other role. The rail entry, the page and
the floating window (B4) are hidden from them; the API already refuses on the permission.
**This is a permissions change, so it travels alone.**

### B2. Settings in one place

- Assistant and Connections become one Settings tab.
- The Assistant page gets a settings entry for Super Admin.
- The Anthropic key box shows only when "Anthropic key" is the chosen route; it is not
  shown before.

### B3. Token accounting

- **Recording.** One row per model call: who, which chat, provider, model, input, output
  and thinking tokens, when. **This is a schema change, and it travels alone.**
- **The report.** In the Assistant's settings: by day, month, person and model, with an
  estimated cost from a per-model price table in code. It is labelled as an estimate,
  because Google's invoice is the real figure.
- **The optional monthly limit.** A warning at 80%. At 100% the Assistant stops, with a
  sentence saying so and who can raise the limit.

### B4. The floating window

- A launcher on every dashboard page, for the two roles.
- It opens the chat as a small window over the page.
- It expands to the full Assistant page and back, with the same conversation, attachments
  and draft cards in both.
- It must not cover a page's own controls, and it must work on a phone.
- The dashboard layout is shared code. The owner asked for this; list the screens checked
  with `node .sweep.mjs` afterwards.

---

## For each session's handover

Say which piece was done, what the bar measured (with examples of anything it got wrong),
and what the owner has to decide. Schema and permission changes go out alone, before the
code that needs them.
