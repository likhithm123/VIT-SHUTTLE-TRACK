import { getServerState, saveServerState } from '../../lib/serverDb';
import { getServiceRoleClient } from '../../lib/supabaseClient';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { shuttle_id, route, status, lat, lng, vehicle_number, heading } = req.body || {};
  if (!shuttle_id) return res.status(400).json({ error: 'shuttle_id required' });

  // Update serverDb.json state
  const db = getServerState();
  const bus = db.shuttles.find(s => s.id === shuttle_id);
  if (bus) {
    if (route) bus.route = route;
    if (status) bus.status = status;
    if (vehicle_number) bus.vehicleNo = vehicle_number;
    if (heading !== undefined) bus.heading = Number(heading);
    if (lat && lng) {
      bus.lat = Number(lat);
      bus.lng = Number(lng);
      bus.lastSeen = new Date().toISOString();
    }
    saveServerState(db);
  }

  // Also push to Supabase if configured
  const svc = getServiceRoleClient();
  if (svc) {
    const patch = {};
    if (route) patch.route = route;
    if (status) patch.status = status;
    if (vehicle_number) patch.vehicle_number = vehicle_number;
    if (heading !== undefined) patch.heading = Number(heading);
    if (lat && lng) {
      patch.current_lat = lat;
      patch.current_lng = lng;
      patch.last_seen = new Date().toISOString();
    }
    await svc.from('shuttles').update(patch).eq('id', shuttle_id);
  }

  return res.json({ ok: true });
}
