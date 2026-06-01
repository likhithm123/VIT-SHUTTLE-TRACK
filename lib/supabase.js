import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('CRITICAL: Supabase environment variables are missing in .env.local');
} else if (supabaseUrl.includes('{')) {
  console.error('CRITICAL: NEXT_PUBLIC_SUPABASE_URL appears to contain an error JSON string. Check .env.local');
} else {
  console.log(`[System] Supabase client initialized targeting: ${supabaseUrl}`);
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { params: { eventsPerSecond: 10 } },
});