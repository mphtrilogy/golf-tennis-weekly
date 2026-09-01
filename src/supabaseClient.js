import { createClient } from '@supabase/supabase-js';

// Set these in Vercel → Project → Settings → Environment Variables:
//   VITE_SUPABASE_URL      = https://fnxoucliekhotvartyfu.supabase.co
//   VITE_SUPABASE_ANON_KEY = <the shared project's anon/public key>
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Guard: createClient() throws synchronously on a missing/invalid URL,
// which would crash the whole app to a blank screen before React ever
// renders. Exporting null instead lets the app fall back to sample
// data gracefully until the env vars are actually set.
export const supabase =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
