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

**Wrong is worse than slow.** The Assistant must never invent an account, a category, a
figure or a module nobody named.

**How it is tested — the owner's decision, 2 Oct:** *"local a kichu bosanor dorkar nei …
ami sorasori live ei test korbo ager barer moto. sudhu sudhu retry kore local a token nosto
korar dorkar nei."*

- **No Google key goes into the local app, and no session spends tokens on real-model runs
  locally.** Do not ask the owner for one.
- **Locally, each piece is proved with the stand-in model and the page**, the way #133 was:
  the harnesses and the four CI steps. That proves the code. It does not prove what the
  model will say.
- **The real model is tested by the owner, on the live site, after the deploy.** Every
  handover therefore ends with a short list for the owner: the exact messages to type, and
  what should come back for each (what the draft holds, what is asked, what must not
  appear). Add the same cases to `.assistantbar.mjs`, so they exist as code for whenever a
  key is available.
- **What this costs, said once to the owner and accepted:** a wrong answer is found by the
  owner's eyes, not by a count. Each fix is a push and a deploy of about eight minutes. So
  make the code-side guards strong: the draft is checked against the schema, routing
  follows the map, and nothing is saved without Confirm. The model's care is not the only
  thing between a mistake and the books.

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

**The owner's first rule, decided 2 Oct (it goes into the map and the first instruction
set):** anything called a subscription belongs to **Ai Tools and Subscriptions**. That
covers software, AI tools, hosting and servers, and domains. It is recorded as a plan in
that part, and filed under the "Ai Tools and Subscriptions" heading.

The Technology sub-categories "Software & subscriptions" and "AI tools" are duplicates of
that heading. The owner means to trash them. If payments are filed under them, re-file
those first, and tell the owner how many there were.

**Reading more.** Widen the look-up tools (`ai-tools.ts`) to every part the map lists:
subscriptions and their charges, payroll runs, TDS, invoices, HR requests and budget, bank
advice. Each one is gated on the asker's own permission, as the existing ones are.

### A2b. It gets better with use — the owner's words, 2 Oct

> "model er porikkha coltei thakbe and aste aste improve korbo oke train kore kore
> serokom system banano jayna? puro application er kon page a ki ache and kon forms ta
> kivabe kaj kore etc sob or knowledge thaka ucit."

We cannot retrain Google's model. What can be built is a system around it that learns,
with four parts:

1. **The map covers pages and forms, and is generated where it can be.**
   - For every page: what it shows, and what can be done there.
   - For every form: its fields, which are required, what each means, and what happens on
     Save.
   - The field lists come from the same schemas the API validates with, as
     `field-reference.ts` already does for the five targets. The map then cannot drift
     from the app.
   - The meaning of each page is written by hand, next to its module. A test fails when a
     page or a form has no entry.
2. **Every correction is kept** (`ai_corrections` exists; widen it).
   - When the person changes a field in a draft before saving, or presses "this was wrong"
     on a reply and says why, the app stores:
     - what was asked;
     - what the Assistant gave;
     - what was right.
   - Recent, relevant corrections are shown to the model on later turns.
3. **Corrections become rules.**
   - The Assistant's settings get a list of recent mistakes.
   - Beside each is "make this a rule", which writes one line into the owner's instruction
     set (A2). The owner can edit or delete any rule.
   - This list is the "training" the owner asked for, in a form they can read and control.
4. **Every mistake becomes a test.** Each recorded mistake is added to `.assistantbar.mjs`
   as a case, so a later change to the prompt or the model cannot bring it back unnoticed.

Also add a page the owner can open: **"What the Assistant knows"**. It shows the map, the
rules and the recent corrections, so that the owner can see why it answered as it did.

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

### B2. The Assistant's own settings, inside the chat (the owner's change, 2 Oct)

The owner wants it the way ChatGPT and Claude do it: a settings icon on the chat page
itself, and everything about the Assistant behind it. Not two tabs in the app's Settings.

- **A settings icon on the Assistant page**, and in the floating window (B4). It opens the
  Assistant's own settings page or panel, which holds:
  - the route and the model;
  - the Google Cloud connection: the key, Test, and the address to share files with;
  - how much it may read;
  - the owner's instruction set (A2).

  Super Admin can change these, as now. Decide with the owner what CFO sees. The default
  is the usage panel only.
- **The Assistant and Connections tabs leave the app's Settings.** Keep the old addresses
  working as redirects, so links in SESSIONS and bookmarks do not break.
- **The Anthropic key box** shows only when "Anthropic key" is the chosen route; it is not
  shown before.
- **A panel on the right of the chat for usage** (B3): this month's tokens, the estimated
  cost, the limit, and how much of it is used. It can be collapsed, and on a phone it sits
  behind a button.

### B3. Token accounting

- **Recording.** One row per model call: who, which chat, provider, model, input, output
  and thinking tokens, when. **This is a schema change, and it travels alone.**
- **The report.** In the chat's right-hand panel (B2), with the full breakdown in the
  Assistant's settings: by day, month, person and model, with an
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
