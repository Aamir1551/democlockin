// Ray-casting point-in-polygon
export function pip(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if (((yi > lat) !== (yj > lat)) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

// Haversine distance in metres
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distToPolyVerts(lat, lon, poly) {
  return Math.min(...poly.map(([v1, v2]) => haversine(lat, lon, v1, v2)));
}

// Returns { inside: boolean, distance: number (metres outside, 0 if inside) }
export function checkSite(lat, lon, site) {
  if (site.use_polygon && site.polygons) {
    const polys = site.polygons;
    const inside = polys.some(poly => pip(lat, lon, poly));
    if (inside) return { inside: true, distance: 0 };
    const dist = Math.min(...polys.map(poly => distToPolyVerts(lat, lon, poly)));
    return { inside: false, distance: Math.round(dist) };
  }
  const dist = haversine(lat, lon, site.lat, site.lon);
  return {
    inside: dist <= site.geofence_radius_m,
    distance: Math.max(0, Math.round(dist - site.geofence_radius_m)),
  };
}
