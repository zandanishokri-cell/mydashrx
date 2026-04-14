interface GeoResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

export async function geocode(address: string): Promise<GeoResult | null> {
  const params = new URLSearchParams({
    address,
    key: process.env.GOOGLE_MAPS_API_KEY!,
  });
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?${params}`,
  );
  const data = (await res.json()) as {
    status: string;
    results: Array<{
      geometry: { location: { lat: number; lng: number } };
      formatted_address: string;
    }>;
  };
  if (data.status !== 'OK' || !data.results[0]) return null;
  const loc = data.results[0].geometry.location;
  return {
    lat: loc.lat,
    lng: loc.lng,
    formattedAddress: data.results[0].formatted_address,
  };
}
