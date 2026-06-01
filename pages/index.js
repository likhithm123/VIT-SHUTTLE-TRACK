import { useRouter } from 'next/router';
import { useState } from 'react';
import { applyAuthSession } from '../lib/authSession';

export default function Home() {
  const router = useRouter();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // Password reset flow for first time login
  const [showReset, setShowReset] = useState(false);
  const [tempUser, setTempUser] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetError, setResetError] = useState('');

  async function login(e) {
    e.preventDefault();
    setError('');
    try {
      const isEmail = loginId.includes('@');
      const res = await fetch(isEmail ? '/api/login' : '/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEmail
            ? { email: loginId.trim(), password }
            : { login: loginId, password }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Invalid user id or password');
        return;
      }

      const user = data.user;
      if (data.session) await applyAuthSession(data.session);
      if (user.needsPasswordReset) {
        setTempUser(user);
        setShowReset(true);
      } else {
        localStorage.setItem('cs_user', JSON.stringify(user));
        router.push(`/${user.role}`);
      }
    } catch (err) {
      setError('Connection error. Please try again.');
    }
  }

  async function handlePasswordReset(e) {
    e.preventDefault();
    setResetError('');
    if (!newPassword) {
      setResetError('Password cannot be empty');
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError('Passwords do not match');
      return;
    }
    if (newPassword === `${tempUser.regNo}@123` || newPassword === 'admin@123') {
      setResetError('Please choose a different password than the default');
      return;
    }

    if (String(newPassword).length < 6) {
      setResetError('Password must be at least 6 characters');
      return;
    }

    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_password', userId: tempUser.id, newPassword })
      });
      const data = await res.json();
      if (!res.ok) {
        setResetError(data.error || 'Failed to reset password');
        return;
      }

      localStorage.setItem('cs_user', JSON.stringify(data.user));
      router.push(`/${data.user.role}`);
    } catch (err) {
      setResetError('Connection error. Please try again.');
    }
  }

  return (
    <div className="login-shell">
      <section className="login-hero">
        <div className="brand-pill">VIT Vellore Shuttle NFC</div>
        <h1>Track. Tap. Ride.</h1>
        <p>Live SJT/PRP green route and Mens Hostel blue route tracking with mobile NFC fare collection and realtime dashboards.</p>
        <div className="hero-grid">
          <span>Live GPS</span><span>Mobile NFC</span><span>Wallet due</span><span>Admin map</span>
        </div>
      </section>

      {!showReset ? (
        <form className="login-card" onSubmit={login}>
          <h2>Sign in</h2>
          <label>User ID / Reg No</label>
          <input value={loginId} onChange={(e) => setLoginId(e.target.value)} placeholder="Enter Reg No / Admin ID" required />
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" required />
          {error && <p className="error">{error}</p>}
          <button className="primary" style={{ backgroundColor: '#1e90ff' }}>Continue</button>
        </form>
      ) : (
        <form className="login-card" onSubmit={handlePasswordReset}>
          <h2>Reset Password</h2>
          <p className="muted" style={{ fontSize: '14px', marginBottom: '10px' }}>
            First time login detected for <strong>{tempUser.name}</strong>. Please change your password.
          </p>
          <label>New Password</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password" required />
          <label>Confirm New Password</label>
          <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" required />
          {resetError && <p className="error">{resetError}</p>}
          <button className="primary" style={{ backgroundColor: '#32cd32' }}>Save and Login</button>
        </form>
      )}
    </div>
  );
}
