import config from "../config/index.js";

const BASE_URL = "https://api.mapbox.com";
const TOKEN = config.mapbox.token;

if (!TOKEN) {
  throw new Error("Missing Mapbox token. Set MAPBOX_ACCESS_TOKEN in the environment.");
}

function toMiles(meters) {
  return Number(meters) / 1609.344;
}

async function mapboxFetch(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("access_token", TOKEN);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Mapbox request failed (${response.status}): ${body}`);
  }

  return response.json();
}

export async function geocodeAddress(address, { proximity } = {}) {
  if (!address || !String(address).trim()) return null;

  const params = {
    limit: 1,
    autocomplete: false,
    country: "us",
  };

  if (Array.isArray(proximity) && proximity.length === 2) {
    params.proximity = proximity.join(",");
  }

  const data = await mapboxFetch(`/geocoding/v5/mapbox.places/${encodeURIComponent(
    address,
  )}.json`, params);

  const feature = data?.features?.[0];
  if (!feature || !Array.isArray(feature.center) || feature.center.length < 2) return null;

  return {
    lon: Number(feature.center[0]),
    lat: Number(feature.center[1]),
    placeName: feature.place_name,
  };
}

export async function reverseGeocode(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const data = await mapboxFetch(`/geocoding/v5/mapbox.places/${lon},${lat}.json`, {
    limit: 1,
  });

  const feature = data?.features?.[0];
  if (!feature) return null;

  return {
    placeName: feature.place_name,
    context: feature.context,
  };
}

export async function getDrivingDistanceMiles({
  pickup,
  dropoff,
  profile = "driving",
}) {
  if (!pickup || !dropoff) return null;

  const coords = `${pickup.lon},${pickup.lat};${dropoff.lon},${dropoff.lat}`;
  const data = await mapboxFetch(`/directions/v5/mapbox.${profile}/${coords}`, {
    overview: "false",
    geometries: "geojson",
  });

  const meters = data?.routes?.[0]?.distance;
  return Number.isFinite(meters) ? toMiles(meters) : null;
}
