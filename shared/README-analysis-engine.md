# VRS Analysis Engine Refactor

This branch adds reusable analysis modules without replacing the current event HTML reports.

## Goal

Move race logic out of large event-specific HTML files and into small pure modules that are easier to test, debug, and reuse across classes and events.

## New modules

- `data-quality.js` — summarises telemetry coverage by boat and fleet.
- `race-analysis.js` — shared start, leg, speed, distance, line-bias, and race-model helpers.
- `telemetry-safe.js` — structured telemetry fetch wrapper with chunking, warnings, and errors.
- `gun-time.js` — gun-time source resolver with explicit confidence levels.

## Migration strategy

1. Keep existing reports working.
2. Add new shared helpers beside the old code.
3. Replace duplicated calculations in event HTML one section at a time.
4. Add tests around geometry, polar interpolation, gun-time resolution, line metrics, and data quality.
5. Only then simplify the event HTML into a thin config + renderer shell.

## Analysis principles

Every race metric should identify whether it is:

- measured directly from telemetry,
- sourced from official/event metadata,
- inferred from geometry or fleet behaviour,
- or manually overridden in event config.

Each high-impact number should also carry confidence or warnings. This is especially important for gun time, mark identity, wind direction, leg segmentation, and missing telemetry.

## Recommended next migration targets

1. Replace any silent `[]` telemetry failure handling with `fetchTelemetrySafe()`.
2. Use `resolveGunTime()` before calculating start metrics.
3. Use `buildRaceModel()` to expose data-quality labels in the report UI.
4. Move start table calculations to `analyseStart()`.
5. Move leg statistics to `analyseLegs()`.
