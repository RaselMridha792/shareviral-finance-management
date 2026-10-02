-- "Instructions for the Assistant": the owner's own rules, kept in the
-- database (docs/briefs/2026-10-02-assistant-powerful.md, piece A2).
--
-- The owner, 2 Oct 2026: "dorkar hole or jonne instructions set ready kore
-- rakho oke training dewar jonne". A model cannot be trained by us; what it
-- knows about this company is what the app puts in front of it. This is the
-- part of that the owner writes: plain text, one rule a line, in their own
-- words. It is placed in the Assistant's prompt after the map of the app, and
-- edited under the Assistant's settings by a Super Admin.
--
-- Three columns on the settings row, additive, so the row that exists already
-- means "no rules of the owner's yet":
--
--   ai_instructions          the text. Empty is a real answer: no rules.
--   ai_instructions_set_at   when it was last saved, and
--   ai_instructions_set_by   by whom. NULL means nobody has saved it yet.
--
-- The size limit is the API's, not a CHECK here: it is a limit on what one
-- request may carry, and a database that refused a longer text would turn a
-- raised limit into a second migration.
--
-- Defined here and nowhere else; ADD COLUMN IF NOT EXISTS, so a second run
-- changes nothing.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS ai_instructions text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_instructions_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_instructions_set_by uuid;

-- The owner's first rule, decided 2 Oct 2026, as the first instruction set:
-- anything called a subscription belongs to Ai Tools and Subscriptions.
--
-- Written only where nobody has saved a set yet (set_at IS NULL) and the text
-- is still empty, so a second run does not put it back after the owner has
-- changed or cleared it.
UPDATE app_settings
   SET ai_instructions =
         'Anything called a subscription belongs to Ai Tools and Subscriptions: software, AI tools, hosting and servers, and domains. Record it as a plan there, never as a plain payment.'
         || E'\n'
         || 'Claude, ChatGPT, Gemini kena = Ai Tools and Subscriptions.'
 WHERE id = 1
   AND ai_instructions = ''
   AND ai_instructions_set_at IS NULL;
