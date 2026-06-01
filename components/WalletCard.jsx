import { useEffect, useState, useRef } from 'react';
import { FARE, getFine, money } from '../lib/demoData';

export default function WalletCard({ user, dbState, onRefresh }) {
  const [balance, setBalance] = useState(0);
  const [due, setDue] = useState(null);
  
  // Forms state
  const [showAddForm, setShowAddForm] = useState(false);
  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [confirmData, setConfirmData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Hotlist cooldown state
  const [cooldownTime, setCooldownTime] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!user || !dbState) return;
    setBalance(Number(dbState.wallets?.[user.id] || 0));
    setDue(dbState.dues?.[user.id] || null);

    // Check cooldown for the current user's assigned NFC card
    const cardUid = user.cardUid;
    if (cardUid && dbState.hotlist) {
      const expiresAt = dbState.hotlist[cardUid];
      if (expiresAt) {
        const remaining = Math.ceil((expiresAt - Date.now()) / 1000);
        if (remaining > 0) {
          setCooldownTime(remaining);
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = setInterval(() => {
            setCooldownTime((prev) => {
              if (prev <= 1) {
                clearInterval(timerRef.current);
                return 0;
              }
              return prev - 1;
            });
          }, 1000);
        } else {
          setCooldownTime(0);
        }
      }
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [user, dbState]);

  // Clean inputs when toggled
  const toggleAdd = () => {
    setShowAddForm(!showAddForm);
    setShowWithdrawForm(false);
    setAmountInput('');
    setConfirmData(null);
    setErrorMsg('');
  };

  const toggleWithdraw = () => {
    setShowWithdrawForm(!showWithdrawForm);
    setShowAddForm(false);
    setAmountInput('');
    setConfirmData(null);
    setErrorMsg('');
  };

  // Preview add money to show fine breakdown
  function previewAdd(e) {
    e.preventDefault();
    setErrorMsg('');
    const amt = Number(amountInput);
    if (isNaN(amt) || amt <= 0) {
      setErrorMsg('Enter a valid amount');
      return;
    }

    const currentDue = due ? due.amount : 0;
    const fine = due ? getFine(due.since) : 0;
    const totalDebt = currentDue + fine;
    
    let toDebtPaid = 0;
    let toWalletBalance = 0;
    
    if (amt >= totalDebt) {
      toDebtPaid = totalDebt;
      toWalletBalance = amt - totalDebt;
    } else {
      toDebtPaid = amt;
      toWalletBalance = 0;
    }

    setConfirmData({
      type: 'add',
      amount: amt,
      currentDue,
      fine,
      totalDebt,
      toDebtPaid,
      toWalletBalance,
      remainingDebt: Math.max(0, totalDebt - amt)
    });
  }

  // Preview withdraw to show confirmation
  function previewWithdraw(e) {
    e.preventDefault();
    setErrorMsg('');
    const amt = Number(amountInput);
    if (isNaN(amt) || amt <= 0) {
      setErrorMsg('Enter a valid amount');
      return;
    }
    if (balance < amt) {
      setErrorMsg('Insufficient balance');
      return;
    }

    setConfirmData({
      type: 'withdraw',
      amount: amt
    });
  }

  // Execute confirmation
  async function handleConfirm() {
    if (!confirmData) return;
    const actionType = confirmData.type === 'add' ? 'add_money' : 'withdraw';
    setIsSubmitting(true);
    setErrorMsg('');
    try {
      const res = await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: actionType,
          userId: user.id,
          amount: confirmData.amount
        })
      });
      
      if (res.ok) {
        setShowAddForm(false);
        setShowWithdrawForm(false);
        setAmountInput('');
        setConfirmData(null);
        onRefresh?.();
      } else {
        const d = await res.json();
        setErrorMsg(d.error || 'Operation failed');
      }
    } catch (e) {
      setErrorMsg('Connection error');
    } finally {
      setIsSubmitting(false);
    }
  }

  const fineAmount = due ? getFine(due.since) : 0;
  const totalDueAmount = due ? due.amount + fineAmount : 0;

  return (
    <div className="wallet-card-container">
      {/* Wallet Balance Board */}
      <div className="wallet" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px', border: '1px solid var(--line)', background: 'var(--panel)', padding: '20px', borderRadius: '12px' }}>
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
          <span style={{ color: 'var(--muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Balance</span>
          <strong style={{ fontSize: '20px', color: '#166534', fontWeight: '800' }}>{money(balance)}</strong>
        </div>
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
          <span style={{ color: 'var(--muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Standard Fare</span>
          <strong style={{ fontSize: '20px', color: '#166534', fontWeight: '800' }}>{money(FARE)}</strong>
        </div>
        <div style={{ background: totalDueAmount > 0 ? '#f0f9ff' : '#f0fdf4', border: totalDueAmount > 0 ? '1px solid #bae6fd' : '1px solid #bbf7d0' }}>
          <span style={{ color: 'var(--muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Due</span>
          <strong style={{ fontSize: '20px', color: totalDueAmount > 0 ? '#0369a1' : '#166534', fontWeight: '800' }}>{money(totalDueAmount)}</strong>
        </div>
      </div>

      {/* Cooldown Timer for Student 1 */}
      {cooldownTime > 0 && (
        <div className="alert" style={{ background: '#f0f9ff', borderColor: '#bae6fd', color: '#0369a1', margin: '15px 0', padding: '12px', borderRadius: '8px', textAlign: 'center', fontWeight: '600' }}>
          🔄 NFC Card Hotlist Cooldown: <span style={{ fontSize: '16px', fontWeight: '800' }}>{cooldownTime}s</span> remaining.
        </div>
      )}

      {/* Due Date Overdue Notice */}
      {due && (
        <div style={{ margin: '10px 0', fontSize: '12px', color: 'var(--muted)', padding: '4px 10px', background: '#f0f9ff', borderRadius: '6px', borderLeft: '3px solid var(--blue)' }}>
          ⚠️ Due since {new Date(due.since).toLocaleDateString()}. Fines applied if older than 15 days (₹5/day).
          {fineAmount > 0 && <span style={{ display: 'block', fontWeight: 'bold', color: 'var(--blue)' }}>Includes fine: {money(fineAmount)} ({Math.floor((Date.now() - new Date(due.since).getTime())/86400000)} days overdue)</span>}
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
        <button 
          onClick={toggleAdd} 
          style={{ flex: 1, background: 'var(--green)', color: '#ffffff', fontWeight: '700', borderRadius: '8px', transition: 'all 0.2s' }}
        >
          {showAddForm ? 'Close Add Form' : 'Add Money'}
        </button>
        <button 
          onClick={toggleWithdraw} 
          style={{ flex: 1, background: 'var(--blue)', color: '#ffffff', fontWeight: '700', borderRadius: '8px', transition: 'all 0.2s' }}
        >
          {showWithdrawForm ? 'Close Withdraw' : 'Withdraw Money'}
        </button>
      </div>

      {/* Add Money Interactive Section */}
      {showAddForm && !confirmData && (
        <form onSubmit={previewAdd} style={{ marginTop: '15px', padding: '15px', border: '1px solid var(--line)', borderRadius: '8px', background: '#ffffff', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h3 style={{ fontSize: '14px', margin: '0 0 5px 0', color: 'var(--ink)' }}>Top Up Account Balance</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input 
              type="number" 
              value={amountInput} 
              onChange={(e) => setAmountInput(e.target.value)} 
              placeholder="Enter amount (e.g. 100)"
              style={{ flex: 1, minHeight: '38px', padding: '8px', borderRadius: '6px' }}
              min="1"
              required 
            />
            <button type="submit" style={{ background: 'var(--green)', minHeight: '38px' }}>Preview</button>
          </div>
          {errorMsg && <small style={{ color: 'var(--blue)' }}>{errorMsg}</small>}
        </form>
      )}

      {/* Withdraw Money Interactive Section */}
      {showWithdrawForm && !confirmData && (
        <form onSubmit={previewWithdraw} style={{ marginTop: '15px', padding: '15px', border: '1px solid var(--line)', borderRadius: '8px', background: '#ffffff', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h3 style={{ fontSize: '14px', margin: '0 0 5px 0', color: 'var(--ink)' }}>Withdraw Wallet Funds</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input 
              type="number" 
              value={amountInput} 
              onChange={(e) => setAmountInput(e.target.value)} 
              placeholder="Enter amount to withdraw"
              style={{ flex: 1, minHeight: '38px', padding: '8px', borderRadius: '6px' }}
              min="1"
              required 
            />
            <button type="submit" style={{ background: 'var(--blue)', minHeight: '38px' }}>Preview</button>
          </div>
          {errorMsg && <small style={{ color: 'var(--blue)' }}>{errorMsg}</small>}
        </form>
      )}

      {/* Premium Confirm Modal/Overlay */}
      {confirmData && (
        <div style={{ marginTop: '15px', padding: '15px', border: '2px solid var(--line)', borderRadius: '10px', background: '#f7fee7', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h4 style={{ margin: 0, fontSize: '15px', color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '6px' }}>
            {confirmData.type === 'add' ? 'Confirm Account Top Up' : 'Confirm Cash Withdrawal'}
          </h4>
          
          {confirmData.type === 'add' ? (
            <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyBetween: 'space-between' }}>
                <span>Top Up Amount:</span>
                <strong>{money(confirmData.amount)}</strong>
              </div>
              {confirmData.totalDebt > 0 && (
                <>
                  <div style={{ display: 'flex', justifyBetween: 'space-between', color: 'var(--muted)' }}>
                    <span>Pending Due Amount:</span>
                    <span>{money(confirmData.currentDue)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyBetween: 'space-between', color: 'var(--muted)' }}>
                    <span>Overdue Fines (₹5/day):</span>
                    <span>{money(confirmData.fine)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyBetween: 'space-between', fontWeight: '600', color: 'var(--blue)' }}>
                    <span>Total Debt to Deduct:</span>
                    <span>-{money(confirmData.totalDebt)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyBetween: 'space-between', borderTop: '1px dashed var(--line)', paddingTop: '4px', fontWeight: 'bold' }}>
                    <span>Paid to Debt:</span>
                    <span style={{ color: 'var(--blue)' }}>{money(confirmData.toDebtPaid)}</span>
                  </div>
                </>
              )}
              <div style={{ display: 'flex', justifyBetween: 'space-between', borderTop: '1px dashed var(--line)', paddingTop: '4px', fontWeight: '800' }}>
                <span>Added to Wallet Balance:</span>
                <span style={{ color: 'var(--green)' }}>{money(confirmData.toWalletBalance)}</span>
              </div>
              {confirmData.remainingDebt > 0 && (
                <div style={{ color: 'var(--blue)', fontSize: '11px', marginTop: '4px' }}>
                  * A remaining due of {money(confirmData.remainingDebt)} remains on your account.
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: '13px' }}>
              <p>Are you sure you want to withdraw <strong>{money(confirmData.amount)}</strong> from your wallet?</p>
              <div style={{ display: 'flex', justifyBetween: 'space-between', marginTop: '8px', fontWeight: '700' }}>
                <span>Current Balance:</span>
                <span>{money(balance)}</span>
              </div>
              <div style={{ display: 'flex', justifyBetween: 'space-between', color: 'var(--blue)', fontWeight: '700' }}>
                <span>New Balance:</span>
                <span>{money(balance - confirmData.amount)}</span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '5px' }}>
            <button 
              onClick={handleConfirm} 
              disabled={isSubmitting}
              style={{ flex: 1, background: confirmData.type === 'add' ? 'var(--green)' : 'var(--blue)', minHeight: '34px', fontSize: '13px', fontWeight: '700', opacity: isSubmitting ? 0.7 : 1 }}
            >
              {isSubmitting ? 'Processing...' : 'Confirm'}
            </button>
            <button 
              onClick={() => setConfirmData(null)} 
              disabled={isSubmitting}
              style={{ flex: 1, background: 'var(--ink)', minHeight: '34px', fontSize: '13px', fontWeight: '700', opacity: isSubmitting ? 0.5 : 1 }}
            >
              Cancel
            </button>
          </div>
          {errorMsg && <small style={{ color: 'var(--blue)' }}>{errorMsg}</small>}
        </div>
      )}
    </div>
  );
}
