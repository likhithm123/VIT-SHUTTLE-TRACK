import { getServerState, clearDummyData } from '../../lib/serverDb';
import { getServiceRoleClient } from '../../lib/supabaseClient';
import { defaultPassword, getFine, normalizeUser, routeStartLatLng } from '../../lib/demoData';

function campusEmail(regNo) {
  return `${String(regNo).trim().toLowerCase()}@campus.shuttle`;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const db = await getServerState();
    return res.json(db);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const svc = getServiceRoleClient();
  if (!svc) {
    return res.status(503).json({ error: 'Supabase service role is not configured' });
  }

  const { action, ...payload } = req.body || {};

  try {
    switch (action) {
      case 'get_state': {
        const db = await getServerState();
        return res.json(db);
      }

      case 'add_money':
        return handleAddMoney(svc, payload, res);

      case 'withdraw':
        return handleWithdraw(svc, payload, res);

      case 'add_student':
        return handleAddStudent(svc, payload, res);

      case 'add_driver':
        return handleAddDriver(svc, payload, res);

      case 'delete_user':
        return handleDeleteUser(svc, payload, res);

      case 'reset_password':
        return handleResetPassword(svc, payload, res);

      case 'revert_password':
        return handleRevertPassword(svc, payload, res);

      case 'map_nfc':
        return handleMapNfc(svc, payload, res);

      case 'send_alert':
        return handleSendAlert(svc, payload, res);

      case 'delete_alert':
        return handleDeleteAlert(svc, payload, res);

      case 'clear_dummy': {
        const db = await clearDummyData();
        return res.json(db);
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action || '(missing)'}` });
    }
  } catch (error) {
    console.error('[state API]', action, error);
    return res.status(500).json({ error: error.message || 'Database error' });
  }
}

async function handleAddMoney(svc, { userId, amount }, res) {
  const numAmount = Number(amount);
  if (!userId || !numAmount || numAmount <= 0) {
    return res.status(400).json({ error: 'Valid User ID and Amount are required' });
  }

  const { data: due } = await svc.from('dues').select('*').eq('user_id', userId).maybeSingle();
  let toWallet = numAmount;

  if (due && due.amount > 0) {
    const fine = getFine(due.since);
    const totalDebt = Number(due.amount) + fine;
    if (numAmount >= totalDebt) {
      toWallet = numAmount - totalDebt;
      await svc.from('dues').delete().eq('user_id', userId);
    } else {
      await svc
        .from('dues')
        .update({ amount: totalDebt - numAmount })
        .eq('user_id', userId);
      toWallet = 0;
    }
  }

  const { data: wallet } = await svc.from('wallets').select('balance').eq('user_id', userId).maybeSingle();
  const newBalance = Number(wallet?.balance || 0) + toWallet;
  await svc.from('wallets').upsert({ user_id: userId, balance: newBalance });
  return res.status(200).json({ success: true, wallet: newBalance });
}

async function handleWithdraw(svc, { userId, amount }, res) {
  const numAmount = Number(amount);
  if (!userId || !numAmount || numAmount <= 0) {
    return res.status(400).json({ error: 'Valid User ID and Amount are required' });
  }

  const { data: wallet } = await svc.from('wallets').select('balance').eq('user_id', userId).maybeSingle();
  if (!wallet || Number(wallet.balance) < numAmount) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  const newBalance = Number(wallet.balance) - numAmount;
  await svc.from('wallets').update({ balance: newBalance }).eq('user_id', userId);
  return res.status(200).json({ success: true, wallet: newBalance });
}

async function handleAddStudent(svc, { name, regNo, cardUid, passoutYear }, res) {
  if (!name || !regNo) {
    return res.status(400).json({ error: 'Name and Registration Number are required' });
  }

  const { data: existing } = await svc.from('users').select('id').eq('reg_no', regNo).maybeSingle();
  if (existing) {
    return res.status(400).json({ error: 'Student already exists with this Reg No' });
  }

  const password = defaultPassword(regNo);
  const { data: auth, error: authErr } = await svc.auth.admin.createUser({
    email: campusEmail(regNo),
    password,
    email_confirm: true,
  });
  if (authErr || !auth.user) {
    return res.status(400).json({ error: authErr?.message || 'Failed to create auth user' });
  }

  const { error: profileErr } = await svc.from('users').insert({
    id: auth.user.id,
    name,
    role: 'student',
    reg_no: regNo,
    card_uid: cardUid || null,
    passout_year: Number(passoutYear) || new Date().getFullYear() + 4,
    needs_password_reset: true,
  });
  if (profileErr) {
    await svc.auth.admin.deleteUser(auth.user.id);
    return res.status(400).json({ error: profileErr.message });
  }

  return res.json({ success: true, user: normalizeUser({ id: auth.user.id, name, role: 'student', reg_no: regNo, card_uid: cardUid, needs_password_reset: true, passout_year: passoutYear }) });
}

async function handleAddDriver(svc, { name, regNo, vehicleNo, route }, res) {
  if (!name || !regNo || !vehicleNo) {
    return res.status(400).json({ error: 'Name, Driver ID, and Vehicle Number are required' });
  }

  const { data: existing } = await svc.from('users').select('id').eq('reg_no', regNo).maybeSingle();
  if (existing) {
    return res.status(400).json({ error: 'Driver already exists with this ID' });
  }

  const password = defaultPassword(regNo);
  const { data: auth, error: authErr } = await svc.auth.admin.createUser({
    email: campusEmail(regNo),
    password,
    email_confirm: true,
  });
  if (authErr || !auth.user) {
    return res.status(400).json({ error: authErr?.message || 'Failed to create auth user' });
  }

  const driverId = auth.user.id;
  const { error: profileErr } = await svc.from('users').insert({
    id: driverId,
    name,
    role: 'driver',
    reg_no: regNo,
    card_uid: regNo,
    needs_password_reset: true,
  });
  if (profileErr) {
    await svc.auth.admin.deleteUser(driverId);
    return res.status(400).json({ error: profileErr.message });
  }

  const shuttleId = `bus-${Date.now()}`;
  const start = routeStartLatLng(route || 'A');
  await svc.from('shuttles').insert({
    id: shuttleId,
    vehicle_no: vehicleNo,
    driver_id: driverId,
    route: route || 'A',
    status: 'running',
    lat: start.lat,
    lng: start.lng,
    heading: 0,
  });

  return res.json({
    success: true,
    user: normalizeUser({ id: driverId, name, role: 'driver', reg_no: regNo, card_uid: regNo, needs_password_reset: true }),
  });
}

async function handleDeleteUser(svc, { userId }, res) {
  if (!userId) return res.status(400).json({ error: 'User ID is required' });
  await svc.auth.admin.deleteUser(userId);
  return res.json({ success: true });
}

async function handleResetPassword(svc, { userId, newPassword }, res) {
  if (!userId || !newPassword) {
    return res.status(400).json({ error: 'User ID and new password are required' });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const { error: authErr } = await svc.auth.admin.updateUserById(userId, { password: newPassword });
  if (authErr) return res.status(400).json({ error: authErr.message });

  const { data: profile } = await svc
    .from('users')
    .update({ needs_password_reset: false })
    .eq('id', userId)
    .select('*')
    .single();

  return res.json({ success: true, user: normalizeUser(profile) });
}

async function handleRevertPassword(svc, { userId }, res) {
  if (!userId) return res.status(400).json({ error: 'User ID is required' });

  const { data: profile, error } = await svc.from('users').select('*').eq('id', userId).single();
  if (error || !profile) return res.status(404).json({ error: 'User not found' });

  const password = defaultPassword(profile.reg_no);
  const { error: authErr } = await svc.auth.admin.updateUserById(userId, { password });
  if (authErr) return res.status(400).json({ error: authErr.message });

  const { data: updated } = await svc
    .from('users')
    .update({ needs_password_reset: true })
    .eq('id', userId)
    .select('*')
    .single();

  return res.json({ success: true, user: normalizeUser(updated) });
}

async function handleMapNfc(svc, { userId, cardUid }, res) {
  if (!userId || !cardUid) {
    return res.status(400).json({ error: 'User ID and Card UID are required' });
  }
  const { error } = await svc.from('users').update({ card_uid: String(cardUid).trim() }).eq('id', userId);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ success: true });
}

async function handleSendAlert(svc, { text, audience, expiresAt }, res) {
  if (!text || !expiresAt) {
    return res.status(400).json({ error: 'Text and expiry date are required' });
  }
  const { data, error } = await svc
    .from('alerts')
    .insert({
      text,
      audience: audience || 'all',
      expires_at: new Date(expiresAt).toISOString(),
    })
    .select('*')
    .single();
  if (error) return res.status(400).json({ error: error.message });
  return res.json({
    success: true,
    alert: {
      id: data.id,
      text: data.text,
      audience: data.audience,
      expiresAt: data.expires_at,
      createdAt: data.created_at,
    },
  });
}

async function handleDeleteAlert(svc, { alertId }, res) {
  if (!alertId) return res.status(400).json({ error: 'Alert ID is required' });
  await svc.from('alerts').delete().eq('id', alertId);
  return res.json({ success: true });
}
