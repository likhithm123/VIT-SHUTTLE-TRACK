import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { divIcon } from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { ROUTE_LABELS, routeColor, runningShuttles } from '../lib/demoData';

function Recenter({ pos, zoom = 16 }) {
  const map = useMap();
  useEffect(() => { if (pos) map.setView(pos, zoom, { animate: true }); }, [pos, zoom, map]);
  return null;
}

function getSelfIcon() {
  return divIcon({ 
    className: 'pin self-marker', 
    html: `<div style="width: 14px; height: 14px; background: #1e90ff; border: 2.5px solid #ffffff; border-radius: 999px; box-shadow: 0 0 8px #1e90ff;"></div>`, 
    iconSize: [14, 14], 
    iconAnchor: [7, 7] 
  });
}

function getBusIcon(s) {
  const heading = s.heading || 0;
  const color = routeColor(s.route) || '#32cd32';
  // SVG arrow pointing up (N), rotated by s.heading
  const svg = `
    <div style="transform: rotate(${heading}deg); width: 30px; height: 30px; display: grid; place-items: center; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.25)); transition: transform 0.5s ease-out;">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z" fill="${color}" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round" />
      </svg>
    </div>
  `;
  return divIcon({ 
    className: `bus-arrow-icon route-${s.route}`, 
    html: svg, 
    iconSize: [30, 30], 
    iconAnchor: [15, 15] 
  });
}

export default function MapView({ shuttles = [], followSelf = true, onSelect }) {
  const [self, setSelf] = useState([12.9716, 79.1581]);
  const [focus, setFocus] = useState(null);
  const [lastSync, setLastSync] = useState('');

  // Track shuttle updates
  useEffect(() => {
    if (shuttles && shuttles.length >= 0) {
      setLastSync(new Date().toLocaleTimeString());
    }
  }, [shuttles]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => setSelf([p.coords.latitude, p.coords.longitude]),
      () => {},
      { enableHighAccuracy: true, maximumAge: 500, timeout: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  const running = useMemo(() => runningShuttles(shuttles), [shuttles]);

  function pick(s) {
    setFocus([Number(s.lat), Number(s.lng)]);
    onSelect?.(s);
  }

  return (
    <div className="map-frame">
      <aside className="map-rail">
        <b style={{ color: 'var(--ink)' }}>Active Shuttles</b>
        {lastSync && <small style={{ display: 'block', color: '#0284c7', fontSize: '10px', marginTop: '2px' }}>🔄 {lastSync}</small>}
        {running.length ? running.map((s) => (
          <button key={s.id} onClick={() => pick(s)} style={{ borderLeft: `4px solid ${routeColor(s.route)}` }}>
            <span style={{ color: 'var(--ink)' }}>{s.vehicleNo}</span>
            <small style={{ color: 'var(--muted)' }}>{ROUTE_LABELS[s.route] || `Route ${s.route}`}</small>
          </button>
        )) : <div className="null-state">No live shuttles</div>}
      </aside>
      <MapContainer center={self} zoom={16} zoomControl={false} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {followSelf && !focus && <Recenter pos={self} />}
        {focus && <Recenter pos={focus} zoom={17} />}
        <Marker position={self} icon={getSelfIcon()}><Popup>Your current location</Popup></Marker>
        {running.map((s) => (
          <Marker key={s.id} position={[Number(s.lat), Number(s.lng)]} icon={getBusIcon(s)} eventHandlers={{ click: () => pick(s) }}>
            <Popup>
              <strong>{s.vehicleNo}</strong><br />
              Route: {ROUTE_LABELS[s.route]}<br />
              Status: {s.status}<br />
              Heading: {Math.round(s.heading || 0)}°
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
