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

## The order now — the owner's decisions after A3 (2 Oct, evening)

1. **B1 next, before A4.**
   - With a link, anyone who can use the Assistant reads any file shared with the
     service account. HR still holds `ai.use`, so B1 comes first.
   - It is a permissions change and goes out alone: `ai.use` for Super Admin and CFO
     only, and the rail entry and the page hidden from everyone else.
   - Prove it with `.rolecheck.mjs` and the Assistant harnesses: HR gets a 403 and
     sees no entry.
2. **Then A4**, then A5, then the rest of Part B.
3. **A Google Sheet link that names no tab reads every tab, each counted separately.**
   - The card and the summary show each tab's name, rows, columns and totals on its own,
     because the boss's data is mixed and one tab may hold a different kind of record
     from the next.
   - A link that names a tab (`#gid=`) still reads only that tab.
   - This is a follow-up to A3. Do it with A4, or on its own before A5.

## While the boss's samples wait (the owner, 3 Oct)

A3b, A4b, A3c and A3d are done. **A5 waits** for the boss's sample files. The owner will
put them in `F:\boss-samples\`, outside the repository. When they are there, A5 starts
by reading them and saying what each row and image would become, before anything is
built.

Until then, do Part B in this order:
1. **B4. The floating window.** The owner has asked for it longest.
2. **B2. The Assistant's settings and usage inside the chat**, and switching the model
   from the chat.
3. **B3. Token accounting.** Its schema change goes out alone first.
   **Done: SESSIONS #152.** The owner's two answers and what the code needs
   are under "B3 — the owner's two answers" below.

### B2 — the owner's three answers (3 Oct), and the order they make

1. **A model picked in the chat holds for that conversation.** Each chat keeps
   its own, and opening it again from History brings that model back. A chat
   nobody switched follows the default in the Assistant's settings.
   - That needs `ai_chats.model`. **Done, pushed alone: SESSIONS #149.**
   - NULL means "the default". Read it through `aiModelFrom`; the column has
     no check of its own.
2. **CFO sees everything behind the settings icon, and changes nothing.** That
   covers the route, the model, how much it may read and the owner's
   instructions. Never a key, a key's hint, or the Google address.
   - `GET /ai/instructions` is `settings.write` today, so the CFO is refused.
     Opening its read to `ai.use` (writes stay `settings.write`) is a
     permission change. **It goes out alone, before the B2 code**, proved as
     #140 was: the CFO reads and gets a 403 on every write; HR gets a 403 on
     all of it.
   - `/ai/availability` already sends `keyHint` and `setBy` to anyone with
     `ai.use`. The CFO's view must not draw them.
   - **Done, pushed alone: SESSIONS #150.** The CFO reads the instructions
     and, by the owner's answer that session, the recent mistakes too
     (`GET /ai/mistakes`, each only about a part the reader may read). The
     key's hint, its date and who set it now go only to `settings.write`:
     the CFO is sent them null, so the page has nothing to hide.
   - **The B2 code is built: SESSIONS #151.** `/assistant/settings`
     behind the gear on the chat and in the window; the CFO's read-only
     view there and on What the Assistant knows; the chat's picker for
     both roles, held per conversation; the route following the model;
     the old Settings tabs redirecting. **Next is B3** (token accounting),
     its schema change alone first. The usage panel on the right of the
     chat (B2's last bullet) needs B3's figures, so it is built with B3.
3. **Shared code is approved** for `packages/shared/src/ai.ts`: availability
   lists every model that has a working route now, and a turn carries the
   chat's model. Only the Assistant's own screens and its settings read
   these.

Found while reading the code (#149). These were suggestions, and #151 built
both as written:
- **The route follows the model.** Gemini goes only through Google Cloud.
  Claude goes the way the settings' route says, so `app_settings.ai_provider`
  becomes Claude's route. The Anthropic key box shows only when that route
  is "Anthropic key".
- **Where it lives.** Suggested: a page, `/assistant/settings`, beside
  `/assistant/knowledge`. The window's settings icon goes there.
  `/settings?tab=assistant` and `?tab=connections` redirect to it. The
  "Not switched on" card, the knowledge screen, and the API's sentences that
  say "Settings → Connections" or "Settings, Assistant" are changed to match.

### B3 — the owner's two answers (3 Oct), and what is done

1. **The monthly limit is in dollars of estimated cost**, not in tokens. A
   million tokens on Opus and on Gemini Flash are very different money, so a
   token limit would mean a different sum on each model.
2. **One limit for the whole company**, not one per person. At 100% the
   Assistant stops for the Super Admin and the CFO alike, and the sentence
   says the Super Admin can raise it in the Assistant's settings.

- **The schema is done, pushed alone: SESSIONS #152.**
  - `ai_usage` holds one row per model call. It records who, which chat
    (NULL for a key's Test), the provider (`anthropic` | `vertex`), the
    model, and the kind (`turn` | `document` | `test`). It also records
    input, cache-read, cache-write, output and thinking tokens, and when.
  - Rows outlive the chat and the person (`SET NULL`). Deleting a chat must
    never lower the month's total under the limit.
  - `app_settings.ai_monthly_limit_usd` is numeric(10,2). NULL means no
    limit. `GET /settings` does not carry it (`SECRET_COLUMNS`).
- **Next is the B3 code.** What the schema expects of it:
  - **Write a row at every model call.** That covers both adapters' rounds
    (`model-turn.ts`, `gemini.ts`), `readDocument` (a PDF), and the three
    Tests: the Anthropic key in `ai-intake.service.ts` and the two in
    `connections.service.ts`.
  - **Claude:** `input_tokens`, `cache_read_input_tokens`,
    `cache_creation_input_tokens` and `output_tokens`. Its thinking is
    inside `output_tokens`, so `thinking_tokens` is NULL.
  - **Gemini:** `promptTokenCount − cachedContentTokenCount` as the input,
    `cachedContentTokenCount` as the cache read, 0 as the cache write,
    `candidatesTokenCount` as the output and `thoughtsTokenCount` as the
    thinking.
  - **The price table is in the code, per model and per route.** Claude
    through Google Cloud is priced by Google. Take each price from the
    provider's own page when it is built; do not recall one. A model with no
    price shows its tokens and "no price known", never $0.
  - **No cost column.** The estimate is worked out when it is read. Sum the
    tokens in SQL.
  - **The month is Dhaka's:** `created_at >= date_trunc('month', now() at
    time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka'`
    (`ai_usage_created_idx` serves it).
  - **Check the limit before the model is asked.**
    - At 80%, a warning.
    - At 100%, a refusal in words that names who can raise it. Nothing is
      asked and nothing is kept.
  - **Who may do what:** setting the limit is `settings.write` and audited.
    The report and the limit are read with `ai.use`, so the CFO reads them
    (B2's answer).
  - **Where it shows:** the panel on the right of the chat (B2's last
    bullet), and the full breakdown on `/assistant/settings`.
- **The B3 code is built: SESSIONS #156** (from the brief of 4 Oct, piece 2).

## Next, after A4 (the owner, 2 Oct, night): three pieces in this order

1. **A3b. A Sheet link that names no tab reads every tab.** This is decision 3 under "The
   order now" above.
2. **A4b. "Added by the assistant" shows as the origin of everything the Assistant
   saves.**
   - After A4, a transfer, a plan's payment and a challan's payment saved through
     Confirm still show the origin "Entered by hand" or "From a tax payment" on the
     ledger. Only the audit row says "through the Assistant".
   - `TXN_ORIGINS` already has `ai_intake` ("Added by the assistant"), so **no schema
     change** is needed. The Confirm path has to carry the origin through the transfer,
     subscription and TDS services, as it already does for a plain payment.
   - Why it matters: before A5 enters the boss's six months, every entry the Assistant
     made must be findable by origin. A wrong batch can then be found and reversed as
     one.
   - Prove it on the page: All transactions, origin filter "Added by the assistant",
     shows exactly the rows saved through Confirm, of every kind.
   - Also fix the prompt while here: it still says "**Save** on the draft card", but
     since A4 the button is "Confirm and save" (found in A3b).
3. **A3c. Excel files read every sheet too** (the owner's choice, 2 Oct night, on the
   question A3b raised).
   - An .xlsx, whether attached with the paperclip or fetched from a Drive link, reads
     every sheet, each as its own card and its own FILE for the model, exactly as A3b
     does for a Google Sheet's tabs.
   - An empty sheet gets an "Empty" card.
   - The boss keeps the data in Excel workbooks, so this comes before A5.
4. **A3d. Empty sheets do not count** (the owner, 3 Oct, on the question A3c raised).
   - Old workbooks often hold the data in Sheet1 and leave Sheet2 and Sheet3 empty.
     Since A3c such a file shows three cards, and with more than one card the
     Assistant offers no Import plan.
   - When exactly one sheet or tab holds data, read the file as one: one card, and the
     Import plan offered as before. The empty ones are named in a single line under the
     card ("Sheet2, Sheet3: empty").
   - Several sheets with data stay separate, as A3b and A3c made them.
   - Do it in the same session as the start of A5, or just before it. It is small.
5. **A5.** The boss's files.

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

### A1b. Claude is reachable again (2 Oct, evening)

Anthropic verified the owner's account, and credit can be bought. The owner was told to:
buy credit, set a monthly spend limit in the Anthropic Console, make an API key, and paste
it into the **live** Settings → Assistant (never into chat). Then choose "Anthropic key"
and Claude Opus 5, and try the same messages as for Gemini.

What this changes:
- **Claude Opus 5 is the model the quality bar was set on**, which is why it was the only
  model offered before Gemini. Once the owner has tried it, it is the expected default.
  Gemini stays offered as the second route. Everything in Part A must work on both: the
  adapters already share prompts, tools and checks.
- **Claude Opus 5.5** (`claude-opus-5-5`) is newer and cheaper: $4 / $20 per million
  tokens, against $5 / $25. But it returns a 400 on forced `tool_choice` (`any` / `tool`),
  which the turn loop uses today, and thinking cannot be switched off on it.
  - Moving to it is its own piece: `auto` plus `strict` tools, the instruction in the
    prompt, and the bar run before it is offered.
  - Read `shared/model-migration.md` in the claude-api skill first.
  - Not before A2.

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

**A gap the owner found on live (2 Oct, Claude Opus 5):** "amader total team member
kotojon?" was answered "Team member er total count dekhar kono tool amar kache nei". The
Assistant can find a person by name, but it cannot count or list. Add counting and
listing look-ups where the map says a part holds people or records:
- team members by status and engagement;
- vendors;
- subscriptions;
- open HR requests;
- payroll runs.

Make this question a case on the bar: it must answer with the count, and the count must
match the Team screen.

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

### A5. The boss's requirement — nothing typed by hand (2 Oct)

The owner's boss keeps the company's data in Excel sheets, in images on Google Drive, and
in Docs. The instruction passed on: build the Assistant so that he types nothing. He
hands it the files and it enters the data.

This is A3 and A4 at volume, plus three things they do not cover:

1. **A whole file at once.**
   - For a sheet of many rows, the Assistant proposes how the columns map to a record's
     fields, and which part of the app each kind of row belongs to (the map, A2).
   - **Code**, not the model, applies that mapping to every row.
   - The result is a batch of drafts with a summary:
     - how many;
     - totals by account and by category;
     - the date range;
     - the rows it could not place, each with its question;
     - the rows that look already recorded.
   - The app already stages a whole attached file for the Import screen
     (`ai-attachments.service.ts`); build on that.
   - Confirm saves the batch. A batch can be put in the trash as one.
2. **Images.**
   - A receipt, a bill or a bank slip as a photo or scan. The model reads the date, the
     amount, the party and what it was for.
   - The image is attached to the record it becomes. The files module already holds
     vouchers.
   - A figure the model could not read clearly is left empty and asked for. It is never
     guessed.
3. **A Drive folder.**
   - A folder shared with the service account is listed and worked through.
   - The app remembers which files it has already turned into records, so that nothing is
     entered twice. Decide where that memory lives: a schema change, which travels alone.

**Before building, ask the owner for real samples:** one sheet, one Doc and a few images
of each kind, shared with the service account. The first job is to read them and say
what each row and each image would become. The owner has to say what the data is
(payments, income, people, vendors, invoices, past years), and whether books for past
periods are closed.

**What the owner has said so far (2 Oct):** the data is **everything mixed**, and **all
of it is 2026**. That includes payments, income, people and vendors. So:
- one sheet may hold several kinds of record, and the mapping is per kind of row, not per
  file;
- check which 2026 months are closed or already hold records
  (`apps/api/test/integration/13-closed-books.mjs` shows the rule), and tell the owner
  before anything is staged for a closed month;
- much of 2026 is already in the books from daily use, so "already recorded" matching
  matters more than it would for an empty year.

The owner's estimate, not sure of it: **about the previous six months**, so roughly April
to September 2026. Take the real range from the files themselves, and say it back to the
owner in the summary before anything is confirmed.

Still to come from the owner: the samples, and a rough count of sheets, rows and images.

**The rule over all of it still holds.** At this volume a wrong mapping is hundreds of
wrong records at once. So the summary before Confirm is the control, and it must show
totals a person can check against the sheet.

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
- **Switching the model from the chat** (the owner asked, 2 Oct). Today the composer
  shows only "Opus 5", because the chosen route is the Anthropic key, and that route
  offers only Claude. To try Gemini the owner has to go to Settings and change the route.
  - Make the route follow the model. The composer's picker lists every model that has a
    working route right now: Claude Opus 5 through the Anthropic key (or Google Cloud
    once its quota exists), and the Gemini models through Google Cloud.
  - Picking one in the chat switches to it without a trip to Settings. Settings keeps only
    the default.
  - Decide with the owner whether a choice in the chat holds for that conversation or
    becomes everyone's default. The first needs the model stored per chat, which is a
    schema change if `ai_chats` has no such column.
  - Only Super Admin and CFO can use the Assistant at all (B1), so both may switch.
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
