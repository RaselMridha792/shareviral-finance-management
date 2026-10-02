-- The Assistant gets better with use: every correction kept, and a
-- correction can become one of the owner's rules
-- (docs/briefs/2026-10-02-assistant-powerful.md, piece A2b).
--
-- `ai_corrections` has held, since August, one row per field somebody changed
-- on a draft before saving it. A2b widens it to the other kind of mistake: a
-- reply the person marks "this was wrong" and says why — a count that was
-- off, a request filed under the wrong part of the app, "there is no tool for
-- that" when there was one. Either way a row is the same three things:
--
--   said        what was asked (its digits masked, as before)
--   drafted     what the Assistant gave
--   corrected   what was right
--
-- Four new columns, all additive:
--
--   kind       'field' (a draft's field changed before Save — every row so
--              far, hence the default) or 'reply' (a reply marked wrong).
--              The list lives in the code, as the lists for `target` and
--              `field` already do.
--   area       the part of the app's map the reply was in (the API's
--              `app-map.ts`). NULL on the rows from before; their `target`
--              says it.
--   model      which model gave it, so the owner can see which one errs.
--   ruled_at   when the owner made it one of their rules: a line written
--              into app_settings.ai_instructions. NULL: not a rule.
--
-- And two columns stop being required: a reply marked wrong may have drafted
-- nothing (no `target`), and is never about one field (no `field`).
--
-- The table was created by hand on the old database in August and has no
-- file here, so this one first creates it exactly as it stands, in case a
-- database lacks it: an ALTER on a missing table would stop the deploy. Where
-- the table is there, CREATE ... IF NOT EXISTS does nothing.
--
-- Defined here and nowhere else. Every statement is IF NOT EXISTS or a DROP
-- NOT NULL, so a second run changes nothing.
CREATE TABLE IF NOT EXISTS ai_corrections (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target     varchar(32) NOT NULL,
  said       text NOT NULL,
  field      varchar(64) NOT NULL,
  drafted    text,
  corrected  text,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_corrections_target_idx
  ON ai_corrections (target, created_at);

ALTER TABLE ai_corrections
  ADD COLUMN IF NOT EXISTS kind varchar(16) NOT NULL DEFAULT 'field',
  ADD COLUMN IF NOT EXISTS area varchar(32),
  ADD COLUMN IF NOT EXISTS model varchar(64),
  ADD COLUMN IF NOT EXISTS ruled_at timestamptz,
  ALTER COLUMN target DROP NOT NULL,
  ALTER COLUMN field DROP NOT NULL;
