import { getServiceRoleClient } from '../../lib/supabaseClient';
import { normalizeTx, normalizeUser } from '../../lib/demoData';

const FARE = 15;
const HOTLIST_MS = 10000;

function tapResponse(payload) {
  return {
    ok: true,
    result: payload.result,
    cooldownRemaining: 10,
    tapTime: payload.tapTime,
    userName: payload.userName,
    userRegNo: payload.userRegNo,
    cardUid: payload.cardUid,
    synced: payload.synced || false,
  };
}

function fromRpcRow(data) {
  return tapResponse({
    tapTime: data.tap_time,
    userName: data.user_name,
    userRegNo: data.user_reg_no,
    cardUid: data.card_uid,
    synced: data.synced || false,
    result: data.tx_id ? { id: data.tx_id } : undefined,
  });
}

async function processTapRpc(svc, body, txId) {
  const { card_uid, driver_id, shuttle_id, route, vehicle_no, queue_id, queued_at } = body;
  const rpc = await svc.rpc('sp_process_tap', {
    p_card_uid: card_uid,
    p_driver_id: driver_id || null,
    p_shuttle_id: shuttle_id || null,
    p_route: route || 'A',
    p_vehicle_no: vehicle_no || 'Vehicle',
    p_tx_id: txId,
    p_fare: FARE,
    p_hotlist_ms: HOTLIST_MS,
    p_queue_id: queue_id || null,
    p_queued_at: queued_at || null,
  });

  if (rpc.error) {
    const msg = rpc.error.message || '';
    if (msg.includes('hotlisted')) {
      const wait = msg.match(/(\d+)/);
      return { status: 409, error: msg };
    }
    if (msg.includes('not mapped')) return { status: 404, error: 'Card not mapped to any user' };
    return { status: 500, error: msg || 'rpc_error' };
  }

  return { status: 200, data: fromRpcRow(rpc.data) };
}

/** Fallback when sp_process_tap is not deployed — minimal sequential queries */
async function processTapLegacy(svc, body, txId) {
  const { card_uid, driver_id, shuttle_id, route, vehicle_no, queue_id, queued_at } = body;
  const now = Date.now();

  if (queue_id) {
    const { data: existingTx } = await svc.from('transactions').select('id, user_id, created_at').eq('id', txId).maybeSingle();
    if (existingTx) {
      const { data: profile } = await svc.from('users').select('name, reg_no').eq('id', existingTx.user_id).single();
      return {
        status: 200,
        data: tapResponse({
          tapTime: existingTx.created_at,
          userName: profile?.name || 'Student',
          userRegNo: profile?.reg_no || '',
          cardUid: card_uid,
          synced: true,
        }),
      };
    }
  }

  const [{ data: hotRow }, { data: cardUser }] = await Promise.all([
    svc.from('hotlist').select('expires_at').eq('card_uid', card_uid).maybeSingle(),
    svc.from('users').select('id, name, reg_no').eq('card_uid', card_uid).eq('role', 'student').maybeSingle(),
  ]);

  if (hotRow?.expires_at && now < Number(hotRow.expires_at)) {
    const remaining = Math.ceil((Number(hotRow.expires_at) - now) / 1000);
    return { status: 409, error: `Card is hotlisted. Please wait ${remaining}s.` };
  }
  if (!cardUser) return { status: 404, error: 'Card not mapped to any user' };

  const [{ data: wallet }, { data: due }] = await Promise.all([
    svc.from('wallets').select('balance').eq('user_id', cardUser.id).maybeSingle(),
    svc.from('dues').select('amount, since').eq('user_id', cardUser.id).maybeSingle(),
  ]);

  const balance = Number(wallet?.balance || 0);
  if (balance < FARE) {
    const dueAmount = Number(due?.amount || 0) + (FARE - balance);
    await svc.from('dues').upsert({
      user_id: cardUser.id,
      amount: dueAmount,
      since: due?.since || new Date().toISOString(),
    });
    await svc.from('wallets').upsert({ user_id: cardUser.id, balance: 0 });
  } else {
    await svc.from('wallets').upsert({ user_id: cardUser.id, balance: balance - FARE });
  }

  const createdAt = new Date().toISOString();
  const txRow = {
    id: txId,
    user_id: cardUser.id,
    driver_id: driver_id || null,
    shuttle_id: shuttle_id || null,
    route: route || 'A',
    amount: FARE,
    status: 'success',
    metadata: {
      card_uid,
      vehicle_no: vehicle_no || 'Vehicle',
      route: route || 'A',
      ...(queue_id ? { queue_id, queued_at: queued_at || null, offline_sync: true } : {}),
    },
    created_at: createdAt,
  };

  await Promise.all([
    svc.from('transactions').insert(txRow),
    svc.from('hotlist').upsert({ card_uid, expires_at: now + HOTLIST_MS }),
  ]);

  return {
    status: 200,
    data: tapResponse({
      tapTime: createdAt,
      userName: cardUser.name,
      userRegNo: cardUser.reg_no,
      cardUid: card_uid,
      result: normalizeTx(txRow),
    }),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const body = req.body || {};
  const { card_uid, queue_id } = body;
  if (!card_uid) return res.status(400).json({ error: 'card_uid required' });

  const svc = getServiceRoleClient();
  if (!svc) return res.status(503).json({ error: 'Supabase service role is not configured' });

  const txId = queue_id
    ? `OFF-${String(queue_id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)}`
    : `TX${Date.now()}`;

  try {
    let outcome = await processTapRpc(svc, body, txId);
    const missingRpc =
      outcome.status === 500 &&
      (outcome.error?.includes('sp_process_tap') || outcome.error?.includes('Could not find the function'));
    if (missingRpc) {
      outcome = await processTapLegacy(svc, body, txId);
    }

    if (outcome.status !== 200) {
      return res.status(outcome.status).json({ error: outcome.error });
    }
    return res.json(outcome.data);
  } catch (e) {
    console.error('[process-tap]', e);
    return res.status(500).json({ error: 'server' });
  }
}
