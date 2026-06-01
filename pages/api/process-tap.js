import { getServerState, saveServerState } from '../../lib/serverDb';
import { getServiceRoleClient } from '../../lib/supabaseClient';

const FARE = 15;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { card_uid, driver_id, shuttle_id, route, vehicle_no } = req.body;
  if (!card_uid) return res.status(400).json({ error: 'card_uid required' });

  // Update serverDb.json state
  const db = getServerState();
  
  // Initialize hotlist
  db.hotlist = db.hotlist || {};

  // Check if card is in hotlist
  if (db.hotlist[card_uid] && Date.now() < db.hotlist[card_uid]) {
    const remaining = Math.ceil((db.hotlist[card_uid] - Date.now()) / 1000);
    return res.status(409).json({ error: `Card is hotlisted. Please wait ${remaining}s.` });
  }

  // Find user by card
  let userId = db.cards[card_uid];
  if (!userId) {
    // Fallback: search users for cardUid match
    const foundUser = db.users.find(u => u.cardUid === card_uid);
    if (foundUser) userId = foundUser.id;
  }

  if (!userId) {
    return res.status(404).json({ error: 'Card not mapped to any user' });
  }

  const user = db.users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Calculate fare / dues
  const balance = Number(db.wallets[userId] || 0);
  if (balance < FARE) {
    const dueObj = db.dues[userId] || { amount: 0, since: new Date().toISOString() };
    dueObj.amount += (FARE - balance);
    db.dues[userId] = dueObj;
    db.wallets[userId] = 0;
  } else {
    db.wallets[userId] = balance - FARE;
  }

  // Record transaction
  const txId = `TX${Date.now()}`;
  const row = {
    id: txId,
    userId,
    driverId: driver_id || null,
    shuttleId: shuttle_id || null,
    route: route || 'A',
    vehicleNo: vehicle_no || 'Vehicle',
    amount: FARE,
    status: 'success',
    cardUid: card_uid,
    createdAt: new Date().toISOString()
  };
  db.transactions.unshift(row);

  // Set 10-second hotlist for ALL cards to prevent duplicate charges
  db.hotlist[card_uid] = Date.now() + 10000;

  saveServerState(db);

  // Also push to Supabase if configured
  const svc = getServiceRoleClient();
  if (svc) {
    try {
      await svc.rpc('sp_process_transaction', {
        p_user_id: userId,
        p_shuttle_id: shuttle_id,
        p_amount: FARE,
        p_card_uid: card_uid
      });
    } catch (e) {
      console.error('Supabase transaction process failed:', e);
    }
  }

  return res.json({
    ok: true,
    result: row,
    cooldownRemaining: 10,
    tapTime: row.createdAt,
    userName: user.name,
    userRegNo: user.regNo,
    cardUid: card_uid
  });
}
