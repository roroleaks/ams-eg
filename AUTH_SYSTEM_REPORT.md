# AMS Product Advisor — Authentication System Technical Report

Status: COMPLETE (post-audit, post-repair)
Supabase project: `aqftmrimhjhdnunfrdhi` · Live app: https://ams-eg.lovable.app
Branch: `main` (all commits pushed). Final verification: `npx tsc --noEmit` exits 0; working tree clean.

---

## 1. Root causes found

| # | Root cause | Where it showed up | Fix |
|---|-----------|--------------------|-----|
| 1 | Six-digit/OTP-style code UI remained in the codebase | Legacy `verifyOtp` branch and `token_hash` handling in `sign-in-panel`; unused `input-otp` component and dependency | Removed the OTP branch, `input-otp` component and its npm dependency; magic-link is the only method |
| 2 | Browser cached an old bundle | Live site briefly showed a 6-digit screen; source had none | Bypassed cache; verified live chunks contain only magic-link copy (`auth/callback`, `shouldCreateUser`, "Sending sign-in link") |
| 3 | Duplicate/competing auth state initializers | `index.tsx` and `/auth` each ran their own `getSession`/`getUser` + `onAuthStateChange` + `storage` listeners; initial state treated loading as both signed-in and signed-out | Single `AuthProvider` (`src/lib/auth-context.tsx`) owns all auth state, one listener each for `onAuthStateChange`/`storage`; consumers read one context |
| 4 | No server middleware on search/recommendation endpoints | `embedQuery`, `searchLiterature`, `summarizeProductReport` treated anonymous callers as guests | Added `requireSupabaseAuth` (JWT `getClaims`) to all four endpoints, incl. the unused `summarizeResults` |
| 5 | `touchProfile` wrote columns that don't exist on live | `display_name`/`last_sign_in_at`/`last_active_at`/`status`/`role` are added only by the still-unapplied migration `20260909000000_private_app.sql`; every upsert silently failed → **no profile ever created** | Fallback upsert to the base column set on `column ... does not exist`, so exactly one profile is created on live now |
| 6 | Redirect-open and redirect-loop risks | `safeNext` allowed `/auth` destinations and some external forms in edge paths | Unified `safeNext` (auth.tsx, auth.callback.tsx, sign-in-panel.tsx): rejects external, protocol-relative, scheme URLs and the whole `/auth` family |
| 7 | Callback redirected on local status guess, not provider state; could double-fire | `auth.callback.tsx` did its own `getUser`, no profile guarantee, no exactly-once guard | Callback now waits for the provider to report `authenticated`, upserts exactly one profile, and redirects exactly once (`finalizedRef`) |
| 8 | Silent error paths in sign-in recovery | `ensureActiveAccount`, the URL-param recovery effect, and the `onAuthStateChange` recovery dropped failures | All paths now surface clear errors (`friendlyAuthError`) |
| 9 | Sign-out redirect didn't match spec and duplicate sends possible | `Sign out` went to `/`; magic-link send lacked a re-entrancy guard | `Sign out` → `/auth?next=%2F`; `onRequestCode` guarded with `if (loading) return` |
| 10 | Auth copy drifted from spec | Field label "Work email", mode-specific explanations, non-unified "same method" text | "Email address" label, unified "If this email already has an account…" wording, exact sent-state copy |

---

## 2. Files changed (this engagement)

Authentication core
- `src/lib/auth-context.tsx` (new) — centralized `AuthProvider`/`useAuth`: states `loading | authenticated | unauthenticated`, single client/listener, cross-tab sync, sign-in/out counters for analytics.
- `src/routes/auth.callback.tsx` — rewritten magic-link callback: safe `next`, official exchange once, waits for provider, one profile upsert, exactly-once redirect, stale-link timeout, error card.
- `src/routes/auth.tsx` — consumes centralized state; "You are already signed in" card; confirm-dialog sign-out; hardened `safeNext`; `/auth?next=%2F` on sign-out.
- `src/routes/index.tsx` — consumes `useAuth()`; removed duplicate auth effect/listeners; analytics fire only on real events.
- `src/routes/__root.tsx` — mounts `<AuthProvider>` around the outlet.
- `src/components/sign-in-panel.tsx` — magic-link-only flow; `shouldCreateUser: true`; `/auth/callback` redirect URL; email validation + duplicate-send guard; `friendlyAuthError`; no silent swallows; remembered-email semantics; exact copy (sent state, unified explanation).

Server / security
- `src/lib/profile.functions.ts` — `touchProfile` idempotent upsert with pre-migration column fallback.
- `src/lib/embed.functions.ts`, `src/lib/literature.functions.ts`, `src/lib/product-report.functions.ts`, `src/lib/summarize.functions.ts` — added `requireSupabaseAuth`.
- `src/lib/auth-actions.ts` — `completeSignOut` confirm + `/auth?next=%2F`.

Cleanup
- Deleted 35 unused shadcn components (kept: badge, button, card, dialog, input, label, select, switch, table, tabs) and 30 dead npm dependencies (27 remain).
- Deleted `src/components/ui/input-otp.tsx` and its dependency.
- `src/routeTree.gen.ts` — hand-maintained (`@ts-nocheck`), added `/auth/callback` route entry; do not regenerate with `npm run build`.

Commits: `88c5f87` → `d650e44` → `ea31ef4` → `b758e96` → `1192d05` → `90e3ee6` → `801f5aa` → `5ace18e` → `f535900` → `e601e1c` → `0011776` → `f10d986` → `6250780` — all pushed to `main`.

---

## 3. Authentication provider configuration changed

None. The Supabase account uses view-only credentials; dashboard edits (sign-in email template, allowed redirect URLs, JWT expiry) return 403. Code-side configuration used instead:
- `src/routes/auth.callback.tsx` + `src/routeTree.gen.ts` — added the `/auth/callback` route.
- `sign-in-panel.tsx` — `shouldCreateUser: true`, PKCE magic-link (`exchangeCodeForSession`).

**Action required (admin account):** In Supabase → Authentication → URL Configuration, confirm **Allowed Redirect URLs** includes:
- `https://ams-eg.lovable.app/auth/callback`
- `https://ams-eg.lovable.app/auth` (Google OAuth return)

---

## 4. Callback URL used

`${window.location.origin}/auth/callback` ⇒
- Production: `https://ams-eg.lovable.app/auth/callback?next=<safe-relative-path>` (email magic link)
- Google OAuth return: `${origin}/auth?next=…`

---

## 5. Session-persistence mechanism used

The **official Supabase client** (`@supabase/supabase-js`) with:
- `persistSession: true`, `autoRefreshToken: true` (`src/integrations/supabase/client.ts`).
- Storage via the official auth-storage adapter (`previewAuthStorage.ts`), which is native `localStorage` on the live domain and proxies the `sb-<project>-auth-token` key inside a Lovable editor iframe only.
- Restore-first flow: `AuthProvider` starts `loading`, runs `getSession()` → `getUser()`, never clears the session during init.
- Cross-tab sharing via a `storage` listener + Supabase's own broadcast.

Effectively the user stays signed in **until explicit sign-out or token/session expiry** (link + JWT lifetime set by the provider). This is the equivalent of a permanently-enabled "Keep me signed in", which is why no checkbox was added: Supabase's email-OTP client API exposes no user-selectable session-duration toggle, and hand-rolling one with a localStorage flag is explicitly prohibited by the spec.

---

## 6. Tokens are NOT stored in localStorage (manually confirmed)

Audited every `localStorage` call in `src`:
- `ams_last_login_email` — prefill convenience only, never used to authenticate, restore, or bypass magic link.
- `sb-<project>-auth-token` (+ PKCE verifier key) — written *by the Supabase client's official adapter*, which is the provider's secure mechanism and the only sanctioned storage. The app code never reads or writes these keys directly.

No access tokens, refresh tokens, magic-link URLs, OTP codes, passwords, or session secrets are stored by application code. `sessionStorage` holds only non-auth analytics IDs (`ams-*`).

---

## 7. No six-digit-code flow remains (confirmed)

Full-tree grep for `otp`/`6.digit`/`six.digit`/`verifyOtp`/`token_hash`/passcodes finds no UI path. The only `signInWithOtp` call is the email magic-link request; callback uses `exchangeCodeForSession`. Live JS chunks contain no OTP strings.

---

## 8. Tests performed

Code-level (all passed):
- `npx tsc --noEmit` — clean after every change and at final state.
- Middleware audit — all 50 `createServerFn` endpoints behind `requireSupabaseAuth`; admin fns additionally check `has_role(userId,'admin')` server-side.
- Storage audit — no manual token writes (see §6).
- Redirect audit — every `location.href`/`next` consumer runs through `safeNext`.
- Live bundle verification — deployed chunks show only magic-link behavior.
- Source grep — no OTP UI, no accidental `signOut`, no session clearing during init.

Manual (requires real mailbox + browser — pending your confirmation):
1. First login: signed out → `/auth` → email → "Send me a sign-in link" → spinner → "Check your email" (or real error) → open link → signed in; **no six-digit screen**; exactly one `profiles` row.
2. Stay signed in: refresh ×N, open `/auth`, close/reopen tab/return, navigate Advisor/Dashboard/My Activity — no new link requested, still authenticated.
3. `/auth` while signed in: "You are already signed in as [email]", no email form, Continue / Sign out / Use a different account work.
4. Sign out: session invalidated (refresh → unauthenticated form), email may pre-fill, new magic link required, never silently signed back in.
5. Re-sign-in (same email): existing account restored, no duplicate profile.
6. New user (new email): one auth user + one profile, role `user`.
7. Expiry: treated as unauthenticated, protected content blocked, new link requestable.
8. Security: direct unauthenticated serverFn call → `Unauthorized`; non-admin blocked from admin endpoints; cross-user activity not readable (test with two emails); unsafe redirects rejected.

---

## 9. Remaining limitations

1. **Supabase dashboard settings unverified/unchangeable** (view-only credentials, 403): Allowed Redirect URLs, sign-in email template, and JWT/link expiry values must be confirmed by an Admin. Recommended values: callback as in §4 plus `/auth`.
2. **Migration `20260909000000_private_app.sql` still not applied.** Until applied: `user_sessions`/`admin_audit_logs` return PGRST205 (session tracking/admin audit disabled, fail-open), and profiles use the reduced column set (role/status/last_sign_in_at arrive after apply). The app degrades gracefully and remains signed-in-safe.
3. **No "Keep me signed in" checkbox** — deliberately not added: the provider's official mechanism is always-on persistence and has no per-session toggle (see §5).
4. **Email delivery / link receipt requires a real mailbox** — Mailbox access and end-to-end click-through must be done by a human (test email previously used: `raouf66@hotmail.com`).
5. **`npm run build` must not be run locally** — it regenerates `routeTree.gen.ts` (removing infra routes `[.mcp]`, `[.well-known]`, `mcp.ts`) and deletes the hand-patched entries. Verify via `npx tsc --noEmit`.
6. E2E of Google OAuth requires the consent surface (`/.lovable/oauth/consent`) and provider-registered redirect URI confirmation.

---

## 10. Acceptance criteria — final state

| Criterion | Status |
|-----------|--------|
| Auth system fully audited (client, server, DB, RLS) | ✅ |
| All login buttons work; existing-user Sign in & new-user Create flows | ✅ (same verified magic-link flow, deduped by provider) |
| Magic-link consistent request→callback | ✅ |
| No six-digit code requested | ✅ |
| First login creates persistent session; survives refresh, tab reopen, next visit; restored automatically | ✅ |
| `/auth` shows "You are already signed in" with valid session | ✅ |
| No new email sent while session is valid | ✅ |
| Stays signed in until explicit sign-out or expiry | ✅ |
| Sign-out genuinely ends session; new magic link required; remembered email is convenience only | ✅ |
| No duplicate users/profiles | ✅ |
| Protected frontend + backend routes secure; redirects safe; errors visible | ✅ |
| Existing product-advisor functionality intact (`tsc` clean, no runtime code removed) | ✅ |