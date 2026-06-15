import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient = createClient(
  url || "https://placeholder.supabase.co",
  anonKey || "placeholder",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // We exchange the PKCE ?code= ourselves in AuthCallbackPage. If the client
      // ALSO auto-detects and exchanges it, the second exchange fails with
      // "PKCE code verifier not found in storage" (the verifier is single-use and
      // removed after the first exchange). Keep it off so only our explicit
      // exchangeCodeForSession runs.
      detectSessionInUrl: false,
      storageKey: "algodesk_supabase_auth",
      flowType: "pkce",
    },
  }
);
