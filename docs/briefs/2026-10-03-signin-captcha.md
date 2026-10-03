# Brief — Cloudflare Turnstile on the sign-in page

**For:** the Claude sessions that build it.
**From:** the planning session, 3 Oct 2026. The owner asked for the same Cloudflare
verification the HR portal has had on its sign-in since 26 Sep. The HR session wrote down
how theirs is built (its "Brief 9", pasted to this session). What follows is that shape,
fitted to this repository.

This is not an integration with the HR portal. The finance app gets **its own widget, its
own pair of keys, and its own `siteverify` call**.

## Why it was not here before

The September handoff draws a Turnstile box on the sign-in page. #90 left it out: *"a box
saying 'you are verified' with nothing behind it is a lie on the one page about security.
Real Turnstile needs keys and a server check: an auth change, its own session."* This is
that session. **Put the widget where the handoff draws the box**, at the handoff's size
(the zip at the repository root is the spec).

## Where the walls already are

- **A lockout:** five wrong passwords, then five minutes (`auth.service.ts`).
- **A second factor**, for whoever has turned it on (`two-factor.service.ts`,
  `challenge.service.ts`).
- **One sentence for every refusal:** "Email or password is incorrect"
  (`auth.service.ts`).
- **No throttler on the API.**

Turnstile becomes the wall in front of all of them, on the password step only. It does not
go on the second-factor step: whoever reaches that step has already passed the captcha.

## The decisions — the HR portal's, kept, and each with its reason

1. **Off unless the secret is set.** With no keys the app behaves exactly as it does
   today. Every harness and every local sign-in posts a password and has no token, and
   the owner must not be locked out of their own app before the keys are in place.
   - **Once the secret is set, a missing or malformed token is refused.**
     Off-by-configuration must never become off-by-accident.
   - One getter (`enabled` = the secret is set) decides it, and nothing else in the
     sign-in path knows.
2. **Fails closed.** If `siteverify` times out (**5 s**) or throws, the sign-in is
   refused. For a payroll app, an open door while Cloudflare is down is not a trade
   worth making. The way out is to take the secret off the environment and recreate the
   api container (below).
3. **The same sentence as a wrong password:** "Email or password is incorrect", whatever
   the cause — a bad token, no token, or Cloudflare unreachable.
4. **A refused captcha does not count against the account's lockout.** This one is ours,
   not the HR portal's.
   - The captcha is checked **before** the password is looked at, so a refusal there
     says nothing about the password.
   - If it counted, anybody could lock out any account by posting its email five times
     without a token.
   - Prove it: five refused captchas, then the right password and a good token, signs
     in.
5. **The site key is read at request time, never baked into the bundle.**
   - The web image is built in GitHub Actions, and every `NEXT_PUBLIC_*` value is inlined
     at that point (`docker-compose.yml` says so beside `NEXT_PUBLIC_API_URL`).
   - So use `TURNSTILE_SITE_KEY`, not `NEXT_PUBLIC_`. `app/login/page.tsx` is already a
     server component (`dynamic = "force-dynamic"`): read it there and hand it to
     `LoginForm` as a prop.
   - No site key: no widget, and no empty box either.
6. **The widget is reset after every refused sign-in** (`turnstile.reset(id)`). A token
   is single-use and lasts about five minutes. Without the reset, a second attempt sends
   a spent token and the right password is refused, which reads as "my password stopped
   working".

## Where it goes

| | |
|---|---|
| `apps/api/src/config/env.ts` | `TURNSTILE_SECRET_KEY` (optional), plus `TURNSTILE_VERIFY_URL` (optional, defaulting to Cloudflare's), so the "unreachable" case can be tested. A key not declared here is dropped from a local `.env` |
| `apps/api/src/modules/auth/captcha.service.ts` | new: `enabled`, and `verify(token, ip)` against `siteverify`, 5 s timeout, fails closed. Never logs the secret |
| `auth.controller.ts` / `auth.service.ts` | the captcha before the password, and outside the lockout count (decision 4) |
| the shared login body | `captchaToken`, optional, at most 2048 characters. `packages/shared` is shared code: only the login form and the auth module read this schema; say so in the handover, and run `npm run build:shared` |
| `apps/web/src/app/login/page.tsx` | reads `process.env.TURNSTILE_SITE_KEY` |
| `apps/web/src/components/auth/login-form.tsx` + a small Turnstile component | renders the widget when there is a key, sends the token, resets it after a refusal |
| `deploy/docker-compose.yml` | **names** `TURNSTILE_SITE_KEY` on `web` and `TURNSTILE_SECRET_KEY` on `api`. A variable not named under `environment:` never reaches the container. Empty means off |
| `deploy/.env.example`, STATUS.md | the two keys, and how to switch it off |

`nginx` sets no Content-Security-Policy, only `X-Frame-Options SAMEORIGIN` on our own
pages. Cloudflare's script and frame load as they are.

## Two pushes, each alone

1. **Deploy configuration:** `docker-compose.yml` and `.env.example`. Harmless alone,
   because nothing reads the variables yet.
2. **The auth change:** everything else. It is off until the owner sets the keys, so it
   changes nothing live on the day it ships.

## What to measure (reading the diff proves none of it)

1. **No keys:** every harness still signs in. Run `.rolecheck.mjs`, the four CI steps, and
   one Assistant harness.
2. **Secret set locally, with a test secret:** a sign-in with no token is refused with
   "Email or password is incorrect".
3. Five refused captchas do **not** lock the account (decision 4).
4. **Verify URL pointed at a dead address:** refused, within about 5 s, not allowed.
5. **On the live site, by the owner, after the keys are in, in a real browser:**
   - the widget appears where the handoff draws it;
   - the right password signs in;
   - **a wrong password, then the right one, without reloading**, signs in. That is the
     reset.
   - Cloudflare publishes test keys that always pass or always fail. Use those locally
     for the browser check, never the owner's real secret.

## For the owner — the keys (after push 2 is live)

1. Go to **dash.cloudflare.com → Turnstile → Add widget**. Name it `SFM finance
   sign-in`, mode **Managed**.
2. Hostnames:
   - `app.hellonizam.com`;
   - `localhost` and `127.0.0.1`.

   **A separate widget from the HR portal's,** so one revoked key cannot stop both
   sign-ins.
3. Put both keys into the server, from the server terminal, without them being shown or
   kept in the shell's history:
   ```
   cd /opt/sfm/deploy && read -rp "Site key: " K && echo "TURNSTILE_SITE_KEY=$K" >> .env && read -rsp "Secret key: " S && echo && echo "TURNSTILE_SECRET_KEY=$S" >> .env && unset K S
   COMPOSE_PROFILES=local-db docker compose up -d api web
   ```
   The secret key goes nowhere else: not into a chat, a commit or a screenshot.
4. **Switching it off,** if Cloudflare is down and nobody can sign in: delete the
   `TURNSTILE_SECRET_KEY` line from `/opt/sfm/deploy/.env`, then
   `COMPOSE_PROFILES=local-db docker compose up -d api`.
