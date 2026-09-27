# FayTarra authentication emails

These files are what Supabase Auth should send. **They are not read by the
running app** — Supabase renders email templates from its own dashboard, so
these are the source of truth to paste in, and the thing to re-paste after any
change.

Rebuild them from `src/lib/email/` with:

```bash
npm run email:build            # writes the .html and .txt files here
npm run email:build preview    # also writes preview.html — open it in a browser
```

Nothing in this folder contains a credential, a key or a token, and nothing
should ever be added here that does.

---

## 1. Paste the templates in

**Dashboard → Authentication → Emails** (older projects: *Authentication →
Email Templates*). Each template has a **Subject** field and a **Message body**
box. Switch the body to source/HTML, replace the contents entirely, and save.

| File | Template in the dashboard | Subject to set |
|---|---|---|
| `confirm-signup.html` | Confirm signup | `Confirm your email address` |
| `reset-password.html` | Reset password | `Reset your FayTarra password` |
| `change-email.html` | Change email address | `Confirm your new email address` |
| `magic-link.html` | Magic Link | `Your FayTarra sign-in link` |
| `invite.html` | Invite user | `You have been invited to FayTarra` |
| `reauthentication.html` | Reauthentication | `Your FayTarra confirmation code` |

`subjects.json` holds the same subject lines in one place.

**Confirm signup is also what "send verification email again" sends** — resend
reuses that template, so there is nothing separate to configure for it.

The `.txt` files are the plain-text alternatives. Supabase's dashboard has one
body box per template and sends HTML, so there is nowhere to paste these in the
default setup; they matter if you move to a provider (or an Auth Hook) that
sends `multipart/alternative`. They are kept in step either way.

FayTarra does not use magic links or invites. They are branded anyway so that
no path can fall back to Supabase's unbranded default.

### ⚠️ The admin code must be 6 digits — set Email OTP Length

**Authentication → Providers → Email** (newer dashboards: *Authentication →
Sign In / Providers → Email*) has an **Email OTP Length** field. Supabase
allows 6 to 10; set it to **6**. Self-hosted, the same setting is
`GOTRUE_MAILER_OTP_LENGTH=6`.

This is the only thing that decides how long the code is. GoTrue generates it
and renders it into `{{ .Token }}`, so a project set to 8 mails eight digits
and nothing in this repository can change that. Projects created more recently
default to **8**, which is why this needs setting rather than checking.

If the dashboard field is hard to find, set it through the Management API
instead — same setting, no hunting:

```bash
# what is it now?
SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=<ref> \
  node scripts/supabase-otp-length.mjs

# set it to six, and read it back to confirm
SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=<ref> \
  node scripts/supabase-otp-length.mjs --set 6
```

The access token comes from https://supabase.com/dashboard/account/tokens and
the project ref is the subdomain of your project URL. The script reads the
value back after writing it, because a PATCH that is accepted and silently
ignored looks exactly like one that worked.

FayTarra will not pretend otherwise. An eight-digit code is refused with
"FayTarra admin codes are 6 digits. That one has 8." — **not** trimmed to its
first six. Truncating would throw away two digits of entropy, a hundredth of
the search space, which is the opposite of what a second factor is for. The
refusal costs no verification attempt, so a mismatched project setting cannot
lock the admin out; it just will not let them in until the length agrees.

It also changes nothing for normal users: signup, password reset and email
change all use links, not codes.

### ⚠️ If the admin code email arrives as a "sign-in link"

Then the dashboard still holds an older **Magic Link** body. Nothing in the
app can fix that: Supabase renders email templates from its own dashboard, so
whatever is pasted there is what gets sent, for as long as nobody re-pastes.

Paste `magic-link.html` again and set its subject to
`Your FayTarra admin verification code`.

**To tell which version is in there**, look at the second line of the body in
the dashboard editor, or at the source of a received email:

```html
<!-- faytarra-template: magic-link (code) — regenerate with: npm run email:build -->
```

`(code)` is the admin verification code. Anything else, or no marker at all,
is an older template. Every generated file carries one.

The admin step-up is the only thing that uses Magic Link — FayTarra signs
everybody else in with a password — so this template can be replaced without
affecting any other flow.

### What is in them

Supabase's own variables, untouched: `{{ .TokenHash }}` and `{{ .SiteURL }}`
in the link templates, `{{ .Token }}` in Reauthentication, and `{{ .Email }}` /
`{{ .NewEmail }}` in Change email address. **No verification tokens are
generated by FayTarra** — Supabase mints, sends and validates every one.

### ⚠️ Why these links are NOT `{{ .ConfirmationURL }}` — re-paste required

If you pasted an earlier version of these templates, **paste them again**.
The action links changed shape, and that change is the fix for accounts being
asked to verify an email they had already verified.

`{{ .ConfirmationURL }}` sends the reader to Supabase's `/auth/v1/verify`,
which bounces back to the app carrying a **PKCE `code`**. Exchanging that code
requires the code-verifier cookie written in *the browser that signed up* —
`@supabase/ssr` pins the client to the PKCE flow, so the app cannot opt out.
Open the email on your phone, or in a mail app's in-app browser, or after the
cookie has expired, and the exchange fails on a link that was perfectly valid.

The templates now link to:

```
{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=signup&next=/home
```

`/auth/callback` hands the hash straight back to Supabase with `verifyOtp`,
server-side. That one call both confirms the address and returns the session,
and it needs nothing from the browser — so the link works from any device.
This is Supabase's own documented pattern for server-rendered apps.

`type` differs per template and **must not be edited**: `signup`, `recovery`,
`email_change`, `magiclink`, `invite`. `/auth/callback` still accepts the old
`?code=` links, so anything already sitting in an inbox keeps working.

The design is deliberately image-free. The FayTarra mark is drawn with table
cells in the brand's own gradient stops (`#7C5CFF`, `#FF3D9A`, `#FFB443`)
rather than linked as a PNG, because most clients block remote images until the
reader asks for them — a logo that only appears on the second look is worse
than one built from colour. Layout is tables, styles are inline, and the button
carries a VML fallback so Outlook for Windows draws it properly.

---

## 2. Point the links at faytarra.com

This is what decides whether a confirmation link goes to production or to
localhost, and it is **not** set by anything in this repository.

**Dashboard → Authentication → URL Configuration**

- **Site URL**: `https://faytarra.com`
- **Redirect URLs** (allow list) — add:
  - `https://faytarra.com/auth/callback`
  - `https://faytarra.com/**`
  - plus any preview domain you actually use, e.g. `https://*.vercel.app/**`

**Site URL is what the templates interpolate as `{{ .SiteURL }}`**, so a
project still set to `http://localhost:3000` mails localhost links no matter
what the app does. That is the single most common cause of "the confirmation
link goes to localhost".

The Redirect URLs list still matters for the `?code=` links already in
inboxes, and for anything else that uses `redirectTo`. The new token-hash
links do not pass through Supabase's redirector at all, so they are unaffected
by it.

On the app side, set on the deployment:

```
NEXT_PUBLIC_SITE_URL=https://faytarra.com
```

That is what `siteUrl()` uses to build `emailRedirectTo` and `redirectTo`. In
production without it, the app logs a warning and would fall back to localhost.

---

## 3. Sender address: custom SMTP is required

**Until this is done, mail does not come from FayTarra.** Supabase's built-in
email service sends from a Supabase address (`noreply@mail.app.supabase.io`),
cannot be renamed, and is rate-limited to a handful of messages per hour —
Supabase documents it as being for development only. The templates above will
look like FayTarra; the `From:` line will not, and signups will start silently
failing to receive anything once the built-in quota is hit.

To send as `FayTarra <no-reply@faytarra.com>`:

1. Create an account with an email provider that offers SMTP — Resend, Postmark,
   SendGrid, Mailgun, Amazon SES and Brevo all work.
2. Verify `faytarra.com` as a sending domain there, and add the DNS records it
   gives you (section 4).
3. **Dashboard → Project Settings → Authentication → SMTP Settings** (newer
   dashboards: *Authentication → Emails → SMTP Settings*). Enable custom SMTP
   and fill in:

   | Field | Value |
   |---|---|
   | Sender email | `no-reply@faytarra.com` |
   | Sender name | `FayTarra` |
   | Host | your provider's SMTP host, e.g. `smtp.resend.com` |
   | Port | `587` (STARTTLS) or `465` (implicit TLS) |
   | Username | from the provider |
   | Password | the provider's SMTP key — **only ever pasted into the dashboard** |
   | Minimum interval between emails | `60` seconds is a sane start |

4. **Dashboard → Authentication → Rate Limits** → raise *Rate limit for sending
   emails* from the built-in default to something your provider can carry.

The SMTP password is a secret. It belongs in the Supabase dashboard and nowhere
else — not in this repository, not in `.env`, not in the app. FayTarra's code
never sends email and never needs it.

---

## 4. DNS records

Required, at whoever hosts DNS for `faytarra.com`. Your provider generates the
exact values — these are the shapes, not values to copy.

| Type | Host | Purpose |
|---|---|---|
| TXT | `@` | **SPF** — authorises the provider to send as faytarra.com, e.g. `v=spf1 include:_spf.resend.com ~all`. If a TXT SPF record already exists, **add the include to it**; two SPF records is itself a failure. |
| TXT or CNAME | provider-specific, e.g. `resend._domainkey` | **DKIM** — signs the mail. Usually one to three records. |
| TXT | `_dmarc` | **DMARC** — start at `v=DMARC1; p=none; rua=mailto:dmarc@faytarra.com`, tighten to `p=quarantine` once reports look clean. |
| CNAME | provider-specific | **Return-path / bounce domain**, if your provider asks for one. Improves deliverability and alignment. |

No MX record is needed to *send*. One is only needed if `faytarra.com` should
also *receive* mail.

Without SPF and DKIM, Gmail and Outlook will put verification emails in spam or
reject them outright, and new accounts will look broken.

---

## 5. Checklist

- [ ] Six templates pasted, with their subject lines
- [ ] Site URL is `https://faytarra.com`
- [ ] Redirect URLs include `https://faytarra.com/auth/callback`
- [ ] `NEXT_PUBLIC_SITE_URL=https://faytarra.com` on the deployment
- [ ] Custom SMTP enabled, sender `FayTarra <no-reply@faytarra.com>`
- [ ] SPF, DKIM and DMARC published and verified with the provider
- [ ] Email rate limit raised from the built-in default
- [ ] Signed up with a real address and received a branded email that verifies
- [ ] Opened that email **on a different device** and confirmed it still works
- [ ] Logged in afterwards with the same email and password, without being sent
      back to the verification page
- [ ] Reset a password end to end with a real address
