import { supabase } from '../../lib/supabase';
import { getServiceRoleClient } from '../../lib/supabaseClient';
import { normalizeUser } from '../../lib/demoData';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { login, password } = req.body;
  if (!login || !password) {
    return res.status(400).json({ error: 'User ID and Password are required' });
  }

  const svc = getServiceRoleClient();
  if (!svc) {
    return res.status(503).json({ error: 'Supabase is not configured' });
  }

  const key = String(login).trim().toLowerCase();
  const { data: users } = await svc.from('users').select('*');
  const profile = (users || []).find(
    (u) =>
      String(u.id).toLowerCase() === key ||
      String(u.reg_no || '').toLowerCase() === key ||
      String(u.name || '').toLowerCase() === key
  );

  if (!profile) {
    return res.status(401).json({ error: 'Invalid user ID or password' });
  }

  const { data: authData, error: authUserErr } = await svc.auth.admin.getUserById(profile.id);
  if (authUserErr || !authData?.user?.email) {
    return res.status(401).json({ error: 'Invalid user ID or password' });
  }

  const { data: auth, error } = await supabase.auth.signInWithPassword({
    email: authData.user.email,
    password,
  });

  if (error || !auth?.user) {
    return res.status(401).json({ error: 'Invalid user ID or password' });
  }

  return res.json({
    user: normalizeUser(profile),
    firstLogin: profile.needs_password_reset,
    session: auth.session,
  });
}
