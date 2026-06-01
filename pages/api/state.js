import { getServerState, saveServerState, clearDummyData } from '../../lib/serverDb';
import { defaultPassword, getFine } from '../../lib/demoData';

export default async function handler(req, res) {
  const method = req.method;
  if (method === 'GET') {
    const db = getServerState();
    return res.json(db);
  }

  if (method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, ...payload } = req.body || {};
  let db = getServerState();

  switch (action) {
    case 'get_state':
      return res.json(db);

    case 'login': {
      const { loginId, password } = payload;
      if (!loginId || !password) {
        return res.status(400).json({ error: 'Login and password are required' });
      }
      const key = String(loginId).trim().toLowerCase();
      const user = db.users.find(u => 
        (u.id.toLowerCase() === key || 
         u.regNo.toLowerCase() === key || 
         u.name.toLowerCase() === key) && 
        u.password === password
      );
      if (!user) {
        return res.status(401).json({ error: 'Invalid user ID or password' });
      }
      return res.json({ user });
    }

    case 'reset_password': {
      const { userId, newPassword } = payload;
      if (!userId || !newPassword) {
        return res.status(400).json({ error: 'User ID and new password are required' });
      }
      const user = db.users.find(u => u.id === userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      user.password = newPassword;
      user.needsPasswordReset = false;
      saveServerState(db);
      return res.json({ success: true, user });
    }

    case 'revert_password': {
      const { userId } = payload;
      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }
      const user = db.users.find(u => u.id === userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      user.password = defaultPassword(user.regNo);
      user.needsPasswordReset = true;
      saveServerState(db);
      return res.json({ success: true, user });
    }

    case 'add_student': {
      const { name, regNo, cardUid, passoutYear } = payload;
      if (!name || !regNo) {
        return res.status(400).json({ error: 'Name and Registration Number are required' });
      }
      const exists = db.users.some(u => u.regNo.toLowerCase() === regNo.toLowerCase());
      if (exists) {
        return res.status(400).json({ error: 'Student already exists with this Reg No' });
      }
      const id = `stu-${Date.now()}`;
      const newUser = {
        id,
        role: 'student',
        name,
        regNo,
        cardUid: cardUid || '',
        passoutYear: Number(passoutYear) || (new Date().getFullYear() + 4),
        password: defaultPassword(regNo),
        needsPasswordReset: true
      };
      db.users.push(newUser);
      db.wallets[id] = 0;
      if (cardUid) {
        db.cards[cardUid] = id;
      }
      saveServerState(db);
      return res.json({ success: true, user: newUser });
    }

    case 'add_driver': {
      const { name, regNo, vehicleNo, route } = payload;
      if (!name || !regNo || !vehicleNo) {
        return res.status(400).json({ error: 'Name, Driver ID, and Vehicle Number are required' });
      }
      const exists = db.users.some(u => u.regNo.toLowerCase() === regNo.toLowerCase());
      if (exists) {
        return res.status(400).json({ error: 'Driver already exists with this ID' });
      }
      const id = `drv-${Date.now()}`;
      const newUser = {
        id,
        role: 'driver',
        name,
        regNo,
        cardUid: regNo,
        password: defaultPassword(regNo),
        needsPasswordReset: true
      };
      db.users.push(newUser);
      db.wallets[id] = 0;

      const shuttleId = `bus-${Date.now()}`;
      db.shuttles.push({
        id: shuttleId,
        vehicleNo,
        driverId: id,
        route: route || 'A',
        status: 'running',
        lat: route === 'B' ? 12.9724 : 12.9729,
        lng: route === 'B' ? 79.1552 : 79.1586,
        heading: 0,
        lastSeen: new Date().toISOString()
      });

      saveServerState(db);
      return res.json({ success: true, user: newUser });
    }

    case 'delete_user': {
      const { userId } = payload;
      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }
      db.users = db.users.filter(u => u.id !== userId);
      delete db.wallets[userId];
      delete db.dues[userId];
      db.shuttles = db.shuttles.filter(s => s.driverId !== userId);
      Object.keys(db.cards).forEach(k => {
        if (db.cards[k] === userId) delete db.cards[k];
      });
      saveServerState(db);
      return res.json({ success: true });
    }

    case 'add_money': {
      const { userId, amount } = payload;
      const parsedAmount = Number(amount);
      if (!userId || isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: 'Valid User ID and Amount are required' });
      }
      const user = db.users.find(u => u.id === userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const walletBal = Number(db.wallets[userId] || 0);
      const dueObj = db.dues[userId];
      
      if (dueObj) {
        const fine = getFine(dueObj.since);
        const totalDue = dueObj.amount + fine;
        if (parsedAmount >= totalDue) {
          db.wallets[userId] = walletBal + (parsedAmount - totalDue);
          delete db.dues[userId];
        } else {
          dueObj.amount = totalDue - parsedAmount;
        }
      } else {
        db.wallets[userId] = walletBal + parsedAmount;
      }

      // Record ledger entry
      db.ledger = db.ledger || [];
      db.ledger.unshift({
        id: `LED-${Date.now()}`,
        userId,
        type: 'credit',
        amount: parsedAmount,
        note: 'Wallet top-up by Admin',
        createdAt: new Date().toISOString()
      });

      saveServerState(db);
      return res.json({ success: true, wallet: db.wallets[userId], due: db.dues[userId] });
    }

    case 'withdraw': {
      const { userId, amount } = payload;
      const parsedAmount = Number(amount);
      if (!userId || isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: 'Valid User ID and Amount are required' });
      }
      const walletBal = Number(db.wallets[userId] || 0);
      if (walletBal < parsedAmount) {
        return res.status(400).json({ error: 'Insufficient balance' });
      }
      db.wallets[userId] = walletBal - parsedAmount;

      // Record ledger entry
      db.ledger = db.ledger || [];
      db.ledger.unshift({
        id: `LED-${Date.now()}`,
        userId,
        type: 'debit',
        amount: parsedAmount,
        note: 'Wallet withdrawal by Admin',
        createdAt: new Date().toISOString()
      });

      saveServerState(db);
      return res.json({ success: true, wallet: db.wallets[userId] });
    }

    case 'send_alert': {
      const { text, audience, expiresAt } = payload;
      if (!text || !expiresAt) {
        return res.status(400).json({ error: 'Text and expiry date are required' });
      }
      const alert = {
        id: `AL-${Date.now()}`,
        text,
        audience: audience || 'all',
        expiresAt: new Date(expiresAt).toISOString(),
        createdAt: new Date().toISOString()
      };
      db.alerts.unshift(alert);
      saveServerState(db);
      return res.json({ success: true, alert });
    }

    case 'map_nfc': {
      const { userId, cardUid } = payload;
      if (!userId || !cardUid) {
        return res.status(400).json({ error: 'User ID and Card UID are required' });
      }
      // Remove any existing mappings for this card
      Object.keys(db.cards).forEach(k => {
        if (db.cards[k] === userId) delete db.cards[k];
      });
      db.cards[cardUid] = userId;
      // Also update student user object's cardUid
      const user = db.users.find(u => u.id === userId);
      if (user) {
        user.cardUid = cardUid;
      }
      saveServerState(db);
      return res.json({ success: true });
    }

    case 'clear_dummy': {
      db = clearDummyData();
      return res.json(db);
    }

    default:
      return res.status(400).json({ error: `Unknown action: ${action}` });
  }
}
