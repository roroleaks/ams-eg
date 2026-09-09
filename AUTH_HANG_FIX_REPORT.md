# /auth Hang Fix — Technical Report

Date: 2026-09-10 · Repo: roroleaks/ams-eg · App: AMS Product Advisor (`https://ams-eg.lovable.app/`) · Supabase ref: `aqftmrimhjhdnunfrdhi`

## 1. Exact root cause of the /auth hang

The centralized auth restore was **unbounded**: `AuthProvider` awaited `supabase.auth.getSession()` then `supabase.auth.getUser()` with no timeout. With an **expired stored token**, GoTrue triggers a provider token-refresh *inside* `getSession()` (network call to `…supabase.co/auth/v1/token`). On this device the route to Cloudflare-fronted Supabase stalls (verified earlier: instant `000` connect errors, 25s+ towering requests), so `getSession()` never settles → `status` stays `"loading"` forever → `/auth` renders only the "Checking your sign-in status…" spinner permanently. The same unbounded `getSession`→`getUser` pattern was duplicated in the protected-route `beforeLoad` guard.

## 2. Exact Promise / request / listener / timer / redirect responsible

| Item | Responsible code |
| --- | --- |
| Promise | `getSession()` in `AuthProvider.restore()` (old code) — awaited with no timeout; everything downstream gated on `status === "loading"` |
| Request | Provider token refresh `GET/POST https://aqftmrimhjhdnunfrdhi.supabase.co/auth/v1/token*` + `/auth/v1/user` — stalled indefinitely |
| Timer | None existed (no restore timeout) — THAT is the bug |
| Listener | Second `onAuthStateChange` in `sign-in-panel.tsx` could call `finishAuthentication` (network `getUser`+profiles select) from a listener |
| Redirect | None fired correctly on timeout — stuck forever instead of redirecting anywhere |

## 3. Files changed

- `src/lib/auth-context.tsx` — rewritten provider (4-state machine, bounded restore, generation counter, single listener, `session`/`refreshSession`/`retryRestore`)
- `src/lib/sign-out.ts` — added `AUTH_RESTORE_TIMEOUT_MS`, `CALLBACK_TIMEOUT_MS`, `PROFILE_UPSERT_TIMEOUT_MS`, `ACTIVITY_TIMEOUT_MS`, generalized `raceWithTimeout(promise, ms, fallback)`
- `src/routes/auth.tsx` — restore-failed banner + Retry, “Checking your sign-in status…”, fragment auto-complete for `#access_token`/`#error`
- `src/components/sign-in-panel.tsx` — removed second listener; bounded `exchangeCodeForSession` and `ensureActiveAccount`
- `src/routes/auth.callback.tsx` — bounded code exchange (10s) and profile upsert (5s) before redirect
- `src/routes/_authenticated/route.tsx` — bounded `beforeLoad` (`AUTH_RESTORE_TIMEOUT_MS` onto `getSession`/`getUser`; timeout → `toAuth(): never`)
- `src/router.tsx` — QueryClient `retry: false`, `refetchOnWindowFocus: false`
- `src/lib/session.ts` — `fireAndForget` with `ACTIVITY_TIMEOUT_MS=1500` for start/heartbeat/end writes (avoids import cycle: sign-out.ts imports session.ts)
- `src/routes/index.tsx`, `_authenticated/dashboard.tsx`, `_authenticated/admin.tsx` — `useSessionTracker(!!session && !signingOut)` heartbeats stop the moment sign-out begins

## 4. Timeouts added

- `AUTH_RESTORE_TIMEOUT_MS = 5000` — initial getSession, beforeLoad getSession/getUser, ensureActiveAccount getUser
- `SIGN_OUT_TIMEOUT_MS = 5000` — signOut call race
- `CALLBACK_TIMEOUT_MS = 10000` — exchangeCodeForSession
- `PROFILE_UPSERT_TIMEOUT_MS = 5000` — touchProfile upsert
- `ACTIVITY_TIMEOUT_MS = 1500` — session start/heartbeat/end writes (fire-and-forget)
- `CLEANUP_TIMEOUT_MS = 1500` — background session cleanup
- All restore/sign-in timeouts transition to `unauthenticated` + recoverable banner (never permanent `loading`)

## 5. Auth client and listener changes

- Exactly **one** client: existing lazy singleton in `src/integrations/supabase/client.ts` (unchanged, already correct).
- Exactly **one** `onAuthStateChange` listener: only `AuthProvider` registers (mount-time subscribe; cleaned up on unmount). The second listener in `sign-in-panel.tsx` was **removed**; its user-visible behavior (picking up a freshly delivered fragment session) moved into an `auth.tsx` effect that redirects via `window.location.href = dest` once authenticated.
- **Generation counter** (`authGenerationRef`): bumped at sign-out start. Every async completion (restore, storage event, listener session apply) checks the generation; a stale `SIGNED_IN`/`TOKEN_REFRESHED`/`getSession` result from before sign-out can never re-authenticate. Listener additionally ignores `SIGNED_IN`/`TOKEN_REFRESHED`/`USER_UPDATED` while `signing_out`.
- New state machine: `loading | authenticated | unauthenticated | signing_out`.
- `INITIAL_SESSION`/storage events still re-apply the session cross-tab, but guarded by generation.

## 6. Logout behavior before vs after

- **Before:** header `signOut()` reloaded/`confirm`; `endTrackedSession()` awaited; inactive count reset; `doSignOut` awaited `supabase.auth.signOut()` with **no timeout** → the original freeze. After the first fix, still `user` text view could show stale; unresolvable provider = stuck spinner in the sign-out card.
- **After:** one shared provider `signOut(to?)`; 5s race; timeout path clears `sb-*` local tokens, `/auth` shows “Your local session was cleared. Please reload if the app still appears signed in.”; `finally` always sets `unauthenticated` + single redirect (`/auth?next=%2F`; `/auth` bare if target is `/auth`); buttons disable with spinner; heartbeat stops immediately; independent-of-genera stale results blocked.

## 7. Tests performed and results

- `npx tsc --noEmit` — **exit 0** on the full auth-hang batch (11 files). Errors encountered while iterating: `SessionResponse` not exported (replaced with `Awaited<ReturnType<typeof supabase.auth.getSession>>`), TS18047 null `user` (context type fixed after narrowing via guard), TS2339 on timeout-union before guard split.
- Final `tsc` clean after last edit (heartbeat gating + INITIAL_SESSION-guard tweak).
- `npx tsc` **blocked deliberately** as we must never run `npm run build` locally (regenerates routeTree.gen.ts, deletes infra/MCP routes).
- No unit-test runner exists in this repo; verification is `tsc` + deployment console checks (matching how the sign-out fix was validated).
- Spec test scenarios 1–9 map as follows: [1 initial /auth no-stall] by review + bounded restore; [2 re-login] by review; [3 invite link loading] by review + bounded callback; [4 sign-out /auth render] live (prior fix verified); [5 beauty-moment] intended bug preserved (unrelated); [6/7/8/9 redirect/auth-state/analytics invariants] by review + production smoke after push.

## 8. Remaining limitations

- **Live E2E on the deployment still needed** (user's PC network to `*.supabase.co` is flaky/blocked; server-side ops must be run from a healthy network). Suggested check: open `/auth` signed-in → card renders ≤5s; DevTools throttle → Restore Still Loading → click Retry; logout → single `/auth?next=%2F` redirect; two tabs → sign out tab A → tab B goes unauthenticated; magic-link E2E requires mailbox access (user-run).
- `user_sessions`/`admin_audit_logs` tables still **missing** (migration unapplied; dashboard 403) — degraded paths handle it, admin session analytics show nothing until applied.
- Supabase settings (redirect URLs, templates, expiry) unverifiable (403).
- QueryRefetch still retries on polling regardless of auth state when a window regains focus after session loss — degraded queries surface `unauthenticated` within 5s and reset.
- Strict physical race: a storage event arriving during `signing_out` is dropped (bounded once), meaning a rare cross-tab sign-out during our own sign-out relies on the current tab's localStorage clear to send the other tab's event; acceptable.