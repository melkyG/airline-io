const SIMULATION_MS_PER_REAL_SECOND = 15000 * 1000;

const WORLD_EVENT_NEUTRAL_FACTOR = 1.0;
const WORLD_EVENT_TYPE_TRAVEL_BOOM = 'travel-boom';
const WORLD_EVENT_TYPE_TRAVEL_SLUMP = 'travel-slump';
const WORLD_EVENT_TYPE_MAJOR_SPORTING_EVENT = 'major-sporting-event';

const WORLD_EVENT_STATUS_SCHEDULED = 'scheduled';
const WORLD_EVENT_STATUS_ACTIVE = 'active';
const WORLD_EVENT_STATUS_FINISHED = 'finished';
const WORLD_EVENT_STATUS_EXPIRED = 'expired';

const WORLD_EVENT_OUTCOME_OCCURRED = 'occurred';
const WORLD_EVENT_OUTCOME_DID_NOT_OCCUR = 'did-not-occur';

// Spontaneous daily Boom/Slump trigger constants (real-sec equivalents at 12500x).
const WORLD_EVENT_DAY_SIMULATION_MS = 24 * 60 * 60 * 1000;
const WORLD_EVENT_DAILY_TRIGGER_PROBABILITY = 0.2;
const WORLD_EVENT_BOOM_PROBABILITY = 0.5;
// Real-time-intent duration ranges (real seconds; converted via the game's speed multiplier).
const TRAVEL_EVENT_ONSET_MIN_REAL_SECONDS = 15;
const TRAVEL_EVENT_ONSET_MAX_REAL_SECONDS = 30;
const TRAVEL_EVENT_HOLD_MIN_REAL_SECONDS = 25;
const TRAVEL_EVENT_HOLD_MAX_REAL_SECONDS = 60;
const TRAVEL_EVENT_DECAY_MIN_REAL_SECONDS = 30;
const TRAVEL_EVENT_DECAY_MAX_REAL_SECONDS = 60;
const TRAVEL_BOOM_PEAK_MIN_FACTOR = 1.35;
const TRAVEL_BOOM_PEAK_MAX_FACTOR = 1.65;
const TRAVEL_SLUMP_PEAK_MIN_FACTOR = 0.55;
const TRAVEL_SLUMP_PEAK_MAX_FACTOR = 0.8;

// Lifecycle values for scheduled Major Sporting Events.
// Onset/decay are real-time intent (real seconds); hold is simulation-calendar intent.
const SPORTING_EVENT_ONSET_MIN_REAL_SECONDS = 20;
const SPORTING_EVENT_ONSET_MAX_REAL_SECONDS = 30;
const SPORTING_EVENT_HOLD_SIMULATION_MS = 30 * WORLD_EVENT_DAY_SIMULATION_MS;
const SPORTING_EVENT_DECAY_MIN_REAL_SECONDS = 30;
const SPORTING_EVENT_DECAY_MAX_REAL_SECONDS = 60;
const SPORTING_EVENT_DEFAULT_PEAK_FACTOR = 1.4;
const SPORTING_EVENT_PEAK_MIN_FACTOR = 1.9;
const SPORTING_EVENT_PEAK_MAX_FACTOR = 2.35;
const SPORTING_EVENT_DEFAULT_ANNOUNCE_LEAD_SIMULATION_MS = WORLD_EVENT_DAY_SIMULATION_MS;

function normalizeDurationSimulationMs(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function createWorldEvent({
  id,
  type,
  countries,
  candidateAtSimulationMs,
  probability = 1.0,
  resolutionAtSimulationMs,
  announceAtSimulationMs,
  announcementEmitted = false,
  onsetDurationSimulationMs = 0,
  holdDurationSimulationMs = 0,
  decayDurationSimulationMs = 0,
  peakFactor = WORLD_EVENT_NEUTRAL_FACTOR,
  status = WORLD_EVENT_STATUS_SCHEDULED,
  resolvedOutcome = null,
  startedAtSimulationMs = null
} = {}) {
  const normalizedCandidateAt = Number.isFinite(candidateAtSimulationMs) ? candidateAtSimulationMs : null;
  const normalizedResolutionAt = Number.isFinite(resolutionAtSimulationMs)
    ? resolutionAtSimulationMs
    : normalizedCandidateAt;

  return {
    id: typeof id === 'string' && id.trim().length > 0 ? id.trim() : null,
    type: typeof type === 'string' && type.trim().length > 0 ? type.trim() : null,
    countries: Array.isArray(countries)
      ? countries.map((country) => String(country || '').trim()).filter(Boolean)
      : [],
    candidateAtSimulationMs: normalizedCandidateAt,
    probability: Number.isFinite(probability) ? Math.max(0, Math.min(1, probability)) : 1.0,
    resolutionAtSimulationMs: normalizedResolutionAt,
    announceAtSimulationMs: Number.isFinite(announceAtSimulationMs) ? announceAtSimulationMs : null,
    announcementEmitted: announcementEmitted === true,
    onsetDurationSimulationMs: normalizeDurationSimulationMs(onsetDurationSimulationMs),
    holdDurationSimulationMs: normalizeDurationSimulationMs(holdDurationSimulationMs),
    decayDurationSimulationMs: normalizeDurationSimulationMs(decayDurationSimulationMs),
    peakFactor: Number.isFinite(peakFactor) ? peakFactor : WORLD_EVENT_NEUTRAL_FACTOR,
    status: typeof status === 'string' ? status : WORLD_EVENT_STATUS_SCHEDULED,
    resolvedOutcome,
    startedAtSimulationMs: Number.isFinite(startedAtSimulationMs) ? startedAtSimulationMs : null
  };
}

function lerp(min, max, roll) {
  return min + (max - min) * roll;
}

function resolveSimMsPerRealSecond(simulationSpeedMultiplier) {
  return (Number.isFinite(simulationSpeedMultiplier) && simulationSpeedMultiplier > 0
    ? simulationSpeedMultiplier
    : 12500) * 1000;
}

function createSpontaneousTravelEvent({ id, type, country, startedAtSimulationMs, rng, simulationSpeedMultiplier } = {}) {
  const normalizedType = type === WORLD_EVENT_TYPE_TRAVEL_SLUMP
    ? WORLD_EVENT_TYPE_TRAVEL_SLUMP
    : WORLD_EVENT_TYPE_TRAVEL_BOOM;

  const nextRoll = () => {
    const value = typeof rng === 'function' ? rng() : Math.random();
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  };

  const strengthRoll = nextRoll();
  const peakMin = normalizedType === WORLD_EVENT_TYPE_TRAVEL_SLUMP
    ? TRAVEL_SLUMP_PEAK_MIN_FACTOR
    : TRAVEL_BOOM_PEAK_MIN_FACTOR;
  const peakMax = normalizedType === WORLD_EVENT_TYPE_TRAVEL_SLUMP
    ? TRAVEL_SLUMP_PEAK_MAX_FACTOR
    : TRAVEL_BOOM_PEAK_MAX_FACTOR;
  const peakFactor = lerp(peakMin, peakMax, strengthRoll);

  const onsetRoll = nextRoll();
  const holdRoll = nextRoll();
  const decayRoll = nextRoll();
  const simMsPerRealSecond = resolveSimMsPerRealSecond(simulationSpeedMultiplier);

  return createWorldEvent({
    id,
    type: normalizedType,
    countries: typeof country === 'string' && country.trim().length > 0 ? [country.trim()] : [],
    candidateAtSimulationMs: startedAtSimulationMs,
    probability: 1.0,
    resolutionAtSimulationMs: startedAtSimulationMs,
    onsetDurationSimulationMs:
      lerp(TRAVEL_EVENT_ONSET_MIN_REAL_SECONDS, TRAVEL_EVENT_ONSET_MAX_REAL_SECONDS, onsetRoll) * simMsPerRealSecond,
    holdDurationSimulationMs:
      lerp(TRAVEL_EVENT_HOLD_MIN_REAL_SECONDS, TRAVEL_EVENT_HOLD_MAX_REAL_SECONDS, holdRoll) * simMsPerRealSecond,
    decayDurationSimulationMs:
      lerp(TRAVEL_EVENT_DECAY_MIN_REAL_SECONDS, TRAVEL_EVENT_DECAY_MAX_REAL_SECONDS, decayRoll) * simMsPerRealSecond,
    peakFactor,
    status: WORLD_EVENT_STATUS_ACTIVE,
    resolvedOutcome: WORLD_EVENT_OUTCOME_OCCURRED,
    startedAtSimulationMs
  });
}

function createMajorSportingEvent({
  id,
  hostCountry,
  eventStartAtSimulationMs,
  announceAtSimulationMs,
  onsetDurationSimulationMs,
  holdDurationSimulationMs = SPORTING_EVENT_HOLD_SIMULATION_MS,
  decayDurationSimulationMs,
  peakFactor = SPORTING_EVENT_DEFAULT_PEAK_FACTOR,
  rng,
  simulationSpeedMultiplier
} = {}) {
  const normalizedStart = Number.isFinite(eventStartAtSimulationMs) ? eventStartAtSimulationMs : null;

  let normalizedAnnounceAt = Number.isFinite(announceAtSimulationMs)
    ? announceAtSimulationMs
    : (Number.isFinite(normalizedStart) ? normalizedStart - SPORTING_EVENT_DEFAULT_ANNOUNCE_LEAD_SIMULATION_MS : null);

  // Announcements must precede the event start.
  if (Number.isFinite(normalizedStart) && Number.isFinite(normalizedAnnounceAt) && normalizedAnnounceAt >= normalizedStart) {
    normalizedAnnounceAt = normalizedStart - 1;
  }
  if (!Number.isFinite(normalizedStart)) {
    normalizedAnnounceAt = null;
  }

  const nextRoll = () => {
    const value = typeof rng === 'function' ? rng() : Math.random();
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  };
  const simMsPerRealSecond = resolveSimMsPerRealSecond(simulationSpeedMultiplier);

  const resolvedOnsetMs = Number.isFinite(onsetDurationSimulationMs)
    ? onsetDurationSimulationMs
    : lerp(SPORTING_EVENT_ONSET_MIN_REAL_SECONDS, SPORTING_EVENT_ONSET_MAX_REAL_SECONDS, nextRoll())
      * simMsPerRealSecond;
  const resolvedDecayMs = Number.isFinite(decayDurationSimulationMs)
    ? decayDurationSimulationMs
    : lerp(SPORTING_EVENT_DECAY_MIN_REAL_SECONDS, SPORTING_EVENT_DECAY_MAX_REAL_SECONDS, nextRoll())
      * simMsPerRealSecond;

  return createWorldEvent({
    id,
    type: WORLD_EVENT_TYPE_MAJOR_SPORTING_EVENT,
    countries: typeof hostCountry === 'string' && hostCountry.trim().length > 0 ? [hostCountry.trim()] : [],
    candidateAtSimulationMs: normalizedStart,
    probability: 1.0,
    resolutionAtSimulationMs: normalizedStart,
    announceAtSimulationMs: normalizedAnnounceAt,
    announcementEmitted: false,
    onsetDurationSimulationMs: resolvedOnsetMs,
    holdDurationSimulationMs,
    decayDurationSimulationMs: resolvedDecayMs,
    peakFactor,
    status: WORLD_EVENT_STATUS_SCHEDULED
  });
}

function isWorldEventBlockingCountry(event, country, simulationNowMs) {
  if (!event || typeof event !== 'object' || event.status !== WORLD_EVENT_STATUS_ACTIVE) {
    return false;
  }
  if (!Number.isFinite(simulationNowMs)) {
    return false;
  }

  const countries = Array.isArray(event.countries) ? event.countries : [];
  if (!countries.includes(country)) {
    return false;
  }

  const startAt = resolveWorldEventStartSimulationMs(event);
  if (!Number.isFinite(startAt)) {
    return false;
  }

  const blockingEnd =
    startAt +
    normalizeDurationSimulationMs(event.onsetDurationSimulationMs) +
    normalizeDurationSimulationMs(event.holdDurationSimulationMs);

  return simulationNowMs < blockingEnd;
}

function resolveWorldEventStartSimulationMs(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }

  if (Number.isFinite(event.startedAtSimulationMs)) {
    return event.startedAtSimulationMs;
  }

  // v1-A: only guaranteed events (probability 1.0) resolve at their candidate time.
  if (event.status === WORLD_EVENT_STATUS_EXPIRED) {
    return null;
  }

  if (Number(event.probability) >= 1 && Number.isFinite(event.candidateAtSimulationMs)) {
    return event.candidateAtSimulationMs;
  }

  return null;
}

function getWorldEventFactorAtTime(event, simulationNowMs) {
  if (!Number.isFinite(simulationNowMs)) {
    return WORLD_EVENT_NEUTRAL_FACTOR;
  }

  const startAt = resolveWorldEventStartSimulationMs(event);
  if (!Number.isFinite(startAt)) {
    return WORLD_EVENT_NEUTRAL_FACTOR;
  }

  const peakFactor = Number.isFinite(event.peakFactor) ? event.peakFactor : WORLD_EVENT_NEUTRAL_FACTOR;
  const onsetDuration = normalizeDurationSimulationMs(event.onsetDurationSimulationMs);
  const holdDuration = normalizeDurationSimulationMs(event.holdDurationSimulationMs);
  const decayDuration = normalizeDurationSimulationMs(event.decayDurationSimulationMs);

  let elapsed = simulationNowMs - startAt;
  if (elapsed < 0) {
    return WORLD_EVENT_NEUTRAL_FACTOR;
  }

  if (elapsed < onsetDuration) {
    return WORLD_EVENT_NEUTRAL_FACTOR + (peakFactor - WORLD_EVENT_NEUTRAL_FACTOR) * (elapsed / onsetDuration);
  }
  elapsed -= onsetDuration;

  if (elapsed < holdDuration) {
    return peakFactor;
  }
  elapsed -= holdDuration;

  if (elapsed < decayDuration) {
    return WORLD_EVENT_NEUTRAL_FACTOR + (peakFactor - WORLD_EVENT_NEUTRAL_FACTOR) * (1 - elapsed / decayDuration);
  }

  return WORLD_EVENT_NEUTRAL_FACTOR;
}

function getWorldEventTotalDurationSimulationMs(event) {
  if (!event || typeof event !== 'object') {
    return 0;
  }

  return (
    normalizeDurationSimulationMs(event.onsetDurationSimulationMs) +
    normalizeDurationSimulationMs(event.holdDurationSimulationMs) +
    normalizeDurationSimulationMs(event.decayDurationSimulationMs)
  );
}

function advanceWorldEventStatus(event, simulationNowMs) {
  if (!event || typeof event !== 'object' || !Number.isFinite(simulationNowMs)) {
    return event;
  }

  if (event.status === WORLD_EVENT_STATUS_FINISHED || event.status === WORLD_EVENT_STATUS_EXPIRED) {
    return event;
  }

  if (event.status === WORLD_EVENT_STATUS_SCHEDULED) {
    const resolutionAt = Number.isFinite(event.resolutionAtSimulationMs)
      ? event.resolutionAtSimulationMs
      : event.candidateAtSimulationMs;

    if (!Number.isFinite(resolutionAt) || simulationNowMs < resolutionAt) {
      return event;
    }

    // v1-A: guaranteed events always occur; probabilistic resolution is not implemented yet.
    if (Number(event.probability) >= 1) {
      event.status = WORLD_EVENT_STATUS_ACTIVE;
      event.resolvedOutcome = WORLD_EVENT_OUTCOME_OCCURRED;
      event.startedAtSimulationMs = resolutionAt;
    } else {
      event.resolvedOutcome = WORLD_EVENT_OUTCOME_DID_NOT_OCCUR;
      event.status = WORLD_EVENT_STATUS_EXPIRED;
      return event;
    }
  }

  if (event.status === WORLD_EVENT_STATUS_ACTIVE) {
    const startedAt = Number.isFinite(event.startedAtSimulationMs) ? event.startedAtSimulationMs : null;
    if (Number.isFinite(startedAt) && simulationNowMs >= startedAt + getWorldEventTotalDurationSimulationMs(event)) {
      event.status = WORLD_EVENT_STATUS_FINISHED;
    }
  }

  return event;
}

class WorldEventEngine {
  constructor(events = []) {
    this.events = Array.isArray(events) ? events : [];
  }

  tick(simulationNowMs) {
    let changed = false;

    for (const event of this.events) {
      if (!event || typeof event !== 'object') {
        continue;
      }

      const previousStatus = event.status;
      const previousOutcome = event.resolvedOutcome;
      advanceWorldEventStatus(event, simulationNowMs);

      if (event.status !== previousStatus || event.resolvedOutcome !== previousOutcome) {
        changed = true;
      }
    }

    return { changed };
  }
}

module.exports = {
  SIMULATION_MS_PER_REAL_SECOND,
  WORLD_EVENT_NEUTRAL_FACTOR,
  WORLD_EVENT_TYPE_TRAVEL_BOOM,
  WORLD_EVENT_TYPE_TRAVEL_SLUMP,
  WORLD_EVENT_TYPE_MAJOR_SPORTING_EVENT,
  SPORTING_EVENT_ONSET_MIN_REAL_SECONDS,
  SPORTING_EVENT_ONSET_MAX_REAL_SECONDS,
  SPORTING_EVENT_HOLD_SIMULATION_MS,
  SPORTING_EVENT_DECAY_MIN_REAL_SECONDS,
  SPORTING_EVENT_DECAY_MAX_REAL_SECONDS,
  SPORTING_EVENT_DEFAULT_PEAK_FACTOR,
  SPORTING_EVENT_PEAK_MIN_FACTOR,
  SPORTING_EVENT_PEAK_MAX_FACTOR,
  resolveSimMsPerRealSecond,
  SPORTING_EVENT_DEFAULT_ANNOUNCE_LEAD_SIMULATION_MS,
  WORLD_EVENT_STATUS_SCHEDULED,
  WORLD_EVENT_STATUS_ACTIVE,
  WORLD_EVENT_STATUS_FINISHED,
  WORLD_EVENT_STATUS_EXPIRED,
  WORLD_EVENT_OUTCOME_OCCURRED,
  WORLD_EVENT_OUTCOME_DID_NOT_OCCUR,
  WORLD_EVENT_DAY_SIMULATION_MS,
  WORLD_EVENT_DAILY_TRIGGER_PROBABILITY,
  WORLD_EVENT_BOOM_PROBABILITY,
  TRAVEL_EVENT_ONSET_MIN_REAL_SECONDS,
  TRAVEL_EVENT_ONSET_MAX_REAL_SECONDS,
  TRAVEL_EVENT_HOLD_MIN_REAL_SECONDS,
  TRAVEL_EVENT_HOLD_MAX_REAL_SECONDS,
  TRAVEL_EVENT_DECAY_MIN_REAL_SECONDS,
  TRAVEL_EVENT_DECAY_MAX_REAL_SECONDS,
  TRAVEL_BOOM_PEAK_MIN_FACTOR,
  TRAVEL_BOOM_PEAK_MAX_FACTOR,
  TRAVEL_SLUMP_PEAK_MIN_FACTOR,
  TRAVEL_SLUMP_PEAK_MAX_FACTOR,
  createWorldEvent,
  createSpontaneousTravelEvent,
  createMajorSportingEvent,
  isWorldEventBlockingCountry,
  resolveWorldEventStartSimulationMs,
  getWorldEventFactorAtTime,
  getWorldEventTotalDurationSimulationMs,
  advanceWorldEventStatus,
  WorldEventEngine
};
