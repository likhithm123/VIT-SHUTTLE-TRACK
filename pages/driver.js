import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import {
  activeAlerts,
  isShuttleRunning,
  logout,
  money,
  normalizeShuttle,
  normalizeShuttleStatus,
  normalizeTx,
  ROUTE_LABELS,
  routeColor,
  runningShuttles,
} from '../lib/demoData';
import { clearAuthSession } from '../lib/authSession';
import { useAppState } from '../lib/useAppState';

const MapView = dynamic(() => import('../components/MapView'), { ssr: false });

export default function Driver() {
  const [user, setUser] = useState(null);
  const [route, setRoute] = useState('A');
  const [status, setStatus] = useState('not started');
  const [shuttle, setShuttle] = useState(null);
  const [tx, setTx] = useState([]);
  const [studentRegSearch, setStudentRegSearch] = useState('');
  const [tap, setTap] = useState({ state: 'idle', text: 'NFC ready' });
  const { dbState, lastUpdated, syncMode, refresh } = useAppState({ enabled: true, pollMs: 1500 });
  const [nfcMode, setNfcMode] = useState('none'); // 'none' | 'mobile' | 'usb'
  const [usbDevice, setUsbDevice] = useState(null);
  const [nfcReader, setNfcReader] = useState(null);
  const [tapHistory, setTapHistory] = useState([]); // { uid, name, regNo, time, amount }
  const [hotlistCountdown, setHotlistCountdown] = useState(0); // seconds remaining for last-tapped card
  const [wakeLock, setWakeLock] = useState(null); // For Wake Lock API
  const [showPopup, setShowPopup] = useState(false);
  
  // Interactive vehicle number input
  const [vehicleNoInput, setVehicleNoInput] = useState('');

  const refs = useRef({});

  useEffect(() => {
    const u = JSON.parse(localStorage.getItem('cs_user') || 'null');
    if (!u || u.role !== 'driver') {
      location.href = '/';
      return;
    }
    setUser(u);
    refs.current.user = u;

    return () => {
      stopGps();
      if (refs.current.hotlistTimer) clearInterval(refs.current.hotlistTimer);
      
      // Release wake lock on component unmount/logout
      if (wakeLock) {
        wakeLock.release();
      }
    };
  }, []);

  useEffect(() => {
    const u = user;
    if (!u || !dbState?.shuttles) return;

    const assignedShuttle = dbState.shuttles.find((s) => s.driverId === u.id);
    setShuttle(assignedShuttle);
    refs.current.shuttle = assignedShuttle;

    if (assignedShuttle) {
      const st = normalizeShuttleStatus(assignedShuttle.status);
      setRoute(assignedShuttle.route);
      setStatus(st);
      if (!refs.current.editingVehicleNo) {
        setVehicleNoInput(assignedShuttle.vehicleNo);
      }
      refs.current.route = assignedShuttle.route;
      refs.current.status = st;
      if (st === 'running') {
        if (!refs.current.gpsTimer) startGps();
      } else {
        stopGps();
      }
    } else {
      stopGps();
    }

    setTx(
      (dbState.transactions || [])
        .map(normalizeTx)
        .filter((t) => t.driverId === u.id)
    );
  }, [dbState, user]);

  async function stopShuttleOnLogout() {
    const bus = refs.current.shuttle;
    if (!bus?.id) return;
    try {
      await fetch('/api/update-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shuttle_id: bus.id, status: 'not started' }),
      });
    } catch (e) {
      console.error('Failed to mark shuttle offline on logout:', e);
    }
  }

  function stopGps() {
    if (refs.current.gpsTimer) {
      clearInterval(refs.current.gpsTimer);
      refs.current.gpsTimer = null;
    }
  }

  async function handleDriverLogout() {
    stopGps();
    releaseWakeLock();
    refs.current.status = 'not started';
    await stopShuttleOnLogout();
    localStorage.removeItem('cs_user');
    await clearAuthSession();
    location.href = '/';
  }

  async function updateVehicleDetails(newMeta) {
    const bus = refs.current.shuttle;
    if (!bus) return;

    const nextStatus = normalizeShuttleStatus(newMeta.status ?? refs.current.status);
    const isRunning = nextStatus === 'running';

    try {
      const payload = {
        shuttle_id: bus.id,
        route: newMeta.route || refs.current.route || 'A',
        status: nextStatus,
        vehicle_number: newMeta.vehicleNo !== undefined ? newMeta.vehicleNo : bus.vehicleNo,
        heading: newMeta.heading !== undefined ? newMeta.heading : bus.heading,
      };
      if (isRunning) {
        payload.lat = newMeta.lat !== undefined ? newMeta.lat : bus.lat;
        payload.lng = newMeta.lng !== undefined ? newMeta.lng : bus.lng;
      }

      const res = await fetch('/api/update-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        refresh();
      }
    } catch (e) {
      console.error('Failed to update shuttle details:', e);
    }
  }

  function handleVehicleNoChange(e) {
    setVehicleNoInput(e.target.value);
    refs.current.editingVehicleNo = true;
  }

  function submitVehicleNo(e) {
    e.preventDefault();
    if (!vehicleNoInput.trim()) return;
    refs.current.editingVehicleNo = false;
    updateVehicleDetails({ vehicleNo: vehicleNoInput.trim() });
  }

  function handleRouteSelect(e) {
    const val = e.target.value;
    setRoute(val);
    refs.current.route = val;
    updateVehicleDetails({ route: val });
  }

  function handleStatusSelect(e) {
    const val = normalizeShuttleStatus(e.target.value);
    setStatus(val);
    refs.current.status = val;
    if (val === 'running') {
      if (!refs.current.gpsTimer) startGps();
      requestWakeLock();
    } else {
      stopGps();
      releaseWakeLock();
    }
    updateVehicleDetails({ status: val });
  }

  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        const newWakeLock = await navigator.wakeLock.request('screen');
        setWakeLock(newWakeLock);
      } catch (err) {
        console.error('Wake Lock API error:', err);
      }
    }
  }

  // Calculate heading between two points
  function calculateHeading(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    let brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release();
      setWakeLock(null);
    }
  }

  // Route waypoints for simulated movement (VIT Vellore campus loop)
  const ROUTE_WAYPOINTS = {
    A: [
      [12.9729, 79.1586], [12.9735, 79.1592], [12.9741, 79.1580],
      [12.9748, 79.1574], [12.9752, 79.1565], [12.9745, 79.1558],
      [12.9738, 79.1563], [12.9730, 79.1570], [12.9725, 79.1578]
    ],
    B: [
      [12.9724, 79.1552], [12.9718, 79.1560], [12.9712, 79.1568],
      [12.9706, 79.1575], [12.9710, 79.1583], [12.9716, 79.1578],
      [12.9720, 79.1570], [12.9722, 79.1562]
    ],
    C: [
      [12.9692, 79.1559], [12.9680, 79.1550], [12.9670, 79.1540],
      [12.9660, 79.1530], [12.9675, 79.1520], [12.9690, 79.1535],
      [12.9700, 79.1550]
    ]
  };

  function startGps() {
    let waypointIdx = 0;

    refs.current.gpsTimer = setInterval(() => {
      const bus = refs.current.shuttle;
      const currentStatus = refs.current.status;
      const currentRoute = refs.current.route || 'A';

      if (!bus || normalizeShuttleStatus(currentStatus) !== 'running') return;

      // Attempt Real GPS
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const nextLat = pos.coords.latitude;
            const nextLng = pos.coords.longitude;
            let newHeading = bus.heading || 0;
            if (bus.lat && bus.lng) {
              newHeading = calculateHeading(bus.lat, bus.lng, nextLat, nextLng);
            }
            updateVehicleDetails({ lat: nextLat, lng: nextLng, heading: newHeading });
          },
          () => {
            // Fallback to simulator if GPS permission denied or failed
            runSimulator();
          },
          { enableHighAccuracy: true, maximumAge: 500, timeout: 2000 }
        );
      } else {
        runSimulator();
      }

      function runSimulator() {
        const waypoints = ROUTE_WAYPOINTS[currentRoute] || ROUTE_WAYPOINTS.A;
        const [nextLat, nextLng] = waypoints[waypointIdx % waypoints.length];
        // Add tiny jitter so map markers visibly move
        const jLat = nextLat + (Math.random() - 0.5) * 0.0002;
        const jLng = nextLng + (Math.random() - 0.5) * 0.0002;
        let newHeading = bus.heading || 0;
        if (bus.lat && bus.lng) {
          newHeading = calculateHeading(bus.lat, bus.lng, jLat, jLng);
        }
        updateVehicleDetails({ lat: jLat, lng: jLng, heading: newHeading });
        waypointIdx = (waypointIdx + 1) % waypoints.length;
      }
    }, 1000); 
  }

  function beep(ok) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const audio = new AudioCtx();
      const osc = audio.createOscillator();
      osc.frequency.value = ok ? 880 : 180;
      osc.connect(audio.destination); 
      osc.start();
      setTimeout(() => { osc.stop(); audio.close(); }, ok ? 120 : 260);
    } catch(e) {}
  }

  async function processTap(cardUid = 'CARD1001') {
    if (!shuttle) return;
    setTap({ state: 'scan', text: `Verifying card UID: ${cardUid}` });
    
    try {
      const res = await fetch('/api/process-tap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_uid: cardUid,
          driver_id: user.id,
          shuttle_id: shuttle.id,
          route: route,
          vehicle_no: shuttle.vehicleNo
        })
      });
      
      setShowPopup(true);

      const data = await res.json();
      if (res.ok) {
        const tapTime = new Date(data.tapTime || Date.now()).toLocaleTimeString();
        setTap({ state: 'ok', text: `✅ ${data.userName} charged ${money(15)} at ${tapTime}` });
        beep(true);
        // Add to tap history with timestamp
        setTapHistory(prev => [{
          uid: cardUid,
          name: data.userName,
          regNo: data.userRegNo,
          time: tapTime,
          amount: 15
        }, ...prev].slice(0, 20));
        // Start 10s hotlist countdown
        setHotlistCountdown(10);
        if (refs.current.hotlistTimer) clearInterval(refs.current.hotlistTimer);
        refs.current.hotlistTimer = setInterval(() => {
          setHotlistCountdown(prev => {
            if (prev <= 1) { clearInterval(refs.current.hotlistTimer); return 0; }
            return prev - 1;
          });
        }, 1000);
        refresh();
      } else {
        setTap({ state: 'fail', text: data.error || 'Tap rejected' });
        beep(false);
      }
    } catch (e) {
      setTap({ state: 'fail', text: 'Network connection failed' });
      beep(false);
    }

    setTimeout(() => {
      setTap(prev => prev.state !== 'fail' ? { state: 'idle', text: nfcMode === 'mobile' ? '📱 Mobile NFC listening...' : nfcMode === 'usb' ? '🔌 USB NFC listening...' : 'NFC ready' } : prev);
      setShowPopup(false);
    }, 4000);
  }

  // ── Real NFC Mobile Tap (Web NFC API) ──────────────────────────────────────
  async function startMobileNfc() {
    if (!('NDEFReader' in window)) {
      alert('Web NFC requires Chrome on Android. Use USB or Simulate mode on desktop.');
      return;
    }
    try {
      const reader = new NDEFReader();
      await reader.scan();
      setNfcReader(reader);
      setNfcMode('mobile');
      setTap({ state: 'idle', text: '📱 Mobile NFC listening...' });
      reader.onreading = (e) => {
        const uid = e.serialNumber || 'CARD_NFC';
        processTap(uid);
      };
      reader.onerror = () => {
        setTap({ state: 'fail', text: 'NFC read error. Retrying...' });
      };
    } catch (e) {
      alert(`NFC error: ${e.message}`);
    }
  }

  function stopMobileNfc() {
    // NDEFReader has no explicit stop; GC will handle it
    setNfcReader(null);
    setNfcMode('none');
    setTap({ state: 'idle', text: 'NFC ready' });
  }

  // ── USB NFC Reader (WebUSB API) ────────────────────────────────────────────
  async function connectUsbNfc() {
    if (!navigator.usb) {
      alert('WebUSB is not supported on this browser. Use Chrome/Edge.');
      return;
    }
    try {
      const device = await navigator.usb.requestDevice({ filters: [] });
      await device.open();
      if (device.configuration === null) await device.selectConfiguration(1);
      await device.claimInterface(0);
      setUsbDevice(device);
      setNfcMode('usb');
      setTap({ state: 'idle', text: `🔌 USB: ${device.productName || 'NFC Reader'} connected` });
      // Poll USB for card data every 500ms
      const usbTimer = setInterval(async () => {
        try {
          const result = await device.transferIn(1, 64);
          if (result.data && result.data.byteLength > 0) {
            const bytes = new Uint8Array(result.data.buffer);
            const uid = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(':').toUpperCase();
            processTap(uid);
          }
        } catch (_) {}
      }, 500);
      refs.current.usbTimer = usbTimer;
    } catch (e) {
      if (e.name !== 'NotFoundError') alert(`USB error: ${e.message}`);
    }
  }

  async function disconnectUsb() {
    if (refs.current.usbTimer) clearInterval(refs.current.usbTimer);
    if (usbDevice) { try { await usbDevice.close(); } catch (_) {} }
    setUsbDevice(null);
    setNfcMode('none');
    setTap({ state: 'idle', text: 'NFC ready' });
  }

  const simulateTapInput = () => {
    const uid = prompt('Simulate Card UID Tap (e.g. CARD1001, CARD1002):', 'CARD1001');
    if (uid) processTap(uid);
  };

  const dayRevenue = tx.filter((t) => new Date(t.createdAt).toDateString() === new Date().toDateString()).reduce((a, t) => a + t.amount, 0);
  const totalRevenue = tx.reduce((a, t) => a + t.amount, 0);
  
  // Filter active alerts for driver
  const alerts = activeAlerts(dbState).filter((a) => !a.audience || ['all', 'driver'].includes(a.audience));

  // Student history lookup
  const searchedStudent = dbState?.users?.find(
    (s) => s.role === 'student' && s.regNo.toLowerCase() === studentRegSearch.toLowerCase()
  );
  const studentTx = searchedStudent
    ? (dbState?.transactions || []).map(normalizeTx).filter((t) => t.userId === searchedStudent.id)
    : [];

  return (
    <div className="app-shell vit">
      <header className="topbar" style={{ borderLeft: '5px solid var(--blue)' }}>
        <div>
          <p style={{ color: 'var(--muted)', fontWeight: 'bold' }}>VIT Driver Terminal</p>
          <h1 style={{ color: 'var(--ink)', fontWeight: '800' }}>{user?.name}</h1>
        </div>
        <div className="bar-actions">
          <button onClick={() => refresh()} style={{ background: 'var(--blue)' }}>Sync</button>
          <span>Last sync: {lastUpdated || '-'} ({syncMode === 'realtime' ? 'Supabase live' : 'polling'})</span>
          <button onClick={handleDriverLogout} style={{ background: 'var(--ink)' }}>Logout</button>
        </div>
      </header>

      <main className="dashboard">
        {/* Map Panel */}
        <section className="panel map-panel" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '12px' }}>
          <div className="section-head">
            <h2 style={{ color: 'var(--ink)', fontWeight: '700' }}>
              {shuttle ? `Active Vehicle: ${shuttle.vehicleNo}` : 'No Vehicle Assigned'}
            </h2>
            <span className="live-dot" style={{ backgroundColor: '#e0f2fe', color: '#0369a1', borderColor: '#bae6fd' }}>
              {syncMode === 'realtime' ? 'Live (Supabase)' : 'Syncing'}
            </span>
          </div>
          <MapView shuttles={runningShuttles(shuttle ? [shuttle] : [])} />
          {shuttle && !isShuttleRunning(shuttle) && (
            <p className="muted" style={{ fontSize: '12px', padding: '8px 12px', margin: 0 }}>
              Map marker hidden until status is <strong>Running</strong>.
            </p>
          )}
        </section>

        {/* Sidestack panels */}
        <section className="side-stack">
          {/* Controls panel */}
          <div className="panel controls-grid" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
            <h2 style={{ color: 'var(--ink)', fontWeight: '700' }}>Vehicle Controls</h2>
            <p className="muted" style={{ fontSize: '13px' }}>Current Route: {shuttle ? ROUTE_LABELS[route] : 'None'}</p>
            
            <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Select Operational Route</label>
            <select value={route} onChange={handleRouteSelect} disabled={!shuttle} style={{ border: '1px solid var(--line)', borderRadius: '6px' }}>
              <option value="A">SJT / PRP Green Route</option>
              <option value="B">Mens Hostel Blue Route</option>
              <option value="C">Out of Campus Yellow Route</option>
            </select>

            <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Select Shuttle Status</label>
            <select value={status} onChange={handleStatusSelect} disabled={!shuttle} style={{ border: '1px solid var(--line)', borderRadius: '6px' }}>
              <option value="running">Running</option>
              <option value="maintenance">Maintenance</option>
              <option value="not started">Not Started</option>
            </select>

            {/* Vehicle Number Editable Input */}
            <form onSubmit={submitVehicleNo} style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '10px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold' }}>Edit Vehicle Number</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input 
                  value={vehicleNoInput} 
                  onChange={handleVehicleNoChange} 
                  disabled={!shuttle}
                  style={{ flex: 1, minHeight: '38px', borderRadius: '6px', border: '1px solid var(--line)' }}
                />
                <button type="submit" disabled={!shuttle} style={{ background: 'var(--green)', minHeight: '38px' }}>Update</button>
              </div>
            </form>

            {/* NFC / USB Payment Options */}
            <div style={{ marginTop: '10px' }}>
              <label style={{ fontSize: '12px', fontWeight: 'bold', display: 'block', marginBottom: '6px' }}>Payment Tap Method</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                {nfcMode !== 'mobile' ? (
                  <button
                    onClick={startMobileNfc}
                    disabled={!shuttle}
                    style={{ background: '#6366f1', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
                    title="Requires Chrome on Android"
                  >
                    📱 Mobile NFC Tap
                  </button>
                ) : (
                  <button
                    onClick={stopMobileNfc}
                    style={{ background: '#ef4444', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
                  >
                    ⏹ Stop Mobile NFC
                  </button>
                )}
                {nfcMode !== 'usb' ? (
                  <button
                    onClick={connectUsbNfc}
                    disabled={!shuttle}
                    style={{ background: '#0ea5e9', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
                    title="Pair a USB NFC card reader"
                  >
                    🔌 USB NFC Reader
                  </button>
                ) : (
                  <button
                    onClick={disconnectUsb}
                    style={{ background: '#ef4444', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
                  >
                    ⏹ Disconnect USB
                  </button>
                )}
                <button
                  onClick={simulateTapInput}
                  disabled={!shuttle}
                  style={{ background: 'var(--blue)', gridColumn: 'span 2', fontSize: '12px' }}
                >
                  🧪 Simulate Card Tap (Demo)
                </button>
              </div>
              {nfcMode !== 'none' && (
                <div style={{ marginTop: '6px', fontSize: '11px', color: nfcMode === 'mobile' ? '#6366f1' : '#0ea5e9', fontWeight: 'bold', padding: '4px 8px', background: nfcMode === 'mobile' ? '#eef2ff' : '#e0f2fe', borderRadius: '4px' }}>
                  {nfcMode === 'mobile' ? '📱 Mobile NFC Active — tap card to phone' : `🔌 USB Reader Active — ${usbDevice?.productName || 'connected'}`}
                </div>
              )}
            </div>
          </div>

          {/* Real-time Tap Monitor */}
          <div className={`panel tap-card ${tap.state}`} style={{ border: '1px solid var(--line)', borderRadius: '10px', padding: '20px' }}>
            <div className="tick" style={{ 
              backgroundColor: tap.state === 'ok' ? 'var(--green)' : tap.state === 'fail' ? '#ef4444' : nfcMode !== 'none' ? (nfcMode === 'mobile' ? '#6366f1' : '#0ea5e9') : '#f3f4f6', 
              color: tap.state === 'idle' && nfcMode === 'none' ? 'var(--ink)' : 'white' 
            }}>
              {tap.state === 'fail' ? 'Err' : tap.state === 'ok' ? 'OK' : tap.state === 'scan' ? '...' : nfcMode === 'mobile' ? '📱' : nfcMode === 'usb' ? '🔌' : 'NFC'}
            </div>
            <h2 style={{ fontSize: '16px', color: 'var(--ink)', fontWeight: 'bold' }}>{tap.text}</h2>
            <p className="muted" style={{ fontSize: '11px', marginTop: '5px' }}>
              {nfcMode === 'mobile' ? 'Hold student NFC card to back of phone.' : nfcMode === 'usb' ? 'Present student card to USB reader.' : 'Select a tap method above or use demo simulate.'}
            </p>
            {/* Hotlist countdown */}
            {hotlistCountdown > 0 && (
              <div style={{ marginTop: '10px', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '8px', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#f59e0b', color: 'white', display: 'grid', placeItems: 'center', fontWeight: 'bold', fontSize: '14px' }}>
                  {hotlistCountdown}
                </div>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#92400e' }}>Card hotlisted — {hotlistCountdown}s cooldown</div>
                  <div style={{ fontSize: '10px', color: '#b45309' }}>Other cards can tap freely. Same card blocked.</div>
                </div>
              </div>
            )}
          </div>

          {/* Revenue metrics */}
          <div className="panel earn" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
            <span>Today's Earnings</span>
            <b style={{ color: 'var(--green)' }}>{money(dayRevenue)}</b>
            <span>Total Lifetime Earnings</span>
            <b style={{ color: 'var(--blue)' }}>{money(totalRevenue)}</b>
          </div>

          {/* Alerts notification block */}
          <div className="panel notify" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
            <h2 style={{ color: 'var(--ink)', fontWeight: '700' }}>Terminal Broadcasts</h2>
            {alerts.length ? (
              alerts.map((a) => (
                <p className="notice" key={a.id} style={{ background: '#f0f9ff', borderColor: '#bae6fd', color: '#0369a1' }}>
                  {a.text}
                  <small style={{ color: '#0284c7' }}>Valid until {new Date(a.expiresAt).toLocaleTimeString()}</small>
                </p>
              ))
            ) : (
              <p className="muted">No current broadcasts.</p>
            )}
          </div>

          {/* Student transaction lookup */}
          <div className="panel" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
            <div className="section-head">
              <h2 style={{ color: 'var(--ink)', fontWeight: '700' }}>Student Verification</h2>
            </div>
            <div className="inline-search" style={{ marginBottom: '10px' }}>
              <input 
                value={studentRegSearch} 
                onChange={(e) => setStudentRegSearch(e.target.value)} 
                placeholder="Enter Reg No (e.g. REG1001)" 
                style={{ border: '1px solid var(--line)', borderRadius: '6px' }}
              />
            </div>
            
            {searchedStudent ? (
              <div style={{ fontSize: '13px', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '10px', borderRadius: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold' }}>
                  <span>{searchedStudent.name} <small style={{ color: 'var(--muted)', fontWeight: 'normal' }}>({searchedStudent.regNo})</small></span>
                  <span style={{ color: 'var(--green)' }}>Balance: {money(dbState?.wallets?.[searchedStudent.id] || 0)}</span>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '3px' }}>Card UID: {searchedStudent.cardUid || 'Not mapped'}</div>
                {dbState?.dues?.[searchedStudent.id] && (
                  <div style={{ color: '#ef4444', fontWeight: 'bold', marginTop: '4px', fontSize: '12px' }}>
                    Due: {money(dbState.dues[searchedStudent.id].amount)} + fine
                  </div>
                )}

                {/* Recent taps for this student with timestamps */}
                <div style={{ marginTop: '8px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--ink)', marginBottom: '4px' }}>Recent Tap Timestamps</div>
                  <div className="history rich" style={{ maxHeight: '130px', overflowY: 'auto' }}>
                    {studentTx.length ? (
                      studentTx.map((t) => (
                        <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', fontSize: '11px', borderBottom: '1px solid var(--line)', padding: '4px 0', gap: '8px' }}>
                          <div>
                            <div style={{ fontWeight: 'bold', color: 'var(--ink)' }}>{new Date(t.createdAt).toLocaleString()}</div>
                            <div style={{ color: 'var(--muted)' }}>{t.vehicleNo} · {ROUTE_LABELS[t.route] || t.route}</div>
                          </div>
                          <strong style={{ color: t.status === 'refunded' ? '#ef4444' : 'var(--green)', alignSelf: 'center' }}>{money(t.amount)}</strong>
                        </div>
                      ))
                    ) : (
                      <div className="muted" style={{ fontSize: '11px' }}>No transactions on record.</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              studentRegSearch && <p className="muted" style={{ fontSize: '12px' }}>Student not found.</p>
            )}
          </div>

          {/* Recent Taps with full timestamps */}
          <div className="panel" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
            <h2 style={{ color: 'var(--ink)', fontWeight: '700' }}>Recent Taps</h2>
            <div className="history rich" style={{ maxHeight: '200px', overflowY: 'auto' }}>
              {tapHistory.length ? (
                tapHistory.map((t, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto', fontSize: '12px', borderBottom: '1px solid var(--line)', padding: '6px 0', gap: '8px' }}>
                    <div>
                      <div style={{ fontWeight: 'bold', color: 'var(--ink)' }}>{t.name} <small style={{ color: 'var(--muted)', fontWeight: 'normal' }}>({t.regNo})</small></div>
                      <div style={{ color: 'var(--muted)', fontSize: '11px' }}>🕒 {t.time}</div>
                    </div>
                    <strong style={{ color: 'var(--green)', alignSelf: 'center' }}>{money(t.amount)}</strong>
                  </div>
                ))
              ) : (
                tx.length ? (
                  tx.map((t) => (
                    <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', fontSize: '12px', borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
                      <span style={{ color: 'var(--muted)' }}>🕒 {new Date(t.createdAt).toLocaleTimeString()}</span>
                      <strong style={{ color: 'var(--green)' }}>{money(t.amount)}</strong>
                    </div>
                  ))
                ) : (
                  <p className="muted">No recent taps recorded.</p>
                )
              )}
            </div>
          </div>
        </section>
      </main>

      {showPopup && (
        <div className={`tap-popup-overlay ${tap.state}`}>
          <div className="popup-card">
            <div className="popup-icon">{tap.state === 'ok' ? '✅' : '❌'}</div>
            <div className="popup-msg">{tap.state === 'ok' ? 'SUCCESS' : 'FAILED'}</div>
            <div className="popup-sub">{tap.text}</div>
          </div>
        </div>
      )}
    </div>
  );
}
