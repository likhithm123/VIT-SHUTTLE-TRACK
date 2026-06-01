export const FARE = 15;
export const GRACE_DAYS = 15;
export const FINE_PER_DAY = 5;

export const USERS = [];

export const ROUTES = {
  A: [[12.9729, 79.1586], [12.9715, 79.1608], [12.9695, 79.1622], [12.9678, 79.1637]],
  B: [[12.9724, 79.1552], [12.9709, 79.1531], [12.9686, 79.1518], [12.9669, 79.1507]],
  C: [
    [12.9692, 79.1559], [12.9680, 79.1550], [12.9670, 79.1540],
    [12.9660, 79.1530], [12.9675, 79.1520], [12.9690, 79.1535], [12.9700, 79.1550],
  ],
};

export const ROUTE_LABELS = {
  A: 'SJT / PRP Green Route',
  B: 'Mens Hostel Blue Route',
  C: 'Out of Campus Yellow Route',
};

export const BASE_SHUTTLES = [
  { id: 'bus-a1', vehicleNo: 'VIT-A-101', driverId: 'drv-001', route: 'A', status: 'running', lat: 12.9729, lng: 79.1586 },
  { id: 'bus-b1', vehicleNo: 'VIT-B-202', driverId: 'drv-002', route: 'B', status: 'running', lat: 12.9724, lng: 79.1552 },
];

export function routeColor(route) {
  if (route === 'B') return '#2563eb';
  if (route === 'C') return '#ffcc00';
  return '#16a34a';
}

export function money(value) {
  return `Rs ${Number(value || 0).toFixed(0)}`;
}

export function getFine(dueSince, now = Date.now()) {
  if (!dueSince) return 0;
  const days = Math.floor((now - new Date(dueSince).getTime()) / 86400000);
  return Math.max(0, days - GRACE_DAYS) * FINE_PER_DAY;
}

export function loadState() {
  console.warn('loadState is deprecated. Data should be fetched from Supabase via getServerState.');
  return {};
}

export function saveState() {
  console.error('saveState is deprecated. Use API routes to update Supabase directly.');
  return null;
}

export function authUser() {
  console.warn('Local authUser is deprecated. Use Supabase Auth via /api/login.');
  return null;
}

export function defaultPassword(regNo) {
  return `${String(regNo || '').trim()}@123`;
}

export function cleanupPassedOut(users, wallets, year = new Date().getFullYear()) {
  return users.filter(
    (u) =>
      u.role !== 'student' ||
      !u.passoutYear ||
      Number(u.passoutYear) >= year ||
      Number(wallets[u.id] || 0) !== 0
  );
}

export function logout() {
  localStorage.removeItem('cs_user');
  if (typeof window !== 'undefined') {
    import('./authSession').then(({ clearAuthSession }) => clearAuthSession());
  }
  location.href = '/';
}

export function normalizeShuttleStatus(status) {
  const s = String(status || 'not started').trim().toLowerCase();
  if (s === 'running') return 'running';
  if (s === 'maintenance') return 'maintenance';
  return 'not started';
}

export function isShuttleRunning(shuttle) {
  if (!shuttle) return false;
  return normalizeShuttleStatus(shuttle.status) === 'running';
}

/** Shuttles visible on the live map (running + valid coordinates). */
export function runningShuttles(shuttles = []) {
  return shuttles.filter(
    (s) => isShuttleRunning(s) && Number(s.lat) && Number(s.lng)
  );
}

export function normalizeShuttle(row) {
  if (!row) return null;
  const status = normalizeShuttleStatus(
    row.status || (row.active === false ? 'not started' : 'running')
  );
  return {
    id: row.id,
    vehicleNo: row.vehicleNo || row.vehicle_no || row.vehicle_number,
    route: row.route || 'A',
    status,
    driverId: row.driverId || row.driver_id,
    lat: row.lat ?? row.current_lat,
    lng: row.lng ?? row.current_lng,
    heading: row.heading ?? 0,
    lastSeen: row.lastSeen || row.last_seen,
  };
}

export function normalizeTx(row) {
  const meta = row.metadata || {};
  return {
    id: row.id,
    userId: row.userId || row.user_id,
    driverId: row.driverId || row.driver_id,
    shuttleId: row.shuttleId || row.shuttle_id,
    route: row.route || meta.route,
    vehicleNo: row.vehicleNo || meta.vehicleNo || meta.vehicle_number,
    amount: Number(row.amount || 0),
    status: row.status || 'success',
    cardUid: row.cardUid || meta.card_uid,
    createdAt: row.createdAt || row.created_at,
  };
}

export function normalizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    regNo: row.regNo || row.reg_no,
    cardUid: row.cardUid || row.card_uid,
    needsPasswordReset: row.needsPasswordReset ?? row.needs_password_reset,
    passoutYear: row.passoutYear || row.passout_year,
  };
}

export function allUsers(state) {
  if (!state) {
    console.warn('allUsers called without state. Ensure Supabase data is loaded.');
    return USERS;
  }
  const s = state;
  const deleted = new Set(s.deletedUsers || []);
  return [...USERS, ...(s.extraUsers || [])].filter((u) => !deleted.has(u.id));
}

export function isAdmin(user) {
  return user?.role === 'admin';
}

export function activeAlerts(state, now = Date.now()) {
  return ((state || {}).alerts || []).filter(
    (a) => !a.expiresAt || new Date(a.expiresAt).getTime() > now
  );
}

export function routeStartLatLng(route) {
  if (route === 'B') return { lat: 12.9724, lng: 79.1552 };
  if (route === 'C') return { lat: 12.9692, lng: 79.1559 };
  return { lat: 12.9729, lng: 79.1586 };
}
