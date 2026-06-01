import { supabase } from '../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, name, role, regNo } = req.body;

  try {
    // 1. Create the user in Supabase Auth (This handles password hashing)
    const { data: auth, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError || !auth.user) {
      return res.status(400).json({ error: authError?.message || 'Signup failed' });
    }

    // 2. Create the associated profile in your 'public.users' table
    const { error: profileError } = await supabase
      .from('users')
      .insert([
        { 
          id: auth.user.id, // Linking the Auth UUID
          name, 
          role: role || 'student', 
          reg_no: regNo,
          needs_password_reset: false 
        }
      ]);

    if (profileError) throw profileError;

    return res.status(200).json({ message: 'Registration successful. Check your email for verification.' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}