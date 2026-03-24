# VRS Sailing Tools

Race analytics and live tactical tools for Vakaros RaceSense GPS telemetry.

Supports multiple classes (Cape 31, Dragon, and more) on windward/leeward courses.

## Structure

- `index.html` — Event directory (dynamic, reads from Firestore)
- `shared/` — Shared utilities: geometry, wind inference, telemetry API, Firebase config
- `polars/` — Class polar data (JSON)
- `events/` — Per-event race report HTML files, organised by class
- `tactical/` — Single multi-class live tactical tool

## Classes Supported
- Cape 31
- Dragon (polar TBD)

## Powered by
- [Vakaros RaceSense](https://vakaros.com) telemetry
- Firebase Firestore
- GitHub Pages
