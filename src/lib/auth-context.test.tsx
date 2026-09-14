import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./auth-context";

// Shared, controllable mocks. vi.hoisted so both the vi.mock factories and the
// tests reference the same instances/state.
const h = vi.hoisted(() => ({
  state: { session: null as any },
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signOut: vi.fn(),
    refreshSession: vi.fn(),
  },
  signout: {
    redirectOnce: vi.fn(),
    clearAuthTokens: vi.fn(),
    markLocalCleared: vi.fn(),
    scheduleSessionCleanup: vi.fn(),
  },
  listener: { cb: null as null | ((event: string, session: unknown) => void) },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: h.auth },
}));

vi.mock("@/lib/sign-out", () => ({
  AUTH_RESTORE_TIMEOUT_MS: 5000,
  SIGN_OUT_TIMEOUT_MS: 5000,
  CALLBACK_TIMEOUT_MS: 10000,
  PROFILE_UPSERT_TIMEOUT_MS: 5000,
  CLEANUP_TIMEOUT_MS: 1500,
  clearAuthTokens: h.signout.clearAuthTokens,
  markLocalCleared: h.signout.markLocalCleared,
  scheduleSessionCleanup: h.signout.scheduleSessionCleanup,
  redirectOnce: h.signout.redirectOnce,
  delay: async () => {},
  raceWithTimeout: async (p: Promise<unknown>, _ms: number, _fallback: unknown) => p,
}));

function makeSession(email = "jane@clinic.com", id = "user-123") {
  return {
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id, email, user_metadata: { full_name: "Jane Doe" }, app_metadata: {} },
  };
}

function Harness() {
  const a = useAuth();
  return (
    <div>
      <span data-testid="status">{a.status}</span>
      <span data-testid="email">{a.user?.email ?? "none"}</span>
      <span data-testid="sessionId">{a.session?.user_id ?? "none"}</span>
      <span data-testid="signingOut">{String(a.signingOut)}</span>
      <span data-testid="restoreFailed">{String(a.restoreFailed)}</span>
      <span data-testid="signInCount">{a.signInCount}</span>
      <span data-testid="signOutCount">{a.signOutCount}</span>
      <button data-testid="signout" onClick={() => void a.signOut()}>Sign out</button>
      <button data-testid="refresh" onClick={() => void a.refreshSession()}>Refresh</button>
      <button data-testid="retry" onClick={() => a.retryRestore()}>Retry</button>
    </div>
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;

beforeEach(() => {
  h.state.session = null;
  h.listener.cb = null;
  h.auth.getSession.mockReset().mockImplementation(() =>
    Promise.resolve({ data: { session: h.state.session }, error: null }),
  );
  h.auth.onAuthStateChange.mockReset().mockImplementation((cb) => {
    h.listener.cb = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  h.auth.signOut.mockReset().mockResolvedValue({ error: null });
  h.auth.refreshSession.mockReset().mockImplementation(() =>
    Promise.resolve({ data: { session: h.state.session }, error: null }),
  );
  for (const m of Object.values(h.signout)) m.mockClear?.();
});

describe("AuthProvider session persistence", () => {
  it("restores an existing session on start and shows the user (preserving the user id)", async () => {
    h.state.session = makeSession("jane@clinic.com", "user-123");
    render(<AuthProvider><Harness /></AuthProvider>);

    await waitFor(() => expect(text("status")).toBe("authenticated"));
    expect(text("email")).toBe("jane@clinic.com");
    expect(text("sessionId")).toBe("user-123");
    // A restore is not a new sign-in.
    expect(text("signInCount")).toBe("0");
    expect(text("signOutCount")).toBe("0");
  });

  it("shows unauthenticated when there is no stored session", async () => {
    render(<AuthProvider><Harness /></AuthProvider>);
    await waitFor(() => expect(text("status")).toBe("unauthenticated"));
    expect(text("email")).toBe("none");
    expect(text("sessionId")).toBe("none");
  });

  it("waits for the restore before rendering protected state and does not flash", async () => {
    let resolve!: (v: unknown) => void;
    h.auth.getSession.mockImplementationOnce(
      () => new Promise((res) => { resolve = res; }),
    );
    render(<AuthProvider><Harness /></AuthProvider>);

    // Restore still pending: gate stays on loading, nothing authenticated.
    expect(text("status")).toBe("loading");
    expect(text("email")).toBe("none");

    await act(async () => {
      resolve({ data: { session: makeSession("later@clinic.com") }, error: null });
    });
    await waitFor(() => expect(text("status")).toBe("authenticated"));
    expect(text("email")).toBe("later@clinic.com");
  });

  it("reports a recovery state when the session restore errors", async () => {
    h.auth.getSession.mockImplementationOnce(() =>
      Promise.resolve({ data: { session: null }, error: new Error("network") }),
    );
    render(<AuthProvider><Harness /></AuthProvider>);
    await waitFor(() => expect(text("status")).toBe("unauthenticated"));
    expect(text("restoreFailed")).toBe("true");
  });

  it("retry re-runs restoration after a failure", async () => {
    h.auth.getSession.mockImplementationOnce(() =>
      Promise.resolve({ data: { session: null }, error: new Error("network") }),
    );
    render(<AuthProvider><Harness /></AuthProvider>);
    await waitFor(() => expect(text("restoreFailed")).toBe("true"));

    h.state.session = makeSession("recovered@clinic.com");
    fireEvent.click(screen.getByTestId("retry"));
    await waitFor(() => expect(text("status")).toBe("authenticated"));
    expect(text("email")).toBe("recovered@clinic.com");
    expect(text("restoreFailed")).toBe("false");
  });

  it("signs out through the provider, clears state and redirects to /auth", async () => {
    h.state.session = makeSession("jane@clinic.com");
    render(<AuthProvider><Harness /></AuthProvider>);
    await waitFor(() => expect(text("status")).toBe("authenticated"));

    fireEvent.click(screen.getByTestId("signout"));
    await waitFor(() => expect(text("status")).toBe("unauthenticated"));
    expect(h.auth.signOut).toHaveBeenCalledTimes(1);
    expect(h.signout.redirectOnce).toHaveBeenCalledWith("/auth?next=%2F");
    expect(text("email")).toBe("none");
    expect(text("sessionId")).toBe("none");
    expect(text("signOutCount")).toBe("1");
  });

  it("honors a provider SIGNED_OUT event", async () => {
    h.state.session = makeSession("jane@clinic.com");
    render(<AuthProvider><Harness /></AuthProvider>);
    await waitFor(() => expect(text("status")).toBe("authenticated"));

    await act(async () => {
      h.listener.cb?.("SIGNED_OUT", null);
    });
    await waitFor(() => expect(text("status")).toBe("unauthenticated"));
    expect(text("email")).toBe("none");
    expect(text("signOutCount")).toBe("1");
    expect(h.auth.signOut).not.toHaveBeenCalled();
  });

  it("applies a TOKEN_REFRESHED session without counting a sign-in", async () => {
    h.state.session = makeSession("old@clinic.com");
    render(<AuthProvider><Harness /></AuthProvider>);
    await waitFor(() => expect(text("status")).toBe("authenticated"));

    await act(async () => {
      h.listener.cb?.("TOKEN_REFRESHED", makeSession("refreshed@clinic.com"));
    });
    await waitFor(() => expect(text("email")).toBe("refreshed@clinic.com"));
    expect(text("status")).toBe("authenticated");
    expect(text("signInCount")).toBe("0");
  });

  it("counts a genuine SIGNED_IN event once", async () => {
    render(<AuthProvider><Harness /></AuthProvider>);
    await waitFor(() => expect(text("status")).toBe("unauthenticated"));

    await act(async () => {
      h.listener.cb?.("SIGNED_IN", makeSession("new@clinic.com"));
    });
    await waitFor(() => expect(text("status")).toBe("authenticated"));
    expect(text("signInCount")).toBe("1");
  });

  it("explicit refreshSession restores the session without losing auth", async () => {
    h.state.session = makeSession("first@clinic.com");
    render(<AuthProvider><Harness /></AuthProvider>);
    await waitFor(() => expect(text("status")).toBe("authenticated"));

    h.state.session = makeSession("second@clinic.com");
    fireEvent.click(screen.getByTestId("refresh"));
    await waitFor(() => expect(text("email")).toBe("second@clinic.com"));
    expect(text("status")).toBe("authenticated");
  });

  it("syncs a session change signalled by another tab (storage event)", async () => {
    h.state.session = makeSession("tab-a@clinic.com");
    render(<AuthProvider><Harness /></AuthProvider>);
    await waitFor(() => expect(text("email")).toBe("tab-a@clinic.com"));

    h.state.session = makeSession("tab-b@clinic.com", "user-456");
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "sb-mipbeciycmefyjiverid-auth-token" }));
    });
    await waitFor(() => expect(text("email")).toBe("tab-b@clinic.com"));
    expect(text("sessionId")).toBe("user-456");
  });
});