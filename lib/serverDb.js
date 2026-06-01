const fs = require('fs');
const path = require('path');

const FILE_PATH = path.resolve(process.cwd(), 'lib/db_state.json');

const INITIAL_STATE = {
  users: [
    {
      id: 'adm-001',
      role: 'admin',
      name: 'Campus Admin',
      regNo: 'ADMIN',
      password: 'admin@123',
      needsPasswordReset: false
    }
  ],
  wallets: {}, // userId -> number
  dues: {}, // userId -> { amount: number, since: string }
  shuttles: [], // { id, vehicleNo, driverId, route, status, lat, lng, heading, lastSeen }
  transactions: [],
  alerts: [],
  cards: {}, // cardUid -> userId
  hotlist: {}, // cardUid -> expiry timestamp (ms)
  ledger: [] // { id, userId, type, amount, note, createdAt }
};

function readDb() {
  try {
    if (!fs.existsSync(FILE_PATH)) {
      fs.writeFileSync(FILE_PATH, JSON.stringify(INITIAL_STATE, null, 2), 'utf-8');
      return INITIAL_STATE;
    }
    const content = fs.readFileSync(FILE_PATH, 'utf-8');
    const data = JSON.parse(content);
    // Enforce admin@123 default
    const admin = data.users.find(u => u.role === 'admin' && u.regNo === 'ADMIN');
    if (!admin) {
      data.users.push({
        id: 'adm-001',
        role: 'admin',
        name: 'Campus Admin',
        regNo: 'ADMIN',
        password: 'admin@123',
        needsPasswordReset: false
      });
      fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
    }
    return data;
  } catch (e) {
    console.error('Error reading server DB:', e);
    return INITIAL_STATE;
  }
}

function writeDb(data) {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error writing server DB:', e);
  }
}

// Global cached state (optional, readDb is fast enough and ensures persistence)
export function getServerState() {
  return readDb();
}

export function saveServerState(state) {
  writeDb(state);
  return state;
}

export function clearDummyData() {
  const db = readDb();
  // Keep only the admin
  db.users = db.users.filter(u => u.role === 'admin');
  db.wallets = {};
  db.dues = {};
  db.shuttles = [];
  db.transactions = [];
  db.alerts = [];
  db.cards = {};
  db.hotlist = {};
  db.ledger = [];
  writeDb(db);
  return db;
}
