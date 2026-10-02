# Brief — the Assistant: complete drafts, transfers, and talking like a colleague

**For:** the next Claude session in this repository.
**From:** the session that wrote the Gemini brief, 2 Oct 2026.
Read SESSIONS #132 (the Assistant on Gemini, on trial) first.

## What the owner saw on the live site (Gemini 2.5, 2 Oct)

1. "ms/exprovia account a koto taka ache akhon?" → the right balance. Reading works.
2. "1 lakh taka transfer koro ms/exprovia theke Md. Nizam Uddin accounts a" → it asked for
   today's USD rate, then said **"…transfer record korechi"** and showed a draft:
   - Amount 100000;
   - Account M/S. EXPROVIA;
   - Counterparty Md. Nizam Uddin;
   - Usd rate 121.5;
   - **no category**.
3. Save answered: `Invalid input: expected string, received undefined: Category`.

The owner's words: why does it make mistakes like this, does it need training, why can it
not choose from the dropdown with its own intelligence — and then: *"or hate control diye
daw jate o properly sob read korte pare and oi onujayi kaj korte pare, amar sathe naturally
kothao bolte pare and question korte pare and bujhte pare."*

## Why it happened — three faults, none of them "training"

1. **A transfer between two of our own accounts is not something the Assistant can draft.**
   - `AI_TARGETS` is money out, money in, vendor, team member and TDS challan.
   - `createTransferSchema` exists (`packages/shared/src/transactions.ts`) and the
     transactions controller takes transfers, but no target points at it.
   - The model pushed a transfer into "money going out", which needs a category it did not
     have.
2. **Completeness is the model's word, not the code's.**
   - `normalise()` takes `missingFields` from the model and trusts an empty list.
   - The draft is never checked against the schema the Save will use (`field-reference.ts`
     already holds those schemas per target).
   - Claude followed the prompt's rule. Gemini returned a draft with a required field
     absent and nothing listed as missing, so the page offered Save on a form that could
     not be saved.
3. **The model wrote the closing sentence, and it was false.** "Record korechi", when
   nothing is recorded until Save.

## What to build

**The rule the owner is told, and that stays:** the Assistant drafts and a person presses
Save. "Giving it control" means more to read, more it can draft, and better questions. It
does not mean writing to the books by itself. If the owner wants a "yes" in chat to count
as Save, that is a separate decision for them, with its own session.

1. **Check every draft in code, for every model.**
   - After `normalise()`, validate the draft against the target's own create schema, after
     `resolve()` has turned names into ids.
   - Any required field that fails goes into `missingFields`.
   - The reply then becomes a question about the first one. If the model gave no
     question, generate it in code from the field's label ("Which category is this
     under?").
   - A draft is "ready" only when the schema accepts it.
   - This is the fix for "expected string, received undefined", and it makes the picker
     safe whichever model answers.
2. **A transfer between own accounts as a target.**
   - Add `transfer` to `AI_TARGETS` (label, permission, endpoint, field reference from
     `createTransferSchema`), with the form the Money transfer screen already has.
   - The prompt says when it applies: both sides are our own accounts, so there is no
     category and no counterparty.
   - `packages/shared` is shared code. Its users are the assistant screen and composer,
     `assistant-panel.tsx`, `ai-intake.service.ts` and `connections.service.ts`. Say so in
     the handover, and run `npm run build:shared`.
3. **The closing sentence comes from code, not the model.**
   - When the draft is ready: "Draft ready — check every line, then press Save. Nothing is
     recorded yet."
   - The model's own text is shown only for questions and answers.
   - Never show "recorded", "saved" or "done" before a Save has happened.
4. **Do not ask for what the form does not need.**
   - The USD rate was asked for on a BDT move.
   - Find out why. `accounts.currency` marks the foreign-spend account; it does not
     denominate the figures.
   - Ask for the rate only when the schema requires it for that account.
5. **Talking like a colleague.** The owner writes Bangla in Latin letters, mixed with
   English. The Assistant should:
   - answer in the same register;
   - ask one short question at a time;
   - say what it understood before it asks;
   - when a name matches several accounts or people, list the real choices from the
     books, not pick one.

   This is prompt work. Measure it with the bar below, not by reading the prompt.
6. **Run the quality bar** (`.assistantbar.mjs`, SESSIONS #132) on Gemini with these
   fixes.
   - Add the owner's three messages above as cases:
     - the transfer must come out as a transfer;
     - it must not ask for a USD rate;
     - it must not claim to have recorded anything.
   - Check whether a newer Gemini Pro model is in Model Garden for the project. If so,
     compare it on the bar and offer the better one.
   - Results go in SESSIONS, with examples; the owner decides from them.

## Order

1 and 3 first: they stop an unsaveable or misleading draft whichever model answers. Then
2 and 4, then 5, then 6. Reading Google Sheets/Docs from a link (step 3 of the
2026-10-01 brief) follows after.

## Added 2 Oct, after #133: Gemini 2.5 Pro is being retired this month

- **The date.** Google is retiring Gemini 2.5 Pro, Flash and Flash Lite on Agent Platform
  (Vertex AI). Its own pages say "no earlier than 16 October 2026", and the lifecycle page
  says 20 October 2026. `gemini-2.5-pro` is the only Gemini model in `AI_MODELS`, so the
  Assistant on Gemini stops working on that day unless a successor is offered first.
- **The successor.** For Pro it is Gemini 3.1 Pro. One source gives its model ID as
  `gemini-3.1-pro-preview`; confirm the exact ID in the owner's Agent Studio model list,
  or with one request, before writing it down.
- **The work.**
  - Add it to `AI_MODELS` in `packages/shared`, the same users as before.
  - Make it the Gemini default.
  - Keep `gemini-2.5-pro` selectable only until it is retired.
  - Run `.assistantbar.mjs` on the new model.
  - Check its thinking and function-calling settings against Google's own page for that
    model; do not assume they match 2.5's.
