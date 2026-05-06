// VRS Sailing Tools — Safer Telemetry Fetch Wrapper
// This module sits beside telemetry.js rather than replacing it. Existing reports
// can continue to use fetchTelemetry(), while new code can opt into structured
// results with explicit errors, warnings, and coverage metadata.

import { fetchTelemetry } from './telemetry.js';

/**
 * Fetch telemetry in chunks and return a structured result instead of silently
 * returning [] on every failure mode.
 *
 * @param {Object} params
 * @param {string} params.eventId
 * @param {number} params.after
 * @param {number} params.before
 * @param {string|null} params.division
 * @param {number} params.chunkMs
 * @param {number} params.limit
 */
export async function fetchTelemetrySafe(params) {
  const {
    eventId,
    after,
    before,
    division = null,
    chunkMs = 5 * 60_000,
    limit = 5000
  } = params || {};

  const warnings = [];
  const errors = [];
  const rows = [];

  if (!eventId) errors.push('MISSING_EVENT_ID');
  if (!Number.isFinite(after)) errors.push('INVALID_AFTER_TIMESTAMP');
  if (!Number.isFinite(before)) errors.push('INVALID_BEFORE_TIMESTAMP');
  if (Number.isFinite(after) && Number.isFinite(before) && before <= after) errors.push('EMPTY_OR_NEGATIVE_TIME_WINDOW');

  if (errors.length) {
    return {
      ok: false,
      rows,
      errors,
      warnings,
      meta: { eventId, after, before, division, chunksRequested: 0, chunksSucceeded: 0 }
    };
  }

  let chunksRequested = 0;
  let chunksSucceeded = 0;

  for (let t = after; t < before; t += chunkMs) {
    const chunkStart = t;
    const chunkEnd = Math.min(before, t + chunkMs);
    chunksRequested++;

    try {
      const chunkRows = await fetchTelemetry(eventId, chunkStart, chunkEnd, limit, division);
      if (!Array.isArray(chunkRows)) {
        warnings.push(`NON_ARRAY_RESPONSE:${chunkStart}-${chunkEnd}`);
        continue;
      }
      if (chunkRows.length >= limit) {
        warnings.push(`POSSIBLE_LIMIT_TRUNCATION:${chunkStart}-${chunkEnd}`);
      }
      rows.push(...chunkRows);
      chunksSucceeded++;
    } catch (err) {
      errors.push(`FETCH_FAILED:${chunkStart}-${chunkEnd}:${err?.message || err}`);
    }
  }

  const deduped = dedupeRows(rows);
  if (deduped.length < rows.length) warnings.push(`DUPLICATE_ROWS_REMOVED:${rows.length - deduped.length}`);
  deduped.sort((a, b) => (a.ts ?? a.timestamp ?? 0) - (b.ts ?? b.timestamp ?? 0));

  return {
    ok: errors.length === 0 && deduped.length > 0,
    rows: deduped,
    errors,
    warnings,
    meta: {
      eventId,
      after,
      before,
      division,
      chunksRequested,
      chunksSucceeded,
      rawRows: rows.length,
      rows: deduped.length
    }
  };
}

function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const key = [row.ts ?? row.timestamp, row.sail ?? '', row.sn ?? row.device_sn ?? '', row.lat, row.lon].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
