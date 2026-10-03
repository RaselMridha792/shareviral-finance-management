# Brief — the Assistant asks about every field at once; then B3, what it spends

**For:** one Claude session, two pieces in this order, each its own commit and push.
**From:** the planning session, 4 Oct 2026, from the owner's words and a screenshot.
Read SESSIONS #134–#154 and `2026-10-02-assistant-powerful.md` first.

---

## Piece 1. Every field asked, in one message

**What the owner saw on the live site.** They had the Assistant buy a Claude
subscription. The plan was saved, but AI tools and subscriptions shows **N/A** for:
- Invoice;
- Reference;
- Login accounts;
- User name;
- User department.

The Assistant never asked about any of them:

> "onekgula field se faka rekheche and oi somporke amakeo jigges korenai. eta thik korte
> hobe jate sobgula field somporke ekebarei jigges kore ney"

**Why.** The prompt asks only for what the schema requires, and since #133 it asks one
question at a time. The subscription form's optional fields (`packages/shared/src/
subscriptions.ts`) never come up:
- `loginEmail`;
- `users` (a team member, whose department the page shows);
- `invoiceNo`;
- `reference`;
- `boughtFor`, `websiteUrl`, `notes`.

**What to build:**
1. **"Worth asking" fields, per form, in the app map.**
   - The map (`app-map.ts` beside each module) says, for each form, which optional
     fields the page shows and the owner expects filled.
   - Start with the subscription plan: login account, users, invoice number, reference.
   - Then the other forms the Assistant drafts. Read each page to see which empty column
     reads as "N/A".
2. **One message, all of it** (the owner's words: "ekebarei").
   - When the required fields are known, the reply lists what is still open, required
     first, then worth asking, as a short list.
   - The person answers all of it in one go. "skip" or "nai" for a field leaves it empty
     **on purpose**, and it is not asked again.
   - This replaces "one question at a time" **for this list only**. A question about a
     choice among real names (two accounts called alike) is still asked on its own.
3. **The draft card shows the whole form**, the empty worth-asking fields included, so
   they can be filled on the card before Confirm. Today it shows only what the model
   filled.
4. **An invoice attached in the chat** (a PDF or an image) becomes the plan's invoice file
   on Confirm, as the page's own upload does (the files module). Its number goes in
   `invoiceNo` when it can be read; when it cannot, ask.
5. **Measure.**
   - A harness with the stand-in model on the real page: a subscription draft whose
     reply lists the four, an answer that fills them, the card showing them, Confirm,
     and the page with no N/A in those columns.
   - "skip" on one leaves only that one empty.
   - Add the owner's case to `.assistantbar.mjs` for the live model.
   - **For the owner, on live:** the exact messages, and what should come back.

**Done: SESSIONS #155.** The owner's answers that session: shared code
approved for both pieces, and Confirm stays off until each field is
answered or left empty on purpose.

---

## Piece 2. B3, the code: what it spends

The schema went out alone in #152 (`ai_usage`, `app_settings.ai_monthly_limit_usd`).
Everything the B3 section of `2026-10-02-assistant-powerful.md` asks for is still to
build:
- **One row per model call**: who, which chat, provider, model, input, output and
  thinking tokens, when. That covers Claude and Gemini, the turn loop and the PDF reading.
- **A price table in code**, per model.
  - Anthropic's prices are in the claude-api skill. Gemini's come from Google's own
    pricing page, read when this is built, not guessed (#152).
  - Gemini 3.8 Flash's price changes on 1 Jan 2027: keep both, with dates.
  - Label every figure as an **estimate**; the invoice is the real figure.
- **The report**, in the Assistant's settings (the gear, B2): by day, month, person and
  model. The CFO reads it (B2's rule).
- **The usage panel on the right of the chat**: this month's tokens, the estimated cost,
  the limit and how much of it is used. It can be collapsed, and sits behind a button on
  a phone.
- **The monthly limit**, in dollars, one for the company, set by the Super Admin.
  - A warning at 80%.
  - At 100% the Assistant stops, with a sentence saying so and who can raise the limit.
  - No limit set means none.
- **Measure.** Rows written for each kind of call with the stand-in model. The report's
  sums checked against the rows, in SQL. The panel on the page at 1440px and 390px. The
  limit's warning and its stop.

**Done: SESSIONS #156.** Prices read from Anthropic's and Google's pages on
4 Oct 2026 (the Global endpoint for Google), in `ai-intake/ai-prices.ts`.

## Order

Piece 1 first: it is what the owner saw go wrong. Then piece 2. Each piece is its own
commit and push, with a SESSIONS entry and the owner's live steps. Before pushing, check
with the owner that no other session's push is in flight: one deploy at a time.
