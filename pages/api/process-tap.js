import { getServiceRoleClient } from '../../lib/supabaseClient';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { card_uid, driver_id, shuttle_id, route, vehicle_no } = req.body;
  if (!card_uid) return res.status(400).json({ error: 'card_uid required' });

  const svc = getServiceRoleClient();
  if (!svc) return res.json({ ok: true, mode: 'local-demo', result: { card_uid, driver_id, shuttle_id } });

  // check hotlist first
  const { data: hot } = await svc.from('hotlist').select('until').eq('card_uid', card_uid).order('until', { ascending: false }).limit(1);
  if (hot && hot[0] && new Date(hot[0].until) > new Date()) {
    return res.status(409).json({ error: 'card hotlisted' });
  }

  // find user by card
  const { data: cards } = await svc.from('nfc_cards').select('user_id').eq('card_uid', card_uid).limit(1);
  if (!cards || !cards[0]) return res.status(404).json({ error: 'card not found' });
  const user_id = cards[0].user_id;

  // amount to debit (fixed fare for prototype)
  const amount = 15;

  try{
    // Call the atomic Postgres function to process transaction
    const rpc = await svc.rpc('sp_process_transaction', { p_user_id: user_id, p_shuttle_id: shuttle_id, p_amount: amount, p_card_uid: card_uid }).single();
    if (rpc.error) {
      console.error('rpc error', rpc.error);
      return res.status(500).json({ error: 'rpc_error' });
    }
    return res.json({ ok: true, result: rpc.data });
  }catch(err){
    console.error(err);
    return res.status(500).json({ error: 'server' });
  }
}
