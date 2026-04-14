'use client';
import { useEffect, useRef } from 'react';

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
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#94a3b8',
  arrived: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444',
};

export function LiveMap({ drivers, stops, center = [42.3314, -83.0458], zoom = 11 }: Props) {
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) return;

    // Dynamically import leaflet (client-only)
    import('leaflet').then((L) => {
      if (mapRef.current) return; // already initialized

      // Fix default icon paths for Next.js
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
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update markers when data changes
  useEffect(() => {
    if (!mapRef.current) return;
    import('leaflet').then((L) => {
      // Clear existing markers
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      // Driver markers (blue truck icon)
      drivers.forEach((driver) => {
        if (!driver.lat || !driver.lng) return;
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:#0F4C81;color:white;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)">${driver.name[0]}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        const marker = L.marker([driver.lat, driver.lng], { icon })
          .addTo(mapRef.current)
          .bindPopup(`<strong>${driver.name}</strong><br>Status: ${driver.status}`);
        markersRef.current.push(marker);
      });

      // Stop markers (colored dots)
      stops.forEach((stop) => {
        if (!stop.lat || !stop.lng) return;
        const color = STATUS_COLORS[stop.status] ?? '#94a3b8';
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:${color};color:white;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.25)">${stop.sequenceNumber !== null ? stop.sequenceNumber + 1 : '•'}</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const marker = L.marker([stop.lat, stop.lng], { icon })
          .addTo(mapRef.current)
          .bindPopup(`<strong>${stop.recipientName}</strong><br>${stop.address}<br>Status: ${stop.status}`);
        markersRef.current.push(marker);
      });

      // Fit bounds if we have markers
      const allPoints = [
        ...drivers.filter((d) => d.lat && d.lng).map((d) => [d.lat, d.lng] as [number, number]),
        ...stops.filter((s) => s.lat && s.lng).map((s) => [s.lat, s.lng] as [number, number]),
      ];
      if (allPoints.length > 1) {
        mapRef.current.fitBounds(allPoints, { padding: [40, 40] });
      }
    });
  }, [drivers, stops]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
    </>
  );
}
