import { getServerState } from '../../lib/serverDb';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { login, password } = req.body;
  if (!login || !password) {
    return res.status(400).json({ error: 'User ID and Password are required' });
  }

  const db = getServerState();
  const key = String(login).trim().toLowerCase();
  
  const user = db.users.find(u => 
    (u.id.toLowerCase() === key || 
     u.regNo.toLowerCase() === key || 
     u.name.toLowerCase() === key) && 
    u.password === password
  );

  if (!user) {
    return res.status(401).json({ error: 'Invalid user ID or password' });
  }

  return res.json({ user, firstLogin: user.needsPasswordReset });
}
