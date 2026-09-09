import { useEffect, useRef } from "react";
import {
  startUserSession,
  recordSessionHeartbeat,
  endUserSession,
} from "@/lib/session.functions";

const STORAGE_KEY = "ams-user-session-key";
const HEARTBEAT_MS = 45_000;
const INACTIVITY_MS = 30 * 60 * 1000;
const ACTIVITY_TIMEOUT_MS = 1500;

/** Background, bounded session/activity write: never blocks or lingers. */
function fireAndForget(pr: Promise<unknown>, ms: number): void {
  void Promise.race([pr, new Promise<void>((resolve) => setTimeout(resolve, ms))]).catch(() => {});
}

function newKey(): string {
  const rnd = (Math.random() + 1).toString(36).slice(2);
  const ts = Date.now().toString(36);
  return `s_${ts}_${rnd}`;
}

export function sessionKey(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(STORAGE_KEY) ?? "";
}

export function setSessionKey(key: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, key);
}

export function clearSessionKey(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
}

function detectDeviceType(): string | null {
  const ua = navigator.userAgent;
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return "tablet";
  if (/Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated/i.test(ua)) return "mobile";
  return "desktop";
}

function detectBrowser(): string | null {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  if (/OPR\//.test(ua)) return "Opera";
  return null;
}

function detectOS(): string | null {
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

function referrer(): string | null {
  const r = document.referrer;
  if (!r) return null;
  if (r.startsWith(window.location.origin)) return null;
  return r.slice(0, 500);
}

/**
 * Tracks the user's session while they are signed in.
 * - Starts a new session once when `enabled` becomes true.
 * - Sends heartbeats ~45s only while the tab is visible (paused when hidden).
 * - Sends a best-effort end on pagehide/sign-out.
 * - The server prunes sessions idle > 30 minutes.
 */
export function useSessionTracker(enabled: boolean) {
  const startedRef = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const key = newKey();
    setSessionKey(key);
    startedRef.current = { key, at: Date.now() };

    fireAndForget(
      startUserSession({
        data: {
          session_key: key,
          device_type: detectDeviceType(),
          browser: detectBrowser(),
          operating_system: detectOS(),
          referrer: referrer(),
        },
      }),
      ACTIVITY_TIMEOUT_MS,
    );

    const pulse = () => {
      if (document.visibilityState !== "visible") return;
      fireAndForget(recordSessionHeartbeat({ data: { session_key: key } }), ACTIVITY_TIMEOUT_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") pulse();
    };

    const interval = window.setInterval(pulse, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", onVisible);

    const onPageHide = () => {
      fireAndForget(endUserSession({ data: { session_key: key } }), ACTIVITY_TIMEOUT_MS);
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [enabled]);
}

/** Ends the current tracked session (used right before sign-out). */
export async function endTrackedSession(): Promise<void> {
  const key = sessionKey();
  if (key) {
    try {
      await endUserSession({ data: { session_key: key } });
    } catch {
      /* best-effort */
    }
  }
  clearSessionKey();
}