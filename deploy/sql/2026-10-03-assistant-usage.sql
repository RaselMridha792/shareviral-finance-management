-- What the Assistant spends: one row per call to a model, and an optional
-- monthly limit (docs/briefs/2026-10-02-assistant-powerful.md, piece B3).
--
-- The owner's decision of 2 Oct 2026: "Tokens: a report and an optional
-- monthly limit." The report reads ai_usage by day, month, person and model,
-- with a cost estimated from a price table in the code. It is labelled an
-- estimate, because the invoice from Anthropic or Google is the real figure.
--
-- ai_usage, one row per call that came back with a count:
--
--   user_id             who asked. SET NULL when the person is deleted: what
--                       was spent stays spent.
--   chat_id             the conversation, when there is one. SET NULL when
--                       the chat is deleted, for the same reason, and so that
--                       deleting a chat never lowers the month's total under
--                       its limit. NULL too for a key's Test.
--   provider            the way it went: 'anthropic' (the Anthropic key) or
--                       'vertex' (Google Cloud), as app_settings.ai_provider
--                       names them. Gemini is always 'vertex'.
--   model               as the app names it ("claude-opus-5",
--                       "gemini-3.8-flash"). No CHECK, as with ai_model: the
--                       list changes when a model is retired, and a row about
--                       a retired model is still true.
--   kind                'turn' (one round of a conversation), 'document' (a
--                       PDF read into a statement) or 'test' (a key's Test
--                       button). The list is the code's.
--   input_tokens        input charged at the full rate. Cached input is not
--                       in it: Gemini counts it inside its prompt figure, and
--                       the code takes it out before writing this.
--   cache_read_tokens   input read back from the cache, about a tenth of the
--                       price.
--   cache_write_tokens  input written to Claude's cache, about a quarter more
--                       than the full rate. Gemini's cache is Google's own,
--                       and writes nothing here.
--   output_tokens       what the model wrote. Claude counts its thinking in
--                       this figure.
--   thinking_tokens     what Gemini spent thinking, which Google counts apart
--                       and bills as output. NULL where the model gives no
--                       separate figure (Claude), which is not the same as 0.
--   created_at          when. The month is Dhaka's.
--
-- No cost column. The estimate is worked out when the report is read, from
-- the tokens and the price table, so a price corrected in the code corrects
-- every month at once. A stored figure would keep the mistake.
--
-- app_settings.ai_monthly_limit_usd: the owner's answers, 3 Oct 2026. The
-- limit is in dollars of estimated cost, not in tokens, because a million
-- tokens on Opus and on Gemini Flash are very different money. And it is one
-- limit for the company, not one per person. NULL: no limit, which is how it
-- starts. Above 80% the Assistant warns; at 100% it stops and says who can
-- raise it. Whether a figure is acceptable (more than zero) is the API's
-- check, as the size of ai_instructions is.
--
-- Defined here and nowhere else; IF NOT EXISTS throughout, so a second run
-- changes nothing.
CREATE TABLE IF NOT EXISTS ai_usage (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES users(id) ON DELETE SET NULL,
  chat_id            uuid REFERENCES ai_chats(id) ON DELETE SET NULL,
  provider           text NOT NULL,
  model              text NOT NULL,
  kind               text NOT NULL DEFAULT 'turn',
  input_tokens       integer NOT NULL DEFAULT 0,
  cache_read_tokens  integer NOT NULL DEFAULT 0,
  cache_write_tokens integer NOT NULL DEFAULT 0,
  output_tokens      integer NOT NULL DEFAULT 0,
  thinking_tokens    integer,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- The month's total, read before every turn once a limit is set.
CREATE INDEX IF NOT EXISTS ai_usage_created_idx
  ON ai_usage (created_at);

-- The report by person.
CREATE INDEX IF NOT EXISTS ai_usage_user_idx
  ON ai_usage (user_id, created_at);

-- So that deleting a chat finds its rows without reading the whole table.
CREATE INDEX IF NOT EXISTS ai_usage_chat_idx
  ON ai_usage (chat_id);

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS ai_monthly_limit_usd numeric(10, 2);
