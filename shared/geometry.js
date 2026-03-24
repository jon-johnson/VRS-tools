// VRS Sailing Tools — Shared Geometry Utilities
// Class-agnostic. Used by race report, tactical tool, and wind inference.

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

/** Haversine distance in metres between two lat/lon points */
export function hav(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*D2R) * Math.cos(lat2*D2R) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/** True bearing in degrees from point 1 to point 2 */
export function brg(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * D2R;
  const y = Math.sin(dLon) * Math.cos(lat2 * D2R);
  const x = Math.cos(lat1*D2R)*Math.sin(lat2*D2R) -
            Math.sin(lat1*D2R)*Math.cos(lat2*D2R)*Math.cos(dLon);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Absolute angular difference between two bearings (0–180) */
export function angDiff(a, b) {
  return Math.min(((a - b + 360) % 360), ((b - a + 360) % 360));
}

/** Cardinal direction label from bearing */
export function card(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

/**
 * Signed distance (metres) from point P to line defined by A→B.
 * Positive = left of line (A→B), Negative = right of line.
 */
export function signedDistToLine(pLat, pLon, aLat, aLon, bLat, bLon) {
  const ax = (aLon - pLon) * Math.cos(pLat * D2R) * 111320;
  const ay = (aLat - pLat) * 111320;
  const bx = (bLon - pLon) * Math.cos(pLat * D2R) * 111320;
  const by = (bLat - pLat) * 111320;
  return (bx * ay - by * ax) / Math.hypot(bx - ax, by - ay);
}

/** Unsigned distance (metres) from point to line */
export function distToLine(pLat, pLon, aLat, aLon, bLat, bLon) {
  return Math.abs(signedDistToLine(pLat, pLon, aLat, aLon, bLat, bLon));
}

/**
 * Start line bias — returns degrees of bias and favoured end.
 * Positive = RC end favoured, Negative = PIN end favoured.
 */
export function lineBias(rcLat, rcLon, pinLat, pinLon, windDir) {
  const lineAxis = brg(rcLat, rcLon, pinLat, pinLon);
  const perpToWind = (windDir + 90 + 360) % 360;
  const bias = ((lineAxis - perpToWind + 180 + 360) % 360) - 180;
  return {
    degrees: +bias.toFixed(1),
    favoured: bias > 0 ? 'RC' : bias < 0 ? 'PIN' : 'SQUARE'
  };
}

/**
 * Gate bias — how square a leeward or windward gate is to the wind.
 * Returns degrees off square (0 = perfectly square).
 */
export function gateBias(m1Lat, m1Lon, m2Lat, m2Lon, windDir) {
  const gateAxis = brg(m1Lat, m1Lon, m2Lat, m2Lon);
  const idealAxis = (windDir + 90 + 360) % 360;
  const diff = ((gateAxis - idealAxis + 180 + 360) % 360) - 180;
  return {
    degrees: +diff.toFixed(1),
    favoured: diff > 0 ? 'LEFT' : diff < 0 ? 'RIGHT' : 'SQUARE'
  };
}

/**
 * Upwind VMG for a given TWA and boatspeed (knots).
 */
export function vmgUpwind(twaDeg, speedKts) {
  return speedKts * Math.cos(twaDeg * D2R);
}

/**
 * Downwind VMG for a given TWA and boatspeed (knots).
 */
export function vmgDownwind(twaDeg, speedKts) {
  return speedKts * Math.cos((180 - twaDeg) * D2R);
}

/**
 * Weighted circular mean of an array of { angle, weight } objects.
 * Returns degrees [0, 360).
 */
export function weightedCircMean(items) {
  if (!items || !items.length) return null;
  let sx = 0, sy = 0, sw = 0;
  for (const it of items) {
    const w = it.weight ?? 1;
    sx += Math.cos(it.angle * D2R) * w;
    sy += Math.sin(it.angle * D2R) * w;
    sw += w;
  }
  if (!sw) return null;
  return (Math.atan2(sy / sw, sx / sw) * R2D + 360) % 360;
}

/**
 * Blend two circular angles with weights.
 */
export function circularBlend(a, wa, b, wb) {
  const sx = Math.cos(a * D2R) * wa + Math.cos(b * D2R) * wb;
  const sy = Math.sin(a * D2R) * wa + Math.sin(b * D2R) * wb;
  return (Math.atan2(sy, sx) * R2D + 360) % 360;
}

/**
 * Interpolate boatspeed from a polar table for a given TWA and TWS.
 * polar: { twa: [...], tws: [...], speeds: [[...]] }
 * speeds[i] corresponds to tws[i], speeds[i][j] to twa[j].
 */
export function polarSpeed(polar, twa, tws) {
  if (!polar || !polar.speeds) return null;
  const twas = polar.twa;
  const twss = polar.tws;
  const speeds = polar.speeds;

  // Clamp
  const twaClamped = Math.max(twas[0], Math.min(twas[twas.length-1], twa));
  const twsClamped = Math.max(twss[0], Math.min(twss[twss.length-1], tws));

  // Find surrounding indices
  let ti = twss.findIndex(t => t >= twsClamped);
  if (ti <= 0) ti = 1;
  const t0 = twss[ti-1], t1 = twss[ti];
  const tFrac = (twsClamped - t0) / (t1 - t0);

  let ai = twas.findIndex(a => a >= twaClamped);
  if (ai <= 0) ai = 1;
  const a0 = twas[ai-1], a1 = twas[ai];
  const aFrac = (twaClamped - a0) / (a1 - a0);

  // Bilinear interpolation
  const s00 = speeds[ti-1][ai-1];
  const s01 = speeds[ti-1][ai];
  const s10 = speeds[ti][ai-1];
  const s11 = speeds[ti][ai];

  return s00*(1-tFrac)*(1-aFrac) + s01*(1-tFrac)*aFrac +
         s10*tFrac*(1-aFrac)     + s11*tFrac*aFrac;
}

/**
 * Look up VMG-optimal TWA from precomputed peaks for a given TWS.
 * mode: 'upwind' | 'downwind'
 */
export function vmgOptimalTWA(polar, tws, mode = 'upwind') {
  const peaks = mode === 'upwind' ? polar.vmg_upwind_peaks : polar.vmg_downwind_peaks;
  if (!peaks) return mode === 'upwind' ? 42 : 140; // sensible fallback
  // Find closest TWS entry
  let best = peaks[0];
  for (const p of peaks) {
    if (Math.abs(p.tws - tws) < Math.abs(best.tws - tws)) best = p;
  }
  return best.twa;
}
