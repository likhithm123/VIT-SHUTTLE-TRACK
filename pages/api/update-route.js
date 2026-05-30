import { getServiceRoleClient } from '../../lib/supabaseClient';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { shuttle_id, route, status, lat, lng, vehicle_number } = req.body || {};
  if (!shuttle_id) return res.status(400).json({ error: 'shuttle_id required' });
  const svc = getServiceRoleClient();
  if (!svc) return res.json({ ok: true, mode: 'local-demo' });

  const patch = {};
  if (route) patch.route = route;
  if (status) patch.status = status;
  if (vehicle_number) patch.vehicle_number = vehicle_number;
  if (lat && lng) {
    patch.current_lat = lat;
    patch.current_lng = lng;
    patch.last_seen = new Date().toISOString();
  }

  const { error } = await svc.from('shuttles').update(patch).eq('id', shuttle_id);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
}
