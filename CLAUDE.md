# VRS Sailing Tools — Claude Code Knowledge Base

## Repository
- **GitHub:** https://github.com/jon-johnson/VRS-tools (public)
- **Live URL:** https://jon-johnson.github.io/VRS-tools/
- **GitHub PAT:** `[GitHub PAT — ask Sam]`
- **Working dir:** repo root (all files checked in, GitHub Pages serves from `main`)
- **Deploy:** `git add / commit / push` → Pages deploys in ~60-90s. Use `?v=N` cache-bust on reload.

---

## File Structure

```
index.html                          ← Event database homepage
events/
  cape31/
    cape31-porto-cervo-2026.html    ← Cape 31 Porto Cervo (3 days, 10 races)
    cape31-puntaldia-2026.html      ← Cape 31 Puntaldia (1 day, 3 races inc. abandoned)
  j70/
    j70-gs2-cowes-2026.html         ← J70 GS2 Cowes (2 days, 7 races)
  VRS_event_TEMPLATE.html           ← Base template (older — use j70 file as base instead)
shared/                             ← Shared utilities (not currently used by reports)
polars/                             ← Polar data files
```

The **J70 GS2 Cowes file** is the most current and feature-complete report — use it as the base when creating new event reports.

---

## Telemetry API

```
GET https://teleapi.regatta.app/telemetry/event/{EVENT_ID}?after={ms}&before={ms}&limit=100000&division={DIV}
```

- Returns `{ Fields: [...], Rows: [[...], ...] }` columnar format
- `Fields` can be `null` if no data in window — always null-check
- Key fields: `ts` (UTC ms), `sn` (device serial), `sail_number`, `race_number`, `race_stage`, `role`, `latitude`, `longitude`, `heading`, `sog`
- `role` values: `'competitor'`, `'mark'`
- `race_stage` values: `'pre_start'`, `'starting'`, `'in_progress'`, `'finishing'`, `'finished'`
- **Gun time** = first `in_progress` timestamp for a race number (fires ~1s before or at the on-the-minute gun)
- Max 100k rows per fetch — paginate by advancing `after` to `rows[-1][tsI] + 1`

### Finding Gun Times (auto-detection)
```python
# Paginate through the day, collect first in_progress per race_number
guns = {}
cursor = day_start_ms
while cursor < day_end_ms:
    url = f'...?after={cursor}&before={day_end_ms}&limit=100000&division={DIV}'
    # fetch, parse
    for row in rows:
        if row[stageI] == 'in_progress':
            rn = row[raceI]
            if rn not in guns or row[tsI] < guns[rn]:
                guns[rn] = row[tsI]
    cursor = rows[-1][tsI] + 1
```

### Identifying Abandoned Races
- A race is **abandoned** if it has `in_progress` but no `finishing` stage
- Check by fetching a wide window and looking at stage transitions per race number

### Finding Mark SNs
```python
# Fetch ±2min around gun, collect marks, sort by dist to fleet centroid
marks = {}  # sn → {lat, lon, dt}
for row in rows:
    if row[roleI] == 'mark':
        sn = row[snI]; dt = abs(row[tsI] - gun)
        if sn not in marks or dt < marks[sn]['dt']:
            marks[sn] = {'lat': row[latI], 'lon': row[lonI], 'dt': dt}
```

Compute haversine distances from fleet centroid. The RC committee boat mark is always the closest device to the committee boat (test pairwise distances).

**Confirming the correct start line pair:**
- Test each candidate pair: compute signed perpendicular distance for all boats at gun
- Correct pair: fleet is clustered within ±20m, with most boats on the pre-start side
- If a pair gives 0 OCS with all boats 60-200m behind the line, those marks are the **windward gate**, not the start line

---

## Event Report Config (top of each HTML file)

```javascript
const REGATTA_TITLE    = 'J70 GS2 2026 Cowes';
const REGATTA_SUBTITLE = 'Cowes, Royal Thames YC · 9-10 May 2026 · BST (UTC+1)';

const EVENTS = [
  {
    id: 'eTg9LhKGLTtOVD9f01Gb',   // Vakaros event ID from URL
    division: 'J70_GS2',           // Vakaros division string
    label: 'DAY 1',
    date: '2026-05-09',
    tz: 'BST', tzOffset: 1,        // for gun time display
    raceDay: 2,                    // Vakaros raceDay param (1-indexed from event start)
    dayStart: 1778320800000,       // UTC ms — start of telemetry fetch window
    dayEnd:   1778346000000,       // UTC ms — end of telemetry fetch window
    knownGuns: [
      [1, 1778328000000],   // [telemetry_race_number, gun_UTC_ms]
      [2, 1778332723800],   // use actual in_progress ts, not stated time if they differ
      [3, 1778336100000],
      [4, 1778339400000],
    ],
  },
  // Add Day 2 as second element for multi-day events
];

const EXCLUDED_BOATS = ['001'];    // RC/committee boat sail numbers to ignore

const BOATS_ALL = ["GBR1247", "GBR1942", ...];  // all competitor sail numbers

const COL = {
  'GBR1942': '#ff4444',  // focal boat = red; all others = '#22c55e' (green)
  'GBR1247': '#22c55e',
  // ...
};

const TEAM_NAMES = {
  'GBR1942': 'Lady Khumbu',
  // ...
};

const GATE_SNS = {
  WW: [28249, 27947],    // windward gate SNs ([] if none)
  LW: [],                // leeward gate SNs
  RC_SNS: [25966],       // RC boat mark SN(s)
  PIN_SN: 25935,         // pin end mark SN
};

const OFFICIAL_RESULTS_BY_DAY = {
  // Key = EVENTS array index (0-based) + 1 (so Day1=1, Day2=2)
  1: {
    1: { "GBR1247": 9, "GBR1942": 1, ... },  // race_number → {sail: position}
    2: { ... },
  },
  2: {
    5: { ... },  // race numbers continue from Day 1
  },
};

// Focal boat (highlighted in red, row tint in start table)
// Set sail === 'FOCAL_SAIL' in reachRankColor() and gunMapBoatColor()
// and the row highlight in renderStartR()

const BOAT_LOA  = 6.93;   // J70; Cape 31 = 9.45
const BOAT_BEAM = 2.49;   // J70; Cape 31 = 2.99
const BOAT_CLASS = 'j70'; // or 'cape31'
```

### Multi-Day Events
- Each day = one entry in `EVENTS[]`
- Same `id` and `division` for same Vakaros event
- Different `raceDay` (Vakaros counts from start of the event)
- `OFFICIAL_RESULTS_BY_DAY` keyed by EVENTS index + 1

### Abandoned Races
- Include in `knownGuns` with the correct telemetry race number
- Label with `window.RACE_LABEL_MAP = { 1: 'R1 (ABD)', 2: 'R1', 3: 'R2' }`
- No entry in `OFFICIAL_RESULTS_BY_DAY` needed — Finish column shows "—"

---

## Key Design Decisions & Features

### Colours
- **All boats:** `#22c55e` (green) in maps and replay
- **Focal boat:** `#ff4444` (red) in maps, replay, and start table row tint
- **OCS boats:** `#ff3355` red highlight in start table
- Boat colours in `COL` object are used in the start table speed bars only

### Mark Detection (distance sanity check)
```javascript
// In loadRace(), configured marks are skipped if >400m from fleet centroid
// → falls through to fleet-perpendicular auto-detection
const _markOK = (m) => {
  const d = hav(_cLat4RC, _cLon4RC, m.lat, m.lon);
  return d < 400;
};
```

### Mark Confirmation Card
Shows between chip row and maps: `START MARKS RC #SN PIN #SN [confidence] [OVERRIDE]`
- OVERRIDE prompts for new SNs, clears raceCache, writes to `knownGuns[race][2]`
- Method shows "configured" (from GATE_SNS) or "auto-detected" with ⊥ error

### Replay Layout (startReplayLayout)
- Canvas: 16:6 landscape aspect ratio, full width
- Bounding box computed from ALL boat positions across T-1:30 to T+30 (not just gun snapshot)
- Uses safe loop `_expand(rx, ry)` — not `Math.min(...array)` (stack overflow risk)
- `tX`/`tY` use `trajCx`/`trajCy` (trajectory bounding box centre) — only in `startReplayLayout`
- Other map functions (`drawGunR`, `drawT50R`, `drawT50`) use their own `plotCX`/`plotCY`

### Boat Labels
- Drawn BEHIND the stern (opposite bow direction, offset `L*1.5`)
- Small font (4–6px), no pill, no leader
- Does not obscure the boat hull shape

### Start Report Table
- Sorted by official finish position (from `OFFICIAL_RESULTS_BY_DAY`)
- Columns: # · Boat · DTL@T-15 · DTL@Gun · Speed@Gun · Line End · Finish
- Focal boat row: red tint background + 4px red left border

### Hidden Sections
These are hidden via CSS `display:none!important` (not removed):
- Course overview card (`.course-card`)
- Wind inference card (`.wind-card`)
- DAY AVG tab (`st.style.display = 'none'`)
- EVENT tab (`.style.display = 'none'`)
- LEG 1 table (hidden in template)

### Fetch Window
- `BEFORE_GUN = 100000` (100s before gun) — enables T-1:30 replay
- `AFTER_GUN = 1200000` (20 min)
- Separate mark fetch: ±30min around gun

---

## Index Page (`index.html`)

Events are stored as a **static JavaScript array** (no Firestore):

```javascript
const EVENT_DB = [
  {
    id: 'cape31-puntaldia-2026',
    name: 'Puntaldia',
    date: '2026-05-15',
    venue: 'Puntaldia, Sardinia',
    class: 'Cape31',
    file: 'cape31-puntaldia-2026.html',   // relative to events/<class-lowercase>/
    races: [
      {label:'R1 (ABD)'}, {label:'R1'}, {label:'R2'}
    ]
  },
  // ...sorted newest first
];
```

To add a new event: add an entry to `EVENT_DB` in `index.html`. The class filter buttons auto-generate from unique `class` values.

---

## Existing Events

| File | Event | Dates | Class | Races | Focal Boat |
|---|---|---|---|---|---|
| `cape31-puntaldia-2026.html` | Puntaldia, Sardinia | 15 May 2026 | Cape 31 | R1(ABD), R1, R2 | TUR3150 Eker Süzme |
| `j70-gs2-cowes-2026.html` | J70 GS2 Royal Thames | 9-10 May 2026 | J70 | R1-R7 (2 days) | GBR1942 Lady Khumbu |
| `cape31-porto-cervo-2026.html` | Porto Cervo, Sardinia | 23-25 Apr 2026 | Cape 31 | Practice + R1-R7 | GER3156 La Pericolosa |

### Puntaldia Specifics
- Event ID: `XoD82gqmlIzj8SXFJfFe`, division `C31`
- Timezone: CEST (UTC+2)
- 14 boats. Telemetry race 1 (15:45 CEST) = abandoned. Scored R1 = tele race 2 (16:42). Scored R2 = tele race 3 (17:41).
- Hatari (hull 83, entry sail GER 3183) transmits as `GER3138` — device config typo
- Mark SNs: RC=28142 (3m from committee boat device 28335), PIN=28320, WW gate=28249/27947
- `RACE_LABEL_MAP = { 1: 'R1 (ABD)', 2: 'R1', 3: 'R2' }`

### J70 GS2 Cowes Specifics
- Event ID: `eTg9LhKGLTtOVD9f01Gb`, division `J70_GS2`
- Timezone: BST (UTC+1)
- 23 boats. R2 (14:18:43 gun) had incomplete telemetry — shown blank.
- Mark SNs: RC=25966, PIN=25935 (SN 25937 co-located at PIN end)
- Mark distance check active (>400m = skip configured SNs) — handles line reset between races
- Day 2 races are tele races 5, 6, 7 (raceDay=3)
- XV Manta = GBR881, Lightfoot Racing Spirit = GBR1381

### Porto Cervo Specifics
- Event ID: `Wz4a9bhZz4qmu3Li7Yrm`, division `C31`
- Timezone: CEST (UTC+2)
- 14 boats. 3 days: Practice (raceDay 2), Day 1 (raceDay 3), Day 2 (raceDay 4)
- This file uses an older Cape 31 boat shape and slightly different table design

---

## Creating a New Event Report

1. **Copy** the J70 file: `cp events/j70/j70-gs2-cowes-2026.html events/<class>/<new-file>.html`
2. **Probe telemetry** to find gun times (see auto-detection section above)
3. **Update config** at top of file:
   - `REGATTA_TITLE`, `REGATTA_SUBTITLE`
   - `EVENTS` array with correct `id`, `division`, `tz`, `tzOffset`, `raceDay`, `dayStart/End`, `knownGuns`
   - `EXCLUDED_BOATS` (RC boat sail = `'001'` typically)
   - `BOATS_ALL` (all competitor sail numbers from telemetry, minus excluded)
   - `COL` (focal boat = `'#ff4444'`, all others = `'#22c55e'`)
   - `TEAM_NAMES`
   - `GATE_SNS` (probe marks, verify with perpendicular distance test)
   - `OFFICIAL_RESULTS_BY_DAY`
   - `BOAT_LOA`, `BOAT_BEAM`, `BOAT_CLASS`
   - Focal boat sail in `reachRankColor()`, `gunMapBoatColor()`, and `renderStartR()` row highlight
4. **Fix `<title>` tag**
5. **Add to `index.html`** EVENT_DB
6. **Syntax check:** `node --check <file>.js` (extract scripts first)
7. **Push:** `git add . && git commit -m "..." && git push origin main`

---

## Common Bugs & Fixes

| Bug | Cause | Fix |
|---|---|---|
| `Can't find variable: tracks` | `startReplayLayout` missing destructure | Add `const {tracks, gunTs} = rd;` at top of function |
| `Can't find variable: trajCx` | `tX`/`tY` replacement leaked into `drawGunR`/`drawT50`/`drawT50R` | Restore `const tX=rx=>plotCX+(rx-cxOff)*scale` in those functions |
| `Math.min(...allRxs)` crash | Stack overflow on large spread | Use `_expand()` loop pattern instead |
| All boats OCS | Wrong sign direction in DTL calc | Swap RC/PIN in GATE_SNS — reverses A→B direction |
| OCS from wrong mark pair | Windward gate SNs used as start line | Fleet 60-200m behind a pair = windward gate, not start line |
| Day AVG table empty | `_dayIdx` is 0-based but results keyed 1-based | Lookup: `OFFICIAL_RESULTS_BY_DAY[di] || OFFICIAL_RESULTS_BY_DAY[di+1]` |
| Replay blank/wrong scale | `trajCx`/`trajCy` not defined when `tX`/`tY` called | Ensure bounding box block runs before `tX`/`tY` definition |
| R2 gun time off | Stated time vs actual telemetry in_progress differ | Use actual `in_progress` ms from telemetry |

---

## Workflow Notes

- **No testing needed from Claude** — Sam tests in browser and reports errors
- **Syntax check** before every push: extract `<script>` blocks, run `node --check`
- **Cache busting:** increment `?v=N` in URL to force reload; Pages takes 60-90s to deploy
- **GitHub Pages** serves from `main` branch root
- All changes go to the same file being modified — no separate build step
