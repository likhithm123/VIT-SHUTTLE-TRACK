import { supabase } from '../../lib/supabase';
import { getServiceRoleClient } from '../../lib/supabaseClient';
import { normalizeUser } from '../../lib/demoData';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  console.log('[Login API] Request received for:', req.body.email);

  const { email, password } = req.body;

  try {
    // 1. Authenticate with Supabase Auth
    const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError || !auth?.user) {
      console.error('[Login API] Auth Error:', authError?.message);
      const msg = authError?.message || 'Invalid Credentials';
      const hint =
        msg.toLowerCase().includes('invalid login credentials') && String(password).length < 6
          ? ' Password must be at least 6 characters (demo: admin123).'
          : '';
      return res.status(401).json({ error: msg + hint });
    }
    console.log('[Login API] Auth Successful for UUID:', auth.user.id);

    // 2. Fetch profile with service role (RLS on public.users blocks anon reads)
    const db = getServiceRoleClient() || supabase;
    const { data: profile, error: profileError } = await db
      .from('users')
      .select('*')
      .eq('id', auth.user.id)
      .maybeSingle();

    if (profileError || !profile) {
      console.error('[Login API] Profile Fetch Error:', profileError?.message || 'No profile row found');
      return res.status(404).json({ error: 'User profile not found in database. Check if UUID matches SQL.' });
    }

    console.log('[Login API] Profile found for:', profile.name);
    // Return both auth data and profile data
    return res.status(200).json({ 
      user: normalizeUser(profile),
      session: auth.session 
    });
  } catch (err) {
    console.error('[Login API] Unexpected Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}