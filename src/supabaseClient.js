import { createClient } from '@supabase/supabase-js';

// Set these in Vercel → Project → Settings → Environment Variables:
//   VITE_SUPABASE_URL      = https://fnxoucliekhotvartyfu.supabase.co
//   VITE_SUPABASE_ANON_KEY = <the shared project's anon/public key>
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
