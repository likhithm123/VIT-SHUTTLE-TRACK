import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import WalletCard from '../components/WalletCard';
import { activeAlerts, logout, money, normalizeShuttle, normalizeTx, ROUTE_LABELS, routeColor, runningShuttles } from '../lib/demoData';
import { useAppState } from '../lib/useAppState';

const MapView = dynamic(() => import('../components/MapView'), { ssr: false });

export default function Student() {
  const [user, setUser] = useState(null);
  const [shuttles, setShuttles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [hotlistSecs, setHotlistSecs] = useState(0);
  const { dbState, lastUpdated, syncMode, refresh } = useAppState({ enabled: true, pollMs: 1500 });

  useEffect(() => {
    const u = JSON.parse(localStorage.getItem('cs_user') || 'null');
    if (!u || u.role !== 'student') {
      location.href = '/';
      return;
    }
    setUser(u);
  }, []);

  useEffect(() => {
    const uid = user?.id;
    if (!uid || !dbState?.users) return;

    const updatedUser = dbState.users.find((u) => u.id === uid);
    if (updatedUser) setUser(updatedUser);

    setShuttles((dbState.shuttles || []).map(normalizeShuttle));

    const me = dbState.users.find((u) => u.id === uid);
    if (me?.cardUid && dbState.hotlist) {
      const hotlistExpiry = dbState.hotlist[me.cardUid];
      setHotlistSecs(
        hotlistExpiry ? Math.max(0, Math.ceil((Number(hotlistExpiry) - Date.now()) / 1000)) : 0
      );
    } else {
      setHotlistSecs(0);
    }
  }, [dbState, user?.id]);

  // Filter transactions (rides) for current user
  const transactions = (dbState?.transactions || [])
    .map(normalizeTx)
    .filter((t) => t.userId === user?.id);

  // Filter ledger (add/withdraw) for current user
  const ledgerEntries = (dbState?.ledger || []).filter((l) => l.userId === user?.id);

  // Unified history: merge rides + ledger, sort newest first
  // Optimization: Pre-filter and limit history to the most recent 100 entries for mobile performance
  const rawHistory = [
    ...transactions.map(t => ({ ...t, _kind: t.status === 'refunded' ? 'refund' : 'ride' })),
    ...ledgerEntries.map(l => ({ ...l, _kind: l.type === 'credit' ? 'credit' : 'debit' }))
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 100);
  
  const unifiedHistory = rawHistory;

  // Stats
  const totalSpent = transactions
    .filter((t) => t.status !== 'refunded')
    .reduce((sum, t) => sum + t.amount, 0);
  const totalCredited = ledgerEntries
    .filter(l => l.type === 'credit')
    .reduce((sum, l) => sum + l.amount, 0);
  const todayRides = transactions.filter(t =>
    new Date(t.createdAt).toDateString() === new Date().toDateString() && t.status !== 'refunded'
  ).length;

  // Filter active alerts for student audience
  const alerts = activeAlerts(dbState)
    .filter((a) => !a.audience || ['all', 'student'].includes(a.audience));

  return (
    <div className="app-shell vit">
      <header className="topbar" style={{ borderLeft: '5px solid var(--green)' }}>
        <div>
          <p style={{ color: 'var(--muted)', fontWeight: 'bold' }}>VIT Vellore Shuttle Track</p>
          <h1 style={{ color: 'var(--ink)', fontWeight: '800' }}>{user?.name}</h1>
        </div>
        <div className="bar-actions">
          <button onClick={() => refresh()} style={{ background: 'var(--blue)' }}>Sync Now</button>
          <span>Last sync: {lastUpdated || '-'}</span>
          <button onClick={logout} style={{ background: 'var(--ink)' }}>Logout</button>
        </div>
      </header>

      <main className="dashboard">
        {/* Map View */}
        <section className="panel map-panel" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '12px' }}>
          <div className="section-head">
            <div>
              <p style={{ color: 'var(--muted)', fontSize: '12px' }}>Mobile GPS + Live Shuttles</p>
              <h2 style={{ color: 'var(--ink)', fontWeight: '700' }}>Campus Live Map</h2>
            </div>
            <span className="live-dot" style={{ backgroundColor: '#e0f2fe', color: '#0369a1', borderColor: '#bae6fd' }}>
              {syncMode === 'realtime' ? 'Live (Supabase)' : 'Syncing'}{lastUpdated ? ` · ${lastUpdated}` : ''}
            </span>
          </div>
          {/* Hotlist banner */}
          {hotlistSecs > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '8px', padding: '8px 14px', margin: '8px 12px' }}>
              <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#f59e0b', color: 'white', display: 'grid', placeItems: 'center', fontWeight: 'bold', fontSize: '15px', flexShrink: 0 }}>
                {hotlistSecs}
              </div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#92400e' }}>Card cooldown — {hotlistSecs}s remaining</div>
                <div style={{ fontSize: '11px', color: '#b45309' }}>Your card was just charged. Do not tap again until timer ends.</div>
              </div>
            </div>
          )}
          <MapView shuttles={runningShuttles(shuttles)} onSelect={setSelected} showRoutes={false} />
        </section>

        {/* Side Controls & Wallet & Stats */}
        <section className="side-stack">
          {user && dbState && (
            <WalletCard user={user} dbState={dbState} onRefresh={() => refresh()} />
          )}

          {/* Stats Row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 'bold' }}>TOTAL SPENT</div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: '#166534' }}>{money(totalSpent)}</div>
            </div>
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 'bold' }}>WALLET ADDED</div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: '#1d4ed8' }}>{money(totalCredited)}</div>
            </div>
            <div style={{ background: '#fefce8', border: '1px solid #fef08a', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 'bold' }}>TODAY RIDES</div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: '#854d0e' }}>{todayRides}</div>
            </div>
          </div>

          {/* Alerts / Notifications */}
          <div className="panel notify" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
            <h2 style={{ color: 'var(--ink)', fontWeight: '700', marginBottom: '10px' }}>Broadcast Notifications</h2>
            {alerts.length ? (
              alerts.map((a) => (
                <div className="notice" key={a.id}>
                  <strong>{a.text}</strong>
                  <small>Valid until {new Date(a.expiresAt).toLocaleString()}</small>
                </div>
              ))
            ) : (
              <p className="muted">No active announcements.</p>
            )}
          </div>

          {/* Selected Shuttle Detail */}
          <div className="panel" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
            <h2 style={{ color: 'var(--ink)', fontWeight: '700' }}>{selected ? selected.vehicleNo : 'Selected Shuttle Info'}</h2>
            {selected ? (
              <div className="alert" style={{ background: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534', marginTop: '10px' }}>
                <b style={{ color: routeColor(selected.route), fontSize: '15px' }}>
                  {ROUTE_LABELS[selected.route] || `Route ${selected.route}`}
                </b>
                <div style={{ marginTop: '5px', fontSize: '13px' }}>
                  Status: <strong>{selected.status}</strong> · {selected.lastSeen ? `Seen at ${new Date(selected.lastSeen).toLocaleTimeString()}` : 'Live'}
                </div>
              </div>
            ) : (
              <p className="muted" style={{ marginTop: '10px' }}>Click a shuttle arrow on the map to see route info.</p>
            )}
          </div>

          {/* Unified Transaction Ledger */}
          <div className="panel" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
            <div className="section-head">
              <h2 style={{ color: 'var(--ink)', fontWeight: '700' }}>Full Transaction History</h2>
              <b style={{ color: 'var(--muted)', fontSize: '12px' }}>{unifiedHistory.length} entries</b>
            </div>
            <div className="txn-history" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {unifiedHistory.length ? unifiedHistory.map((entry, i) => (
                <div 
                  key={entry.id || i} 
                  className={`txn-row ${entry._kind === 'credit' || entry._kind === 'refund' ? 'add' : 'withdraw'}`}
                  onClick={() => entry._kind === 'ride' && setSelected(shuttles.find(s => s.id === entry.shuttleId) || null)}
                >
                  <div className="txn-main">
                    <div className="txn-desc">
                      <b>{entry._kind === 'ride' ? `Ride: ${entry.vehicleNo}` : entry.note || (entry._kind === 'credit' ? 'Wallet Deposit' : 'Ride Payment')}</b>
                      {entry._kind === 'ride' && <small>{ROUTE_LABELS[entry.route] || entry.route}</small>}
                    </div>
                    <span className="txn-time">{new Date(entry.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                  </div>
                  <div className="txn-val">
                    <span className="txn-amount">{entry._kind === 'credit' || entry._kind === 'refund' ? '+' : '-'}{money(entry.amount)}</span>
                    <small className="txn-kind">{entry._kind}</small>
                  </div>
                </div>
              )) : <p className="muted">No transaction history yet.</p>}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
