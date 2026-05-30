import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { activeAlerts, allUsers, FARE, loadState, logout, money, normalizeShuttle, normalizeTx, ROUTE_LABELS, saveState } from '../lib/demoData';
import { supabase } from '../lib/supabaseClient';

const MapView = dynamic(() => import('../components/MapView'), { ssr: false });

export default function Driver() {
  const [user, setUser] = useState(null);
  const [route, setRoute] = useState('A');
  const [status, setStatus] = useState('not started');
  const [shuttle, setShuttle] = useState(null);
  const [tx, setTx] = useState([]);
  const [state, setState] = useState(null);
  const [reg, setReg] = useState('REG1001');
  const [tap, setTap] = useState({ state: 'idle', text: 'NFC ready' });
  const [lock, setLock] = useState(0);
  const [usb, setUsb] = useState('USB reader not checked');
  const [last, setLast] = useState('');
  const refs = useRef({});

  useEffect(() => {
    const u = JSON.parse(localStorage.getItem('cs_user') || 'null');
    if (!u || u.role !== 'driver') { location.href = '/'; return; }
    setUser(u); refs.current.user = u; refresh(u);
    if (supabase) refs.current.channel = supabase.channel('campus-shuttles').subscribe();
    startGps();
    const timer = setInterval(() => refresh(u), 5000);
    return () => { clearInterval(timer); clearInterval(refs.current.gpsTimer); if (refs.current.channel) supabase.removeChannel(refs.current.channel); };
  }, []);

  useEffect(() => {
    if (!lock) return;
    const t = setInterval(() => setLock((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [lock]);

  async function refresh(u = user) {
    const local = loadState();
    let bus = (local.shuttles || []).map(normalizeShuttle).find((s) => s.driverId === u?.id) || null;
    let rows = (local.transactions || []).map(normalizeTx).filter((t) => t.driverId === u?.id);
    let nextState = { ...local };
    if (supabase && u) {
      const [{ data: buses }, { data: payments }, { data: alerts }] = await Promise.all([
        supabase.from('shuttles').select('*').eq('driver_id', u.id).limit(1),
        supabase.from('transactions').select('*, shuttles(vehicle_number, route)').eq('driver_id', u.id).order('created_at', { ascending: false }).limit(200),
        supabase.from('alerts').select('*').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }),
      ]);
      if (buses?.[0]) bus = normalizeShuttle(buses[0]);
      if (payments) rows = payments.map((x) => normalizeTx({ ...x, vehicleNo: x.shuttles?.vehicle_number, route: x.shuttles?.route }));
      if (alerts) nextState.alerts = alerts.map((a) => ({ id: a.id, text: a.text, audience: a.audience, expiresAt: a.expires_at, createdAt: a.created_at }));
    }
    setShuttle(bus); refs.current.shuttle = bus;
    if (bus) { setRoute(bus.route); setStatus(bus.status); refs.current.route = bus.route; refs.current.status = bus.status; }
    setTx(rows); setState(nextState); setLast(new Date().toLocaleTimeString());
  }

  async function persist(meta) {
    if (!refs.current.shuttle) return;
    const next = loadState();
    next.shuttles = (next.shuttles || []).map((s) => s.id === refs.current.shuttle.id ? { ...s, ...meta } : s);
    saveState(next);
    setShuttle((s) => ({ ...s, ...meta }));
    await fetch('/api/update-route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shuttle_id: refs.current.shuttle.id, ...meta }) }).catch(() => {});
  }

  function updateRoute(value) { refs.current.route = value; setRoute(value); persist({ route: value }); }
  function updateStatus(value) { refs.current.status = value; setStatus(value); persist({ status: value }); }
  function updateVehicleNo() {
    if (!shuttle) return;
    const vehicleNo = prompt('Vehicle number', shuttle.vehicleNo);
    if (!vehicleNo) return;
    persist({ vehicleNo, vehicle_number: vehicleNo });
    fetch('/api/update-route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shuttle_id: shuttle.id, vehicle_number: vehicleNo }) }).catch(() => {});
  }

  function startGps() {
    refs.current.gpsTimer = setInterval(() => {
      if (!refs.current.shuttle || refs.current.status !== 'running') return;
      navigator.geolocation?.getCurrentPosition((pos) => {
        const payload = {
          shuttle_id: refs.current.shuttle.id,
          vehicle_no: refs.current.shuttle.vehicleNo,
          route: refs.current.route,
          status: refs.current.status,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        persist({ lat: payload.lat, lng: payload.lng, route: payload.route, status: payload.status });
        refs.current.channel?.send({ type: 'broadcast', event: 'location-update', payload });
      }, () => {}, { enableHighAccuracy: true, maximumAge: 1000 });
    }, 1000);
  }

  async function startReader() {
    if (!('NDEFReader' in window)) { setTap({ state: 'fail', text: 'Mobile Web NFC unavailable' }); beep(false); return; }
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    const ndef = new NDEFReader();
    await ndef.scan();
    ndef.onreading = (e) => processTap(e.serialNumber || 'CARD1001');
    setTap({ state: 'scan', text: 'Mobile NFC active' });
  }

  async function detectUsb() {
    if (!navigator.usb) { setUsb('WebUSB unavailable'); return; }
    try {
      const device = await navigator.usb.requestDevice({ filters: [] });
      setUsb(`USB reader: ${device.productName || device.vendorId}`);
    } catch { setUsb('No USB reader selected'); }
  }

  function beep(ok) {
    const audio = new AudioContext();
    const osc = audio.createOscillator();
    osc.frequency.value = ok ? 880 : 180;
    osc.connect(audio.destination); osc.start();
    setTimeout(() => { osc.stop(); audio.close(); }, ok ? 120 : 260);
  }

  async function processTap(cardUid = 'CARD1001') {
    if (lock || !shuttle) return;
    setTap({ state: 'scan', text: `Tap detected: ${cardUid}` });
    if ('Notification' in window && Notification.permission === 'granted') new Notification('NFC tap detected', { body: cardUid });
    const state = loadState();
    const userId = state.cards?.[cardUid];
    if (!userId) { setTap({ state: 'fail', text: 'Card not mapped' }); beep(false); return; }
    const balance = Number(state.wallets[userId] || 0);
    if (balance < FARE) state.dues[userId] = { amount: (state.dues[userId]?.amount || 0) + (FARE - balance), since: state.dues[userId]?.since || new Date().toISOString() };
    state.wallets[userId] = Math.max(0, balance - FARE);
    const row = { id: `TX${Date.now()}`, userId, driverId: user.id, shuttleId: shuttle.id, route, vehicleNo: shuttle.vehicleNo, amount: FARE, status: 'success', cardUid, createdAt: new Date().toISOString() };
    state.transactions.push(row);
    saveState(state); setTx((x) => [row, ...x]);
    await fetch('/api/process-tap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ card_uid: cardUid, driver_id: user.id, shuttle_id: shuttle.id, route, vehicle_no: shuttle.vehicleNo }) }).catch(() => {});
    setTap({ state: 'ok', text: 'Confirmed in driver account' }); setLock(10); beep(true);
  }

  const day = tx.filter((t) => new Date(t.createdAt).toDateString() === new Date().toDateString()).reduce((a, t) => a + t.amount, 0);
  const month = tx.filter((t) => new Date(t.createdAt).getMonth() === new Date().getMonth()).reduce((a, t) => a + t.amount, 0);
  const total = tx.reduce((a, t) => a + t.amount, 0);
  const byDay = tx.reduce((m, t) => {
    const k = new Date(t.createdAt).toLocaleDateString();
    m[k] = (m[k] || 0) + t.amount;
    return m;
  }, {});
  const found = allUsers(state).find((s) => s.role === 'student' && (s.regNo || '').toLowerCase() === reg.toLowerCase());
  const studentTx = (state?.transactions || []).map(normalizeTx).filter((t) => t.userId === found?.id);
  const alerts = activeAlerts(state).filter((a) => !a.audience || ['all', 'driver'].includes(a.audience));

  return (
    <div className="app-shell vit">
      <header className="topbar">
        <div><p>VIT Driver Console</p><h1>{user?.name}</h1></div>
        <div className="bar-actions"><button onClick={() => refresh()}>Refresh</button><span>Last updated at {last || '-'}</span><button onClick={logout}>Logout</button></div>
      </header>
      <main className="dashboard">
        <section className="panel map-panel"><div className="section-head"><h2>{shuttle ? shuttle.vehicleNo : 'No assigned vehicle'}</h2><span className="live-dot">auto 5s</span></div><MapView shuttles={shuttle ? [shuttle] : []} /></section>
        <section className="side-stack">
          <div className="panel controls-grid">
            <h2>Vehicle controls</h2>
            <p className="muted">{shuttle ? ROUTE_LABELS[route] : 'null'}</p>
            <select value={route} onChange={(e) => updateRoute(e.target.value)} disabled={!shuttle}><option value="A">SJT / PRP Green</option><option value="B">Mens Hostel Blue</option></select>
            <select value={status} onChange={(e) => updateStatus(e.target.value)} disabled={!shuttle}><option>running</option><option>maintenance</option><option>not started</option></select>
            <button onClick={updateVehicleNo} disabled={!shuttle}>Edit vehicle no</button>
            <button onClick={startReader}>Use mobile NFC</button><button onClick={detectUsb}>Detect USB NFC</button><button onClick={() => processTap(prompt('Card UID', 'CARD1001') || 'CARD1001')} disabled={!shuttle}>Simulate tap</button>
            <small>{usb}</small>
          </div>
          <div className="panel earn"><span>Today</span><b>{money(day)}</b><span>This month</span><b>{money(month)}</b><span>Total</span><b>{money(total)}</b></div>
          <div className="panel"><h2>Day wise revenue</h2><div className="history rich">{Object.entries(byDay).map(([d, v]) => <div key={d}><span>{d}</span><b>{money(v)}</b></div>)}</div></div>
          <div className={`panel tap-card ${tap.state}`}><div className="tick">{tap.state === 'fail' ? 'X' : tap.state === 'ok' ? 'OK' : 'NFC'}</div><h2>{tap.text}</h2>{lock > 0 && <p>Hold card. Next tap in {lock}s</p>}</div>
          <div className="panel notify"><h2>Notifications</h2>{alerts.length ? alerts.map((a) => <p className="notice" key={a.id}>{a.text}<small>Until {new Date(a.expiresAt).toLocaleString()}</small></p>) : <p className="muted">No active alerts.</p>}</div>
          <div className="panel"><div className="section-head"><h2>Student history</h2><input value={reg} onChange={(e) => setReg(e.target.value)} placeholder="REG1001" /></div><div className="history rich">{studentTx.length ? studentTx.map((t) => <div key={t.id}><span>{new Date(t.createdAt).toLocaleString()}</span><b>{t.vehicleNo || 'Vehicle'}</b><em>{ROUTE_LABELS[t.route] || t.route} - {money(t.amount)}</em></div>) : <p className="muted">No transaction found.</p>}</div></div>
          <div className="panel"><h2>Transactions</h2><div className="history rich">{tx.map((t) => <div key={t.id}><span>{new Date(t.createdAt).toLocaleString()}</span><b>{money(t.amount)}</b><em>{t.vehicleNo} · {ROUTE_LABELS[t.route] || t.route}</em></div>)}</div></div>
        </section>
      </main>
    </div>
  );
}
