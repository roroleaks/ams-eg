import { supabase } from "@/integrations/supabase/client";
import { endTrackedSession } from "@/lib/session";

/** Ends the tracked session then signs out of Supabase. */
export async function completeSignOut(): Promise<void> {
  if (typeof window !== "undefined") {
    const confirmed = window.confirm(
      "Sign out? You'll need a new sign-in link to return to this device.",
    );
    if (!confirmed) return;
  }
  await endTrackedSession();
  await supabase.auth.signOut();
  if (typeof window !== "undefined") {
    window.location.href = "/auth?next=%2F";
  }
}

/** Fetches the signed-in user's profile, or null if missing. */
export async function getProfileForActiveUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .maybeSingle();
  return profile;
}