import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import WalletCard from '../components/WalletCard';
import { activeAlerts, loadState, logout, money, normalizeShuttle, normalizeTx, ROUTE_LABELS, routeColor } from '../lib/demoData';
import { supabase } from '../lib/supabaseClient';

const MapView = dynamic(() => import('../components/MapView'), { ssr: false });

export default function Student() {
  const [user, setUser] = useState(null);
  const [state, setState] = useState(null);
  const [shuttles, setShuttles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [last, setLast] = useState('');

  useEffect(() => {
    const u = JSON.parse(localStorage.getItem('cs_user') || 'null');
    if (!u || u.role !== 'student') { location.href = '/'; return; }
    setUser(u); refresh();
    const timer = setInterval(refresh, 5000);
    let channel;
    if (supabase) channel = supabase.channel('campus-shuttles')
      .on('broadcast', { event: 'location-update' }, ({ payload }) => setShuttles((list) => upsert(list, payload)))
      .subscribe();
    return () => { clearInterval(timer); if (channel) supabase.removeChannel(channel); };
  }, []);

  async function refresh() {
    const local = loadState();
    let nextShuttles = (local.shuttles || []).map(normalizeShuttle);
    let nextTx = (local.transactions || []).map(normalizeTx);
    if (supabase) {
      const [{ data: s }, { data: t }, { data: alerts }] = await Promise.all([
        supabase.from('shuttles').select('*').order('last_seen', { ascending: false }),
        supabase.from('transactions').select('*, shuttles(vehicle_number, route)').order('created_at', { ascending: false }).limit(100),
        supabase.from('alerts').select('*').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }),
      ]);
      if (s) nextShuttles = s.map(normalizeShuttle);
      if (t) nextTx = t.map((x) => normalizeTx({ ...x, vehicleNo: x.shuttles?.vehicle_number, route: x.shuttles?.route }));
      if (alerts) local.alerts = alerts.map((a) => ({ id: a.id, text: a.text, audience: a.audience, expiresAt: a.expires_at, createdAt: a.created_at }));
    }
    setState({ ...local, transactions: nextTx });
    setShuttles(nextShuttles);
    setLast(new Date().toLocaleTimeString());
  }

  function upsert(list, p) {
    const item = normalizeShuttle({ id: p.shuttle_id, vehicle_number: p.vehicle_no, route: p.route, status: p.status, current_lat: p.lat, current_lng: p.lng, last_seen: new Date().toISOString() });
    return list.some((s) => s.id === item.id) ? list.map((s) => s.id === item.id ? item : s) : [...list, item];
  }

  const tx = (state?.transactions || []).filter((t) => t.userId === user?.id);
  const total = tx.filter((t) => t.status !== 'refunded').reduce((a, t) => a + t.amount, 0);
  const alerts = activeAlerts(state).filter((a) => !a.audience || ['all', 'student'].includes(a.audience));

  return (
    <div className="app-shell vit">
      <header className="topbar">
        <div><p>VIT Vellore Shuttle</p><h1>{user?.name}</h1></div>
        <div className="bar-actions"><button onClick={refresh}>Refresh</button><span>Last updated at {last || '-'}</span><button onClick={logout}>Logout</button></div>
      </header>
      <main className="dashboard">
        <section className="panel map-panel">
          <div className="section-head"><div><p>Mobile GPS + live shuttles</p><h2>Campus map</h2></div><span className="live-dot">auto 5s</span></div>
          <MapView shuttles={shuttles} onSelect={setSelected} showRoutes={false} />
        </section>
        <section className="side-stack">
          {user && <WalletCard user={user} onRefresh={refresh} />}
          <div className="panel">
            <div className="section-head"><h2>My spend</h2><b>{user?.regNo}</b></div>
            <p className="metric">Total spent: <b>{money(total)}</b></p>
          </div>
          <div className="panel notify"><h2>Notifications</h2>{alerts.length ? alerts.map((a) => <p className="notice" key={a.id}>{a.text}<small>Until {new Date(a.expiresAt).toLocaleString()}</small></p>) : <p className="muted">No active alerts.</p>}</div>
          <div className="panel">
            <h2>{selected ? selected.vehicleNo : 'Selected shuttle'}</h2>
            {selected ? <p className="alert"><b style={{ color: routeColor(selected.route) }}>{ROUTE_LABELS[selected.route]}</b><br />{selected.status} · {selected.lastSeen ? new Date(selected.lastSeen).toLocaleTimeString() : 'live'}</p> : <p className="muted">Click a shuttle marker or left list.</p>}
          </div>
          <div className="panel">
            <div className="section-head"><h2>Transactions</h2><b>{user?.regNo}</b></div>
            <div className="history rich">
              {tx.length ? tx.map((t) => <div key={t.id} onClick={() => setSelected(shuttles.find((s) => s.id === t.shuttleId) || null)}>
                <span>{new Date(t.createdAt).toLocaleString()}</span><b>{money(t.amount)}</b><em>{t.vehicleNo || 'Vehicle'} · {ROUTE_LABELS[t.route] || t.route || 'Route'} · {t.status}</em>
              </div>) : <p className="muted">No transactions found.</p>}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
