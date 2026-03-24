// VRS Sailing Tools — Vakaros Telemetry API Utilities
// Endpoint: teleapi.regatta.app

const BASE = 'https://teleapi.regatta.app/telemetry/event';

/**
 * Fetch telemetry for an event within a time window.
 * Returns array of telemetry rows, or [] on error.
 *
 * @param {string} eventId    - Vakaros event ID
 * @param {number} after      - Start timestamp (ms)
 * @param {number} before     - End timestamp (ms)
 * @param {number} limit      - Max rows (default 5000)
 * @param {string} division   - Division filter (e.g. 'Cape31', 'Dragon')
 */
export async function fetchTelemetry(eventId, after, before, limit = 5000, division = null) {
  let url = `${BASE}/${eventId}?after=${after}&before=${before}&limit=${limit}`;
  if (division) url += `&division=${encodeURIComponent(division)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.Rows || !Array.isArray(data.Rows)) return [];
    return data.Rows;
  } catch (e) {
    console.warn('Telemetry fetch failed:', e.message);
    return [];
  }
}

/**
 * Fetch just the first row after a timestamp — useful for gun detection.
 * Returns the row or null.
 */
export async function fetchFirstRow(eventId, after, before, division = null) {
  const rows = await fetchTelemetry(eventId, after, before, 1, division);
  return rows[0] ?? null;
}

/**
 * Detect gun times by polling for in_progress stage transitions.
 * Polls every 30s across a window.
 * Returns array of { raceNumber, gunTs } sorted by gunTs.
 *
 * NOTE: First in_progress row appears ~20s after actual gun,
 * so 20,000ms is subtracted to get the actual gun time.
 */
export async function detectGuns(eventId, windowStart, windowEnd, division = null) {
  const guns = [];
  const seen = new Set();
  const STEP = 30_000;
  const GUN_OFFSET = 20_000;

  for (let t = windowStart; t < windowEnd; t += STEP) {
    const rows = await fetchTelemetry(eventId, t, t + STEP, 100, division);
    for (const row of rows) {
      if (row.stage === 'in_progress' && !seen.has(row.race_number)) {
        seen.add(row.race_number);
        guns.push({
          raceNumber: row.race_number,
          gunTs: row.ts - GUN_OFFSET
        });
      }
    }
  }

  return guns.sort((a, b) => a.gunTs - b.gunTs);
}

/**
 * Group raw telemetry rows into per-boat tracks.
 * Returns { sailNum: [{ts, lat, lon, sog, cog, hdg, stage}] }
 *
 * Marks are identified by role === 'mark' with empty sail number.
 * Excludes sail numbers in the excludeSails set.
 */
export function groupByBoat(rows, excludeSails = new Set()) {
  const tracks = {};
  const marks  = {};

  for (const row of rows) {
    if (row.role === 'mark' && !row.sail) {
      const sn = String(row.sn ?? row.device_sn ?? '');
      if (!marks[sn]) marks[sn] = [];
      marks[sn].push(normaliseRow(row));
      continue;
    }

    const sail = String(row.sail ?? '').trim();
    if (!sail || excludeSails.has(sail)) continue;

    if (!tracks[sail]) tracks[sail] = [];
    tracks[sail].push(normaliseRow(row));
  }

  // Sort each track by timestamp
  for (const sail of Object.keys(tracks)) {
    tracks[sail].sort((a, b) => a.ts - b.ts);
  }

  return { tracks, marks };
}

/**
 * Normalise a raw telemetry row to consistent field names.
 */
function normaliseRow(row) {
  return {
    ts:    row.ts ?? row.timestamp ?? 0,
    lat:   row.lat ?? row.latitude  ?? 0,
    lon:   row.lon ?? row.longitude ?? 0,
    sog:   row.sog ?? row.speed     ?? 0,   // m/s
    cog:   row.cog ?? row.course    ?? 0,   // degrees true
    hdg:   row.hdg ?? row.heading   ?? row.cog ?? 0,
    stage: row.stage ?? null,
    sail:  String(row.sail ?? '').trim(),
    sn:    row.sn ?? row.device_sn ?? null,
    role:  row.role ?? null
  };
}

/**
 * Find RC and PIN marks from a marks object given known serial numbers.
 * rcSns and pinSns are arrays of serial number strings.
 */
export function identifyStartMarks(marks, rcSns = [], pinSns = []) {
  const find = (sns) => {
    for (const sn of sns) {
      if (marks[String(sn)]?.length) {
        const pts = marks[String(sn)];
        // Use median position for stability
        const lats = pts.map(p => p.lat).sort((a,b) => a-b);
        const lons = pts.map(p => p.lon).sort((a,b) => a-b);
        return {
          lat: lats[Math.floor(lats.length / 2)],
          lon: lons[Math.floor(lons.length / 2)]
        };
      }
    }
    return null;
  };
  return {
    rc:  find(rcSns),
    pin: find(pinSns)
  };
}
