/**
 * Supabase client, configured from env vars only — never hardcode a
 * project URL or key here. VITE_SUPABASE_ANON_KEY must be the
 * anon/publishable key (safe to ship to the browser), never the
 * secret/service_role key, which grants full admin access bypassing every
 * row-level security policy.
 *
 * supabaseEnabled is false when the env vars aren't set (e.g. local dev
 * without a .env.local) — lib/storage.js falls back to localStorage in
 * that case, so the app still works without a Supabase project.
 */
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseEnabled = Boolean(url && key);

export const supabase = supabaseEnabled ? createClient(url, key) : null;
