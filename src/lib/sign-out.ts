import { supabase } from "@/integrations/supabase/client";
import { endUserSession } from "@/lib/session.functions";
import { sessionKey, clearSessionKey } from "@/lib/session";

/** Hard cap for the official auth-provider sign-out call. */
export const SIGN_OUT_TIMEOUT_MS = 5000;
/** Hard cap for background (optional) session-record cleanup. */
export const CLEANUP_TIMEOUT_MS = 1500;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Removes the official auth tokens from local storage (best-effort, used only
 * when the provider call times out so the device ends the session locally).
 * The remembered-email preference is intentionally never touched here.
 */
export function clearAuthTokens(): void {
  try {
    supabase.auth.stopAutoRefresh();
  } catch {
    /* ignore */
  }
  const sweep = (store: Storage) => {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith("sb-")) keys.push(k);
    }
    for (const k of keys) {
      try {
        store.removeItem(k);
      } catch {
        /* ignore */
      }
    }
  };
  try {
    sweep(window.localStorage);
  } catch {
    /* ignore */
  }
  try {
    sweep(window.sessionStorage);
  } catch {
    /* ignore */
  }
}

/**
 * Optional session-record cleanup. Bounded and fire-and-forget: it can never
 * block sign-out. The session key is always cleared locally.
 */
export function scheduleSessionCleanup(): void {
  void (async () => {
    const key = sessionKey();
    try {
      if (key) {
        await Promise.race([
          endUserSession({ data: { session_key: key } }),
          delay(CLEANUP_TIMEOUT_MS),
        ]);
      }
    } catch {
      /* best-effort */
    } finally {
      clearSessionKey();
    }
  })();
}

/** Redirects exactly once per sign-out operation. */
export function redirectOnce(to: string): void {
  if (typeof window === "undefined") return;
  window.location.href = to;
}