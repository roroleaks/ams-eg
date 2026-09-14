# Manual test: magic-link sign-in with a real throwaway account

Run against the dev app (local, preview, or staging) — never production with a
real address. This exercises the real Supabase magic-link flow end-to-end,
including the email, since automated tests mock the auth provider.

## Prerequisites

- The environment must point at the real Supabase project
  (`mipbeciycmefyjiverid` — same as production) so the magic link resolves.
- A throwaway Gmail address you can read (e.g. `youraccount+amscheck1@gmail.com`).
  Using a `+tag` of an account you already own avoids creating a new identity.

## Steps

1. In a private browser window, open `/auth`. Confirm:
   - "We'll email you a secure sign-in link — no password needed." copy.
   - No mention of a 6-digit code and no password field.
   - Google sign-in still present ("Continue with Google").
2. Submit the throwaway address. Confirm you land on "Check your email" with a
   masked address (`y***m@gmail.com`), a resend cooldown, and "Use a different
   email".
3. Open the email and click the magic link in the same browser. Confirm you are
   taken into the app directly (no signup/interstitial, no new account asked).
4. Reload the app / close and reopen the tab. Confirm you are still signed in
   and never asked to sign up or request another link.
5. Visit `/auth` while signed in. Confirm the "Already signed in" card shows the
   masked email, "Continue to application" returns to the app, and "Sign out
   and use another account" signs you out first and then shows the login form.
6. After sign-out, press Back. Confirm you cannot reach protected content and
   are returned to the login screen.
7. Wait for the session to expire (or use another account) and open a stale
   magic link. Confirm a graceful "expired or already used" recovery message is
   shown and the login form is still reachable.

## Notes

- Magic links sent to other devices are expected to fail: email deliverability
  into the new domain plus the one-time nature of the link means the same-browser
  flow above is the supported path. (Providers require email template /
  redirect-URL configuration to allow cross-app-invite flows; that is a
  separate feature request.)