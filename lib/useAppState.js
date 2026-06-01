import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { restoreAuthSession } from './authSession';

const REALTIME_TABLES = [
  'shuttles',
  'wallets',
  'users',
  'dues',
  'transactions',
  'alerts',
  'hotlist',
];

const emptyState = {
  users: [],
  wallets: {},
  dues: {},
  shuttles: [],
  hotlist: {},
  transactions: [],
  alerts: [],
  cards: {},
};

/**
 * Loads full app state from /api/state and keeps it in sync via Supabase Realtime.
 * Falls back to fast polling if Realtime is unavailable.
 */
export function useAppState({ enabled = true, pollMs = 2000 } = {}) {
  const [dbState, setDbState] = useState(null);
  const [lastUpdated, setLastUpdated] = useState('');
  const [syncMode, setSyncMode] = useState('loading');
  const loadingRef = useRef(false);
  const debounceRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!enabled) return null;
    try {
      const res = await fetch('/api/state');
      if (!res.ok) return null;
      const state = await res.json();
      setDbState(state);
      setLastUpdated(new Date().toLocaleTimeString());
      return state;
    } catch (e) {
      console.error('[useAppState] refresh failed:', e);
      return null;
    }
  }, [enabled]);

  const scheduleRefresh = useCallback(() => {
    if (!enabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      refresh().finally(() => {
        loadingRef.current = false;
      });
    }, 120);
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return undefined;

    let channel = null;
    let pollTimer = null;
    let cancelled = false;

    async function setup() {
      await refresh();
      if (cancelled) return;

      await restoreAuthSession();

      if (supabase) {
        channel = supabase.channel('campus-shuttle-sync');
        for (const table of REALTIME_TABLES) {
          channel.on(
            'postgres_changes',
            { event: '*', schema: 'public', table },
            () => {
              scheduleRefresh();
            }
          );
        }
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            setSyncMode('realtime');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setSyncMode('poll');
          }
        });
      }

      pollTimer = setInterval(refresh, pollMs);
      if (!channel) setSyncMode('poll');
    }

    setup();

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (channel && supabase) supabase.removeChannel(channel);
    };
  }, [enabled, pollMs, refresh, scheduleRefresh]);

  return {
    dbState: dbState || emptyState,
    lastUpdated,
    syncMode,
    refresh,
    setDbState,
  };
}
