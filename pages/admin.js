import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { activeAlerts, getFine, logout, money, normalizeShuttle, normalizeTx, ROUTE_LABELS, routeColor, runningShuttles } from '../lib/demoData';
import { useAppState } from '../lib/useAppState';
import AdminDriverProfile from '../components/AdminDriverProfile';

const MapView = dynamic(() => import('../components/MapView'), { ssr: false });

export default function Admin() {
  const [user, setUser] = useState(null);
  const [shuttles, setShuttles] = useState([]);
  const [tab, setTab] = useState('students');
  const [reg, setReg] = useState('');
  const [driverReg, setDriverReg] = useState('');
  const { dbState, lastUpdated, syncMode, refresh } = useAppState({ enabled: true, pollMs: 1500 });
  
  // Alert form state
  const [showAlertForm, setShowAlertForm] = useState(false);
  const [alertText, setAlertText] = useState('');
  const [alertAudience, setAlertAudience] = useState('all');
  const [alertExpiry, setAlertExpiry] = useState('');
  const [alertSuccess, setAlertSuccess] = useState('');

  // Add student form state
  const [studentForm, setStudentForm] = useState({ name: '', regNo: '', cardUid: '', passoutYear: new Date().getFullYear() + 4 });
  const [studentFormError, setStudentFormError] = useState('');

  // Add driver form state
  const [driverForm, setDriverForm] = useState({ name: '', regNo: '', vehicleNo: '', route: 'A' });
  const [driverFormError, setDriverFormError] = useState('');

  // NFC mapping state
  const [showNfcMapForm, setShowNfcMapForm] = useState(false);
  const [nfcCardUidInput, setNfcCardUidInput] = useState('');
  const [usbStatus, setUsbStatus] = useState('');

  // Add Money state
  const [showAddMoneyForm, setShowAddMoneyForm] = useState(false);
  const [addMoneyInput, setAddMoneyInput] = useState('');

  async function startAdminNfcScan() {
    if (!('NDEFReader' in window)) {
      alert('Web NFC is not supported on this browser/device (requires Chrome on Android/Mobile).');
      return;
    }
    try {
      const ndef = new NDEFReader();
      await ndef.scan();
      ndef.onreading = (e) => {
        const uid = e.serialNumber || 'CARD1001';
        handleMapNfc(null, uid); // Auto-save on tap
      };
      setUsbStatus('Mobile NFC Active: Tap card now...');
    } catch (e) {
      alert(`NFC Scan Error: ${e.message}`);
    }
  }

  async function detectAdminUsb() {
    if (!navigator.usb) {
      alert('WebUSB is not supported on this browser.');
      return;
    }
    try {
      const device = await navigator.usb.requestDevice({ filters: [] });
      setUsbStatus(`USB Reader: ${device.productName || device.vendorId}`);
      alert(`Connected to USB NFC device: ${device.productName}`);
    } catch (e) {
      alert('Failed to connect USB Reader');
    }
  }

  useEffect(() => {
    const u = JSON.parse(localStorage.getItem('cs_user') || 'null');
    if (!u || u.role !== 'admin') {
      location.href = '/';
      return;
    }
    setUser(u);
  }, []);

  useEffect(() => {
    if (!dbState?.shuttles) return;
    setShuttles((dbState.shuttles || []).map(normalizeShuttle));
  }, [dbState]);

  async function handleAddStudent(e) {
    e.preventDefault();
    setStudentFormError('');
    if (!studentForm.name || !studentForm.regNo) {
      setStudentFormError('Name and Reg No are required');
      return;
    }
    
    // DUPLICATE CHECKS
    if (allUsersList.some(u => u.regNo.toLowerCase() === studentForm.regNo.toLowerCase())) {
      setStudentFormError('Registration Number already exists');
      return;
    }
    if (studentForm.cardUid && allUsersList.some(u => u.cardUid === studentForm.cardUid)) {
      setStudentFormError('NFC UID already assigned to another user');
      return;
    }

    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_student',
          ...studentForm
        })
      });
      const data = await res.json();
      if (res.ok) {
        setStudentForm({ name: '', regNo: '', cardUid: '', passoutYear: new Date().getFullYear() + 4 });
        refresh();
      } else {
        setStudentFormError(data.error || 'Failed to add student');
      }
    } catch (err) {
      setStudentFormError('Network connection failed');
    }
  }

  async function handleAddDriver(e) {
    e.preventDefault();
    setDriverFormError('');
    if (!driverForm.name || !driverForm.regNo || !driverForm.vehicleNo) {
      setDriverFormError('Name, Driver ID, and Vehicle Number are required');
      return;
    }
    
    // DUPLICATE CHECKS
    if (allUsersList.some(u => u.regNo.toLowerCase() === driverForm.regNo.toLowerCase())) {
      setDriverFormError('Driver ID already exists');
      return;
    }
    if (shuttles.some(s => s.vehicleNo.toLowerCase() === driverForm.vehicleNo.toLowerCase())) {
      setDriverFormError('Vehicle Number already registered');
      return;
    }

    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_driver',
          ...driverForm
        })
      });
      const data = await res.json();
      if (res.ok) {
        setDriverForm({ name: '', regNo: '', vehicleNo: '', route: 'A' });
        refresh();
      } else {
        setDriverFormError(data.error || 'Failed to add driver');
      }
    } catch (err) {
      setDriverFormError('Network connection failed');
    }
  }

  async function handleSendAlert(e) {
    e.preventDefault();
    setAlertSuccess('');
    if (!alertText || !alertExpiry) return;

    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_alert',
          text: alertText,
          audience: alertAudience,
          expiresAt: alertExpiry
        })
      });

      if (res.ok) {
        setAlertText('');
        setAlertExpiry('');
        setAlertSuccess('Broadcast sent successfully!');
        setShowAlertForm(false);
        refresh();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeleteAlert(alertId) {
    if (!confirm('Are you sure you want to delete this broadcast notification?')) return;

    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_alert',
          alertId
        })
      });

      if (res.ok) {
        refresh();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleMapNfc(e, manualUid = null) {
    if (e) e.preventDefault();
    const targetUid = manualUid || nfcCardUidInput;
    if (!targetUid || !selectedStudent) return;
    
    if (allUsersList.some(u => u.cardUid === targetUid.trim() && u.id !== selectedStudent.id)) {
      alert('Error: This NFC UID is already assigned to another user.');
      return;
    }

    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'map_nfc',
          userId: selectedStudent.id,
          cardUid: targetUid.trim()
        })
      });

      if (res.ok) {
        setNfcCardUidInput('');
        setShowNfcMapForm(false);
        refresh();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleAddMoney(e) {
    e.preventDefault();
    const amount = Number(addMoneyInput);
    if (isNaN(amount) || amount <= 0 || !selectedStudent) return;

    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_money',
          userId: selectedStudent.id,
          amount
        })
      });

      if (res.ok) {
        setAddMoneyInput('');
        setShowAddMoneyForm(false);
        refresh();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleEmptyAccount() {
    if (!selectedStudent) return;
    if (!confirm(`Are you sure you want to empty the account of ${selectedStudent.name}?`)) return;

    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'withdraw',
          userId: selectedStudent.id,
          amount: dbState?.wallets?.[selectedStudent.id] || 0
        })
      });

      if (res.ok) {
        refresh();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleRevertPassword(userId, regNo) {
    if (!confirm(`Confirm reverting password of user ${regNo} back to ${regNo}@123?`)) return;

    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'revert_password',
          userId
        })
      });

      if (res.ok) {
        alert('Password reverted successfully. User will be forced to change it at next login.');
        refresh();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleClearDummy() {
    if (!confirm('WARNING: Are you sure you want to clear all dummy students, drivers, shuttles, and transactions? Only the Admin user will remain.')) return;

    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'clear_dummy'
        })
      });

      if (res.ok) {
        setReg('');
        setDriverReg('');
        refresh();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleRefund(row) {
    if (!confirm(`Confirm refunding ${money(row.amount)} to user?`)) return;

    try {
      const res = await fetch('/api/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: row.id,
          admin_id: user?.id
        })
      });

      if (res.ok) {
        refresh();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDeleteUser(userId, role, regNo) {
    if (!confirm(`Confirm deleting this ${role} (${regNo}) permanently from the database?`)) return;

    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_user',
          userId
        })
      });

      if (res.ok) {
        if (role === 'student') setReg('');
        else setDriverReg('');
        refresh();
      }
    } catch (e) {
      console.error(e);
    }
  }

  const allUsersList = dbState?.users || [];
  // Optimization: Strict limit on DOM rendering. 
  // Even with 10k users, only the 30 most relevant (or searched) are rendered.
  const students = allUsersList
    .filter(u => u.role === 'student' && (!reg || u.regNo.toLowerCase().includes(reg.toLowerCase())))
    .slice(0, 30);
  const drivers = allUsersList.filter(u => u.role === 'driver');
  const tx = dbState?.transactions || [];

  const selectedStudent = students.find(s => s.regNo.toLowerCase() === reg.toLowerCase());
  const selectedDriver = drivers.find(d => d.regNo.toLowerCase() === driverReg.toLowerCase());

  // Driver Profile Data Calculation
  const driverRides = tx.filter(t => t.driverId === selectedDriver?.id && t.status !== 'refunded');
  const driverProfileData = selectedDriver ? {
    ...selectedDriver,
    vehicleNo: shuttles.find(s => s.driverId === selectedDriver.id)?.vehicleNo || 'Not Mapped',
    earningsToday: driverRides.filter(t => new Date(t.createdAt).toDateString() === new Date().toDateString()).reduce((a, t) => a + t.amount, 0),
    earningsMonth: driverRides.filter(t => new Date(t.createdAt).getMonth() === new Date().getMonth()).reduce((a, t) => a + t.amount, 0),
    totalRides: driverRides.length,
    rating: "5.0",
    phone: "Not Provided"
  } : null;

  const studentTxList = selectedStudent ? tx.filter(t => t.userId === selectedStudent.id) : [];
  
  const totalRevenue = tx.filter(t => t.status !== 'refunded').reduce((a, t) => a + Number(t.amount || 0), 0);
  
  const totalDues = Object.entries(dbState?.dues || {}).reduce((sum, [uid, dueObj]) => {
    const fine = getFine(dueObj.since);
    return sum + dueObj.amount + fine;
  }, 0);

  const activeBroadcasts = activeAlerts(dbState);

  return (
    <div className="app-shell vit">
      <header className="topbar" style={{ borderLeft: '5px solid var(--green)' }}>
        <div>
          <p style={{ color: 'var(--muted)', fontWeight: 'bold' }}>VIT Vellore shuttle Management System</p>
          <h1 style={{ color: 'var(--ink)', fontWeight: '800' }}>Admin Command Dashboard</h1>
        </div>
        <div className="bar-actions">
          <button onClick={() => setShowAlertForm(!showAlertForm)} style={{ background: 'var(--blue)' }}>
            {showAlertForm ? 'Close Alert' : 'Send Alert'}
          </button>
          <button onClick={handleClearDummy} style={{ background: 'var(--ink)' }}>Clear Dummy Data</button>
          <button onClick={refresh} style={{ background: 'var(--green)' }}>Sync</button>
          <span>Last sync: {lastUpdated || '-'} ({syncMode === 'realtime' ? 'Supabase live' : 'polling'})</span>
          <button onClick={logout} style={{ background: 'var(--ink)' }}>Logout</button>
        </div>
      </header>

      {/* Glassmorphic Send Alert Overlay */}
      {showAlertForm && (
        <div style={{ margin: '15px 0', padding: '20px', border: '1px solid var(--line)', background: '#ffffff', borderRadius: '12px', boxShadow: 'var(--shadow)' }}>
          <h3 style={{ margin: '0 0 12px 0', color: 'var(--ink)', fontSize: '16px' }}>Send Dynamic Alert Broadcast</h3>
          <form onSubmit={handleSendAlert} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr auto', gap: '10px', alignItems: 'end' }}>
            <div>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '4px' }}>Alert Content Text</label>
              <input value={alertText} onChange={(e) => setAlertText(e.target.value)} placeholder="Alert description here..." required style={{ border: '1px solid var(--line)' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '4px' }}>Audience Filter</label>
              <select value={alertAudience} onChange={(e) => setAlertAudience(e.target.value)} style={{ border: '1px solid var(--line)' }}>
                <option value="all">All audiences</option>
                <option value="student">Students Only</option>
                <option value="driver">Drivers Only</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '4px' }}>Expiry Time</label>
              <input type="datetime-local" value={alertExpiry} onChange={(e) => setAlertExpiry(e.target.value)} required style={{ border: '1px solid var(--line)' }} />
            </div>
            <button type="submit" style={{ background: 'var(--green)' }}>Broadcast Alert</button>
          </form>
          {alertSuccess && <p style={{ color: 'var(--green)', fontSize: '12px', marginTop: '6px' }}>{alertSuccess}</p>}
        </div>
      )}

      {/* Metrics Row */}
      <main className="admin-grid">
        <section className="panel stat" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
          <span>Active Shuttles</span>
          <b style={{ color: 'var(--green)' }}>{shuttles.length}</b>
          <p>shuttles tracked</p>
        </section>
        <section className="panel stat" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
          <span>Running Now</span>
          <b style={{ color: 'var(--blue)' }}>{runningShuttles(shuttles).length}</b>
          <p>active status</p>
        </section>
        <section className="panel stat" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
          <span>Total Fare Revenue</span>
          <b style={{ color: 'var(--green)' }}>{money(totalRevenue)}</b>
          <p>collected balance</p>
        </section>
        <section className="panel stat" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
          <span>Outstanding Dues</span>
          <b style={{ color: 'var(--blue)' }}>{money(totalDues)}</b>
          <p>accumulated dues + fines</p>
        </section>

        {/* Live Shuttle Map */}
        <section className="panel map-wide" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '12px' }}>
          <div className="section-head">
            <h2 style={{ color: 'var(--ink)', fontWeight: '700' }}>Operational Shuttle Map</h2>
            <span className="live-dot" style={{ backgroundColor: '#e0f2fe', color: '#0369a1', borderColor: '#bae6fd' }}>
              {syncMode === 'realtime' ? 'Live (Supabase)' : 'Syncing'}
            </span>
          </div>
          <MapView shuttles={runningShuttles(shuttles)} followSelf={false} />
        </section>

        {/* User tabs panel */}
        <section className="panel tabs-panel" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
          <div className="tabs">
            <button className={tab === 'students' ? 'active' : ''} onClick={() => setTab('students')} style={{ background: tab === 'students' ? 'var(--green)' : '#f3f4f6', color: tab === 'students' ? 'white' : 'var(--ink)' }}>
              Students ({students.length})
            </button>
            <button className={tab === 'drivers' ? 'active' : ''} onClick={() => setTab('drivers')} style={{ background: tab === 'drivers' ? 'var(--blue)' : '#f3f4f6', color: tab === 'drivers' ? 'white' : 'var(--ink)' }}>
              Drivers ({drivers.length})
            </button>
          </div>

          <div className="history rich" style={{ maxHeight: '420px', overflowY: 'auto' }}>
            {tab === 'students' ? (
              students.length ? (
                students.map((s) => (
                  <div key={s.id} onClick={() => setReg(s.regNo)} style={{ border: reg === s.regNo ? '2px solid var(--green)' : '1px solid var(--line)', borderRadius: '6px', padding: '10px', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyBetween: 'space-between', fontWeight: 'bold' }}>
                      <span>{s.regNo}</span>
                      <span>{money(dbState?.wallets?.[s.id] || 0)}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      {s.name} · Passout {s.passoutYear}
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted">No students registered.</p>
              )
            ) : (
              drivers.length ? (
                drivers.map((d) => (
                  <div key={d.id} onClick={() => setDriverReg(d.regNo)} style={{ border: driverReg === d.regNo ? '2px solid var(--blue)' : '1px solid var(--line)', borderRadius: '6px', padding: '10px', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyBetween: 'space-between', fontWeight: 'bold' }}>
                      <span>{d.regNo}</span>
                      <span>{shuttles.find((s) => s.driverId === d.id)?.vehicleNo || 'No Shuttle'}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      {d.name}
                    </div>
                  </div>
                ))
              ) : (
                <p className="muted">No drivers registered.</p>
              )
            )}
          </div>
        </section>

        {/* Add Student Panel */}
        <section className="panel wide form-grid" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
          <h2>Register Student</h2>
          <form onSubmit={handleAddStudent} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', width: '100%', gridColumn: 'span 4' }}>
            <input placeholder="Name (e.g. Aarav Student)" value={studentForm.name} onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })} required style={{ border: '1px solid var(--line)' }} />
            <input placeholder="Reg no (e.g. REG1001)" value={studentForm.regNo} onChange={(e) => setStudentForm({ ...studentForm, regNo: e.target.value })} required style={{ border: '1px solid var(--line)' }} />
            <input placeholder="NFC UID (optional)" value={studentForm.cardUid} onChange={(e) => setStudentForm({ ...studentForm, cardUid: e.target.value })} style={{ border: '1px solid var(--line)' }} />
            <input placeholder="Passout year (optional)" type="number" value={studentForm.passoutYear} onChange={(e) => setStudentForm({ ...studentForm, passoutYear: e.target.value })} style={{ border: '1px solid var(--line)' }} />
            <button type="submit" style={{ background: 'var(--green)', gridColumn: 'span 2' }}>Add Student User (Pass: REGNO@123)</button>
          </form>
          {studentFormError && <small style={{ color: 'var(--blue)', gridColumn: 'span 4' }}>{studentFormError}</small>}
        </section>

        {/* Add Driver Panel */}
        <section className="panel wide form-grid" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
          <h2>Register Driver & Shuttle</h2>
          <form onSubmit={handleAddDriver} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', width: '100%', gridColumn: 'span 4' }}>
            <input placeholder="Driver Name (e.g. Kumar Blue)" value={driverForm.name} onChange={(e) => setDriverForm({ ...driverForm, name: e.target.value })} required style={{ border: '1px solid var(--line)' }} />
            <input placeholder="Driver ID (e.g. DRV01)" value={driverForm.regNo} onChange={(e) => setDriverForm({ ...driverForm, regNo: e.target.value })} required style={{ border: '1px solid var(--line)' }} />
            <input placeholder="Vehicle Number (e.g. VIT-A-101)" value={driverForm.vehicleNo} onChange={(e) => setDriverForm({ ...driverForm, vehicleNo: e.target.value })} required style={{ border: '1px solid var(--line)' }} />
            <select value={driverForm.route} onChange={(e) => setDriverForm({ ...driverForm, route: e.target.value })} style={{ border: '1px solid var(--line)' }}>
              <option value="A">SJT / PRP Green Route</option>
              <option value="B">Mens Hostel Blue Route</option>
              <option value="C">Out of Campus Yellow Route</option>
            </select>
            <button type="submit" style={{ background: 'var(--blue)', gridColumn: 'span 2' }}>Add Driver & Shuttle (Pass: ID@123)</button>
          </form>
          {driverFormError && <small style={{ color: 'var(--blue)', gridColumn: 'span 4' }}>{driverFormError}</small>}
        </section>

        {/* Student Account Control details */}
        <section className="panel wide" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
          <div className="section-head">
            <h2>Student Account details</h2>
            <div className="inline-search">
              <input value={reg} onChange={(e) => setReg(e.target.value)} placeholder="Search Reg No (e.g. REG1001)" style={{ border: '1px solid var(--line)' }} />
            </div>
          </div>
          
          {selectedStudent ? (
            <div style={{ marginTop: '10px' }}>
              <h3 style={{ fontSize: '15px', color: 'var(--ink)' }}>
                {selectedStudent.name} (Wallet balance: {money(dbState?.wallets?.[selectedStudent.id] || 0)})
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                Reg No: <strong>{selectedStudent.regNo}</strong> · Card UID: <strong>{selectedStudent.cardUid || 'Not Mapped'}</strong> · Passout: <strong>{selectedStudent.passoutYear}</strong>
              </p>

              {/* NFC Mapping Form */}
              {showNfcMapForm ? (
                <form onSubmit={handleMapNfc} style={{ marginTop: '12px', background: '#f0f9ff', padding: '15px', borderRadius: '8px', border: '1px solid #bae6fd', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', color: 'var(--ink)' }}>Map NFC Card UID / Mobile NFC / USB</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <button type="button" onClick={startAdminNfcScan}
                      style={{ background: '#6366f1', minHeight: '36px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
                      title="Requires Chrome on Android">
                      📱 Scan via Mobile NFC
                    </button>
                    <button type="button" onClick={detectAdminUsb}
                      style={{ background: '#0ea5e9', minHeight: '36px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
                      title="Pair a USB NFC card reader">
                      🔌 Pair USB NFC Reader
                    </button>
                  </div>
                  {usbStatus && <small style={{ color: '#0ea5e9', display: 'block', fontWeight: 'bold', padding: '3px 6px', background: '#e0f2fe', borderRadius: '4px' }}>✔ {usbStatus}</small>}
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input value={nfcCardUidInput} onChange={(e) => setNfcCardUidInput(e.target.value)} placeholder="Card UID auto-filled by NFC/USB, or type manually" required style={{ flex: 1, minHeight: '34px', border: '1px solid var(--line)' }} />
                    <button type="submit" style={{ background: 'var(--green)', minHeight: '34px' }}>Save UID</button>
                    <button type="button" onClick={() => setShowNfcMapForm(false)} style={{ background: 'var(--ink)', minHeight: '34px' }}>Cancel</button>
                  </div>
                </form>
              ) : null}

              {/* Add Money Form */}
              {showAddMoneyForm ? (
                <form onSubmit={handleAddMoney} style={{ marginTop: '12px', background: '#f0fdf4', padding: '10px', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 'bold' }}>Add Wallet Balance (Will clear dues/fines first)</label>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                    <input type="number" value={addMoneyInput} onChange={(e) => setAddMoneyInput(e.target.value)} placeholder="Amount (e.g. 100)" required style={{ flex: 1, minHeight: '34px' }} min="1" />
                    <button type="submit" style={{ background: 'var(--green)', minHeight: '34px' }}>Credit</button>
                    <button type="button" onClick={() => setShowAddMoneyForm(false)} style={{ background: 'var(--ink)', minHeight: '34px' }}>Cancel</button>
                  </div>
                </form>
              ) : null}

              {/* Action Buttons Row */}
              <div className="bar-actions" style={{ marginTop: '12px' }}>
                <button onClick={() => { setShowAddMoneyForm(true); setShowNfcMapForm(false); }} style={{ background: 'var(--green)' }}>Add Balance</button>
                <button onClick={handleEmptyAccount} style={{ background: 'var(--blue)' }}>Empty Wallet</button>
                <button onClick={() => { setShowNfcMapForm(true); setShowAddMoneyForm(false); startAdminNfcScan(); }} style={{ background: 'var(--blue)' }}>Map NFC UID</button>
                <button onClick={() => handleRevertPassword(selectedStudent.id, selectedStudent.regNo)} style={{ background: 'var(--blue)' }}>Revert Password</button>
                <button className="danger" onClick={() => handleDeleteUser(selectedStudent.id, 'student', selectedStudent.regNo)} style={{ background: 'var(--blue)' }}>Delete Student</button>
              </div>

              {/* Student Transactions */}
              <h4 style={{ margin: '15px 0 6px 0', fontSize: '13px' }}>Recent Rides</h4>
              <div className="history rich" style={{ maxHeight: '180px', overflowY: 'auto' }}>
                {studentTxList.length ? (
                  studentTxList.map((t) => (
                    <div key={t.id} style={{ display: 'flex', justifyBetween: 'space-between', fontSize: '12px', borderBottom: '1px solid var(--line)', padding: '6px 0' }}>
                      <div>
                        <span>{new Date(t.createdAt).toLocaleString()}</span>
                        <em style={{ display: 'block', fontSize: '11px', color: 'var(--muted)', fontStyle: 'normal' }}>
                          {t.vehicleNo} · {ROUTE_LABELS[t.route]}
                        </em>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <strong style={{ color: t.status === 'refunded' ? 'var(--blue)' : 'var(--green)' }}>
                          {t.status === 'refunded' ? '[Refunded] ' : ''}{money(t.amount)}
                        </strong>
                        {t.status !== 'refunded' && (
                          <button onClick={() => handleRefund(t)} style={{ minHeight: '28px', background: 'var(--blue)', fontSize: '11px', padding: '0 8px' }}>
                            Refund
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted">No rides recorded for this student.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: '10px' }}>Search or click a student user in the left column.</p>
          )}
        </section>

        {/* Driver Account control details */}
        <section className="panel" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px' }}>
          <div className="section-head">
            <h2>Driver details</h2>
            <div className="inline-search">
              <input value={driverReg} onChange={(e) => setDriverReg(e.target.value)} placeholder="Search Driver ID (e.g. DRV01)" style={{ border: '1px solid var(--line)' }} />
            </div>
          </div>

          {selectedDriver ? ( 
            <div style={{ marginTop: '15px' }}>
              <AdminDriverProfile driver={driverProfileData} />
              <div className="bar-actions" style={{ marginTop: '15px' }}>
                <button onClick={() => handleRevertPassword(selectedDriver.id, selectedDriver.regNo)} style={{ background: 'var(--blue)', width: '100%' }}>Revert Password</button>
                <button className="danger" onClick={() => handleDeleteUser(selectedDriver.id, 'driver', selectedDriver.regNo)} style={{ background: 'var(--blue)', width: '100%' }}>Delete Driver</button>
              </div>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: '10px' }}>Search or click a driver user in the left column.</p>
          )}

          {/* Broadcasts/Alerts display */}
          <h2 style={{ color: 'var(--ink)', fontWeight: '700', marginTop: '20px' }}>Active Broadcast Alerts</h2>
          <div style={{ maxHeight: '180px', overflowY: 'auto', marginTop: '8px' }}>
            {activeBroadcasts.length ? (
              activeBroadcasts.map((a) => (
                <div key={a.id} style={{ background: '#f0f9ff', border: '1px solid #bae6fd', color: '#0369a1', borderRadius: '6px', padding: '8px', marginBottom: '6px', fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <strong>{a.text}</strong>
                    <span style={{ display: 'block', fontSize: '10px', color: '#0284c7' }}>Audience: {a.audience} · Until: {new Date(a.expiresAt).toLocaleTimeString()}</span>
                  </div>
                  <button onClick={() => handleDeleteAlert(a.id)} style={{ background: 'transparent', color: '#ef4444', padding: '4px', minHeight: 'auto', fontSize: '14px', fontWeight: 'bold' }}>✕</button>
                </div>
              ))
            ) : (
              <p className="muted">No active broadcast announcements.</p>
            )}
          </div>
        </section>

        {/* Global Transactions list */}
        <section className="panel wide" style={{ border: '1px solid var(--line)', background: 'var(--panel)', borderRadius: '10px', gridColumn: 'span 4' }}>
          <h2>All Shuttle System transactions</h2>
          <div className="history rich" style={{ maxHeight: '250px', overflowY: 'auto', marginTop: '10px' }}>
            {tx.length ? (
              tx.map((t) => (
                <div key={t.id} style={{ display: 'flex', justifyBetween: 'space-between', fontSize: '12px', borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
                  <div>
                    <span>{new Date(t.createdAt).toLocaleString()}</span>
                    <em style={{ display: 'block', color: 'var(--muted)', fontSize: '11px', fontStyle: 'normal' }}>
                      User ID: {t.userId} · Vehicle: {t.vehicleNo} · Route: {t.route}
                    </em>
                  </div>
                  <strong style={{ color: t.status === 'refunded' ? 'var(--blue)' : 'var(--green)' }}>
                    {t.status === 'refunded' ? '[Refunded] ' : ''}{money(t.amount)}
                  </strong>
                </div>
              ))
            ) : (
              <p className="muted">No transactions registered.</p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
