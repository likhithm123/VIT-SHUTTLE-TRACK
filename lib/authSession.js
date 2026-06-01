import { supabase } from './supabase';

export async function applyAuthSession(session) {
  if (!session?.access_token || !supabase) return false;
  const { error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) {
    console.warn('[authSession] setSession failed:', error.message);
    return false;
  }
  if (typeof window !== 'undefined') {
    localStorage.setItem('cs_session', JSON.stringify(session));
  }
  return true;
}

export async function restoreAuthSession() {
  if (typeof window === 'undefined' || !supabase) return false;
  const raw = localStorage.getItem('cs_session');
  if (!raw) return false;
  try {
    const session = JSON.parse(raw);
    return applyAuthSession(session);
  } catch {
    return false;
  }
}

export async function clearAuthSession() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('cs_session');
  }
  if (supabase) await supabase.auth.signOut();
}
