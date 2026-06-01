import { getServiceRoleClient } from '../../lib/supabaseClient';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { shuttle_id, route, status, lat, lng, vehicle_number, heading } = req.body || {};
  if (!shuttle_id) return res.status(400).json({ error: 'shuttle_id required' });

  const svc = getServiceRoleClient();
  if (!svc) {
    return res.status(503).json({ error: 'Supabase service role is not configured' });
  }

  const patch = {};
  if (route) patch.route = route;
  if (status) patch.status = status;
  if (vehicle_number) patch.vehicle_no = vehicle_number;
  if (heading !== undefined) patch.heading = Number(heading);
  if (lat != null && lng != null) {
    patch.lat = Number(lat);
    patch.lng = Number(lng);
    patch.last_seen = new Date().toISOString();
  }

  if (Object.keys(patch).length === 0) {
    return res.json({ ok: true, skipped: true });
  }

  const { error } = await svc.from('shuttles').update(patch).eq('id', shuttle_id);
  if (error) {
    console.error('[update-route]', error.message);
    return res.status(500).json({ error: error.message });
  }

  return res.json({ ok: true });
}
