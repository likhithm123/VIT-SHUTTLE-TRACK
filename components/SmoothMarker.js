import { useEffect, useRef } from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

const SmoothDriverMarker = ({ position, icon, driverName, vehicleNo }) => {
  const markerRef = useRef(null);

  useEffect(() => {
    if (markerRef.current && position) {
      // Imperative update: Updates coordinates without a React re-render cycle
      // This provides buttery smooth movement on the map
      markerRef.current.setLatLng([position.lat, position.lng]);
    }
  }, [position]);

  return (
    <Marker ref={markerRef} position={[position.lat, position.lng]} icon={icon}>
      <Popup>
        <strong>{driverName}</strong> <br />
        <small>{vehicleNo}</small>
      </Popup>
    </Marker>
  );
};

export default SmoothDriverMarker;