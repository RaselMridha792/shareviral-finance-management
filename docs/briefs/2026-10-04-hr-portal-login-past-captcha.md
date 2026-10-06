# Brief — the HR portal's server signs in past the captcha, and nobody else does

**For:** one Claude session in this repository. **This is an auth change: it travels alone.**
**From:** the planning session, 4 Oct 2026, after the HR portal's session explained how it
signs in.

## What broke

The sign-in captcha went on in production at about 01:19 on 4 Oct (#154). The HR portal's
server signs in to this app like a person would:
- `POST /api/auth/login` with `{email, password}` and `x-requested-with: finance-web`;
- the email and the sealed password are in its own table `finance_settings`, set in the
  HR portal under Settings → Finance;
- it keeps **no refresh token**. The access token lives in its process memory for 14
  minutes, then it signs in again.

It sends no Turnstile token, because it cannot: there is no browser. So since the captcha
went on, every one of its sign-ins is refused with "Email or password is incorrect". That
means:
- no pay change, one-off, budget or spend reaches finance;
- no team sync.

The HR portal's Brief 9, on which #154 was built, says nothing about a server-to-server
caller. Neither did our captcha brief.

In the meantime, the owner switches the captcha **off** (removes `TURNSTILE_SECRET_KEY`,
recreates `api`) to restore the link. The captcha stays off until this ships and the HR
portal has done its half.

**State on 6 Oct 2026, 21:24:**
- The captcha is off on live.
- The HR portal signs in as **hr-portal@shareviral.cash** (role `hr`, active), and its
  Settings → Finance check says "It worked".
- Before that, the audit log showed its sign-ins refused as "(human check refused)",
  which is exactly the failure this brief removes.

When the api is recreated on the server, use
`IMAGE_TAG=$(cat .deployed) COMPOSE_PROFILES=local-db docker compose up -d --no-build api`.
A bare `up -d api` asks for `:latest`, which the deploy prunes, so compose builds a new image
on the box. That happened on 6 Oct.

## The decision (finance's)

**A shared-secret header, valid for an HR-role account only.**

1. **The header.** The HR portal sends `x-hr-secret: <the shared secret>` with its sign-in.
   - The secret is the one both servers already hold: our `HR_WEBHOOK_SECRET` and the HR
     portal's `FINANCE_WEBHOOK_SECRET` (#128).
   - No new key goes between them, and the owner handles nothing new.
2. **What it skips.** In `captcha.service.ts` / the login path: when Turnstile is on and
   the header is present and equal to `HR_WEBHOOK_SECRET`, the Turnstile check is skipped.
   - Compare it in constant time (`timingSafeEqual` on equal-length buffers).
   - If `HR_WEBHOOK_SECRET` is unset, no header is accepted.
   - Never log the header, or anything derived from it.
3. **Who may use it.** The password check runs as normal. If the account that
   authenticates is **not role `hr`**, refuse it with the same sentence as a wrong
   password, and count it like one.
   - A leaked secret then opens no captcha-free door to a Super Admin or CFO account.
   - A missing or wrong header: everything as today. The captcha is required, and the
     same sentence refuses.
4. **Lockout and second factor stay.** Five wrong passwords still lock the HR account.
   - The HR account has no second factor. If one is ever set up on it, the portal cannot
     answer it, so say so in STATUS.md.
5. **Audit.** A sign-in through the header is audited as an ordinary login. Add one
   word, e.g. "server, past the captcha", so the owner can see which sign-ins skipped it.

## What to measure

1. **Turnstile on (a test secret).** A sign-in with the right header and the HR account's
   password works with no token.
2. **The same header with a Super Admin's password:** refused, the ordinary sentence.
3. **No header, or a wrong one, with the HR account:** refused without a token, as
   today.
4. **Turnstile off:** everything as before. Run `.loginqa.mjs`, `.sessionqa.mjs` and
   `.captchaqa.mjs`, plus the four CI steps.
5. **On live, after the deploy,** with the HR portal's half also live and the captcha
   back on:
   - the HR portal's Settings → Finance check is green;
   - one request sent from the HR portal arrives in HR Requests;
   - a person still sees the captcha.

## The HR portal's half (for the owner to paste to its session)

> On its finance sign-in (`POST /api/auth/login`), the HR portal must also send the
> header `x-hr-secret` with the value of its `FINANCE_WEBHOOK_SECRET`, on every sign-in.
> Finance accepts it only for an HR-role account, and only when it matches finance's own
> copy of the same secret. Do not log the header. Nothing else changes: the same email,
> password, endpoint and CSRF header.
