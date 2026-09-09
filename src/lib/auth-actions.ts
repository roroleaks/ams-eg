import { supabase } from "@/integrations/supabase/client";

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