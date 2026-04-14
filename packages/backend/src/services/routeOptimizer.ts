interface StopPoint {
  id: string;
  lat: number;
  lng: number;
}

interface OptimizedRoute {
  stopIds: string[];
  totalDistance: number; // km
  totalDuration: number; // minutes
  legs: Array<{ distanceKm: number; durationMin: number }>;
}

// Haversine distance in km
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Nearest-neighbor greedy TSP fallback (no API key required)
function nearestNeighborOptimize(
  originLat: number,
  originLng: number,
  stops: StopPoint[],
): OptimizedRoute {
  const remaining = [...stops];
  const ordered: StopPoint[] = [];
  let curLat = originLat;
  let curLng = originLng;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversine(curLat, curLng, remaining[i].lat, remaining[i].lng);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    curLat = next.lat;
    curLng = next.lng;
  }

  const legs = ordered.map((stop, i) => {
    const fromLat = i === 0 ? originLat : ordered[i - 1].lat;
    const fromLng = i === 0 ? originLng : ordered[i - 1].lng;
    const distanceKm = haversine(fromLat, fromLng, stop.lat, stop.lng);
    return { distanceKm, durationMin: Math.ceil((distanceKm / 40) * 60) }; // assume 40 km/h avg
  });

  return {
    stopIds: ordered.map((s) => s.id),
    totalDistance: legs.reduce((s, l) => s + l.distanceKm, 0),
    totalDuration: legs.reduce((s, l) => s + l.durationMin, 0),
    legs,
  };
}

export async function optimizeRoute(
  originLat: number,
  originLng: number,
  stops: StopPoint[],
): Promise<OptimizedRoute> {
  if (stops.length === 0) return { stopIds: [], totalDistance: 0, totalDuration: 0, legs: [] };

  // Fallback to nearest-neighbor if no API key
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return nearestNeighborOptimize(originLat, originLng, stops);
  }

  try {
    if (stops.length === 1) {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?` +
          new URLSearchParams({
            origin: `${originLat},${originLng}`,
            destination: `${stops[0].lat},${stops[0].lng}`,
            key: process.env.GOOGLE_MAPS_API_KEY,
            departure_time: 'now',
          }),
      );
      const data = (await res.json()) as any;
      if (data.status !== 'OK') throw new Error(`Maps error: ${data.status}`);
      if (!data.routes?.[0]?.legs?.[0]) throw new Error('No route returned');
      const leg = data.routes[0].legs[0];
      const distKm = leg.distance.value / 1000;
      const durMin = Math.ceil((leg.duration_in_traffic?.value ?? leg.duration.value) / 60);
      return { stopIds: [stops[0].id], totalDistance: distKm, totalDuration: durMin, legs: [{ distanceKm: distKm, durationMin: durMin }] };
    }

    const intermediate = stops.slice(0, -1);
    const destination = stops[stops.length - 1];
    const params: Record<string, string> = {
      origin: `${originLat},${originLng}`,
      destination: `${destination.lat},${destination.lng}`,
      key: process.env.GOOGLE_MAPS_API_KEY,
      departure_time: 'now',
    };
    if (intermediate.length > 0) {
      params.waypoints = `optimize:true|${intermediate.map((s) => `${s.lat},${s.lng}`).join('|')}`;
    }

    const res = await fetch(`https://maps.googleapis.com/maps/api/directions/json?` + new URLSearchParams(params));
    const data = (await res.json()) as any;
    if (data.status !== 'OK') throw new Error(`Maps error: ${data.status}`);
    if (!data.routes?.[0]) throw new Error('No route returned');

    const route = data.routes[0];
    const waypointOrder: number[] = route.waypoint_order ?? [];
    const orderedIntermediate = waypointOrder.map((i: number) => intermediate[i]);
    const orderedStops = [...orderedIntermediate, destination];
    const legs = route.legs.map((leg: any) => ({
      distanceKm: leg.distance.value / 1000,
      durationMin: Math.ceil((leg.duration_in_traffic?.value ?? leg.duration.value) / 60),
    }));

    return {
      stopIds: orderedStops.map((s) => s.id),
      totalDistance: legs.reduce((sum: number, l: any) => sum + l.distanceKm, 0),
      totalDuration: legs.reduce((sum: number, l: any) => sum + l.durationMin, 0),
      legs,
    };
  } catch {
    // Google Maps failed — fall back to nearest-neighbor
    return nearestNeighborOptimize(originLat, originLng, stops);
  }
}
