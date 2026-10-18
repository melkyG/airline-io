const test = require('node:test');
const assert = require('node:assert/strict');
const Game = require('../Game');
const { AIRPORT_CATALOG } = require('../airports/catalog');
const {
  WORLD_EVENT_NEUTRAL_FACTOR,
  WORLD_EVENT_TYPE_TRAVEL_BOOM,
  WORLD_EVENT_TYPE_TRAVEL_SLUMP,
  WORLD_EVENT_DAY_SIMULATION_MS,
  WORLD_EVENT_DAILY_TRIGGER_PROBABILITY,
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
  WORLD_EVENT_TYPE_MAJOR_SPORTING_EVENT,
  createSpontaneousTravelEvent,
  createMajorSportingEvent,
  isWorldEventBlockingCountry,
  getWorldEventFactorAtTime
} = require('../world/worldEvents');

const DAY = WORLD_EVENT_DAY_SIMULATION_MS;
function eventTotalDuration(event) {
  return event.onsetDurationSimulationMs + event.holdDurationSimulationMs + event.decayDurationSimulationMs;
}

function eventBlockingDuration(event) {
  return event.onsetDurationSimulationMs + event.holdDurationSimulationMs;
}

const CATALOG_COUNTRIES = [...new Set(AIRPORT_CATALOG.map((a) => a.country).filter(Boolean))];

function createGameState(overrides = {}) {
  return {
    id: 'game-world-events',
    status: 'active',
    createdAt: 100,
    startedAt: 100,
    endsAt: Date.now() + 3600000,
    durationMs: 3600000,
    scoreToWin: 1000,
    simulationStartedAtRealMs: 0,
    simulationStartedAtGameMs: 0,
    simulationSpeedMultiplier: 15000,
    simulationEndedAtGameMs: null,
    worldCalendarStartYear: 2026,
    players: [{ id: 'p1', username: 'Alice', capital: 1000000 }],
    airports: [],
    ownedAircraft: [],
    routes: [],
    flights: [],
    ...overrides
  };
}

function createEmitCapture() {
  const emitted = [];
  const io = {
    to(roomName) {
      const room = {
        emit(eventName, payload) {
          emitted.push({ roomName, eventName, payload });
        }
      };
      room.volatile = room;
      return room;
    }
  };
  return { io, emitted };
}

function createGame({ rng = () => 1, emitted, stateOverrides } = {}) {
  const { io, emitted: captured } = createEmitCapture();
  const manager = { io };
  const game = new Game(createGameState(stateOverrides), manager, { rng });
  game.initializeSimulationClock(0);
  return { game, emitted: emitted || captured };
}

function createBoomEvent(start = 0, overrides = {}) {
  return createSpontaneousTravelEvent({
    id: 'evt-boom',
    type: WORLD_EVENT_TYPE_TRAVEL_BOOM,
    country: 'Canada',
    startedAtSimulationMs: start,
    rng: () => 0,
    ...overrides
  });
}

test('spontaneous Boom event peak stays within 1.35-1.65 and ramps correctly', () => {
  const event = createBoomEvent(0); // rng 0 → minimum peak 1.35

  assert.equal(event.peakFactor, TRAVEL_BOOM_PEAK_MIN_FACTOR);
  assert.equal(event.onsetDurationSimulationMs, TRAVEL_EVENT_ONSET_MIN_REAL_SECONDS * 12500 * 1000);
  assert.equal(event.holdDurationSimulationMs, TRAVEL_EVENT_HOLD_MIN_REAL_SECONDS * 12500 * 1000);
  assert.equal(event.decayDurationSimulationMs, TRAVEL_EVENT_DECAY_MIN_REAL_SECONDS * 12500 * 1000);
  assert.equal(getWorldEventFactorAtTime(event, 0), WORLD_EVENT_NEUTRAL_FACTOR);
  assert.equal(getWorldEventFactorAtTime(event, event.onsetDurationSimulationMs / 2), 1.175);
  assert.equal(getWorldEventFactorAtTime(event, event.onsetDurationSimulationMs), TRAVEL_BOOM_PEAK_MIN_FACTOR);
  assert.equal(
    getWorldEventFactorAtTime(event, eventBlockingDuration(event) - 1),
    TRAVEL_BOOM_PEAK_MIN_FACTOR
  );
  assert.equal(getWorldEventFactorAtTime(event, eventTotalDuration(event)), WORLD_EVENT_NEUTRAL_FACTOR);
});

test('duration rolls map rng 0/0.5/1 to min/mid/max independently per phase', () => {
  const atMin = createSpontaneousTravelEvent({
    id: 'd-min', type: WORLD_EVENT_TYPE_TRAVEL_BOOM, country: 'Canada',
    startedAtSimulationMs: 0, rng: () => 0
  });
  const atMax = createSpontaneousTravelEvent({
    id: 'd-max', type: WORLD_EVENT_TYPE_TRAVEL_BOOM, country: 'Canada',
    startedAtSimulationMs: 0, rng: () => 1
  });
  const atMid = createSpontaneousTravelEvent({
    id: 'd-mid', type: WORLD_EVENT_TYPE_TRAVEL_BOOM, country: 'Canada',
    startedAtSimulationMs: 0, rng: () => 0.5
  });

  const sec = 12500 * 1000;
  assert.equal(atMin.onsetDurationSimulationMs, 15 * sec);
  assert.equal(atMin.holdDurationSimulationMs, 25 * sec);
  assert.equal(atMin.decayDurationSimulationMs, 30 * sec);

  assert.equal(atMax.onsetDurationSimulationMs, 30 * sec);
  assert.equal(atMax.holdDurationSimulationMs, 60 * sec);
  assert.equal(atMax.decayDurationSimulationMs, 60 * sec);

  assert.ok(Math.abs(atMid.onsetDurationSimulationMs - 22.5 * sec) < 1e-6);
  assert.ok(Math.abs(atMid.holdDurationSimulationMs - 42.5 * sec) < 1e-6);
  assert.ok(Math.abs(atMid.decayDurationSimulationMs - 45 * sec) < 1e-6);

  // Strength roll is consumed first; direction/duration rolls stay independent.
  assert.equal(atMin.peakFactor, TRAVEL_BOOM_PEAK_MIN_FACTOR);
  assert.equal(atMax.peakFactor, TRAVEL_BOOM_PEAK_MAX_FACTOR);
});

test('Boom peak range maps RNG 0→1.35 and 1→1.65', () => {
  const min = createSpontaneousTravelEvent({
    id: 'b-min', type: WORLD_EVENT_TYPE_TRAVEL_BOOM, country: 'Canada',
    startedAtSimulationMs: 0, rng: () => 0
  });
  const max = createSpontaneousTravelEvent({
    id: 'b-max', type: WORLD_EVENT_TYPE_TRAVEL_BOOM, country: 'Canada',
    startedAtSimulationMs: 0, rng: () => 1
  });
  const mid = createSpontaneousTravelEvent({
    id: 'b-mid', type: WORLD_EVENT_TYPE_TRAVEL_BOOM, country: 'Canada',
    startedAtSimulationMs: 0, rng: () => 0.5
  });

  assert.ok(Math.abs(min.peakFactor - 1.35) < 1e-9);
  assert.ok(Math.abs(max.peakFactor - 1.65) < 1e-9);
  assert.ok(Math.abs(mid.peakFactor - 1.5) < 1e-9);
  assert.ok(min.peakFactor >= TRAVEL_BOOM_PEAK_MIN_FACTOR && max.peakFactor <= TRAVEL_BOOM_PEAK_MAX_FACTOR);
});

test('Slump peak range maps RNG 0→0.55 and 1→0.80, and dips below neutral', () => {
  const min = createSpontaneousTravelEvent({
    id: 's-min', type: WORLD_EVENT_TYPE_TRAVEL_SLUMP, country: 'Spain',
    startedAtSimulationMs: 0, rng: () => 0
  });
  const max = createSpontaneousTravelEvent({
    id: 's-max', type: WORLD_EVENT_TYPE_TRAVEL_SLUMP, country: 'Spain',
    startedAtSimulationMs: 0, rng: () => 1
  });

  assert.ok(Math.abs(min.peakFactor - 0.55) < 1e-9);
  assert.ok(Math.abs(max.peakFactor - 0.8) < 1e-9);
  assert.ok(min.peakFactor >= TRAVEL_SLUMP_PEAK_MIN_FACTOR && max.peakFactor <= TRAVEL_SLUMP_PEAK_MAX_FACTOR);

  assert.equal(getWorldEventFactorAtTime(min, min.onsetDurationSimulationMs / 2), 0.775);
  assert.equal(getWorldEventFactorAtTime(min, min.onsetDurationSimulationMs), 0.55);
  assert.equal(getWorldEventFactorAtTime(min, eventTotalDuration(min)), WORLD_EVENT_NEUTRAL_FACTOR);
});

test('no Boom/Slump is scheduled at game start (only the scheduled sporting event exists)', () => {
  const { game } = createGame({ rng: () => 1 });
  const travelEvents = game.worldEventEngine.events.filter(
    (e) => e.type === WORLD_EVENT_TYPE_TRAVEL_BOOM || e.type === WORLD_EVENT_TYPE_TRAVEL_SLUMP
  );
  assert.equal(travelEvents.length, 0);
});

test('daily trigger rolls exactly once when a new simulation day begins', () => {
  let rolls = 0;
  const rng = () => { rolls += 1; return 0.5; };
  const { game } = createGame({ rng });
  rolls = 0; // ignore rolls consumed by initialization scheduling

  game.maybeTriggerDailyWorldEvent(DAY - 1);
  assert.equal(rolls, 0); // same day 0, no roll

  game.maybeTriggerDailyWorldEvent(DAY);
  assert.equal(rolls, 1); // day 1 boundary → one roll (0.5 → no event)

  game.maybeTriggerDailyWorldEvent(DAY + 1000);
  assert.equal(rolls, 1); // still day 1 → no second roll

  game.maybeTriggerDailyWorldEvent(2 * DAY);
  assert.equal(rolls, 2); // day 2 boundary → second roll
});

test('forced RNG triggers an event on a day boundary; non-trigger roll does not', () => {
  const { game: noTrigger } = createGame({ rng: () => 0.5 });
  const noTriggerBaseline = noTrigger.worldEventEngine.events.length;
  noTrigger.maybeTriggerDailyWorldEvent(DAY);
  assert.equal(noTrigger.worldEventEngine.events.length, noTriggerBaseline);

  const { game: trigger } = createGame({ rng: () => 0 });
  const triggerBaseline = trigger.worldEventEngine.events.length;
  trigger.maybeTriggerDailyWorldEvent(DAY);
  assert.equal(trigger.worldEventEngine.events.length, triggerBaseline + 1);
});

test('daily trigger threshold is 20% (rolls below 0.2 trigger, 0.2 does not)', () => {
  const { game: below } = createGame({ rng: () => 0.19 });
  const belowBaseline = below.worldEventEngine.events.length;
  below.maybeTriggerDailyWorldEvent(DAY);
  assert.equal(below.worldEventEngine.events.length, belowBaseline + 1);

  const { game: at } = createGame({ rng: () => 0.2 });
  const atBaseline = at.worldEventEngine.events.length;
  at.maybeTriggerDailyWorldEvent(DAY);
  assert.equal(at.worldEventEngine.events.length, atBaseline);
});

test('at most one new Boom/Slump is created per simulation day', () => {
  const { game } = createGame({ rng: () => 0 });
  const baseline = game.worldEventEngine.events.length;
  game.maybeTriggerDailyWorldEvent(DAY);
  game.maybeTriggerDailyWorldEvent(DAY + 1);
  game.maybeTriggerDailyWorldEvent(DAY + DAY - 1);
  assert.equal(game.worldEventEngine.events.length, baseline + 1);
  game.maybeTriggerDailyWorldEvent(2 * DAY);
  assert.equal(game.worldEventEngine.events.length, baseline + 2);
});

test('triggered event uses an eligible country from the airport catalog', () => {
  const { game } = createGame({ rng: () => 0 });
  const event = game.maybeTriggerDailyWorldEvent(DAY);
  assert.ok(event);
  assert.equal(event.countries.length, 1);
  assert.ok(CATALOG_COUNTRIES.includes(event.countries[0]));
  assert.equal(event.type, WORLD_EVENT_TYPE_TRAVEL_BOOM); // rng 0 < 0.5 → Boom
});

test('RNG direction split picks Boom below 0.5 and Slump at/above 0.5', () => {
  // Init consumes: count, start, then host/strength/lead/onset/decay; then trigger: trigger, country, direction.
  const boomRng = (() => { const seq = [0, 0.5, 0, 0.5, 0.5, 0.5, 0.5, 0, 0, 0]; let i = 0; return () => seq[i++] ?? 0; })();
  const { game } = createGame({ rng: boomRng });
  game.maybeTriggerDailyWorldEvent(DAY);
  const last = game.worldEventEngine.events[game.worldEventEngine.events.length - 1];
  assert.equal(last.type, WORLD_EVENT_TYPE_TRAVEL_BOOM);

  const slumpRng = (() => { const seq = [0, 0.5, 0, 0.5, 0.5, 0.5, 0.5, 0, 0, 0.9]; let i = 0; return () => seq[i++] ?? 0.9; })();
  const { game: game2 } = createGame({ rng: slumpRng });
  game2.maybeTriggerDailyWorldEvent(DAY);
  const last2 = game2.worldEventEngine.events[game2.worldEventEngine.events.length - 1];
  assert.equal(last2.type, WORLD_EVENT_TYPE_TRAVEL_SLUMP);
});

test('onset/hold blocks the same country; decay does not', () => {
  const event = createBoomEvent(0);

  const blockingEnd = eventBlockingDuration(event);
  assert.equal(isWorldEventBlockingCountry(event, 'Canada', 0), true);
  assert.equal(isWorldEventBlockingCountry(event, 'Canada', event.onsetDurationSimulationMs + 1), true);
  assert.equal(isWorldEventBlockingCountry(event, 'Canada', blockingEnd - 1), true);
  // decay phase → eligible again
  assert.equal(isWorldEventBlockingCountry(event, 'Canada', blockingEnd + 1), false);
  assert.equal(isWorldEventBlockingCountry(event, 'Canada', eventTotalDuration(event) + 1), false);
  // different country never blocked
  assert.equal(isWorldEventBlockingCountry(event, 'Spain', 0), false);
  // non-active event never blocks
  assert.equal(isWorldEventBlockingCountry({ ...event, status: 'finished' }, 'Canada', 0), false);
});

test('a country in onset cannot receive a second event; another country still can', () => {
  const firstCountry = CATALOG_COUNTRIES[0];
  const game2emitted = [];
  const rng = () => 0; // always trigger, always first eligible, always boom
  const { io } = createEmitCapture();
  const game = new Game(createGameState(), { io }, { rng });
  game.initializeSimulationClock(0);

  // Seed a blocking event on the catalog's first country.
  game.worldEventEngine.events.push(
    createSpontaneousTravelEvent({
      id: 'seeded',
      type: WORLD_EVENT_TYPE_TRAVEL_BOOM,
      country: firstCountry,
      startedAtSimulationMs: DAY
    })
  );

  const event = game.maybeTriggerDailyWorldEvent(DAY + 1);
  assert.ok(event);
  assert.notEqual(event.countries[0], firstCountry);

  // When every country is blocked, no event is created.
  for (const country of CATALOG_COUNTRIES) {
    game.worldEventEngine.events.push(
      createSpontaneousTravelEvent({
        id: `block-${country}`,
        type: WORLD_EVENT_TYPE_TRAVEL_BOOM,
        country,
        startedAtSimulationMs: 2 * DAY
      })
    );
  }
  const count = game.worldEventEngine.events.length;
  const blocked = game.maybeTriggerDailyWorldEvent(2 * DAY + 1);
  assert.equal(blocked, null);
  assert.equal(game.worldEventEngine.events.length, count);
});

test('triggered event emits one game:event log entry to the game room with world time', () => {
  const { io, emitted } = createEmitCapture();
  const game = new Game(createGameState(), { io }, { rng: () => 0 });
  game.initializeSimulationClock(0);
  emitted.length = 0;

  const event = game.maybeTriggerDailyWorldEvent(DAY);
  assert.ok(event);

  const gameEvents = emitted.filter((e) => e.eventName === 'game:event');
  assert.equal(gameEvents.length, 1);
  const payload = gameEvents[0].payload;
  assert.equal(payload.type, 'world:event');
  assert.equal(payload.worldElapsedSimulationMs, DAY);
  assert.equal(payload.gameId, 'game-world-events');
  assert.match(payload.data.message, /^Travel (Boom|Slump) in /);
  assert.equal(payload.data.country, event.countries[0]);
  assert.equal(payload.data.eventType, event.type);
});

test('spontaneous events drive country profit factors through the existing update path', () => {
  const { game } = createGame({ rng: () => 0 });

  game.maybeTriggerDailyWorldEvent(DAY);
  const event = game.worldEventEngine.events[game.worldEventEngine.events.length - 1];
  const country = event.countries[0];

  game.updateWorldEventFactors(DAY + event.onsetDurationSimulationMs);
  assert.equal(game.authoritativeState.world.countryProfitFactors[country], TRAVEL_BOOM_PEAK_MIN_FACTOR);

  game.updateWorldEventFactors(DAY + eventTotalDuration(event) + 1);
  assert.equal(game.authoritativeState.world.countryProfitFactors[country], undefined);
});

test('daily trigger requires an active game and finite sim time', () => {
  const { game } = createGame({ rng: () => 0 });
  game.status = 'ended';
  const baseline = game.worldEventEngine.events.length;
  assert.equal(game.maybeTriggerDailyWorldEvent(DAY), null);
  assert.equal(game.worldEventEngine.events.length, baseline);

  const { game: game2 } = createGame({ rng: () => 0 });
  assert.equal(game2.maybeTriggerDailyWorldEvent(NaN), null);
});

test('createMajorSportingEvent produces a scheduled guaranteed event with the required shape', () => {
  const event = createMajorSportingEvent({
    id: 'sport-1',
    hostCountry: 'France',
    eventStartAtSimulationMs: 5 * DAY,
    announceAtSimulationMs: 4 * DAY
  });

  assert.equal(event.type, WORLD_EVENT_TYPE_MAJOR_SPORTING_EVENT);
  assert.equal(event.type, 'major-sporting-event');
  assert.equal(event.status, 'scheduled');
  assert.equal(event.probability, 1.0);
  assert.equal(event.announcementEmitted, false);
  assert.deepEqual(event.countries, ['France']);
  assert.equal(event.candidateAtSimulationMs, 5 * DAY);
  assert.equal(event.resolutionAtSimulationMs, event.candidateAtSimulationMs);
  assert.equal(event.announceAtSimulationMs, 4 * DAY);
  assert.ok(event.announceAtSimulationMs < event.candidateAtSimulationMs);
  assert.equal(event.resolvedOutcome, null);
  assert.equal(event.startedAtSimulationMs, null);
  assert.ok(event.onsetDurationSimulationMs > 0);
  assert.ok(event.holdDurationSimulationMs > 0);
  assert.ok(event.decayDurationSimulationMs > 0);
  assert.ok(Number.isFinite(event.peakFactor));
});

test('createMajorSportingEvent defaults announce lead and enforces announce-before-start', () => {
  const withDefault = createMajorSportingEvent({
    id: 'sport-2',
    hostCountry: 'Japan',
    eventStartAtSimulationMs: 5 * DAY
  });
  assert.equal(withDefault.announceAtSimulationMs, 5 * DAY - DAY);

  const reversed = createMajorSportingEvent({
    id: 'sport-3',
    hostCountry: 'Japan',
    eventStartAtSimulationMs: 5 * DAY,
    announceAtSimulationMs: 6 * DAY
  });
  assert.ok(reversed.announceAtSimulationMs < reversed.candidateAtSimulationMs);

  const missingStart = createMajorSportingEvent({
    id: 'sport-4',
    hostCountry: 'Japan',
    announceAtSimulationMs: 3 * DAY
  });
  assert.equal(missingStart.candidateAtSimulationMs, null);
  assert.equal(missingStart.announceAtSimulationMs, null);
});

test('scheduled sporting events stay server-private and neutral until they start', () => {
  const { game } = createGame({ rng: () => 1 });
  const event = createMajorSportingEvent({
    id: 'sport-5',
    hostCountry: 'Spain',
    eventStartAtSimulationMs: 5 * DAY,
    announceAtSimulationMs: 4 * DAY
  });
  game.worldEventEngine.events.push(event);

  // Scheduled → factor stays neutral and nothing enters public state.
  game.updateWorldEventFactors(DAY);
  assert.equal(game.authoritativeState.world.countryProfitFactors.Spain, undefined);

  const publicState = game.getPublicState();
  assert.equal(JSON.stringify(publicState.game).includes('sport-5'), false);
  assert.equal(JSON.stringify(publicState.game).includes('major-sporting-event'), false);

  // It activates at its scheduled start through the existing scheduled path.
  game.worldEventEngine.tick(event.candidateAtSimulationMs);
  assert.equal(event.status, 'active');
  assert.equal(event.startedAtSimulationMs, event.candidateAtSimulationMs);
  game.updateWorldEventFactors(event.candidateAtSimulationMs + event.onsetDurationSimulationMs);
  assert.equal(game.authoritativeState.world.countryProfitFactors.Spain, event.peakFactor);
});

test('sporting event announces exactly once at announceAt and does not activate early', () => {
  const { io, emitted } = createEmitCapture();
  const game = new Game(createGameState(), { io }, { rng: () => 1 });
  game.initializeSimulationClock(0);
  emitted.length = 0;

  const event = game.worldEventEngine.events.find(
    (e) => e.type === WORLD_EVENT_TYPE_MAJOR_SPORTING_EVENT
  );
  assert.ok(event);
  const leadSimMs = event.candidateAtSimulationMs - event.announceAtSimulationMs;
  const leadRealMinutes = leadSimMs / (15000 * 1000 * 60);
  assert.ok(leadRealMinutes >= 2 && leadRealMinutes <= 3,
    `announce lead ${leadRealMinutes} real minutes should be in [2, 3]`);

  // Before announceAt: no emit, still scheduled.
  game.updateWorldEventFactors(event.announceAtSimulationMs - 1);
  assert.equal(emitted.filter((e) => e.eventName === 'game:event').length, 0);
  assert.equal(event.announcementEmitted, false);
  assert.equal(event.status, 'scheduled');

  // At announceAt: exactly one announcement, still scheduled (not activated early).
  game.updateWorldEventFactors(event.announceAtSimulationMs);
  const announcements = emitted.filter((e) => e.eventName === 'game:event');
  assert.equal(announcements.length, 1);
  assert.equal(announcements[0].payload.type, 'world:event');
  assert.match(
    announcements[0].payload.data.message,
    new RegExp(`^Major Sporting Event announced in ${event.countries[0]} for [A-Z][a-z]{2} \\d{4}$`)
  );
  assert.equal(announcements[0].payload.data.country, event.countries[0]);
  assert.equal(announcements[0].payload.data.eventType, 'major-sporting-event');
  assert.equal(announcements[0].payload.worldElapsedSimulationMs, event.announceAtSimulationMs);
  assert.equal(event.announcementEmitted, true);
  assert.equal(event.status, 'scheduled');
  assert.equal(event.startedAtSimulationMs, null);

  // Further ticks never re-emit.
  game.updateWorldEventFactors(event.announceAtSimulationMs + 1);
  game.updateWorldEventFactors(event.announceAtSimulationMs + 10 * DAY);
  assert.equal(emitted.filter((e) => e.eventName === 'game:event').length, 1);

  // Activation still occurs only at the scheduled start.
  game.updateWorldEventFactors(event.candidateAtSimulationMs);
  assert.equal(event.status, 'active');
  assert.equal(event.startedAtSimulationMs, event.candidateAtSimulationMs);
});

test('formatWorldCalendarMonthYear derives Mon YYYY from the world calendar', () => {
  const { game } = createGame({ rng: () => 0 }); // → 1 event at earliest start
  const DAY_MS = 24 * 60 * 60 * 1000;

  assert.equal(game.formatWorldCalendarMonthYear(0), 'Jan 2026');           // day 0
  assert.equal(game.formatWorldCalendarMonthYear(29 * DAY_MS), 'Jan 2026'); // day 29
  assert.equal(game.formatWorldCalendarMonthYear(30 * DAY_MS), 'Feb 2026'); // month 2
  assert.equal(game.formatWorldCalendarMonthYear(359 * DAY_MS), 'Dec 2026');// day 359
  assert.equal(game.formatWorldCalendarMonthYear(360 * DAY_MS), 'Jan 2027');// year rollover
  assert.equal(game.formatWorldCalendarMonthYear(365 * DAY_MS), 'Jan 2027');

  // Sporting event start (rng 0 → 5 real-min offset ≈ 52 sim days) → Feb of start year.
  const event = game.worldEventEngine.events.find(
    (e) => e.type === WORLD_EVENT_TYPE_MAJOR_SPORTING_EVENT
  );
  assert.equal(game.formatWorldCalendarMonthYear(event.candidateAtSimulationMs), 'Feb 2026');

  // Missing/invalid inputs → null (message falls back to no date).
  assert.equal(game.formatWorldCalendarMonthYear(NaN), null);
  assert.equal(game.formatWorldCalendarMonthYear(-1), null);
});

const SPORTING_EVENT_HOSTS = [
  'United States', 'Canada', 'Brazil', 'United Kingdom', 'France', 'Germany',
  'Spain', 'Italy', 'Japan', 'China', 'South Korea', 'Australia', 'Mexico',
  'Argentina', 'Turkey', 'Saudi Arabia', 'South Africa'
];

const SIM_MIN = 60 * 15000 * 1000;
const SPORT_EARLIEST = 5 * SIM_MIN;
const SPORT_LATEST = 33 * SIM_MIN;
const SPORT_MIN_GAP = 8 * SIM_MIN;

function getSportingEvents(game) {
  return game.worldEventEngine.events.filter(
    (e) => e.type === WORLD_EVENT_TYPE_MAJOR_SPORTING_EVENT
  );
}

test('initialization schedules 1-3 sporting events, sorted, in the 5-33 minute window, 8-minute spaced', () => {
  // Count roll 0 → 1 event.
  const one = createGame({ rng: () => 0 }).game;
  assert.equal(getSportingEvents(one).length, 1);

  // Deterministic 3 events: count roll 0.99 → 3, then spread start rolls.
  const seq = [0.99, 0.0, 0.5, 1.0];
  let i = 0;
  const rng = () => seq[i++] ?? 0.5;
  const three = createGame({ rng }).game;
  const events = getSportingEvents(three);
  assert.equal(events.length, 3);

  for (const e of events) {
    assert.equal(e.status, 'scheduled');
    assert.equal(e.countries.length, 1);
    assert.ok(SPORTING_EVENT_HOSTS.includes(e.countries[0]), `host ${e.countries[0]} is approved`);
    assert.equal(e.resolutionAtSimulationMs, e.candidateAtSimulationMs);
    assert.equal(e.announcementEmitted, false);
    const offset = e.candidateAtSimulationMs; // sim start = 0
    assert.ok(offset >= SPORT_EARLIEST, `start ${offset} >= earliest`);
    assert.ok(offset <= SPORT_LATEST, `start ${offset} <= latest`);
  }

  const starts = events.map((e) => e.candidateAtSimulationMs);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  for (let j = 1; j < starts.length; j += 1) {
    assert.ok(starts[j] - starts[j - 1] >= SPORT_MIN_GAP, 'minimum 8-minute spacing');
  }
});

test('sporting event count is always within 1-3 across rng extremes', () => {
  for (const roll of [0, 0.25, 0.5, 0.75, 0.999]) {
    const seq = [roll, 0.1, 0.5, 0.9, 0.3, 0.7];
    let i = 0;
    const { game } = createGame({ rng: () => seq[i++] ?? 0.5 });
    const count = getSportingEvents(game).length;
    assert.ok(count >= 1 && count <= 3, `count ${count} for roll ${roll}`);
  }
});

test('each scheduled sporting event draws an independent host from the approved list', () => {
  // count→3, starts spread, then per-event (host, strength, lead, onset, decay) roll groups.
  const seq = [
    0.99, 0.0, 0.5, 0.999,
    0.0, 0.5, 0.5, 0.5, 0.5,
    0.5, 0.5, 0.5, 0.5, 0.5,
    0.999, 0.5, 0.5, 0.5, 0.5
  ];
  let i = 0;
  const { game } = createGame({ rng: () => seq[i++] ?? 0.5 });
  const events = getSportingEvents(game);
  assert.equal(events.length, 3);
  const hosts = events.map((e) => e.countries[0]);
  for (const host of hosts) {
    assert.ok(SPORTING_EVENT_HOSTS.includes(host));
  }
  assert.equal(new Set(hosts).size, 3);
  assert.equal(hosts[0], 'United States');
  assert.equal(hosts[2], 'South Africa');
});

test('sporting event peak factor is drawn from 1.90-2.35 via injected RNG', () => {
  // Roll order per event: count, start, host, strength.
  const cases = [
    { seq: [0, 0, 0, 0], expected: 1.9 },
    { seq: [0, 0, 0, 0.5], expected: 2.125 },
    { seq: [0, 0, 0, 0.999], expected: 1.9 + 0.45 * 0.999 }
  ];

  for (const { seq, expected } of cases) {
    let i = 0;
    const { game } = createGame({ rng: () => seq[i++] ?? 0.5 });
    const events = getSportingEvents(game);
    assert.equal(events.length, 1);
    assert.ok(Math.abs(events[0].peakFactor - expected) < 1e-3, `peak ${events[0].peakFactor} ≈ ${expected}`);
  }

  // All generated strengths stay inside the range.
  for (const roll of [0, 0.2, 0.4, 0.6, 0.8, 0.999]) {
    let i = 0;
    const seq = [0, 0.5, 0.5, roll];
    const { game } = createGame({ rng: () => seq[i++] ?? 0.5 });
    const peak = getSportingEvents(game)[0].peakFactor;
    assert.ok(peak >= 1.9 && peak <= 2.35, `peak ${peak} in [1.9, 2.35]`);
  }
});

test('sporting event onset/decay randomize within range; hold is exactly 30 sim days', () => {
  // Roll order per event: count, start, host, strength, announceLead, onset, decay.
  const cases = [
    { onset: 0, decay: 0, expectedOnset: 20, expectedDecay: 30 },
    { onset: 0.5, decay: 0.5, expectedOnset: 25, expectedDecay: 45 },
    { onset: 0.999, decay: 0.999, expectedOnset: 20 + 10 * 0.999, expectedDecay: 30 + 30 * 0.999 }
  ];

  const SEC = 15000 * 1000;
  for (const { onset, decay, expectedOnset, expectedDecay } of cases) {
    const seq = [0, 0.5, 0, 0.5, 0.5, onset, decay];
    let i = 0;
    const { game } = createGame({ rng: () => seq[i++] ?? 0.5 });
    const event = getSportingEvents(game)[0];
    assert.ok(Math.abs(event.onsetDurationSimulationMs - expectedOnset * SEC) < 1e-3,
      `onset ${event.onsetDurationSimulationMs} ≈ ${expectedOnset * SEC}`);
    assert.ok(Math.abs(event.decayDurationSimulationMs - expectedDecay * SEC) < 1e-3,
      `decay ${event.decayDurationSimulationMs} ≈ ${expectedDecay * SEC}`);
    assert.equal(event.holdDurationSimulationMs, 30 * DAY);
    assert.ok(event.onsetDurationSimulationMs >= 20 * SEC && event.onsetDurationSimulationMs <= 30 * SEC);
    assert.ok(event.decayDurationSimulationMs >= 30 * SEC && event.decayDurationSimulationMs <= 60 * SEC);
  }
});

test('repeated scheduling does not duplicate sporting events', () => {
  const { game } = createGame({ rng: () => 0 });
  game.ensureScheduledWorldEvents();
  game.ensureScheduledWorldEvents();
  assert.equal(getSportingEvents(game).length, 1);
});

test('scheduled sporting event stays neutral before start, activates at start, stays private', () => {
  const { game } = createGame({ rng: () => 1 });
  const event = game.worldEventEngine.events.find(
    (e) => e.type === WORLD_EVENT_TYPE_MAJOR_SPORTING_EVENT
  );
  assert.ok(event);

  // Before start: neutral factor, no public-state leak.
  const host = event.countries[0];
  game.updateWorldEventFactors(event.candidateAtSimulationMs - 1);
  assert.equal(game.authoritativeState.world.countryProfitFactors[host], undefined);
  assert.equal(JSON.stringify(game.getPublicState().game).includes(event.id), false);

  // At start: existing engine flips it active and the factor applies.
  game.worldEventEngine.tick(event.candidateAtSimulationMs);
  game.updateWorldEventFactors(event.candidateAtSimulationMs + event.onsetDurationSimulationMs);
  assert.equal(event.status, 'active');
  assert.equal(game.authoritativeState.world.countryProfitFactors[host], event.peakFactor);
});

test('real-time-intent sporting timings preserve real seconds across speed multipliers', () => {
  const { game: g15 } = createGame({ rng: () => 0 });
  const { game: g10 } = createGame({
    rng: () => 0,
    stateOverrides: { simulationSpeedMultiplier: 10000 }
  });

  const s15 = getSportingEvents(g15)[0];
  const s10 = getSportingEvents(g10)[0];

  // Onset/decay: same real seconds, different sim ms.
  assert.equal(s15.onsetDurationSimulationMs, 20 * 15000 * 1000);
  assert.equal(s10.onsetDurationSimulationMs, 20 * 10000 * 1000);
  assert.equal(s15.onsetDurationSimulationMs / 15000, s10.onsetDurationSimulationMs / 10000);
  assert.equal(s15.decayDurationSimulationMs / 15000, s10.decayDurationSimulationMs / 10000);

  // Hold stays 30 simulation days regardless of multiplier (calendar intent).
  assert.equal(s15.holdDurationSimulationMs, 30 * DAY);
  assert.equal(s10.holdDurationSimulationMs, 30 * DAY);

  // Earliest start preserves 5 real minutes.
  assert.equal(s15.candidateAtSimulationMs, 5 * 60 * 15000 * 1000);
  assert.equal(s10.candidateAtSimulationMs, 5 * 60 * 10000 * 1000);
});

test('real-time-intent Boom/Slump durations preserve real seconds across speed multipliers', () => {
  const { game: g15 } = createGame({ rng: () => 0 });
  const { game: g10 } = createGame({
    rng: () => 0,
    stateOverrides: { simulationSpeedMultiplier: 10000 }
  });

  g15.maybeTriggerDailyWorldEvent(DAY);
  g10.maybeTriggerDailyWorldEvent(DAY);

  const b15 = g15.worldEventEngine.events[g15.worldEventEngine.events.length - 1];
  const b10 = g10.worldEventEngine.events[g10.worldEventEngine.events.length - 1];
  assert.equal(b15.type, WORLD_EVENT_TYPE_TRAVEL_BOOM);
  assert.equal(b10.type, WORLD_EVENT_TYPE_TRAVEL_BOOM);

  assert.equal(b15.onsetDurationSimulationMs, 15 * 15000 * 1000);
  assert.equal(b10.onsetDurationSimulationMs, 15 * 10000 * 1000);
  assert.equal(b15.holdDurationSimulationMs / 15000, b10.holdDurationSimulationMs / 10000);
  assert.equal(b15.decayDurationSimulationMs / 15000, b10.decayDurationSimulationMs / 10000);
});

test('sporting event spacing preserves real minutes across speed multipliers', () => {
  const seq = [0.99, 0.0, 0.5, 0.999, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.999, 0.5, 0.5, 0.5];
  const make = (mult) => {
    let i = 0;
    return createGame({
      rng: () => seq[i++] ?? 0.5,
      stateOverrides: { simulationSpeedMultiplier: mult }
    }).game;
  };

  const g15 = make(15000);
  const g10 = make(10000);
  const starts15 = getSportingEvents(g15).map((e) => e.candidateAtSimulationMs).sort((a, b) => a - b);
  const starts10 = getSportingEvents(g10).map((e) => e.candidateAtSimulationMs).sort((a, b) => a - b);

  assert.equal(starts15.length, 3);
  assert.equal(starts10.length, 3);
  for (let i = 1; i < 3; i += 1) {
    assert.ok(starts15[i] - starts15[i - 1] >= 8 * 60 * 15000 * 1000);
    assert.ok(starts10[i] - starts10[i - 1] >= 8 * 60 * 10000 * 1000);
    // Same real-minute offsets at both multipliers.
    assert.equal(starts15[i] / 15000, starts10[i] / 10000);
  }
});

test('sporting announcement lead is a random 2-3 real minutes at any speed multiplier', () => {
  // Roll order per event: count, start, host, strength, announceLead, onset, decay.
  const cases = [
    { leadRoll: 0, expectedMin: 2 },
    { leadRoll: 0.5, expectedMin: 2.5 },
    { leadRoll: 0.999, expectedMin: 2 + 0.999 }
  ];

  for (const mult of [15000, 10000]) {
    for (const { leadRoll, expectedMin } of cases) {
      const seq = [0, 0.5, 0, 0.5, leadRoll, 0.5, 0.5];
      let i = 0;
      const { game } = createGame({
        rng: () => seq[i++] ?? 0.5,
        stateOverrides: { simulationSpeedMultiplier: mult }
      });
      const event = getSportingEvents(game)[0];
      const leadSimMs = event.candidateAtSimulationMs - event.announceAtSimulationMs;
      const leadRealMinutes = leadSimMs / (mult * 1000 * 60);
      assert.ok(Math.abs(leadRealMinutes - expectedMin) < 1e-6,
        `mult ${mult}: lead ${leadRealMinutes} ≈ ${expectedMin}`);
      assert.ok(leadRealMinutes >= 2 && leadRealMinutes <= 3);
      assert.ok(event.announceAtSimulationMs < event.candidateAtSimulationMs);
    }
  }
});

