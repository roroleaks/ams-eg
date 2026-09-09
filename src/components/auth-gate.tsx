import { useCallback, useRef, useState } from "react";
import { SignInPanel } from "@/components/sign-in-panel";

/**
 * A pending protected action. When an unauthenticated visitor triggers a
 * protected feature, the action is stored here and resumed after sign-in.
 */
export type PendingAction = {
  /** Human-readable label shown/used for the resume target, e.g. the complaint. */
  label: string;
  /** Same-origin path to resume to (also used for the OAuth redirect back). */
  next: string;
  /** What to run once the user is authenticated. */
  run: () => void;
};

/**
 * Reusable guard for protected UI actions. Check authentication via the
 * caller (which owns `session` state); if unauthenticated, store the pending
 * action and open the sign-in modal instead of running it.
 */
export function useAuthGate() {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const pendingRef = useRef<PendingAction | null>(null);

  const openGate = useCallback((action: PendingAction) => {
    pendingRef.current = action;
    setPending(action);
  }, []);

  const closeGate = useCallback(() => {
    pendingRef.current = null;
    setPending(null);
  }, []);

  const resumePending = useCallback(() => {
    const action = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    action?.run();
  }, []);

  const isOpen = pending !== null;

  return { isOpen, pending, openGate, closeGate, resumePending };
}

/** Modal wrapper that hosts the shared sign-in flow for protected actions. */
export function AuthGate({
  pending,
  onClose,
  onSuccess,
}: {
  pending: PendingAction | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  if (!pending) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Sign in required"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl sm:p-8">
        <SignInPanel
          next={pending.next}
          showClose
          onClose={onClose}
          onSuccess={onSuccess}
        />
      </div>
    </div>
  );
}