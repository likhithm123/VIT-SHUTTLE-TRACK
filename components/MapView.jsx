import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { divIcon } from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { ROUTE_LABELS, routeColor } from '../lib/demoData';

function Recenter({ pos, zoom = 16 }) {
  const map = useMap();
  useEffect(() => { if (pos) map.setView(pos, zoom, { animate: true }); }, [pos, zoom, map]);
  return null;
}

function icon(className, html) {
  return divIcon({ className: `pin ${className}`, html, iconSize: [26, 26], iconAnchor: [13, 23] });
}

export default function MapView({ shuttles = [], followSelf = true, onSelect }) {
  const [self, setSelf] = useState([12.9716, 79.1581]);
  const [focus, setFocus] = useState(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => setSelf([p.coords.latitude, p.coords.longitude]),
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 7000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  const running = useMemo(
    () => shuttles.filter((s) => s?.status === 'running' && Number(s.lat) && Number(s.lng)),
    [shuttles]
  );

  function pick(s) {
    setFocus([Number(s.lat), Number(s.lng)]);
    onSelect?.(s);
  }

  return (
    <div className="map-frame">
      <aside className="map-rail">
        <b>Running</b>
        {running.length ? running.map((s) => (
          <button key={s.id} onClick={() => pick(s)}>
            <i style={{ background: routeColor(s.route) }} />
            <span>{s.vehicleNo}</span>
            <small>{ROUTE_LABELS[s.route] || `Route ${s.route}`}</small>
          </button>
        )) : <div className="null-state">null</div>}
      </aside>
      <MapContainer center={self} zoom={16} zoomControl={false} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {followSelf && !focus && <Recenter pos={self} />}
        {focus && <Recenter pos={focus} zoom={17} />}
        <Marker position={self} icon={icon('self', '')}><Popup>Your mobile GPS</Popup></Marker>
        {running.map((s) => (
          <Marker key={s.id} position={[Number(s.lat), Number(s.lng)]} icon={icon(`bus route-${s.route}`, 'BUS')} eventHandlers={{ click: () => pick(s) }}>
            <Popup><strong>{s.vehicleNo}</strong><br />{ROUTE_LABELS[s.route]}<br />{s.status}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
