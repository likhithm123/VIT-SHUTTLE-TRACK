import { useEffect, useState } from 'react';
import { FARE, FINE_PER_DAY, GRACE_DAYS, getFine, loadState, money, saveState } from '../lib/demoData';

export default function WalletCard({ user, onRefresh }){
  const [balance, setBalance] = useState(0);
  const [due, setDue] = useState(null);

  useEffect(()=>{
    if (!user) return;
    refresh();
  }, [user]);

  function refresh() {
    const state = loadState();
    setBalance(Number(state.wallets?.[user.id] || 0));
    setDue(state.dues?.[user.id] || null);
    onRefresh?.();
  }

  function topUp() {
    const amount = Number(prompt('Add amount to wallet', '100'));
    if (!amount || amount < 1) return;
    const state = loadState();
    const currentDue = state.dues[user.id];
    const totalDue = currentDue ? currentDue.amount + getFine(currentDue.since) : 0;
    const remaining = Math.max(0, totalDue - amount);
    const walletCredit = Math.max(0, amount - totalDue);
    state.wallets[user.id] = Number(state.wallets[user.id] || 0) + walletCredit;
    if (remaining) state.dues[user.id] = { ...currentDue, amount: remaining };
    else delete state.dues[user.id];
    saveState(state);
    refresh();
  }

  return (
    <div className="wallet">
      <div><span>Balance</span><strong>{money(balance)}</strong></div>
      <div><span>Fare</span><strong>{money(FARE)}</strong></div>
      <div><span>Due</span><strong>{money((due?.amount || 0) + getFine(due?.since))}</strong></div>
      <button onClick={topUp}>Add money</button>
      {due && <small>{GRACE_DAYS} days no fine, then {money(FINE_PER_DAY)}/day.</small>}
    </div>
  );
}
