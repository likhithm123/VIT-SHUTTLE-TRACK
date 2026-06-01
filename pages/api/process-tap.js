import { getServerState } from '../../lib/serverDb';
import { getServiceRoleClient } from '../../lib/supabaseClient';
import { normalizeTx, normalizeUser } from '../../lib/demoData';

const FARE = 15;
const HOTLIST_MS = 10000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { card_uid, driver_id, shuttle_id, route, vehicle_no } = req.body;
  if (!card_uid) return res.status(400).json({ error: 'card_uid required' });

  const svc = getServiceRoleClient();
  if (!svc) return res.status(503).json({ error: 'Supabase service role is not configured' });

  try {
    const state = await getServerState();
    const now = Date.now();
    const hotlistExpiry = state.hotlist?.[card_uid];
    if (hotlistExpiry && now < Number(hotlistExpiry)) {
      const remaining = Math.ceil((Number(hotlistExpiry) - now) / 1000);
      return res.status(409).json({ error: `Card is hotlisted. Please wait ${remaining}s.` });
    }

    let userId = state.cards?.[card_uid];
    if (!userId) {
      const match = (state.users || []).find((u) => u.cardUid === card_uid);
      userId = match?.id;
    }
    if (!userId) {
      return res.status(404).json({ error: 'Card not mapped to any user' });
    }

    const { data: profile } = await svc.from('users').select('*').eq('id', userId).single();
    if (!profile) return res.status(404).json({ error: 'User not found' });

    const { data: wallet } = await svc.from('wallets').select('balance').eq('user_id', userId).maybeSingle();
    const balance = Number(wallet?.balance || 0);
    const { data: due } = await svc.from('dues').select('*').eq('user_id', userId).maybeSingle();

    if (balance < FARE) {
      const dueAmount = Number(due?.amount || 0) + (FARE - balance);
      await svc.from('dues').upsert({
        user_id: userId,
        amount: dueAmount,
        since: due?.since || new Date().toISOString(),
      });
      await svc.from('wallets').upsert({ user_id: userId, balance: 0 });
    } else {
      await svc
        .from('wallets')
        .upsert({ user_id: userId, balance: balance - FARE });
    }

    const txId = `TX${Date.now()}`;
    const txRow = {
      id: txId,
      user_id: userId,
      driver_id: driver_id || null,
      shuttle_id: shuttle_id || null,
      route: route || 'A',
      amount: FARE,
      status: 'success',
      metadata: {
        card_uid,
        vehicle_no: vehicle_no || 'Vehicle',
        route: route || 'A',
      },
    };

    const { error: txErr } = await svc.from('transactions').insert(txRow);
    if (txErr) {
      console.error('[process-tap] insert tx:', txErr.message);
      return res.status(500).json({ error: txErr.message });
    }

    await svc.from('hotlist').upsert({
      card_uid,
      expires_at: now + HOTLIST_MS,
    });

    const row = normalizeTx({
      ...txRow,
      created_at: new Date().toISOString(),
    });
    const user = normalizeUser(profile);

    return res.json({
      ok: true,
      result: row,
      cooldownRemaining: 10,
      tapTime: row.createdAt,
      userName: user.name,
      userRegNo: user.regNo,
      cardUid: card_uid,
    });
  } catch (e) {
    console.error('[process-tap]', e);
    return res.status(500).json({ error: 'server' });
  }
}
