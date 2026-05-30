import { useRouter } from 'next/router';
import { useState } from 'react';
import { authUser, USERS } from '../lib/demoData';

export default function Home() {
  const router = useRouter();
  const [loginId, setLoginId] = useState('REG1001');
  const [password, setPassword] = useState('REG1001@123');
  const [error, setError] = useState('');

  function login(e) {
    e.preventDefault();
    const user = authUser(loginId, password);
    if (!user) {
      setError('Invalid user id or password');
      return;
    }
    localStorage.setItem('cs_user', JSON.stringify(user));
    router.push(`/${user.role}`);
  }

  return (
    <div className="login-shell">
      <section className="login-hero">
        <div className="brand-pill">VIT Vellore Shuttle NFC</div>
        <h1>Track. Tap. Ride.</h1>
        <p>Live SJT/PRP green route and Mens Hostel blue route tracking with mobile NFC fare collection and Supabase realtime dashboards.</p>
        <div className="hero-grid">
          <span>Live GPS</span><span>Mobile NFC</span><span>Wallet due</span><span>Admin map</span>
        </div>
      </section>
      <form className="login-card" onSubmit={login}>
        <h2>Sign in</h2>
        <label>User ID / Reg No</label>
        <input value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="REG1001" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="student123" />
        {error && <p className="error">{error}</p>}
        <button className="primary">Continue</button>
        <div className="demo-users">
          {USERS.map((u) => (
            <button type="button" key={u.id} onClick={() => { setLoginId(u.regNo); setPassword(u.password); }}>
              {u.role}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
