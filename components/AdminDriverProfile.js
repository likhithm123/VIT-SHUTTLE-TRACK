import React from 'react';

const AdminDriverProfile = ({ driver }) => {
  if (!driver) return <div className="null-state">Search for a driver to see statistics</div>;

  return (
    <div className="driver-search-result">
      <div className="driver-meta">
        <div>
          <h1>{driver.name}</h1>
          <p className="muted">Contact: {driver.phone} | Status: Online</p>
        </div>
        {/* Vehicle No mapped to the driver */}
        <div className="v-tag">{driver.vehicleNo}</div>
      </div>

      <div className="earnings-grid">
        <div className="earn-card">
          <label>Today's Earnings</label>
          <span>₹{driver.earningsToday}</span>
        </div>
        <div className="earn-card">
          <label>Monthly Earnings</label>
          <span>₹{driver.earningsMonth}</span>
        </div>
        <div className="earn-card">
          <label>Total Completed Rides</label>
          <span>{driver.totalRides}</span>
        </div>
        <div className="earn-card">
          <label>Rating</label>
          <span>{driver.rating} ★</span>
        </div>
      </div>
    </div>
  );
};

export default AdminDriverProfile;