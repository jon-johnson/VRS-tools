// VRS Sailing Tools — Shared Race Analysis Helpers
// Pure, UI-free helpers for common racing analysis. The intent is to move
// tactical calculations out of large event HTML files and into reusable modules.

import { hav, brg, distToLine, signedDistToLine, polarSpeed, vmgOptimalTWA } from './geometry.js';
import { summariseFleetCoverage, dataQualityLabel } from './data-quality.js';

export const KTS_PER_MPS = 1.94384449244;

/**
 * Return the sample nearest a timestamp.
 */
export function nearestSample(track, targetTs, maxDeltaMs = 2_500) {
  if (!Array.isArray(track) || !track.length || !Number.isFinite(targetTs)) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const p of track) {
    if (!Number.isFinite(p?.ts)) continue;
    const delta = Math.abs(p.ts - targetTs);
    if (delta < bestDelta) {
      best = p;
      bestDelta = delta;
    }
  }
  return best && bestDelta <= maxDeltaMs ? { ...best, deltaMs: bestDelta } : null;
}

/**
 * Slice a track by timestamp.
 */
export function sliceTrack(track, startTs, endTs) {
  if (!Array.isArray(track)) return [];
  return track.filter(p => p.ts >= startTs && p.ts <= endTs).sort((a, b) => a.ts - b.ts);
}

/**
 * Calculate distance sailed along a track segment in metres.
 */
export function trackDistanceM(track) {
  const pts = Array.isArray(track) ? track : [];
  let distance = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!validLatLon(a) || !validLatLon(b)) continue;
    const step = hav(a.lat, a.lon, b.lat, b.lon);
    // Reject obvious GPS jumps. 250 m between adjacent samples is not normal
    // for short-course analysis and usually indicates a data problem.
    if (step <= 250) distance += step;
  }
  return distance;
}

/**
 * Average speed in knots across a track segment.
 */
export function averageSpeedKts(track) {
  const speeds = (track || [])
    .map(p => Number(p?.sog))
    .filter(Number.isFinite)
    .map(s => s * KTS_PER_MPS);
  if (!speeds.length) return null;
  return speeds.reduce((a, b) => a + b, 0) / speeds.length;
}

/**
 * Build start metrics at gun and a later checkpoint.
 */
export function analyseStart(tracks, startLine, gunTs, opts = {}) {
  const {
    checkpointMs = 50_000,
    maxSampleDeltaMs = 2_500,
    boatLengthM = 9.6
  } = opts;

  const results = [];
  for (const [sail, track] of Object.entries(tracks || {})) {
    const gun = nearestSample(track, gunTs, maxSampleDeltaMs);
    const checkpoint = nearestSample(track, gunTs + checkpointMs, maxSampleDeltaMs);
    const start = gun && startLine ? startLineMetrics(gun, startLine, boatLengthM) : null;
    const tPlus = checkpoint && startLine ? startLineMetrics(checkpoint, startLine, boatLengthM) : null;

    results.push({
      sail,
      gun,
      checkpoint,
      distanceToLineM: start?.distanceToLineM ?? null,
      signedDistanceToLineM: start?.signedDistanceToLineM ?? null,
      boatLengthsFromLine: start?.boatLengthsFromLine ?? null,
      percentUpLine: start?.percentUpLine ?? null,
      speedAtGunKts: gun?.sog != null ? +(gun.sog * KTS_PER_MPS).toFixed(2) : null,
      distanceToLineAtCheckpointM: tPlus?.distanceToLineM ?? null,
      percentUpLineAtCheckpoint: tPlus?.percentUpLine ?? null,
      sampleDeltaMs: gun?.deltaMs ?? null,
      checkpointDeltaMs: checkpoint?.deltaMs ?? null,
      confidence: gun ? sampleConfidence(gun.deltaMs, maxSampleDeltaMs) : 'missing'
    });
  }

  return results.sort((a, b) => {
    // Closer to line at gun ranks higher, but missing values go last.
    if (a.distanceToLineM == null) return 1;
    if (b.distanceToLineM == null) return -1;
    return a.distanceToLineM - b.distanceToLineM;
  });
}

/**
 * Analyse a leg between two marks or two timestamps.
 */
export function analyseLegs(tracks, legs, opts = {}) {
  const { polar = null, tws = null, windDir = null } = opts;
  const out = [];

  for (const leg of legs || []) {
    const rows = [];
    for (const [sail, track] of Object.entries(tracks || {})) {
      const seg = sliceTrack(track, leg.startTs, leg.endTs);
      const distanceM = trackDistanceM(seg);
      const avgSpeedKts = averageSpeedKts(seg);
      const rhumbM = leg.from && leg.to && validLatLon(leg.from) && validLatLon(leg.to)
        ? hav(leg.from.lat, leg.from.lon, leg.to.lat, leg.to.lon)
        : null;
      const distanceEfficiency = rhumbM && distanceM
        ? rhumbM / distanceM
        : null;
      const polarPct = estimatePolarPercent(seg, { polar, tws, windDir, mode: leg.mode });

      rows.push({
        sail,
        sampleCount: seg.length,
        distanceM: +distanceM.toFixed(1),
        rhumbM: rhumbM != null ? +rhumbM.toFixed(1) : null,
        distanceEfficiency: distanceEfficiency != null ? +distanceEfficiency.toFixed(3) : null,
        avgSpeedKts: avgSpeedKts != null ? +avgSpeedKts.toFixed(2) : null,
        polarPct: polarPct != null ? +polarPct.toFixed(3) : null
      });
    }
    out.push({ ...leg, boats: rows });
  }

  return out;
}

/**
 * Create a compact race analysis shell that other report renderers can consume.
 */
export function buildRaceModel({ raceId, tracks, marks, gunTs, raceEndTs, startLine }) {
  const quality = summariseFleetCoverage(tracks, {
    windowStart: gunTs ?? null,
    windowEnd: raceEndTs ?? null
  });

  return {
    raceId,
    gunTs: gunTs ?? null,
    raceEndTs: raceEndTs ?? null,
    marks: marks ?? {},
    startLine: startLine ?? null,
    dataQuality: quality,
    dataQualityLabel: dataQualityLabel(quality),
    boats: Object.keys(tracks || {}).sort()
  };
}

export function startLineMetrics(point, startLine, boatLengthM = 9.6) {
  if (!point || !startLine?.rc || !startLine?.pin) return null;
  const { rc, pin } = startLine;
  const distanceToLineM = distToLine(point.lat, point.lon, rc.lat, rc.lon, pin.lat, pin.lon);
  const signedDistanceToLineM = signedDistToLine(point.lat, point.lon, rc.lat, rc.lon, pin.lat, pin.lon);
  const lineLengthM = hav(rc.lat, rc.lon, pin.lat, pin.lon);
  const percentUpLine = lineLengthM > 0 ? projectionPercent(point, pin, rc) : null;
  return {
    distanceToLineM: +distanceToLineM.toFixed(1),
    signedDistanceToLineM: +signedDistanceToLineM.toFixed(1),
    boatLengthsFromLine: boatLengthM ? +(distanceToLineM / boatLengthM).toFixed(2) : null,
    lineLengthM: +lineLengthM.toFixed(1),
    percentUpLine: percentUpLine != null ? +percentUpLine.toFixed(1) : null
  };
}

export function lineBiasMetres(startLine, windDir, opts = {}) {
  if (!startLine?.rc || !startLine?.pin || !Number.isFinite(windDir)) return null;
  const { squareDeadbandM = 0.5, squareDeadbandDeg = 0.25 } = opts;
  const { rc, pin } = startLine;
  const lineLengthM = hav(rc.lat, rc.lon, pin.lat, pin.lon);
  const lineAxis = brg(pin.lat, pin.lon, rc.lat, rc.lon);
  const squareAxis = (windDir + 90 + 360) % 360;
  const rawBiasDeg = signedAngle(lineAxis, squareAxis);
  const rawBiasM = Math.sin(rawBiasDeg * Math.PI / 180) * lineLengthM;
  const isSquare = Math.abs(rawBiasM) <= squareDeadbandM || Math.abs(rawBiasDeg) <= squareDeadbandDeg;
  const biasDeg = isSquare ? 0 : rawBiasDeg;
  const biasM = isSquare ? 0 : rawBiasM;
  return {
    lineLengthM: +lineLengthM.toFixed(1),
    biasDeg: +biasDeg.toFixed(1),
    biasM: +biasM.toFixed(1),
    favouredEnd: isSquare ? 'SQUARE' : biasM > 0 ? 'RC' : 'PIN'
  };
}

function estimatePolarPercent(track, { polar, tws, windDir, mode }) {
  if (!polar || !Number.isFinite(tws) || !Number.isFinite(windDir) || !track?.length) return null;
  const ratios = [];
  for (const p of track) {
    if (!Number.isFinite(p?.sog) || !Number.isFinite(p?.cog)) continue;
    const speedKts = p.sog * KTS_PER_MPS;
    const twa = trueWindAngle(p.cog, windDir);
    const target = polarSpeed(polar, twa, tws);
    if (target && target > 0) ratios.push(speedKts / target);
  }
  if (!ratios.length) return null;
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

function trueWindAngle(cog, windDir) {
  const diff = Math.abs(signedAngle(cog, windDir));
  return diff > 180 ? 360 - diff : diff;
}

function projectionPercent(point, from, to) {
  // Local flat projection is adequate for start-line scale distances.
  const lat0 = point.lat * Math.PI / 180;
  const x = (ll) => ll.lon * Math.cos(lat0) * 111320;
  const y = (ll) => ll.lat * 111320;
  const ax = x(from), ay = y(from);
  const bx = x(to), by = y(to);
  const px = x(point), py = y(point);
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const len2 = vx * vx + vy * vy;
  if (!len2) return null;
  return Math.max(0, Math.min(100, ((wx * vx + wy * vy) / len2) * 100));
}

function signedAngle(a, b) {
  return ((a - b + 540) % 360) - 180;
}

function sampleConfidence(deltaMs, maxDeltaMs) {
  if (!Number.isFinite(deltaMs)) return 'missing';
  if (deltaMs <= maxDeltaMs * 0.25) return 'high';
  if (deltaMs <= maxDeltaMs * 0.75) return 'medium';
  return 'low';
}

function validLatLon(p) {
  return Number.isFinite(p?.lat) && Number.isFinite(p?.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
}
