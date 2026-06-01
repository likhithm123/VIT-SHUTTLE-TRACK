import { getServiceRoleClient } from '../../lib/supabaseClient';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  const svc = getServiceRoleClient();
  if (!svc) return res.json({ ok: true, mode: 'local-demo', id });

  try {
    const admin_id = req.body.admin_id || null;
    const reason = req.body.reason || null;
    const rpc = await svc
      .rpc('sp_refund_transaction', { p_tx_id: id, p_admin_id: admin_id, p_reason: reason })
      .single();
    if (rpc.error) {
      console.error('rpc error', rpc.error);
      return res.status(500).json({ error: 'rpc_error' });
    }
    return res.json({ ok: true, result: rpc.data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server' });
  }
}
