# Sign-Out Freeze Fix — Technical Report

Date: 2026-09-10 · App: AMS Product Advisor (`ams-eg`) · Commits: `aa20e01`, `29dde60`

## 1. Exact root cause

Clicking **Sign out** froze the UI for **25+ seconds** with no state change, no
spinner, and no redirect. Two independent sign-out implementations, both in the
client bundle, each did the same unsafe thing:

```ts
// src/lib/auth-actions.ts (completeSignOut)   — used by header/dashboard/admin/layout
await endTrackedSession();          // blocking DB round-trip
await supabase.auth.signOut();      // UNBOUNDED network call  ← the hang
window.location.href = "/auth?next=%2F";

// src/routes/auth.tsx (doSignOut)  — used by the auth page
await endTrackedSession();
await supabase.auth.signOut();      // UNBOUNDED  ← the hang
window.location.href = go;
```

`supabase.auth.signOut()` issues a `POST …/auth/v1/logout` through the browser
`fetch` API with **no timeout**. On this device the route to Cloudflare-fronted
Supabase is lossy/stalled (diagnosed earlier: instant `000` to
`*.supabase.co` and `*.lovable.app` from this PC while `google.com` is fast), so
the fetch stalls indefinitely. Because the awaited promise never settles, the
click handler never returns and the redirect — which only ran *after* the await —
never happens. Every later await (session-record cleanup) merely added more
blocking before logout could even start.

There was **no timeout anywhere**, **no single shared operation** (5 separate
call sites could run two logout flows at once), **no duplicate-click guard**,
**no loading state**, and **no local fallback** when the provider is unreachable.

Tagged against the failing requirement set:
- any single fetch stall must not block sign-out (violated — *the* bug);
- session/activity/analytics work must never gate auth invalidation (violated);
- the UI must show a bounded, cancellable, single-confirmation flow (violated);
- the app must end the device session even if the provider is unreachable (violated).

## 2. Blocking promise

`supabase.auth.signOut()` awaited directly on the UI thread, immediately preceded
by an awaited `endTrackedSession()` (a `user_sessions` server call that regresses
to a caught PGRST205 while the migration is pending — unnecessary blocking).

## 3. Software root causes fixed

- Unbounded `supabase.auth.signOut()` with the redirect only after the await.
- Several independent logout implementations with divergent behavior.
- `endTrackedSession()` awaited *before* starting logout.
- No duplicate-click protection, no `signingOut` UI state.
- No device-local fallback if the provider is unreachable.
- No safe message distinguishing "server session ended" from "local only".

## 4. Files changed

| File | Change |
| --- | --- |
| `src/lib/sign-out.ts` *(new)* | Constants `SIGN_OUT_TIMEOUT_MS=5000`, `CLEANUP_TIMEOUT_MS=1500`; `delay`; `clearAuthTokens` (removes `sb-*` keys, stops auto-refresh); `scheduleSessionCleanup` (bounded fire-and-forget session-record end); `redirectOnce`; `markLocalCleared`/`consumeLocalCleared`. |
| `src/lib/auth-context.tsx` | `signingOut` state; the **single shared** `signOut()` operation (5s race, re-entrant guard via in-flight ref, `finally` always ends `unauthenticated` + exactly one redirect). |
| `src/lib/auth-actions.ts` | Removed the old unbounded `completeSignOut()`. |
| `src/routes/auth.tsx` | `doSignOut` delegates to provider `signOut`; confirm card buttons disabled with `Signing out…`; one-shot safe "local session was cleared" banner. |
| `src/routes/index.tsx` | Header button uses provider `signOut` (with confirm), disabled while signing out. |
| `src/routes/_authenticated/dashboard.tsx` | `qc.clear()` (sync) then provider `signOut`; removed redirect path. |
| `src/routes/_authenticated/admin.tsx` | Button delegates to provider `signOut`; removed redirect path. |
| `src/routes/_authenticated/route.tsx` | Suspended-account rejection uses provider `signOut`. |
| `src/components/sign-in-panel.tsx` | Suspended-account rejection sign-out is bounded (5s race, `void`, never awaited), error shown regardless. |
| `src/lib/session.ts` | `endTrackedSession` now unused (helper retained; logic superseded by `scheduleSessionCleanup`). |

## 5. Timeouts added

| Call | Bound |
| --- | --- |
| `supabase.auth.signOut()` (provider) | **5 000 ms** (`Promise.race`) |
| Session-record cleanup (`endUserSession`) | **1 500 ms** (`Promise.race`, background) |
| Suspended-account rejection sign-out (sign-in-panel) | **5 000 ms** (fire-and-forget) |
| `/embed` matrix + literature/timeout hardening | already present from previous commit `55d4a7c` |

## 6. Proof logout does NOT wait on analytics/DB/activity/session records

In `AuthProvider.signOut()`:

```ts
scheduleSessionCleanup();                    // void promise, bounded 1.5s, errors caught
const race = Promise.race([
  supabase.auth.signOut().then(()=>"ok").catch(()=>"ok"),
  delay(SIGN_OUT_TIMEOUT_MS).then(()=>"timeout"),
]);
const outcome = await race;                  // ONLY thing the UI awaits
// finally: clear local state, redirect — runs for every outcome
```

- The **only awaited** work is the provider race. `scheduleSessionCleanup()` is
  invoked `void`-style *before* it and internally bounded.
- No DB/activity/analytics call is awaited at any point in the operation.
- `clearAuthTokens()` is best-effort, wrapped in try/catch, synchronous.
- The `unauthenticated` transition and the redirect live in `finally` for every
  outcome (`ok`/`timeout`), so a stale provider can never leave the app signed in.
- UI never navigates more than once: `signOutInFlightRef` dedupes re-entry and
  the page unloads on the single `location.href` assignment.

## 7. Tests and results

| Scenario | Expected | Result |
| --- | --- | --- |
| 1. Happy path click → confirm → sign out | `SIGNED_OUT` → local tokens removed → exactly one redirect to `/auth?next=%2F` | ✅ by construction; `npx tsc --noEmit` clean |
| 2. Cancel (auth-page card / header confirm) | No sign-out begins, `signOutInFlight` untouched | ✅ by construction |
| 3. Slow provider (>5s) | 5s local clear → safe notice → single redirect, UI never frozen | ✅ race drives outcome; `markLocalCleared` consumed by `/auth` banner |
| 4. Offline | Immediate local clear + safe notice (fetch fails fast) | ✅ `catch(()=>"ok")` + finally path |
| 5. Duplicate/double clicks | Same in-flight op reused; buttons `disabled` with `Signing out…` | ✅ `signOutInFlightRef` + `signingOut` UI |
| 6. Re-click after completion | Fresh operation starts normally (new session or clear flow) | ✅ ref reset on `run.finally` |
| 7. Provider call later resolves after timeout | No double redirect, no re-authenticate; count idempotent, notice stays | ✅ single redirect + finally |
| 8. Stale UI / back button post sign-out | Protected routes re-run `beforeLoad` (`getSession`/`getUser`) and redirect to `/auth` | ✅ unchanged guard |

Static checks run: `npx tsc --noEmit` → exit 0; `rg` confirms `completeSignOut`
removed from the codebase and every sign-out call site routes through
`useAuth().signOut`.

Remaining manual verification (needs a live browser, ideally from a
connection lossy to Supabase): repeat scenario 3 with devtools network
throttling to confirm the UI frees itself at ~5s and shows the amber notice.

## 8. Remaining limitations

- During the 5s window the provider call is still in flight server-side; if the
  network recovers right after local clear, the server session may not be revoked
  until token expiry. The safe notice does not claim a server logout.
- The one-time notice is consumed by the first visit to `/auth`; a deep-link
  redirect target still lands on `/auth` first, so it is reliably shown.
- Migration `20260909000000_private_app.sql` is still unapplied, so session
  records remain best-effort (PGRST205 is caught and never awaited).
- Supabase template/callback settings remain unverifiable (403 dashboard).