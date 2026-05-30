export const FARE = 15;
export const GRACE_DAYS = 15;
export const FINE_PER_DAY = 5;

export const USERS = [
  { id: 'stu-001', role: 'student', name: 'Aarav Student', regNo: 'REG1001', password: 'REG1001@123', cardUid: 'CARD1001', passoutYear: 2028 },
  { id: 'drv-001', role: 'driver', name: 'Ravi Green', regNo: 'DRV01', password: 'DRV01@123', cardUid: 'DRIVER-A' },
  { id: 'drv-002', role: 'driver', name: 'Kumar Blue', regNo: 'DRV02', password: 'DRV02@123', cardUid: 'DRIVER-B' },
  { id: 'adm-001', role: 'admin', name: 'Campus Admin', regNo: 'ADMIN', password: 'admin123', cardUid: 'ADMIN' },
];

export const ROUTES = {
  A: [[12.9729, 79.1586], [12.9715, 79.1608], [12.9695, 79.1622], [12.9678, 79.1637]],
  B: [[12.9724, 79.1552], [12.9709, 79.1531], [12.9686, 79.1518], [12.9669, 79.1507]],
};

export const ROUTE_LABELS = { A: 'SJT / PRP Green Route', B: 'Mens Hostel Blue Route' };
export const BASE_SHUTTLES = [
  { id: 'bus-a1', vehicleNo: 'VIT-A-101', driverId: 'drv-001', route: 'A', status: 'running', lat: 12.9729, lng: 79.1586 },
  { id: 'bus-b1', vehicleNo: 'VIT-B-202', driverId: 'drv-002', route: 'B', status: 'running', lat: 12.9724, lng: 79.1552 },
];

export function routeColor(route) {
  return route === 'B' ? '#2563eb' : '#16a34a';
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
  if (typeof window === 'undefined') return {};
  const seed = {
    wallets: { 'stu-001': 120 },
    dues: {},
    shuttles: BASE_SHUTTLES,
    transactions: [],
    extraUsers: [],
    deletedUsers: [],
    alerts: [],
    cards: { CARD1001: 'stu-001' },
  };
  const raw = localStorage.getItem('campus_shuttle_state');
  if (!raw) {
    localStorage.setItem('campus_shuttle_state', JSON.stringify(seed));
    return seed;
  }
  const next = { ...seed, ...JSON.parse(raw) };
  if (!next.shuttles?.length) next.shuttles = BASE_SHUTTLES;
  next.shuttles = next.shuttles.map((s) => {
    if (s.vehicleNo === 'KA-01-A-1024' || s.vehicle_number === 'KA-01-A-1024') return { ...s, vehicleNo: 'VIT-A-101', vehicle_number: 'VIT-A-101', driverId: s.driverId || 'drv-001' };
    if (s.vehicleNo === 'KA-01-B-2088' || s.vehicle_number === 'KA-01-B-2088') return { ...s, vehicleNo: 'VIT-B-202', vehicle_number: 'VIT-B-202', driverId: s.driverId || 'drv-002' };
    return s;
  });
  next.extraUsers = cleanupPassedOut(next.extraUsers || [], next.wallets || {});
  return next;
}

export function saveState(next) {
  localStorage.setItem('campus_shuttle_state', JSON.stringify(next));
  window.dispatchEvent(new Event('campus-state-change'));
  return next;
}

export function authUser(login, password) {
  const key = String(login || '').trim().toLowerCase();
  const all = allUsers(loadState());
  return all.find((u) => [u.id, u.regNo, u.name].some((v) => String(v).toLowerCase() === key) && u.password === password);
}

export function defaultPassword(regNo) {
  return `${String(regNo || '').trim()}@123`;
}

export function cleanupPassedOut(users, wallets, year = new Date().getFullYear()) {
  return users.filter((u) => u.role !== 'student' || !u.passoutYear || Number(u.passoutYear) >= year || Number(wallets[u.id] || 0) !== 0);
}

export function logout() {
  localStorage.removeItem('cs_user');
  location.href = '/';
}

export function normalizeShuttle(row) {
  return {
    id: row.id,
    vehicleNo: row.vehicleNo || row.vehicle_no || row.vehicle_number,
    route: row.route || 'A',
    status: row.status || (row.active === false ? 'not started' : 'running'),
    driverId: row.driverId || row.driver_id,
    lat: row.lat ?? row.current_lat,
    lng: row.lng ?? row.current_lng,
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

export function allUsers(state) {
  const s = state || loadState();
  const deleted = new Set(s.deletedUsers || []);
  return [...USERS, ...(s.extraUsers || [])].filter((u) => !deleted.has(u.id));
}

export function activeAlerts(state, now = Date.now()) {
  return ((state || {}).alerts || []).filter((a) => !a.expiresAt || new Date(a.expiresAt).getTime() > now);
}
