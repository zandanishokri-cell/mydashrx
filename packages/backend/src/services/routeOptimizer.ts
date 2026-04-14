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

export async function optimizeRoute(
  originLat: number,
  originLng: number,
  stops: StopPoint[],
): Promise<OptimizedRoute> {
  if (stops.length === 0) {
    return { stopIds: [], totalDistance: 0, totalDuration: 0, legs: [] };
  }

  // Single stop — no optimization needed
  if (stops.length === 1) {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/directions/json?` +
        new URLSearchParams({
          origin: `${originLat},${originLng}`,
          destination: `${stops[0].lat},${stops[0].lng}`,
          key: process.env.GOOGLE_MAPS_API_KEY!,
          departure_time: 'now',
        }),
    );
    const data = (await res.json()) as any;
    if (data.status !== 'OK') throw new Error(`Google Maps error: ${data.status}`);
    if (!data.routes?.[0]?.legs?.[0]) throw new Error('Google Maps returned no route');
    const leg = data.routes[0].legs[0];
    return {
      stopIds: [stops[0].id],
      totalDistance: leg.distance.value / 1000,
      totalDuration: Math.ceil((leg.duration_in_traffic?.value ?? leg.duration.value) / 60),
      legs: [{ distanceKm: leg.distance.value / 1000, durationMin: Math.ceil((leg.duration_in_traffic?.value ?? leg.duration.value) / 60) }],
    };
  }

  // Multiple stops — use waypoint optimization
  const intermediate = stops.slice(0, -1);
  const destination = stops[stops.length - 1];

  const waypointsParam = intermediate.length > 0
    ? `optimize:true|${intermediate.map((s) => `${s.lat},${s.lng}`).join('|')}`
    : undefined;

  const params: Record<string, string> = {
    origin: `${originLat},${originLng}`,
    destination: `${destination.lat},${destination.lng}`,
    key: process.env.GOOGLE_MAPS_API_KEY!,
    departure_time: 'now',
  };
  if (waypointsParam) params.waypoints = waypointsParam;

  const res = await fetch(
    `https://maps.googleapis.com/maps/api/directions/json?` + new URLSearchParams(params),
  );
  const data = (await res.json()) as any;
  if (data.status !== 'OK') throw new Error(`Google Maps error: ${data.status}`);
  if (!data.routes?.[0]) throw new Error('Google Maps returned no route');

  const route = data.routes[0];
  const waypointOrder: number[] = route.waypoint_order ?? [];

  // Reconstruct ordered stop list from Google's optimized waypoint indices
  const orderedIntermediate = waypointOrder.map((i: number) => intermediate[i]);
  const orderedStops = [...orderedIntermediate, destination];

  const legs: Array<{ distanceKm: number; durationMin: number }> = route.legs.map((leg: any) => ({
    distanceKm: leg.distance.value / 1000,
    durationMin: Math.ceil((leg.duration_in_traffic?.value ?? leg.duration.value) / 60),
  }));

  return {
    stopIds: orderedStops.map((s) => s.id),
    totalDistance: legs.reduce((sum, l) => sum + l.distanceKm, 0),
    totalDuration: legs.reduce((sum, l) => sum + l.durationMin, 0),
    legs,
  };
}
