// VRS Sailing Tools — Telemetry Data Quality Utilities
// Pure helpers for reporting whether a race analysis is based on strong,
// partial, or weak telemetry coverage. These functions do not fetch data and
// can be reused by event reports, tactical tools, and tests.

/**
 * Summarise telemetry coverage for a single boat track.
 * @param {Array<{ts:number}>} track
 * @param {Object} opts
 * @param {number|null} opts.windowStart
 * @param {number|null} opts.windowEnd
 * @param {number} opts.largeGapMs
 */
export function summariseTrackCoverage(track, opts = {}) {
  const {
    windowStart = null,
    windowEnd = null,
    largeGapMs = 10_000
  } = opts;

  const pts = Array.isArray(track)
    ? track.filter(p => Number.isFinite(p?.ts)).slice().sort((a, b) => a.ts - b.ts)
    : [];

  if (!pts.length) {
    return {
      ok: false,
      sampleCount: 0,
      firstTs: null,
      lastTs: null,
      durationMs: 0,
      coverageRatio: 0,
      maxGapMs: null,
      largeGapCount: 0,
      warnings: ['NO_SAMPLES']
    };
  }

  let maxGapMs = 0;
  let largeGapCount = 0;
  for (let i = 1; i < pts.length; i++) {
    const gap = pts[i].ts - pts[i - 1].ts;
    if (gap > maxGapMs) maxGapMs = gap;
    if (gap > largeGapMs) largeGapCount++;
  }

  const firstTs = pts[0].ts;
  const lastTs = pts[pts.length - 1].ts;
  const observedDurationMs = Math.max(0, lastTs - firstTs);
  const expectedDurationMs = Number.isFinite(windowStart) && Number.isFinite(windowEnd)
    ? Math.max(0, windowEnd - windowStart)
    : observedDurationMs;
  const coverageRatio = expectedDurationMs > 0
    ? Math.max(0, Math.min(1, observedDurationMs / expectedDurationMs))
    : 1;

  const warnings = [];
  if (coverageRatio < 0.75) warnings.push('LOW_WINDOW_COVERAGE');
  if (largeGapCount > 0) warnings.push('LARGE_GAPS');
  if (pts.length < 20) warnings.push('LOW_SAMPLE_COUNT');

  return {
    ok: warnings.length === 0,
    sampleCount: pts.length,
    firstTs,
    lastTs,
    durationMs: observedDurationMs,
    coverageRatio: +coverageRatio.toFixed(3),
    maxGapMs,
    largeGapCount,
    warnings
  };
}

/**
 * Summarise telemetry coverage across all boats in a race.
 * @param {Object<string, Array>} tracks
 */
export function summariseFleetCoverage(tracks, opts = {}) {
  const entries = Object.entries(tracks || {});
  const boats = {};
  let totalSamples = 0;
  let boatsWithWarnings = 0;
  let boatsWithNoSamples = 0;
  let worstMaxGapMs = 0;

  for (const [sail, track] of entries) {
    const summary = summariseTrackCoverage(track, opts);
    boats[sail] = summary;
    totalSamples += summary.sampleCount;
    if (summary.warnings.length) boatsWithWarnings++;
    if (!summary.sampleCount) boatsWithNoSamples++;
    if ((summary.maxGapMs ?? 0) > worstMaxGapMs) worstMaxGapMs = summary.maxGapMs;
  }

  const warningCodes = new Set();
  for (const b of Object.values(boats)) {
    for (const w of b.warnings) warningCodes.add(w);
  }

  return {
    boatCount: entries.length,
    totalSamples,
    boatsWithWarnings,
    boatsWithNoSamples,
    worstMaxGapMs,
    warningCodes: [...warningCodes].sort(),
    boats
  };
}

/**
 * Convert data-quality warnings into a short human-readable status.
 */
export function dataQualityLabel(summary) {
  if (!summary) return 'unknown';
  if (summary.boatCount === 0 || summary.totalSamples === 0) return 'no telemetry';
  if (summary.boatsWithWarnings === 0) return 'good';
  if (summary.boatsWithWarnings <= Math.max(1, summary.boatCount * 0.25)) return 'partial';
  return 'weak';
}
