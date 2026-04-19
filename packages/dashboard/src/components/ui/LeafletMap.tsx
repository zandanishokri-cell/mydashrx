'use client';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix broken default marker icons in Next.js (webpack can't resolve the image paths)
const PIN = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// Status → color for numbered DivIcons
const statusColors: Record<string, string> = {
  completed: '#10b981',
  failed: '#ef4444',
  arrived: '#f59e0b',
  en_route: '#3b82f6',
  rescheduled: '#f97316',
  pending: '#6b7280',
};

function numberedIcon(num: number, status: string) {
  const bg = statusColors[status] ?? '#0F4C81';
  return L.divIcon({
    className: '',
    html: `<div style="background:${bg};color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3)">${num}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
}

// Auto-fits map bounds to all stop positions when stops change
function BoundsFitter({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  if (positions.length > 1) {
    map.fitBounds(L.latLngBounds(positions), { padding: [32, 32], maxZoom: 15 });
  }
  return null;
}

export interface MapStop {
  id: string;
  lat: number;
  lng: number;
  address: string;
  recipientName?: string;
  status?: string;
  sequenceNumber?: number | null;
}

// Single-stop mode props (backwards compatible)
interface LeafletMapSingleProps { lat: number; lng: number; address: string; stops?: undefined; }
// Multi-stop mode props
interface LeafletMapMultiProps { stops: MapStop[]; lat?: number; lng?: number; address?: string; }

type LeafletMapProps = LeafletMapSingleProps | LeafletMapMultiProps;

export default function LeafletMap(props: LeafletMapProps) {
  // Multi-stop mode
  if (props.stops && props.stops.length > 0) {
    const sorted = [...props.stops].sort((a, b) => (a.sequenceNumber ?? 999) - (b.sequenceNumber ?? 999));
    const positions: [number, number][] = sorted.map(s => [s.lat, s.lng]);
    const center: [number, number] = positions.length === 1
      ? positions[0]
      : [
          positions.reduce((s, p) => s + p[0], 0) / positions.length,
          positions.reduce((s, p) => s + p[1], 0) / positions.length,
        ];

    return (
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
        attributionControl={false}
        zoomControl={false}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {positions.length > 1 && (
          <Polyline positions={positions} pathOptions={{ color: '#0F4C81', weight: 2, opacity: 0.7, dashArray: '6 4' }} />
        )}
        {sorted.map((stop, idx) => (
          <Marker
            key={stop.id}
            position={[stop.lat, stop.lng]}
            icon={numberedIcon(stop.sequenceNumber != null ? stop.sequenceNumber + 1 : idx + 1, stop.status ?? 'pending')}
          >
            <Popup className="text-xs">
              <strong>Stop {stop.sequenceNumber != null ? stop.sequenceNumber + 1 : idx + 1}</strong>
              {stop.recipientName && <span> · {stop.recipientName}</span>}
              <br />{stop.address}
              {stop.status && <><br /><span style={{ textTransform: 'capitalize' }}>{stop.status.replace(/_/g, ' ')}</span></>}
            </Popup>
          </Marker>
        ))}
        {positions.length > 1 && <BoundsFitter positions={positions} />}
      </MapContainer>
    );
  }

  // Single-stop mode (backwards compatible)
  const { lat, lng, address } = props as LeafletMapSingleProps;
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={15}
      style={{ height: '100%', width: '100%' }}
      scrollWheelZoom={false}
      attributionControl={false}
      zoomControl={false}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Marker position={[lat, lng]} icon={PIN}>
        <Popup className="text-xs">{address}</Popup>
      </Marker>
    </MapContainer>
  );
}
