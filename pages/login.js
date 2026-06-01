import { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { applyAuthSession } from '../lib/authSession';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  async function handleLogin(e) {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    console.log('[Frontend] Sending login request to /api/login...');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Ensure we trim the email to avoid accidental spaces
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem('cs_user', JSON.stringify(data.user));
        if (data.session) await applyAuthSession(data.session);
        router.push(`/${data.user.role}`);
      } else {
        // If the error is about the profile missing, give a specific hint
        const msg = data.error?.includes('profile not found') 
          ? 'Authenticated, but no database profile found. Please sync your UUID in the SQL Editor.'
          : (data.error || 'Invalid credentials.');
        setError(msg);
      }
    } catch (err) {
      setError('Failed to connect to the server. Check your internet connection.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>
      <Head>
        <title>Login | Campus Shuttle</title>
      </Head>
      <div style={{ width: '100%', maxWidth: '400px', padding: '40px 30px', background: '#ffffff', borderRadius: '16px', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: '900', color: '#0f172a', margin: '0 0 4px 0' }}>VIT Vellore Shuttle NFC</h1>
          <p style={{ fontSize: '14px', fontWeight: '700', color: '#16a34a', margin: '0 0 12px 0' }}>Track. Tap. Ride.</p>
          <p style={{ fontSize: '12px', color: '#64748b', lineHeight: '1.4', margin: '0 0 16px 0' }}>
            Live SJT/PRP green route and Mens Hostel blue route tracking with mobile NFC fare collection and realtime dashboards.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '20px', fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase' }}>
            <span>Live GPS</span> • <span>Mobile NFC</span> • <span>Wallet due</span> • <span>Admin map</span>
          </div>
          <div style={{ height: '1px', background: '#f1f5f9', width: '100%', marginBottom: '20px' }}></div>
          <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', margin: 0 }}>Sign in</h2>
        </div>
        
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.025em' }}>Email ID</label>
            <input 
              id="email"
              name="email"
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              placeholder="admin@gmail.com"
              required
              autoComplete="email"
              style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '15px', outline: 'none', transition: 'all 0.2s', backgroundColor: '#f8fafc' }}
              onFocus={(e) => { e.target.style.borderColor = '#16a34a'; e.target.style.backgroundColor = '#fff'; e.target.style.boxShadow = '0 0 0 4px rgba(22, 163, 74, 0.1)'; }}
              onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.backgroundColor = '#f8fafc'; e.target.style.boxShadow = 'none'; }}
            />
          </div>
          <div style={{ position: 'relative' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.025em' }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input 
                id="password"
                name="password"
                type={showPassword ? "text" : "password"} 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                placeholder="••••••••"
                required
                autoComplete="current-password"
                style={{ width: '100%', padding: '12px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '15px', outline: 'none', transition: 'all 0.2s', backgroundColor: '#f8fafc' }}
                onFocus={(e) => { e.target.style.borderColor = '#16a34a'; e.target.style.backgroundColor = '#fff'; e.target.style.boxShadow = '0 0 0 4px rgba(22, 163, 74, 0.1)'; }}
                onBlur={(e) => { e.target.style.borderColor = '#e2e8f0'; e.target.style.backgroundColor = '#f8fafc'; e.target.style.boxShadow = 'none'; }}
              />
              <button 
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', color: '#64748b', cursor: 'pointer', fontSize: '11px', fontWeight: '800' }}
              >
                {showPassword ? 'HIDE' : 'SHOW'}
              </button>
            </div>
          </div>

          {error && <div style={{ color: '#dc2626', fontSize: '14px', fontWeight: '600', textAlign: 'center', padding: '10px', background: '#fef2f2', borderRadius: '8px' }}>{error}</div>}

          <button 
            type="submit" 
            disabled={isSubmitting}
            style={{ marginTop: '10px', background: '#16a34a', color: 'white', padding: '14px', borderRadius: '10px', fontWeight: '700', border: 'none', cursor: isSubmitting ? 'not-allowed' : 'pointer', fontSize: '16px', transition: 'all 0.2s', opacity: isSubmitting ? 0.7 : 1, boxShadow: '0 4px 6px -1px rgba(22, 163, 74, 0.2)' }}
            onMouseDown={(e) => !isSubmitting && (e.currentTarget.style.transform = 'scale(0.98)')}
            onMouseUp={(e) => !isSubmitting && (e.currentTarget.style.transform = 'scale(1)')}
          >
            {isSubmitting ? 'Verifying Account...' : 'Sign In'}
          </button>
        </form>
        
        <div style={{ marginTop: '32px', padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #e2e8f0' }}>
          <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Demo Access</p>
          <div style={{ fontSize: '13px', color: '#475569', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div>Login Email ID: <strong style={{ color: '#0f172a' }}>admin@gmail.com</strong></div>
            <div>Password: <strong style={{ color: '#0f172a' }}>admin123</strong></div>
          </div>
        </div>
      </div>
    </div>
  );
}