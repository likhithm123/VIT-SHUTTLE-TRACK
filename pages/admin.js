import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { activeAlerts, allUsers, defaultPassword, getFine, loadState, logout, money, normalizeShuttle, normalizeTx, saveState } from '../lib/demoData';
import { supabase } from '../lib/supabaseClient';

const MapView = dynamic(() => import('../components/MapView'), { ssr: false });

export default function Admin() {
  const [user, setUser] = useState(null);
  const [state, setState] = useState(null);
  const [shuttles, setShuttles] = useState([]);
  const [tab, setTab] = useState('students');
  const [reg, setReg] = useState('REG1001');
  const [driverReg, setDriverReg] = useState('DRV01');
  const [last, setLast] = useState('');
  const [form, setForm] = useState({ name: '', regNo: '', cardUid: '', passoutYear: new Date().getFullYear() + 4 });
  const [driverForm, setDriverForm] = useState({ name: '', regNo: '', vehicleNo: '', route: 'A' });

  useEffect(() => {
    const u = JSON.parse(localStorage.getItem('cs_user') || 'null');
    if (!u || u.role !== 'admin') { location.href = '/'; return; }
    setUser(u); refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);

  async function refresh() {
    const local = loadState();
    let next = { ...local, transactions: (local.transactions || []).map(normalizeTx) };
    let buses = (local.shuttles || []).map(normalizeShuttle);
    if (supabase) {
      const [{ data: s }, { data: t }, { data: a }] = await Promise.all([
        supabase.from('shuttles').select('*').order('last_seen', { ascending: false }),
        supabase.from('transactions').select('*, shuttles(vehicle_number, route)').order('created_at', { ascending: false }).limit(500),
        supabase.from('alerts').select('*').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }),
      ]);
      if (s) buses = s.map(normalizeShuttle);
      if (t) next.transactions = t.map((x) => normalizeTx({ ...x, vehicleNo: x.shuttles?.vehicle_number, route: x.shuttles?.route }));
      if (a) next.alerts = a.map((x) => ({ id: x.id, text: x.text, audience: x.audience, expiresAt: x.expires_at, createdAt: x.created_at }));
    }
    setState(next); setShuttles(buses); setLast(new Date().toLocaleTimeString());
  }

  function saveLocal(next) { saveState(next); refresh(); }

  async function addStudent() {
    if (!form.name || !form.regNo) return;
    if (allUsers(loadState()).some((u) => u.regNo === form.regNo)) return alert('Duplicate student/ID not allowed');
    const id = `stu-${Date.now()}`;
    const next = loadState();
    next.extraUsers.push({ id, role: 'student', ...form, passoutYear: Number(form.passoutYear), password: defaultPassword(form.regNo) });
    next.wallets[id] = 0;
    if (form.cardUid) next.cards[form.cardUid] = id;
    saveLocal(next);
    await supabase?.from('users').insert({ name: form.name, role: 'student', reg_no: form.regNo, passout_year: Number(form.passoutYear), wallet: 0 });
  }

  function importStudents(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const next = loadState();
      text.split(/\r?\n/).slice(1).forEach((line) => {
        const [name, regNo, cardUid, passoutYear] = line.split(',').map((v) => v?.trim());
        if (!name || !regNo || allUsers(next).some((u) => u.regNo === regNo)) return;
        const id = `stu-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        next.extraUsers.push({ id, role: 'student', name, regNo, cardUid, passoutYear: Number(passoutYear || new Date().getFullYear() + 4), password: defaultPassword(regNo) });
        next.wallets[id] = 0;
        if (cardUid) next.cards[cardUid] = id;
      });
      saveLocal(next);
    });
  }

  async function addDriver() {
    if (!driverForm.name || !driverForm.regNo || !driverForm.vehicleNo) return;
    if (allUsers(loadState()).some((u) => u.regNo === driverForm.regNo)) return alert('Duplicate driver/ID not allowed');
    const id = `drv-${Date.now()}`;
    const next = loadState();
    next.extraUsers.push({ id, role: 'driver', name: driverForm.name, regNo: driverForm.regNo, password: defaultPassword(driverForm.regNo) });
    next.shuttles.push({ id: `bus-${Date.now()}`, vehicleNo: driverForm.vehicleNo, driverId: id, route: driverForm.route, status: 'running', lat: driverForm.route === 'A' ? 12.9729 : 12.9724, lng: driverForm.route === 'A' ? 79.1586 : 79.1552 });
    saveLocal(next);
    await supabase?.from('users').insert({ name: driverForm.name, role: 'driver', reg_no: driverForm.regNo });
    await supabase?.from('shuttles').insert({ vehicle_number: driverForm.vehicleNo, route: driverForm.route, status: 'running', active: true });
  }

  const users = allUsers(state);
  const students = users.filter((u) => u.role === 'student');
  const drivers = users.filter((u) => u.role === 'driver');
  const tx = state?.transactions || [];
  const student = students.find((s) => (s.regNo || '').toLowerCase() === reg.toLowerCase());
  const driver = drivers.find((d) => (d.regNo || '').toLowerCase() === driverReg.toLowerCase());
  const selectedTx = tx.filter((t) => t.userId === student?.id);
  const revenue = tx.filter((t) => t.status !== 'refunded').reduce((a, t) => a + t.amount, 0);
  const due = Object.values(state?.dues || {}).reduce((a, d) => a + d.amount + getFine(d.since), 0);
  const alerts = activeAlerts(state);

  async function wallet(action) {
    if (!student) return;
    const next = loadState();
    next.wallets[student.id] = action === 'empty' ? 0 : Number(next.wallets[student.id] || 0) + Number(prompt('Amount', '100') || 0);
    saveLocal(next);
    await supabase?.from('users').update({ wallet: next.wallets[student.id] }).eq('reg_no', student.regNo);
  }

  function refund(row) {
    const next = loadState();
    next.wallets[row.userId] = Number(next.wallets[row.userId] || 0) + row.amount;
    next.transactions = next.transactions.map((t) => t.id === row.id ? { ...t, status: 'refunded' } : t);
    saveLocal(next);
    fetch('/api/refund', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: row.id, admin_id: user?.id }) }).catch(() => {});
  }

  function mapNfc() {
    if (!student) return;
    const cardUid = prompt('NFC/Card UID', student.cardUid || 'CARD1001');
    if (!cardUid) return;
    const next = loadState();
    next.cards[cardUid] = student.id;
    saveLocal(next);
  }

  function updatePassout() {
    if (!student) return;
    const year = Number(prompt('Passout year', student.passoutYear || new Date().getFullYear()));
    const next = loadState();
    next.extraUsers = next.extraUsers.map((u) => u.id === student.id ? { ...u, passoutYear: year } : u);
    saveLocal(next);
    supabase?.from('users').update({ passout_year: year }).eq('reg_no', student.regNo);
  }

  function deleteStudent() {
    if (!student || !confirm(`Confirm delete student ${student.regNo}? This removes wallet, NFC mapping and local history.`)) return;
    const next = loadState();
    next.extraUsers = next.extraUsers.filter((u) => u.id !== student.id);
    next.deletedUsers = [...new Set([...(next.deletedUsers || []), student.id])];
    next.transactions = next.transactions.filter((t) => t.userId !== student.id);
    delete next.wallets[student.id];
    Object.keys(next.cards).forEach((k) => { if (next.cards[k] === student.id) delete next.cards[k]; });
    saveLocal(next);
    supabase?.from('users').delete().eq('reg_no', student.regNo);
  }

  function deleteDriver() {
    if (!driver || !confirm(`Confirm delete driver ${driver.regNo}? Assigned vehicle will be removed.`)) return;
    const next = loadState();
    next.extraUsers = next.extraUsers.filter((u) => u.id !== driver.id);
    next.deletedUsers = [...new Set([...(next.deletedUsers || []), driver.id])];
    next.shuttles = next.shuttles.filter((s) => s.driverId !== driver.id);
    saveLocal(next);
    supabase?.from('users').delete().eq('reg_no', driver.regNo);
  }

  async function sendAlert() {
    const text = prompt('Alert text');
    const expiresAt = prompt('Expiry date/time', new Date(Date.now() + 3600000).toISOString().slice(0, 16));
    const audience = prompt('Audience: all/student/driver', 'all') || 'all';
    if (!text || !expiresAt) return;
    const alert = { id: `AL${Date.now()}`, text, audience, expiresAt: new Date(expiresAt).toISOString(), createdAt: new Date().toISOString() };
    const next = loadState(); next.alerts.unshift(alert); saveLocal(next);
    await supabase?.from('alerts').insert({ text, audience, expires_at: alert.expiresAt });
  }

  function getStudentData() {
    if (!student) return alert('Student not found');
    setForm({ name: student.name || '', regNo: student.regNo || '', cardUid: student.cardUid || '', passoutYear: student.passoutYear || '' });
  }

  function saveStudentData() {
    if (!student) return;
    const next = loadState();
    next.extraUsers = next.extraUsers.map((u) => u.id === student.id ? { ...u, name: form.name, regNo: form.regNo, cardUid: form.cardUid, passoutYear: Number(form.passoutYear), password: defaultPassword(form.regNo) } : u);
    if (form.cardUid) next.cards[form.cardUid] = student.id;
    saveLocal(next);
    supabase?.from('users').update({ name: form.name, reg_no: form.regNo, passout_year: Number(form.passoutYear) }).eq('reg_no', student.regNo);
  }

  function getDriverData() {
    if (!driver) return alert('Driver not found');
    const bus = shuttles.find((s) => s.driverId === driver.id);
    setDriverForm({ name: driver.name || '', regNo: driver.regNo || '', vehicleNo: bus?.vehicleNo || '', route: bus?.route || 'A' });
  }

  function saveDriverData() {
    if (!driver) return;
    const next = loadState();
    next.extraUsers = next.extraUsers.map((u) => u.id === driver.id ? { ...u, name: driverForm.name, regNo: driverForm.regNo, password: defaultPassword(driverForm.regNo) } : u);
    next.shuttles = next.shuttles.map((s) => s.driverId === driver.id ? { ...s, vehicleNo: driverForm.vehicleNo, route: driverForm.route } : s);
    saveLocal(next);
    supabase?.from('users').update({ name: driverForm.name, reg_no: driverForm.regNo }).eq('reg_no', driver.regNo);
    supabase?.from('shuttles').update({ vehicle_number: driverForm.vehicleNo, route: driverForm.route }).eq('driver_id', driver.id);
  }

  return (
    <div className="app-shell vit">
      <header className="topbar"><div><p>VIT Vellore Admin</p><h1>{user?.name}</h1></div><div className="bar-actions"><button onClick={sendAlert}>Send alert</button><button onClick={refresh}>Refresh</button><span>Last updated at {last || '-'}</span><button onClick={logout}>Logout</button></div></header>
      <main className="admin-grid">
        <section className="panel stat"><span>Vehicles</span><b>{shuttles.length || 'null'}</b><p>database/local count</p></section>
        <section className="panel stat"><span>Running</span><b>{shuttles.filter((s) => s.status === 'running').length || 'null'}</b><p>live now</p></section>
        <section className="panel stat"><span>Revenue</span><b>{money(revenue)}</b><p>net</p></section>
        <section className="panel stat"><span>Dues</span><b>{money(due)}</b><p>fine included</p></section>
        <section className="panel map-wide"><div className="section-head"><h2>All shuttle map</h2><span className="live-dot">auto 5s</span></div><MapView shuttles={shuttles} followSelf={false} /></section>
        <section className="panel tabs-panel"><div className="tabs"><button className={tab === 'students' ? 'active' : ''} onClick={() => setTab('students')}>Students</button><button className={tab === 'drivers' ? 'active' : ''} onClick={() => setTab('drivers')}>Drivers</button></div>{tab === 'students' ? <div className="history rich">{students.map((s) => <div key={s.id} onClick={() => setReg(s.regNo)}><span>{s.regNo}</span><b>{s.name}</b><em>{money(state?.wallets?.[s.id] || s.wallet || 0)} - passout {s.passoutYear || '-'}</em></div>)}</div> : <div className="history rich">{drivers.map((d) => <div key={d.id} onClick={() => setDriverReg(d.regNo)}><span>{d.regNo}</span><b>{d.name}</b><em>{shuttles.find((s) => s.driverId === d.id)?.vehicleNo || 'No vehicle'}</em></div>)}</div>}</section>
        <section className="panel wide form-grid"><h2>Add / edit students</h2><input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input placeholder="Reg no" value={form.regNo} onChange={(e) => setForm({ ...form, regNo: e.target.value })} /><input placeholder="NFC UID" value={form.cardUid} onChange={(e) => setForm({ ...form, cardUid: e.target.value })} /><input placeholder="Passout year" value={form.passoutYear} onChange={(e) => setForm({ ...form, passoutYear: e.target.value })} /><button onClick={addStudent}>Add</button><button onClick={getStudentData}>Get data</button><button onClick={saveStudentData}>Save edit</button><input type="file" accept=".csv,.txt" onChange={importStudents} /><small>CSV: name,regNo,cardUid,passoutYear. Password: REGNO@123</small></section>
        <section className="panel wide form-grid"><h2>Add / edit driver</h2><input placeholder="Name" value={driverForm.name} onChange={(e) => setDriverForm({ ...driverForm, name: e.target.value })} /><input placeholder="Driver ID" value={driverForm.regNo} onChange={(e) => setDriverForm({ ...driverForm, regNo: e.target.value })} /><input placeholder="Vehicle number" value={driverForm.vehicleNo} onChange={(e) => setDriverForm({ ...driverForm, vehicleNo: e.target.value })} /><select value={driverForm.route} onChange={(e) => setDriverForm({ ...driverForm, route: e.target.value })}><option value="A">SJT / PRP Green</option><option value="B">Mens Hostel Blue</option></select><button onClick={addDriver}>Add</button><button onClick={getDriverData}>Get data</button><button onClick={saveDriverData}>Save edit</button><small>Password: DRIVERID@123</small></section>
        <section className="panel wide"><div className="section-head"><h2>Student account</h2><div className="inline-search"><input value={reg} onChange={(e) => setReg(e.target.value)} placeholder="REG1001" /><button onClick={getStudentData}>Get data</button></div></div>{student ? <><p className="metric">{student.name} - Balance {money(state?.wallets?.[student.id] || 0)} - Passout {student.passoutYear || '-'}</p><div className="bar-actions"><button onClick={() => wallet('add')}>Add amount</button><button onClick={() => wallet('empty')}>Empty account</button><button onClick={mapNfc}>Map NFC tap</button><button onClick={updatePassout}>Edit passout</button><button className="danger" onClick={deleteStudent}>Delete student</button></div><div className="history rich">{selectedTx.map((t) => <div key={t.id}><span>{new Date(t.createdAt).toLocaleString()}</span><b>{t.vehicleNo || 'Vehicle'}</b><em>{t.route || 'Route'} - {t.status} - {money(t.amount)}</em>{t.status !== 'refunded' && <button onClick={() => refund(t)}>Refund</button>}</div>)}</div></> : <p className="muted">Search or click a student.</p>}</section>
        <section className="panel"><h2>Driver vehicle</h2><div className="inline-search"><input value={driverReg} onChange={(e) => setDriverReg(e.target.value)} placeholder="DRV01" /><button onClick={getDriverData}>Get data</button></div><p className="metric">{driver ? `${driver.name} - ${shuttles.find((s) => s.driverId === driver.id)?.vehicleNo || 'No vehicle'}` : 'Search or click driver.'}</p>{driver && <button className="danger" onClick={deleteDriver}>Delete driver</button>}<h2>Active alerts</h2>{alerts.map((a) => <p className="notice" key={a.id}>{a.text}<small>{a.audience} - until {new Date(a.expiresAt).toLocaleString()}</small></p>)}</section>
        <section className="panel wide"><h2>All student transactions</h2><div className="history rich">{tx.map((t) => <div key={t.id}><span>{new Date(t.createdAt).toLocaleString()}</span><b>{money(t.amount)}</b><em>{t.userId} - {t.vehicleNo || 'Vehicle'} - {t.status}</em></div>)}</div></section>
      </main>
    </div>
  );
}
