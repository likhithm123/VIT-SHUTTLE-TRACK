import React from 'react';

export const StudentWallet = ({ balance, transactions }) => (
  <div className="side-stack">
    <div className="wallet panel">
      <div>
        <span>Current Balance</span>
        <b>₹{balance}</b>
      </div>
      <button className="primary">Add Funds</button>
      <button className="danger">Withdraw</button>
    </div>

    <div className="panel">
      <div className="section-head">
        <h2>Transaction History</h2>
      </div>
      <div className="txn-history">
        {transactions.map((txn) => (
          <div key={txn.id} className={`txn-row ${txn.type}`}>
            <div>
              <b>{txn.description}</b>
              <br />
              <small className="muted">{txn.date}</small>
            </div>
            <span className="txn-amount">
              {txn.type === 'add' ? '+' : '-'}₹{txn.amount}
            </span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export const StudentRideHistory = ({ rides }) => (
  <div className="panel">
    <div className="section-head">
      <h2>Ride History</h2>
      <span className="live-dot">Active</span>
    </div>
    <div className="history rich">
      {rides.map((ride) => (
        <div key={ride.id}>
          <span>
            <strong>{ride.pickup}</strong> to <strong>{ride.dropoff}</strong>
          </span>
          <b>₹{ride.fare}</b>
          <em className={ride.status === 'Completed' ? 'completed' : ''}>
            {ride.status} • {ride.date}
          </em>
        </div>
      ))}
    </div>
  </div>
);

/* 
   Usage inside Student Login:
   <StudentWallet balance={user.balance} transactions={user.txns} />
   <StudentRideHistory rides={user.rides} />
*/