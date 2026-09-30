-- A fifth notification switch: a budget or a spend has arrived from the HR
-- portal (#122).
--
-- The owner, 30 Sep 2026: "Hr budget a kono request asle setao jate
-- notifications jay oi option ta rakho ekhane" — on the Settings ->
-- Notifications screen, beside the other three.
--
-- On by default, like the three it sits with: a request nobody is told about
-- waits until somebody happens to open the page.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS notify_hr_budget boolean NOT NULL DEFAULT true;
