// VRS Sailing Tools — Wind Inference Engine
// Polar-aware, class-agnostic. Works for upwind-first W/L courses.
//
// Key difference from M32: boats go upwind immediately after the gun,
// so port/stbd tack clusters are cleanly separable from gun+120s onwards.
// The tack angle used to separate clusters comes from the class polar.

import { D2R, R2D, angDiff, weightedCircMean, circularBlend } from './geometry.js';

/**
 * Infer wind direction from fleet telemetry tracks.
 *
 * @param {Object} tracks       - { sailNum: [{ts, lat, lon, sog, cog}] }
 * @param {Object} polar        - Class polar object (from polars/*.json)
 * @param {Object} courseMarks  - { ww: {lat,lon}, lw: {lat,lon} } (can be null)
 * @param {number} gunTs        - Race gun timestamp (ms)
 * @param {number} [raceEndTs]  - Optional race end timestamp (ms)
 * @returns {Object} Inference result
 */
export function inferWind(tracks, polar, courseMarks, gunTs, raceEndTs) {
  const _gun = gunTs ?? 0;

  // Time window: skip first 2 min (start confusion), cap at 12 min
  const windowStart = _gun + 120_000;
  const windowEnd   = raceEndTs
    ? Math.min(_gun + 720_000, raceEndTs)
    : _gun + 720_000;

  // Course axis from marks (if available) — used as hemisphere classifier
  let upwindAxis = null;
  if (courseMarks?.ww && courseMarks?.lw) {
    const { ww, lw } = courseMarks;
    upwindAxis = bearingDeg(lw.lat, lw.lon, ww.lat, ww.lon);
  }

  // Tack angle from polar (degrees either side of wind = upwind TWA)
  const tackAngle = polar?.wind_inference?.typical_tack_angle ?? 42;

  // Collect stable heading samples per boat
  const uwPort = [], uwStbd = [], dwPort = [], dwStbd = [];

  for (const [, track] of Object.entries(tracks)) {
    if (!track || track.length < 20) continue;

    const seg = track.filter(p => p.ts >= windowStart && p.ts <= windowEnd);
    if (seg.length < 10) continue;

    for (let i = 3; i < seg.length - 3; i++) {
      const p = seg[i];
      const sog = (p.sog ?? 0) * 0.539957; // m/s → kts
      if (sog < 2.5) continue; // ignore drifting

      // Stability check: heading consistency over ±3 samples
      const hdgs = [seg[i-3], seg[i-2], seg[i-1], p, seg[i+1], seg[i+2], seg[i+3]]
        .map(s => s.cog ?? s.hdg ?? 0);
      const spread = circularSpread(hdgs);
      if (spread > 18) continue; // tacking/gybing — skip

      const cog = p.cog ?? p.hdg ?? 0;
      const weight = Math.min(3, sog / 5);

      // Classify as upwind or downwind using course axis (if known)
      // Without course axis, classify by speed vs polar — fast = reaching/running
      let leg = classifyLeg(cog, upwindAxis);

      if (leg === 'upwind') {
        // Split by tack: which hemisphere relative to course axis (or N/S if unknown)
        const ref = upwindAxis ?? 0;
        const rel = ((cog - ref + 360) % 360);
        if (rel < 180) uwStbd.push({ angle: cog, weight }); // starboard tack
        else            uwPort.push({ angle: cog, weight }); // port tack
      } else if (leg === 'downwind') {
        const ref = upwindAxis ?? 0;
        const rel = ((cog - ref + 360) % 360);
        if (rel < 180) dwPort.push({ angle: cog, weight });
        else            dwStbd.push({ angle: cog, weight });
      }
    }
  }

  // ── Compute wind from upwind tack means ────────────────────────────────
  let wfUp = null, wfDw = null;

  if (uwPort.length >= 3 && uwStbd.length >= 3) {
    const mp = weightedCircMean(uwPort);
    const ms = weightedCircMean(uwStbd);
    if (mp != null && ms != null) {
      // Wind bisects the two tack headings
      wfUp = circularBlend(mp, uwPort.length, ms, uwStbd.length);
      // Adjust: the bisector of tack headings points INTO the wind
      // so wfUp is already the wind direction (from)
    }
  }

  if (dwPort.length >= 3 && dwStbd.length >= 3) {
    const mp = weightedCircMean(dwPort);
    const ms = weightedCircMean(dwStbd);
    if (mp != null && ms != null) {
      wfDw = (circularBlend(mp, dwPort.length, ms, dwStbd.length) + 180) % 360;
    }
  }

  // ── Blend upwind and downwind estimates ────────────────────────────────
  let wf = wfUp ?? wfDw ?? upwindAxis;
  if (wfUp != null && wfDw != null) {
    const agreement = angDiff(wfUp, wfDw);
    // Weight upwind more — cleaner signal on W/L
    const wUp = Math.max(1, uwPort.length + uwStbd.length) * 1.3;
    const wDw = Math.max(1, dwPort.length + dwStbd.length) * 0.5
              * Math.max(0.3, 1 - agreement / 45);
    wf = circularBlend(wfUp, wUp, wfDw, wDw);
  }

  // ── Confidence ─────────────────────────────────────────────────────────
  const stableN = uwPort.length + uwStbd.length + dwPort.length + dwStbd.length;
  let confidence = Math.min(0.97,
    0.15
    + Math.min(0.40, stableN / 120)
    + (wfUp != null ? 0.22 : 0)
    + (wfDw != null ? 0.06 : 0)
  );

  const agreement = (wfUp != null && wfDw != null) ? angDiff(wfUp, wfDw) : null;
  if (agreement != null) confidence *= Math.max(0.5, 1 - agreement / 50);

  const fallback = wfUp == null && wfDw == null;
  if (fallback) confidence = 0.10;

  return {
    wf: wf != null ? +wf.toFixed(1) : null,
    wfUp: wfUp != null ? +wfUp.toFixed(1) : null,
    wfDw: wfDw != null ? +wfDw.toFixed(1) : null,
    agreement: agreement != null ? +agreement.toFixed(1) : null,
    confidence: +confidence.toFixed(2),
    stableN,
    portN: uwPort.length,
    stbdN: uwStbd.length,
    dwPortN: dwPort.length,
    dwStbdN: dwStbd.length,
    upwindAxis,
    tackAngle,
    fallback,
    method: 'vrs-stable-segment-tack-bisect'
  };
}

/**
 * Compute day-level wind consensus by blending multiple race inferences.
 * @param {Array} raceInferences - Array of inferWind() results
 */
export function inferDayWind(raceInferences) {
  const valid = raceInferences.filter(r => r && r.wf != null && !r.fallback);
  if (!valid.length) return null;

  const weighted = valid.map(r => ({
    angle: r.wf,
    weight: Math.max(0.1, r.confidence) * Math.max(1, r.stableN / 10)
  }));

  const wf = weightedCircMean(weighted);
  const spreads = valid.map(r => angDiff(r.wf, wf)).sort((a, b) => a - b);
  const spread = spreads[Math.floor(spreads.length / 2)] ?? null;

  const confidence = Math.min(0.95,
    0.25 + valid.length * 0.12 + Math.max(0, 0.30 - (spread ?? 0) / 40)
  );

  return {
    wf: +wf.toFixed(1),
    nRaces: valid.length,
    spread: spread != null ? +spread.toFixed(1) : null,
    confidence: +confidence.toFixed(2),
    method: 'day-consensus'
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function bearingDeg(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * D2R;
  const y = Math.sin(dLon) * Math.cos(lat2 * D2R);
  const x = Math.cos(lat1*D2R)*Math.sin(lat2*D2R) -
            Math.sin(lat1*D2R)*Math.cos(lat2*D2R)*Math.cos(dLon);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

function circularSpread(angles) {
  // Mean resultant length — low value = high spread
  let sx = 0, sy = 0;
  for (const a of angles) { sx += Math.cos(a * D2R); sy += Math.sin(a * D2R); }
  const R = Math.hypot(sx, sy) / angles.length;
  // Convert to degrees spread (approx)
  return R > 0.01 ? Math.acos(Math.min(1, R)) * R2D : 180;
}

function classifyLeg(cog, upwindAxis) {
  if (upwindAxis == null) return 'upwind'; // assume upwind if no axis
  const rel = ((cog - upwindAxis + 360) % 360);
  // Within ±70° of upwind axis = upwind leg
  // Within ±70° of downwind axis = downwind leg
  // Otherwise = reaching (ignore)
  if (rel <= 70 || rel >= 290) return 'upwind';
  if (rel >= 110 && rel <= 250) return 'downwind';
  return 'reach';
}
