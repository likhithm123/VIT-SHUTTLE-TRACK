import { supabase } from './supabase';
import { getServiceRoleClient } from './supabaseClient';
import { normalizeShuttle, normalizeTx, normalizeUser } from './demoData';

function dbClient() {
  return getServiceRoleClient() || supabase;
}

export async function getServerState() {
  const db = dbClient();
  try {
    console.log('[Supabase] Fetching global server state from cloud tables...');
    const [
      { data: users, error: usersErr },
      { data: wallets, error: walletsErr },
      { data: dues, error: duesErr },
      { data: shuttles, error: shuttlesErr },
      { data: hotlist, error: hotlistErr },
      { data: transactions, error: txErr },
      { data: alerts, error: alertsErr },
    ] = await Promise.all([
      db.from('users').select('*'),
      db.from('wallets').select('*'),
      db.from('dues').select('*'),
      db.from('shuttles').select('*'),
      db.from('hotlist').select('*'),
      db.from('transactions').select('*').order('created_at', { ascending: false }).limit(500),
      db.from('alerts').select('*').order('created_at', { ascending: false }),
    ]);

    if (usersErr || walletsErr || duesErr || shuttlesErr || hotlistErr || txErr || alertsErr) {
      console.error('[Supabase] Fetch error details:', {
        usersErr,
        walletsErr,
        duesErr,
        shuttlesErr,
        hotlistErr,
        txErr,
        alertsErr,
      });
    }

    const normalizedUsers = (users || []).map(normalizeUser);

    return {
      users: normalizedUsers,
      wallets: (wallets || []).reduce(
        (acc, curr) => ({ ...acc, [curr.user_id]: Number(curr.balance) }),
        {}
      ),
      dues: (dues || []).reduce(
        (acc, curr) => ({
          ...acc,
          [curr.user_id]: { amount: Number(curr.amount), since: curr.since },
        }),
        {}
      ),
      shuttles: (shuttles || []).map(normalizeShuttle),
      hotlist: (hotlist || []).reduce(
        (acc, curr) => ({ ...acc, [curr.card_uid]: curr.expires_at }),
        {}
      ),
      transactions: (transactions || []).map(normalizeTx),
      alerts: (alerts || []).map((a) => ({
        id: a.id,
        text: a.text,
        audience: a.audience,
        expiresAt: a.expires_at,
        createdAt: a.created_at,
      })),
      cards: normalizedUsers.reduce((acc, u) => {
        if (u.cardUid) acc[u.cardUid] = u.id;
        return acc;
      }, {}),
    };
  } catch (e) {
    console.error('Error fetching from Supabase:', e);
    return {
      users: [],
      wallets: {},
      dues: {},
      shuttles: [],
      hotlist: {},
      transactions: [],
      alerts: [],
      cards: {},
    };
  }
}

export function saveServerState(state) {
  console.warn('saveServerState is deprecated. Use specific Supabase update calls instead.');
  return state;
}

export async function clearDummyData() {
  const db = dbClient();
  const { data: users } = await db.from('users').select('id, role');
  const toRemove = (users || []).filter((u) => u.role !== 'admin').map((u) => u.id);
  for (const id of toRemove) {
    try {
      await db.auth.admin.deleteUser(id);
    } catch (e) {
      await db.from('users').delete().eq('id', id);
    }
  }
  await db.from('transactions').delete().neq('id', '0');
  await db.from('alerts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  return getServerState();
}
