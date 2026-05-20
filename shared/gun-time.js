// VRS Sailing Tools — Gun Time Resolver
// Provides a source hierarchy for start times so report code can distinguish
// official values from telemetry-derived fallbacks.

/**
 * Resolve the best available gun time for a race.
 * Priority: manual override > official/Firestore > RaceSense metadata > telemetry fallback.
 */
export function resolveGunTime({ raceNumber, manualGunTs, officialGuns, metadataGunTs, telemetryGunTs }) {
  if (Number.isFinite(manualGunTs)) {
    return result(manualGunTs, 'manual', 'high', 'Manual override supplied in event config');
  }

  const official = findOfficialGun(raceNumber, officialGuns);
  if (Number.isFinite(official)) {
    return result(official, 'official', 'high', 'Official/Firestore start time');
  }

  if (Number.isFinite(metadataGunTs)) {
    return result(metadataGunTs, 'metadata', 'medium', 'Race metadata start time');
  }

  if (Number.isFinite(telemetryGunTs)) {
    return result(telemetryGunTs, 'telemetry-fallback', 'low', 'Telemetry stage transition fallback');
  }

  return {
    ts: null,
    source: 'missing',
    confidence: 'none',
    warning: 'No usable gun time found'
  };
}

export function findOfficialGun(raceNumber, officialGuns) {
  if (!Array.isArray(officialGuns)) return null;
  for (const item of officialGuns) {
    if (Array.isArray(item) && Number(item[0]) === Number(raceNumber)) return Number(item[1]);
    if (Number(item?.raceNumber) === Number(raceNumber)) return Number(item.gunTs ?? item.ts ?? item.startTime);
  }
  return null;
}

function result(ts, source, confidence, note) {
  return { ts, source, confidence, note, warning: null };
}
