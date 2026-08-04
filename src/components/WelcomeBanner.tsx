import { useEffect, useState } from "react";
import { X, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lovable } from "@/integrations/lovable/index";
import { getAuthChoice, setAuthChoice } from "@/lib/guest";

/**
 * Non-intrusive first-visit banner. Never blocks the app — the user can
 * continue as a guest with one click and the banner disappears for good.
 */
export function WelcomeBanner({ signedIn }: { signedIn: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!signedIn && !getAuthChoice()) setShow(true);
  }, [signedIn]);

  if (!show || signedIn) return null;

  async function onGoogle() {
    setAuthChoice("google");
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) setShow(false);
  }

  return (
    <div className="border-b border-primary/20 bg-primary/5 print:hidden">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-6 py-3">
        <p className="min-w-[240px] flex-1 text-sm text-foreground">
          Continue as Guest or Sign in with Google to unlock additional features.
          <span className="mt-0.5 block text-xs text-muted-foreground">
            <ShieldCheck className="mr-1 inline h-3 w-3" />
            Google sign-in only stores your name, email and profile picture to personalise your
            experience. We never share your data or send marketing without your consent.
          </span>
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAuthChoice("guest");
              setShow(false);
            }}
          >
            Continue as Guest
          </Button>
          <Button size="sm" onClick={onGoogle}>
            Sign in with Google
          </Button>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => {
              setAuthChoice("guest");
              setShow(false);
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
