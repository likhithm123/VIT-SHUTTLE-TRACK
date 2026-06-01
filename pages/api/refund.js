import { getServiceRoleClient } from '../../lib/supabaseClient';

async function refundDirect(svc, id, admin_id, reason) {
  const { data: tx, error } = await svc.from('transactions').select('*').eq('id', id).single();
  if (error || !tx) return { error: 'Transaction not found' };
  if (tx.status === 'refunded') return { error: 'Transaction already refunded' };

  const meta = { ...(tx.metadata || {}), refunded_at: new Date().toISOString() };
  if (admin_id) meta.refunded_by = admin_id;
  if (reason) meta.refund_reason = reason;

  const { error: txErr } = await svc
    .from('transactions')
    .update({ status: 'refunded', metadata: meta })
    .eq('id', id);
  if (txErr) return { error: txErr.message };

  const { data: wallet } = await svc.from('wallets').select('balance').eq('user_id', tx.user_id).maybeSingle();
  const newBalance = Number(wallet?.balance || 0) + Number(tx.amount || 0);
  const { error: walletErr } = await svc.from('wallets').upsert({ user_id: tx.user_id, balance: newBalance });
  if (walletErr) return { error: walletErr.message };

  return { ok: true, result: { tx_id: id, wallet_balance: newBalance } };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  const svc = getServiceRoleClient();
  if (!svc) return res.json({ ok: true, mode: 'local-demo', id });

  const admin_id = req.body.admin_id || null;
  const reason = req.body.reason || null;

  try {
    const rpc = await svc.rpc('sp_refund_transaction', {
      p_tx_id: id,
      p_admin_id: admin_id,
      p_reason: reason,
    });

    if (!rpc.error) {
      return res.json({ ok: true, result: rpc.data });
    }

    const isMissingRpc =
      rpc.error.code === 'PGRST202' ||
      rpc.error.message?.includes('sp_refund_transaction') ||
      rpc.error.message?.includes('Could not find the function');

    if (!isMissingRpc) {
      console.error('rpc error', rpc.error);
      const direct = await refundDirect(svc, id, admin_id, reason);
      if (direct.error) return res.status(400).json({ error: direct.error });
      return res.json(direct);
    }

    const direct = await refundDirect(svc, id, admin_id, reason);
    if (direct.error) return res.status(400).json({ error: direct.error });
    return res.json(direct);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server' });
  }
}
