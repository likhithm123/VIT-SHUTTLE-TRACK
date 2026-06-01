import { getServerState, saveServerState } from '../../lib/serverDb';
import { getServiceRoleClient } from '../../lib/supabaseClient';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { id, admin_id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  // Update serverDb.json state
  const db = getServerState();
  const tx = db.transactions.find(t => t.id === id);
  if (tx && tx.status !== 'refunded') {
    tx.status = 'refunded';
    const userId = tx.userId;
    db.wallets[userId] = Number(db.wallets[userId] || 0) + tx.amount;
    saveServerState(db);
  }

  // Also push to Supabase if configured
  const svc = getServiceRoleClient();
  if (svc) {
    try {
      const reason = req.body.reason || null;
      await svc.rpc('sp_refund_transaction', { p_tx_id: id, p_admin_id: admin_id || null, p_reason: reason });
    } catch (e) {
      console.error('Supabase refund failed:', e);
    }
  }

  return res.json({ ok: true });
}
