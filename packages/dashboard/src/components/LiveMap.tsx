'use client';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';

interface DriverMarker {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: string;
}

interface StopMarker {
  id: string;
  lat: number;
  lng: number;
  recipientName: string;
  address: string;
  status: string;
  sequenceNumber: number | null;
}

interface Props {
  drivers: DriverMarker[];
  stops: StopMarker[];
  center?: [number, number];
  zoom?: number;
  highlightedDriverId?: string | null;
  depotLatLng?: [number, number] | null;
  onMarkerClick?: (driverId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#94a3b8',
  en_route: '#3b82f6',
  arrived: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444',
};

const DRIVER_COLORS: Record<string, string> = {
  on_route: '#0F4C81',
  available: '#10b981',
  offline: '#94a3b8',
};

const driverMarkerHtml = (name: string, status: string, highlighted: boolean) => {
  const bg = DRIVER_COLORS[status] ?? '#0F4C81';
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  const size = highlighted ? 40 : 32;
  const border = highlighted ? '3px solid #fbbf24' : '3px solid white';
  const shadow = highlighted
    ? '0 0 0 3px rgba(251,191,36,0.4),0 3px 10px rgba(0,0,0,0.4)'
    : '0 2px 6px rgba(0,0,0,0.3)';
  return `<div style="background:${bg};color:white;width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${highlighted ? 14 : 12}px;font-weight:700;border:${border};box-shadow:${shadow};cursor:pointer;transition:all .2s">${initials}</div>`;
};

export function LiveMap({
  drivers,
  stops,
  center = [42.3314, -83.0458],
  zoom = 11,
  highlightedDriverId = null,
  depotLatLng = null,
  onMarkerClick,
}: Props) {
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<any[]>([]);
  const hasFitRef = useRef(false);
  const polylineRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false); // signals map init complete

  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) return;

    import('leaflet').then((L) => {
      if (mapRef.current) return;

      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const map = L.map(containerRef.current!).setView(center, zoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      setMapReady(true); // trigger marker effect after map is ready
    });

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markersRef.current = []; // prevent stale refs on remount
      if (polylineRef.current) { polylineRef.current = null; } // map removed, ref cleanup only
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mapRef.current) return;
    import('leaflet').then((L) => {
      // Clear previous polyline
      if (polylineRef.current) { polylineRef.current.remove(); polylineRef.current = null; }
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      drivers.forEach((driver) => {
        if (driver.lat == null || driver.lng == null) return;
        const highlighted = driver.id === highlightedDriverId;
        const icon = L.divIcon({
          className: '',
          html: driverMarkerHtml(driver.name, driver.status, highlighted),
          iconSize: [highlighted ? 40 : 32, highlighted ? 40 : 32],
          iconAnchor: [highlighted ? 20 : 16, highlighted ? 20 : 16],
        });
        const marker = L.marker([driver.lat, driver.lng], { icon, zIndexOffset: highlighted ? 1000 : 0 })
          .addTo(mapRef.current)
          .bindPopup(`<strong>${driver.name}</strong><br>Status: ${driver.status}`);
        if (onMarkerClick) {
          marker.on('click', () => onMarkerClick(driver.id));
        }
        markersRef.current.push(marker);
      });

      stops.forEach((stop) => {
        if (stop.lat == null || stop.lng == null) return;
        const color = STATUS_COLORS[stop.status] ?? '#94a3b8';
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:${color};color:white;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.25)">${stop.sequenceNumber !== null ? stop.sequenceNumber + 1 : '•'}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const stopMarker = L.marker([stop.lat, stop.lng], { icon })
          .addTo(mapRef.current)
          .bindPopup(`<strong>${stop.recipientName}</strong><br>${stop.address}<br>Status: ${stop.status}`);
        markersRef.current.push(stopMarker); // ensure cleanup on next render
      });

      // Draw route polyline connecting stops in sequence order
      if (stops.length > 1) {
        const sortedStops = [...stops].sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0));
        const points: [number, number][] = depotLatLng
          ? [depotLatLng, ...sortedStops.map((s) => [s.lat, s.lng] as [number, number])]
          : sortedStops.map((s) => [s.lat, s.lng] as [number, number]);
        polylineRef.current = L.polyline(points, {
          color: '#0F4C81',
          weight: 2,
          opacity: 0.5,
          dashArray: '6, 6',
        }).addTo(mapRef.current);
      }

      // Initial fit — only once when the first batch of data arrives; subsequent
      // data refreshes must NOT re-fit (would reset zoom/pan on every 15s poll)
      const allPoints = [
        ...drivers.filter((d) => d.lat && d.lng).map((d) => [d.lat, d.lng] as [number, number]),
        ...stops.filter((s) => s.lat && s.lng).map((s) => [s.lat, s.lng] as [number, number]),
      ];
      if (!hasFitRef.current && allPoints.length > 1) {
        mapRef.current.fitBounds(allPoints, { padding: [40, 40] });
        hasFitRef.current = true;
      }
    });
  }, [mapReady, drivers, stops, highlightedDriverId, depotLatLng, onMarkerClick]);

  // When a driver is selected, pan to their route; when deselected, refit all markers
  useEffect(() => {
    if (!mapRef.current) return;
    import('leaflet').then(() => {
      if (!highlightedDriverId) {
        // Deselected — refit to all visible drivers
        const allPoints = drivers
          .filter((d) => d.lat != null && d.lng != null)
          .map((d) => [d.lat, d.lng] as [number, number]);
        if (allPoints.length > 1) {
          hasFitRef.current = false; // allow fitBounds in marker effect on next render
          mapRef.current.fitBounds(allPoints, { padding: [40, 40], animate: true });
        }
        return;
      }
      const stopPoints = stops
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => [s.lat, s.lng] as [number, number]);
      const driver = drivers.find((d) => d.id === highlightedDriverId);
      if (stopPoints.length > 1) {
        mapRef.current.fitBounds(stopPoints, { padding: [40, 40], animate: true });
      } else if (driver?.lat != null && driver?.lng != null) {
        mapRef.current.setView([driver.lat, driver.lng], 14, { animate: true });
      }
    });
  }, [highlightedDriverId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />;
}
