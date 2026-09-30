-- The look of the app, chosen in Settings -> Appearance (#124).
--
-- The owner, 30 Sep 2026: "ami amader applications er color and fonts gulake
-- setting theke dynamic vabe control korbo".
--
-- Two nullable columns, and NULL is the point: it means "the design as the
-- stylesheet draws it", not a stored copy of it. A copy would go stale the
-- first time a colour is retuned in globals.css, and "Reset to the design"
-- would then put back last month's palette. Additive and nullable, so every
-- existing row already means nobody has changed anything.
--
--   theme       { light: {token: "#rrggbb", ...}, dark: {...} }
--   typography  { heading: {font, weight, size}, body: {...}, button: {...} }
--
-- Both are validated by the API on the way in and again on the way out (an
-- unreadable value is read as NULL), because they are written into a <style>
-- block on every signed-in page.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS theme jsonb,
  ADD COLUMN IF NOT EXISTS typography jsonb;
