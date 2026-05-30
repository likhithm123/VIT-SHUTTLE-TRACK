import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const isConfigured =
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes('your-project') &&
  !supabaseAnonKey.includes('public-anon-key');

export const supabase = isConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;
export const hasSupabase = Boolean(isConfigured);

export function getServiceRoleClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!isConfigured || !key || key.includes('DO-NOT-COMMIT')) return null;
  return createClient(supabaseUrl, key);
}
