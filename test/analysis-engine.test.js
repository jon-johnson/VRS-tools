import test from 'node:test';
import assert from 'node:assert/strict';

import { hav, brg, polarSpeed, weightedCircMean } from '../shared/geometry.js';
import { summariseTrackCoverage, summariseFleetCoverage, dataQualityLabel } from '../shared/data-quality.js';
import { nearestSample, trackDistanceM, startLineMetrics, lineBiasMetres } from '../shared/race-analysis.js';
import { resolveGunTime } from '../shared/gun-time.js';

test('geometry distance and bearing are sane at start-line scale', () => {
  const distance = hav(57.0, 11.0, 57.0, 11.001);
  assert.ok(distance > 60 && distance < 70);

  const bearing = brg(57.0, 11.0, 57.001, 11.0);
  assert.ok(bearing < 1 || bearing > 359);
});

test('weighted circular mean handles north wraparound', () => {
  const mean = weightedCircMean([{ angle: 359, weight: 1 }, { angle: 1, weight: 1 }]);
  assert.ok(mean < 2 || mean > 358);
});

test('polar interpolation returns a plausible value', () => {
  const polar = {
    twa: [40, 50],
    tws: [10, 12],
    speeds: [
      [7, 8],
      [8, 9]
    ]
  };
  assert.equal(polarSpeed(polar, 45, 11), 8);
});

test('data quality flags low coverage and large gaps', () => {
  const track = [
    { ts: 0 },
    { ts: 1000 },
    { ts: 25_000 }
  ];
  const summary = summariseTrackCoverage(track, { windowStart: 0, windowEnd: 60_000, largeGapMs: 10_000 });
  assert.equal(summary.sampleCount, 3);
  assert.ok(summary.warnings.includes('LOW_WINDOW_COVERAGE'));
  assert.ok(summary.warnings.includes('LARGE_GAPS'));
});

test('fleet data quality label distinguishes weak telemetry', () => {
  const fleet = summariseFleetCoverage({
    A: [{ ts: 0 }, { ts: 1000 }],
    B: [],
    C: [{ ts: 0 }, { ts: 50_000 }]
  }, { windowStart: 0, windowEnd: 60_000 });
  assert.equal(dataQualityLabel(fleet), 'weak');
});

test('nearest sample respects max delta', () => {
  const track = [{ ts: 1000, sog: 1 }, { ts: 5000, sog: 2 }];
  assert.equal(nearestSample(track, 1200, 500).ts, 1000);
  assert.equal(nearestSample(track, 3000, 500), null);
});

test('track distance ignores unrealistic jumps', () => {
  const track = [
    { ts: 0, lat: 57.0, lon: 11.0 },
    { ts: 1, lat: 57.0, lon: 11.0001 },
    { ts: 2, lat: 58.0, lon: 12.0 }
  ];
  const distance = trackDistanceM(track);
  assert.ok(distance > 5 && distance < 10);
});

test('start line metrics produce distance and line percentage', () => {
  const startLine = {
    pin: { lat: 57.0, lon: 11.0 },
    rc: { lat: 57.0, lon: 11.001 }
  };
  const point = { lat: 57.0001, lon: 11.0005 };
  const metrics = startLineMetrics(point, startLine, 10);
  assert.ok(metrics.distanceToLineM > 10 && metrics.distanceToLineM < 12);
  assert.ok(metrics.percentUpLine > 45 && metrics.percentUpLine < 55);
});

test('line bias returns favoured end and metres', () => {
  const startLine = {
    pin: { lat: 57.0, lon: 11.0 },
    rc: { lat: 57.0, lon: 11.001 }
  };
  const bias = lineBiasMetres(startLine, 0);
  assert.equal(bias.favouredEnd, 'SQUARE');
  assert.ok(Math.abs(bias.biasM) < 1);
});

test('gun time resolver follows source hierarchy', () => {
  const resolved = resolveGunTime({
    raceNumber: 2,
    manualGunTs: null,
    officialGuns: [{ raceNumber: 2, gunTs: 2000 }],
    metadataGunTs: 3000,
    telemetryGunTs: 4000
  });
  assert.equal(resolved.ts, 2000);
  assert.equal(resolved.source, 'official');
});
