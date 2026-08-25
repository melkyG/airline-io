const { randomUUID } = require('node:crypto');
const { AIRPORT_CATALOG } = require('./airports/catalog');
const { AIRCRAFT_CATALOG, AIRCRAFT_CATALOG_BY_ID } = require('./aircraft/catalog');
const { createOwnedAircraftInstance, OWNED_AIRCRAFT_STATUS } = require('./aircraft/ownership');
const { canonicalRouteKey, calculateRouteDistanceKm } = require('./routes');
const {
  MAX_FLIGHT_TRANSITIONS_PER_TICK,
  MAX_FLIGHT_PROCESSING_REAL_MS,
  calculateFlightDurationSimulationMs
} = require('./flights/rules');
const { createBoundedScheduler } = require('./flights/scheduler');
const FlightEngine = require('./FlightEngine');
const { calculateFlightSettlement } = require('./economy/flightSettlement');
const {
  calculateAirportSellToGamePrice,
  calculateAircraftSellToGamePrice
} = require('./economy/liquidation');
const { calculateNetWorthByPlayer } = require('./economy/netWorth');
const { calculateScoreByPlayer } = require('./economy/score');

const AIRPORT_DEFINITIONS_BY_ID = AIRPORT_CATALOG.reduce((lookup, airport) => {
  lookup.set(airport.id, airport);
  return lookup;
}, new Map());

const DEFAULT_SIMULATION_SPEED_MULTIPLIER = 10000;

class Game {
  constructor(initialState, manager) {
    this.id = initialState.id;
    this.status = initialState.status;
    this.players = new Map();
    this.createdAt = initialState.createdAt;
    this.authoritativeState = {
      ...initialState,
      status: initialState.status,
      simulationStartedAtRealMs: Number.isFinite(initialState.simulationStartedAtRealMs)
        ? initialState.simulationStartedAtRealMs
        : null,
      simulationStartedAtGameMs: Number.isFinite(initialState.simulationStartedAtGameMs)
        ? initialState.simulationStartedAtGameMs
        : null,
      simulationSpeedMultiplier:
        Number.isFinite(initialState.simulationSpeedMultiplier) && initialState.simulationSpeedMultiplier > 0
          ? initialState.simulationSpeedMultiplier
          : DEFAULT_SIMULATION_SPEED_MULTIPLIER,
      simulationEndedAtGameMs: Number.isFinite(initialState.simulationEndedAtGameMs)
        ? initialState.simulationEndedAtGameMs
        : null,
      ownedAircraft: Array.isArray(initialState.ownedAircraft) ? initialState.ownedAircraft : [],
      routes: Array.isArray(initialState.routes) ? initialState.routes : [],
      flights: Array.isArray(initialState.flights) ? initialState.flights : []
    };
    this.endTimeoutId = null;
    this.hasBroadcastStarted = false;
    this.gameState = {
      mapPlaceholder: 'Map Placeholder'
    };
    this.manager = manager;
    this.flightEngine = new FlightEngine({
      authoritativeState: this.authoritativeState,
      getSimulationTimeMs: (realNowMs) => this.getSimulationTimeMs(realNowMs),
      resolveFlightArrivalSettlementContext: (transitionContext) => {
        return this.resolveFlightArrivalSettlementContext(transitionContext);
      },
      createBoundedScheduler,
      onTick: (realNowMs) => this.processFlightSchedulerTick(realNowMs)
    });
  }

  initialize() {
    Array.from(this.players.values()).forEach((player) => {
      player.gameId = this.id;
      player.lobbyId = null;
    });

    this.initializeSimulationClock();
    this.scheduleExpirationTimeout();
    this.broadcastStarted();
    this.checkWinConditions();

    if (this.status === 'active') {
      this.startFlightScheduler();
    }
  }

  initializeSimulationClock(realNowMs = Date.now()) {
    if (!Number.isFinite(this.authoritativeState.simulationStartedAtRealMs)) {
      this.authoritativeState.simulationStartedAtRealMs = realNowMs;
    }

    if (!Number.isFinite(this.authoritativeState.simulationStartedAtGameMs)) {
      this.authoritativeState.simulationStartedAtGameMs = realNowMs;
    }

    if (
      !Number.isFinite(this.authoritativeState.simulationSpeedMultiplier) ||
      this.authoritativeState.simulationSpeedMultiplier <= 0
    ) {
      this.authoritativeState.simulationSpeedMultiplier = DEFAULT_SIMULATION_SPEED_MULTIPLIER;
    }

    if (!Number.isFinite(this.authoritativeState.simulationEndedAtGameMs)) {
      this.authoritativeState.simulationEndedAtGameMs = null;
    }
  }

  getSimulationTimeMs(realNowMs = Date.now()) {
    const simulationEndedAtGameMs = this.authoritativeState.simulationEndedAtGameMs;
    if (Number.isFinite(simulationEndedAtGameMs)) {
      return simulationEndedAtGameMs;
    }

    const simulationStartedAtRealMs = this.authoritativeState.simulationStartedAtRealMs;
    const simulationStartedAtGameMs = this.authoritativeState.simulationStartedAtGameMs;
    const simulationSpeedMultiplier =
      Number.isFinite(this.authoritativeState.simulationSpeedMultiplier) && this.authoritativeState.simulationSpeedMultiplier > 0
        ? this.authoritativeState.simulationSpeedMultiplier
        : DEFAULT_SIMULATION_SPEED_MULTIPLIER;

    if (!Number.isFinite(simulationStartedAtRealMs) || !Number.isFinite(simulationStartedAtGameMs)) {
      return null;
    }

    const elapsedRealMs = Math.max(0, realNowMs - simulationStartedAtRealMs);
    return simulationStartedAtGameMs + (elapsedRealMs * simulationSpeedMultiplier);
  }

  getSimulationClockSnapshot(realNowMs = Date.now()) {
    return {
      simulationStartedAtRealMs: Number.isFinite(this.authoritativeState.simulationStartedAtRealMs)
        ? this.authoritativeState.simulationStartedAtRealMs
        : null,
      simulationStartedAtGameMs: Number.isFinite(this.authoritativeState.simulationStartedAtGameMs)
        ? this.authoritativeState.simulationStartedAtGameMs
        : null,
      simulationSpeedMultiplier:
        Number.isFinite(this.authoritativeState.simulationSpeedMultiplier) && this.authoritativeState.simulationSpeedMultiplier > 0
          ? this.authoritativeState.simulationSpeedMultiplier
          : DEFAULT_SIMULATION_SPEED_MULTIPLIER,
      simulationEndedAtGameMs: Number.isFinite(this.authoritativeState.simulationEndedAtGameMs)
        ? this.authoritativeState.simulationEndedAtGameMs
        : null,
      simulationNowGameMs: this.getSimulationTimeMs(realNowMs)
    };
  }

  scheduleExpirationTimeout() {
    this.clearExpirationTimeout();

    if (this.status !== 'active' || !Number.isFinite(this.authoritativeState.endsAt)) {
      return;
    }

    const delayMs = Math.max(0, this.authoritativeState.endsAt - Date.now());
    this.endTimeoutId = setTimeout(() => {
      this.checkWinConditions();
    }, delayMs);
  }

  clearExpirationTimeout() {
    if (!this.endTimeoutId) {
      return;
    }

    clearTimeout(this.endTimeoutId);
    this.endTimeoutId = null;
  }

  endGame(reason) {
    if (this.status !== 'active') {
      return false;
    }

    const endedAtRealNowMs = Date.now();
    if (!Number.isFinite(this.authoritativeState.simulationEndedAtGameMs)) {
      const frozenSimulationTimeMs = this.getSimulationTimeMs(endedAtRealNowMs);
      this.authoritativeState.simulationEndedAtGameMs = Number.isFinite(frozenSimulationTimeMs)
        ? frozenSimulationTimeMs
        : null;
    }

    this.status = 'ended';
    this.authoritativeState.status = 'ended';
    this.authoritativeState.endReason = reason;
    this.authoritativeState.endedAt = endedAtRealNowMs;
    this.generateResults();
    this.stopFlightScheduler();
    this.clearExpirationTimeout();
    this.broadcastState();

    if (this.manager && typeof this.manager.handleGameEnded === 'function') {
      this.manager.handleGameEnded(this.id);
    }

    return true;
  }

  createCoinFlipValue(bitCount = 16) {
    let value = 0;
    for (let index = 0; index < bitCount; index += 1) {
      value = (value << 1) | (Math.random() < 0.5 ? 0 : 1);
    }

    return value;
  }

  generateResults() {
    if (this.authoritativeState.results) {
      return this.authoritativeState.results;
    }

    const sourcePlayers = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const scoreByPlayerId = calculateScoreByPlayer(this.authoritativeState);
    const rankedPlayers = sourcePlayers
      .map((player) => {
        const score = scoreByPlayerId.has(String(player.id)) ? scoreByPlayerId.get(String(player.id)) : 0;
        const capital = Number.isFinite(player.capital) ? player.capital : 0;
        return {
          id: player.id,
          username: player.username,
          score,
          capital,
          tieBreaker: this.createCoinFlipValue()
        };
      })
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        if (right.capital !== left.capital) {
          return right.capital - left.capital;
        }

        if (right.tieBreaker !== left.tieBreaker) {
          return right.tieBreaker - left.tieBreaker;
        }

        return String(left.id).localeCompare(String(right.id));
      });

    const standings = rankedPlayers.map((player, index) => ({
      rank: index + 1,
      id: player.id,
      username: player.username,
      score: player.score,
      capital: player.capital
    }));

    const winner = standings.length > 0 ? { ...standings[0] } : null;
    const results = {
      winner,
      standings,
      generatedAt: Date.now()
    };

    this.authoritativeState.results = results;
    return results;
  }

  checkWinConditions() {
    if (this.status !== 'active') {
      return false;
    }

    const scoreToWin = this.authoritativeState.scoreToWin;
    if (Number.isFinite(scoreToWin) && scoreToWin > 0) {
      const scoreByPlayerId = calculateScoreByPlayer(this.authoritativeState);
      const scoreReached = this.authoritativeState.players.some((player) => {
        const playerScore = scoreByPlayerId.has(String(player.id)) ? scoreByPlayerId.get(String(player.id)) : 0;
        return playerScore >= scoreToWin;
      });

      if (scoreReached) {
        return this.endGame('score');
      }
    }

    if (Number.isFinite(this.authoritativeState.endsAt) && Date.now() >= this.authoritativeState.endsAt) {
      return this.endGame('time');
    }

    return false;
  }

  evaluateWinConditions() {
    return this.checkWinConditions();
  }

  addDebugScoreOffset(playerId, amount) {
    if (this.status !== 'active') {
      return false;
    }

    const delta = Number.isFinite(amount) ? amount : 0;
    if (delta === 0) {
      return false;
    }

    const targetPlayer = this.authoritativeState.players.find((player) => player.id === playerId);
    if (!targetPlayer) {
      return false;
    }

    const currentDebugScoreOffset = Number.isFinite(targetPlayer.debugScoreOffset) ? targetPlayer.debugScoreOffset : 0;
    targetPlayer.debugScoreOffset = currentDebugScoreOffset + delta;

    const runtimePlayer = this.players.get(playerId);
    if (runtimePlayer) {
      const runtimeDebugScoreOffset = Number.isFinite(runtimePlayer.debugScoreOffset) ? runtimePlayer.debugScoreOffset : 0;
      runtimePlayer.debugScoreOffset = runtimeDebugScoreOffset + delta;
    }

    const ended = this.checkWinConditions();
    if (!ended) {
      this.broadcastState();
    }

    return true;
  }

  purchaseUnownedAirport(playerId, airportId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const airports = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];
    const normalizedAirportId = String(airportId || '').trim();

    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const airportState = airports.find((candidate) => candidate.airportId === normalizedAirportId);
    const airportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(normalizedAirportId);
    const basePrice = airportDefinition ? airportDefinition.basePrice : null;

    if (!airportState || !airportDefinition || !Number.isFinite(basePrice) || basePrice < 0) {
      return {
        success: false,
        code: 'AIRPORT_NOT_FOUND',
        message: 'Airport was not found.'
      };
    }

    if (airportState.ownerPlayerId) {
      return {
        success: false,
        code: 'AIRPORT_ALREADY_OWNED',
        message: 'Airport is already owned.'
      };
    }

    const currentCapital = Number.isFinite(player.capital) ? player.capital : 0;
    if (currentCapital < basePrice) {
      return {
        success: false,
        code: 'INSUFFICIENT_CAPITAL',
        message: 'Player does not have enough capital for this purchase.'
      };
    }

    player.capital = currentCapital - basePrice;
    airportState.ownerPlayerId = player.id;
    airportState.saleListing = null;

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      playerId: player.id,
      airportId: airportDefinition.id,
      pricePaid: basePrice,
      remainingCapital: player.capital
    };
  }

  resolveAircraftPurchaseContext(playerId, aircraftCatalogId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const normalizedAircraftCatalogId = String(aircraftCatalogId || '').trim();

    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const aircraftDefinition = AIRCRAFT_CATALOG_BY_ID[normalizedAircraftCatalogId];
    const purchasePrice = aircraftDefinition ? aircraftDefinition.purchasePrice : null;
    if (!aircraftDefinition || !Number.isFinite(purchasePrice) || purchasePrice < 0) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_FOUND',
        message: 'Aircraft was not found.'
      };
    }

    const currentCapital = Number.isFinite(player.capital) ? player.capital : 0;
    const maxPurchasable = Math.max(0, Math.floor(currentCapital / purchasePrice));

    return {
      success: true,
      player,
      aircraftDefinition,
      purchasePrice,
      currentCapital,
      maxPurchasable
    };
  }

  getAircraftPurchaseQuote(playerId, aircraftCatalogId) {
    const context = this.resolveAircraftPurchaseContext(playerId, aircraftCatalogId);
    if (!context.success) {
      return context;
    }

    return {
      success: true,
      code: 'OK',
      playerId: context.player.id,
      aircraftCatalogId: context.aircraftDefinition.aircraftCatalogId,
      unitPrice: context.purchasePrice,
      currentCapital: context.currentCapital,
      maxPurchasable: context.maxPurchasable
    };
  }

  getAircraftSellQuote(playerId, aircraftCatalogId) {
    const context = this.resolveAircraftPurchaseContext(playerId, aircraftCatalogId);
    if (!context.success) {
      return context;
    }

    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    const ownedQuantity = ownedAircraft.reduce((count, aircraft) => {
      if (!aircraft) {
        return count;
      }

      const isOwnerMatch = String(aircraft.ownerPlayerId) === String(context.player.id);
      const isCatalogMatch = String(aircraft.aircraftCatalogId) === String(context.aircraftDefinition.aircraftCatalogId);
      return isOwnerMatch && isCatalogMatch ? count + 1 : count;
    }, 0);
    const unitSellPrice = calculateAircraftSellToGamePrice(context.purchasePrice);

    return {
      success: true,
      code: 'OK',
      aircraftCatalogId: context.aircraftDefinition.aircraftCatalogId,
      ownedQuantity,
      maxSellable: ownedQuantity,
      unitSellPrice
    };
  }

  isAircraftAvailableAndUnassigned(aircraft) {
    if (!aircraft) {
      return false;
    }

    const assignedRouteId = String(aircraft.assignedRouteId || '').trim();
    return aircraft.status === OWNED_AIRCRAFT_STATUS.AVAILABLE && !assignedRouteId;
  }

  resolveRouteAssignmentDetachmentContext(aircraft) {
    if (!aircraft || !aircraft.aircraftInstanceId) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_FOUND',
        message: 'Aircraft instance was not found.'
      };
    }

    if (this.isAircraftAvailableAndUnassigned(aircraft)) {
      return {
        success: true,
        isAlreadyDetached: true,
        aircraft,
        route: null,
        assignedAircraftInstanceIds: [],
        assignmentIndex: -1
      };
    }

    const assignedRouteId = String(aircraft.assignedRouteId || '').trim();
    if (!assignedRouteId) {
      return {
        success: false,
        code: 'ASSIGNMENT_MISMATCH',
        message: 'Aircraft assignment state is inconsistent for one or more aircraft.',
        aircraftInstanceId: aircraft.aircraftInstanceId
      };
    }

    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const route = routes.find((candidate) => candidate && String(candidate.routeId || '').trim() === assignedRouteId);
    if (!route) {
      return {
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'Assigned route was not found.',
        aircraftInstanceId: aircraft.aircraftInstanceId
      };
    }

    const assignedAircraftInstanceIds = Array.isArray(route.assignedAircraftInstanceIds)
      ? route.assignedAircraftInstanceIds
      : [];
    const assignmentIndex = assignedAircraftInstanceIds.findIndex((aircraftInstanceId) => {
      return String(aircraftInstanceId || '').trim() === String(aircraft.aircraftInstanceId || '').trim();
    });

    if (assignmentIndex < 0) {
      return {
        success: false,
        code: 'ASSIGNMENT_NOT_FOUND',
        message: 'Aircraft assignment was not found on the route.',
        aircraftInstanceId: aircraft.aircraftInstanceId
      };
    }

    return {
      success: true,
      isAlreadyDetached: false,
      aircraft,
      route,
      assignedAircraftInstanceIds,
      assignmentIndex
    };
  }

  resolveFlightRecordForAssignedAircraft(aircraft, route) {
    if (!aircraft || !route) {
      return {
        success: false,
        code: 'FLIGHT_ASSIGNMENT_MISMATCH',
        message: 'Flight assignment state is inconsistent for one or more aircraft.'
      };
    }

    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];
    const normalizedAircraftInstanceId = String(aircraft.aircraftInstanceId || '').trim();
    const matchingFlightsWithIndex = [];

    flights.forEach((flight, index) => {
      if (!flight) {
        return;
      }

      const isAircraftMatch = String(flight.aircraftInstanceId || '').trim() === normalizedAircraftInstanceId;
      if (isAircraftMatch) {
        matchingFlightsWithIndex.push({ flight, index });
      }
    });

    if (matchingFlightsWithIndex.length === 0) {
      return {
        success: false,
        code: 'FLIGHT_NOT_FOUND',
        message: 'Assigned flight was not found.',
        aircraftInstanceId: normalizedAircraftInstanceId
      };
    }

    if (matchingFlightsWithIndex.length > 1) {
      return {
        success: false,
        code: 'FLIGHT_DUPLICATE',
        message: 'More than one flight exists for this aircraft instance.',
        aircraftInstanceId: normalizedAircraftInstanceId
      };
    }

    const { flight, index } = matchingFlightsWithIndex[0];
    const isRouteMatch = String(flight.routeId || '').trim() === String(route.routeId || '').trim();
    const isOwnerMatch =
      String(flight.ownerPlayerId || '').trim() === String(route.ownerPlayerId || '').trim() &&
      String(flight.ownerPlayerId || '').trim() === String(aircraft.ownerPlayerId || '').trim();

    if (!isRouteMatch || !isOwnerMatch) {
      return {
        success: false,
        code: 'FLIGHT_ASSIGNMENT_MISMATCH',
        message: 'Flight assignment state is inconsistent for one or more aircraft.',
        aircraftInstanceId: normalizedAircraftInstanceId
      };
    }

    return {
      success: true,
      flight,
      flightIndex: index
    };
  }

  createReadyFlightRecord(route, aircraft) {
    return {
      flightId: `flight-${randomUUID()}`,
      ownerPlayerId: route.ownerPlayerId,
      routeId: route.routeId,
      aircraftInstanceId: aircraft.aircraftInstanceId,
      originAirportId: route.originAirportId,
      destinationAirportId: route.destinationAirportId,
      direction: 'outbound',
      status: 'ready',
      departedAtSimulationMs: null,
      arrivesAtSimulationMs: null,
      nextTransitionAtSimulationMs: null,
      lastOutboundDepartedAtSimulationMs: null
    };
  }

  detachAircraftFromAssignment(aircraftInstanceId, options = {}) {
    const normalizedAircraftInstanceId = String(aircraftInstanceId || '').trim();
    if (!normalizedAircraftInstanceId) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_FOUND',
        message: 'Aircraft instance was not found.'
      };
    }

    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    const aircraft = ownedAircraft.find((candidate) => {
      return candidate && String(candidate.aircraftInstanceId || '').trim() === normalizedAircraftInstanceId;
    });

    if (!aircraft) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_FOUND',
        message: 'Aircraft instance was not found.'
      };
    }

    const providedDetachmentContext =
      options && options.detachmentContext && options.detachmentContext.aircraft === aircraft
        ? options.detachmentContext
        : null;
    const detachmentContext = providedDetachmentContext || this.resolveRouteAssignmentDetachmentContext(aircraft);
    if (!detachmentContext.success) {
      return detachmentContext;
    }

    if (detachmentContext.isAlreadyDetached) {
      const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];
      const hasDetachedFlight = flights.some((flight) => {
        return String(flight && flight.aircraftInstanceId ? flight.aircraftInstanceId : '').trim() === normalizedAircraftInstanceId;
      });

      if (hasDetachedFlight) {
        return {
          success: false,
          code: 'FLIGHT_ASSIGNMENT_MISMATCH',
          message: 'Flight assignment state is inconsistent for one or more aircraft.',
          aircraftInstanceId: normalizedAircraftInstanceId
        };
      }

      aircraft.status = OWNED_AIRCRAFT_STATUS.AVAILABLE;
      aircraft.assignedRouteId = null;
      return {
        success: true,
        code: 'OK',
        aircraftInstanceId: normalizedAircraftInstanceId,
        routeId: null,
        assignedAircraftInstanceIds: []
      };
    }

    const { route } = detachmentContext;
    const flightContext = this.resolveFlightRecordForAssignedAircraft(aircraft, route);
    if (!flightContext.success) {
      return flightContext;
    }

    const assignedAircraftInstanceIds = Array.isArray(route.assignedAircraftInstanceIds)
      ? route.assignedAircraftInstanceIds
      : [];
    const assignmentIndex = assignedAircraftInstanceIds.findIndex((aircraftId) => {
      return String(aircraftId || '').trim() === normalizedAircraftInstanceId;
    });

    if (assignmentIndex < 0) {
      return {
        success: false,
        code: 'ASSIGNMENT_NOT_FOUND',
        message: 'Aircraft assignment was not found on the route.',
        aircraftInstanceId: normalizedAircraftInstanceId
      };
    }

    assignedAircraftInstanceIds.splice(assignmentIndex, 1);
    route.assignedAircraftInstanceIds = assignedAircraftInstanceIds;

    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];
    flights.splice(flightContext.flightIndex, 1);
    this.authoritativeState.flights = flights;

    aircraft.status = OWNED_AIRCRAFT_STATUS.AVAILABLE;
    aircraft.assignedRouteId = null;

    return {
      success: true,
      code: 'OK',
      aircraftInstanceId: normalizedAircraftInstanceId,
      routeId: route.routeId,
      assignedAircraftInstanceIds: route.assignedAircraftInstanceIds.slice()
    };
  }

  selectOwnedAircraftInstancesForSale(playerId, aircraftCatalogId, quantity) {
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    const normalizedPlayerId = String(playerId || '').trim();
    const normalizedAircraftCatalogId = String(aircraftCatalogId || '').trim();
    const normalizedQuantity = Number.isInteger(quantity) && quantity > 0 ? quantity : 0;

    const matchingAircraft = ownedAircraft.filter((aircraft) => {
      if (!aircraft) {
        return false;
      }

      const pendingAction = String(aircraft.pendingRouteExitAction || '').trim();
      if (pendingAction) {
        return false;
      }

      const isOwnerMatch = String(aircraft.ownerPlayerId || '') === normalizedPlayerId;
      const isCatalogMatch = String(aircraft.aircraftCatalogId || '') === normalizedAircraftCatalogId;
      return isOwnerMatch && isCatalogMatch;
    });

    const availableAircraft = matchingAircraft.filter((aircraft) => this.isAircraftAvailableAndUnassigned(aircraft));
    const assignedAircraft = matchingAircraft.filter((aircraft) => !this.isAircraftAvailableAndUnassigned(aircraft));
    const selectedAircraft = [
      ...availableAircraft.slice(0, normalizedQuantity),
      ...assignedAircraft.slice(0, Math.max(0, normalizedQuantity - availableAircraft.length))
    ];

    const assignedAircraftToDetach = selectedAircraft.filter((aircraft) => !this.isAircraftAvailableAndUnassigned(aircraft));

    return {
      selectedAircraft,
      assignedAircraftToDetach,
      availableQuantitySold: selectedAircraft.length - assignedAircraftToDetach.length,
      assignedQuantitySold: assignedAircraftToDetach.length
    };
  }

  sellAircraftToGame(playerId, aircraftCatalogId, quantity = 1) {
    const sellQuote = this.getAircraftSellQuote(playerId, aircraftCatalogId);
    if (!sellQuote.success) {
      return sellQuote;
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      return {
        success: false,
        code: 'INVALID_QUANTITY',
        message: 'Quantity must be an integer greater than or equal to 1.',
        aircraftCatalogId: sellQuote.aircraftCatalogId,
        ownedQuantity: sellQuote.ownedQuantity,
        maxSellable: sellQuote.maxSellable,
        unitSellPrice: sellQuote.unitSellPrice
      };
    }

    if (quantity > sellQuote.ownedQuantity) {
      return {
        success: false,
        code: 'INSUFFICIENT_OWNED_QUANTITY',
        message: 'Player does not own enough aircraft of this model to sell that quantity.',
        aircraftCatalogId: sellQuote.aircraftCatalogId,
        ownedQuantity: sellQuote.ownedQuantity,
        maxSellable: sellQuote.maxSellable,
        unitSellPrice: sellQuote.unitSellPrice
      };
    }

    const context = this.resolveAircraftPurchaseContext(playerId, aircraftCatalogId);
    if (!context.success) {
      return context;
    }

    const selection = this.selectOwnedAircraftInstancesForSale(
      context.player.id,
      sellQuote.aircraftCatalogId,
      quantity
    );
    const selectedAircraft = selection.selectedAircraft;

    if (selectedAircraft.length < quantity) {
      return {
        success: false,
        code: 'INSUFFICIENT_OWNED_QUANTITY',
        message: 'Player does not own enough aircraft of this model to sell that quantity.',
        aircraftCatalogId: sellQuote.aircraftCatalogId,
        ownedQuantity: sellQuote.ownedQuantity,
        maxSellable: sellQuote.maxSellable,
        unitSellPrice: sellQuote.unitSellPrice
      };
    }

    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];

    const immediateSaleAircraft = [];
    const deferredSaleAircraft = [];

    for (const aircraft of selectedAircraft) {
      if (this.isAircraftAvailableAndUnassigned(aircraft)) {
        immediateSaleAircraft.push(aircraft);
        continue;
      }

      const assignedRouteId = String(aircraft.assignedRouteId || '').trim();
      if (!assignedRouteId) {
        immediateSaleAircraft.push(aircraft);
        continue;
      }

      const route = routes.find((candidate) => candidate && candidate.routeId === assignedRouteId);
      if (!route) {
        immediateSaleAircraft.push(aircraft);
        continue;
      }

      const flight = flights.find((candidate) => {
        return candidate && String(candidate.aircraftInstanceId || '').trim() === String(aircraft.aircraftInstanceId || '').trim();
      });

      const routeOriginAirportId = String(route.originAirportId || '').trim();
      const isHomeReady = flight &&
                          String(flight.status || '').trim() === 'ready' &&
                          String(flight.direction || '').trim() === 'outbound' &&
                          String(flight.originAirportId || '').trim() === routeOriginAirportId;

      this.beginModelReconfiguration(route.routeId, aircraft.aircraftCatalogId);

      if (isHomeReady) {
        immediateSaleAircraft.push(aircraft);
      } else {
        deferredSaleAircraft.push(aircraft);
      }
    }

    const detachmentContextsByAircraftInstanceId = new Map();
    for (const aircraft of immediateSaleAircraft) {
      if (this.isAircraftAvailableAndUnassigned(aircraft)) {
        continue;
      }

      const detachmentContext = this.resolveRouteAssignmentDetachmentContext(aircraft);
      if (!detachmentContext.success) {
        return {
          ...detachmentContext,
          aircraftCatalogId: sellQuote.aircraftCatalogId,
          ownedQuantity: sellQuote.ownedQuantity,
          maxSellable: sellQuote.maxSellable,
          unitSellPrice: sellQuote.unitSellPrice
        };
      }

      detachmentContextsByAircraftInstanceId.set(String(aircraft.aircraftInstanceId || '').trim(), detachmentContext);
    }

    for (const aircraft of immediateSaleAircraft) {
      if (this.isAircraftAvailableAndUnassigned(aircraft)) {
        continue;
      }

      const normalizedAircraftInstanceId = String(aircraft.aircraftInstanceId || '').trim();
      const detachResult = this.detachAircraftFromAssignment(normalizedAircraftInstanceId, {
        detachmentContext: detachmentContextsByAircraftInstanceId.get(normalizedAircraftInstanceId)
      });

      if (!detachResult.success) {
        return {
          ...detachResult,
          aircraftCatalogId: sellQuote.aircraftCatalogId,
          ownedQuantity: sellQuote.ownedQuantity,
          maxSellable: sellQuote.maxSellable,
          unitSellPrice: sellQuote.unitSellPrice
        };
      }
    }

    for (const aircraft of deferredSaleAircraft) {
      aircraft.pendingRouteExitAction = 'sell';
      aircraft.pendingSaleRefund = sellQuote.unitSellPrice;
    }

    const immediateSaleAircraftInstanceIdSet = new Set(
      immediateSaleAircraft.map((aircraft) => String(aircraft && aircraft.aircraftInstanceId ? aircraft.aircraftInstanceId : '').trim())
    );
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    const updatedOwnedAircraft = ownedAircraft.filter((aircraft) => {
      if (!aircraft) {
        return true;
      }

      const normalizedAircraftInstanceId = String(aircraft.aircraftInstanceId || '').trim();
      return !immediateSaleAircraftInstanceIdSet.has(normalizedAircraftInstanceId);
    });

    const quantitySoldImmediately = immediateSaleAircraft.length;
    const quantityPendingSale = deferredSaleAircraft.length;
    const totalRefund = sellQuote.unitSellPrice * quantitySoldImmediately;
    const currentCapital = Number.isFinite(context.player.capital) ? context.player.capital : 0;
    context.player.capital = currentCapital + totalRefund;
    this.authoritativeState.ownedAircraft = updatedOwnedAircraft;

    const remainingOwnedQuantity = sellQuote.ownedQuantity - quantitySoldImmediately;

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      aircraftCatalogId: sellQuote.aircraftCatalogId,
      quantitySold: quantity,
      quantitySoldImmediately,
      quantityPendingSale,
      availableQuantitySold: immediateSaleAircraft.filter((aircraft) => this.isAircraftAvailableAndUnassigned(aircraft)).length,
      assignedQuantitySold: immediateSaleAircraft.filter((aircraft) => !this.isAircraftAvailableAndUnassigned(aircraft)).length,
      unitSellPrice: sellQuote.unitSellPrice,
      totalRefund,
      ownedQuantity: remainingOwnedQuantity,
      maxSellable: remainingOwnedQuantity,
      updatedCapital: context.player.capital
    };
  }

  purchaseAircraftFromGame(playerId, aircraftCatalogId, quantity = 1) {
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    const context = this.resolveAircraftPurchaseContext(playerId, aircraftCatalogId);
    if (!context.success) {
      return context;
    }

    const {
      player,
      aircraftDefinition,
      purchasePrice,
      currentCapital,
      maxPurchasable
    } = context;

    if (!Number.isInteger(quantity) || quantity < 1) {
      return {
        success: false,
        code: 'INVALID_QUANTITY',
        message: 'Quantity must be an integer greater than or equal to 1.',
        maxPurchasable
      };
    }

    const totalCost = purchasePrice * quantity;

    if (currentCapital < totalCost) {
      return {
        success: false,
        code: 'INSUFFICIENT_CAPITAL',
        message: 'Player does not have enough capital for this purchase.',
        maxPurchasable
      };
    }

    const purchasedAircraftInstances = [];
    for (let index = 0; index < quantity; index += 1) {
      purchasedAircraftInstances.push(
        createOwnedAircraftInstance({
          ownerPlayerId: player.id,
          aircraftCatalogId: aircraftDefinition.aircraftCatalogId,
          acquisitionPrice: purchasePrice
        })
      );
    }

    player.capital = currentCapital - totalCost;
    ownedAircraft.push(...purchasedAircraftInstances);
    this.authoritativeState.ownedAircraft = ownedAircraft;

    this.broadcastState();

    const primaryAircraftInstance = purchasedAircraftInstances[0] || null;

    return {
      success: true,
      code: 'OK',
      playerId: player.id,
      aircraftInstanceId: primaryAircraftInstance ? primaryAircraftInstance.aircraftInstanceId : null,
      aircraftInstanceIds: purchasedAircraftInstances.map((instance) => instance.aircraftInstanceId),
      aircraftCatalogId: aircraftDefinition.aircraftCatalogId,
      quantityPurchased: quantity,
      unitPrice: purchasePrice,
      pricePaid: totalCost,
      remainingCapital: player.capital,
      maxPurchasable: Math.max(0, Math.floor(player.capital / purchasePrice))
    };
  }

  listAirportForSale(playerId, airportId, askingPrice) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const airports = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];
    const normalizedAirportId = String(airportId || '').trim();
    const player = players.find((candidate) => candidate.id === playerId);

    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const airportState = airports.find((candidate) => candidate.airportId === normalizedAirportId);
    const airportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(normalizedAirportId);
    if (!airportState || !airportDefinition) {
      return {
        success: false,
        code: 'AIRPORT_NOT_FOUND',
        message: 'Airport was not found.'
      };
    }

    if (airportState.ownerPlayerId !== player.id) {
      return {
        success: false,
        code: 'NOT_AIRPORT_OWNER',
        message: 'Player does not own this airport.'
      };
    }

    if (airportState.saleListing) {
      return {
        success: false,
        code: 'AIRPORT_ALREADY_LISTED',
        message: 'Airport is already listed for sale.'
      };
    }

    if (!Number.isFinite(askingPrice) || askingPrice <= 0) {
      return {
        success: false,
        code: 'INVALID_ASKING_PRICE',
        message: 'Asking price must be a finite positive number.'
      };
    }

    airportState.saleListing = {
      sellerPlayerId: player.id,
      askingPrice
    };

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      playerId: player.id,
      airportId: airportDefinition.id,
      saleListing: { ...airportState.saleListing }
    };
  }

  cancelAirportListing(playerId, airportId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const airports = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];
    const normalizedAirportId = String(airportId || '').trim();
    const player = players.find((candidate) => candidate.id === playerId);

    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const airportState = airports.find((candidate) => candidate.airportId === normalizedAirportId);
    const airportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(normalizedAirportId);
    if (!airportState || !airportDefinition) {
      return {
        success: false,
        code: 'AIRPORT_NOT_FOUND',
        message: 'Airport was not found.'
      };
    }

    if (airportState.ownerPlayerId !== player.id) {
      return {
        success: false,
        code: 'NOT_AIRPORT_OWNER',
        message: 'Player does not own this airport.'
      };
    }

    if (!airportState.saleListing) {
      return {
        success: false,
        code: 'AIRPORT_NOT_LISTED',
        message: 'Airport is not currently listed for sale.'
      };
    }

    if (airportState.saleListing.sellerPlayerId !== player.id) {
      return {
        success: false,
        code: 'LISTING_SELLER_MISMATCH',
        message: 'Airport listing does not belong to this player.'
      };
    }

    airportState.saleListing = null;

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      playerId: player.id,
      airportId: airportDefinition.id,
      saleListing: null
    };
  }

  getOwnedRoutesContainingAirport(playerId, airportId) {
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const normalizedPlayerId = String(playerId || '').trim();
    const normalizedAirportId = String(airportId || '').trim();

    if (!normalizedPlayerId || !normalizedAirportId) {
      return [];
    }

    return routes.filter((route) => {
      if (!route) {
        return false;
      }

      if (String(route.ownerPlayerId || '') !== normalizedPlayerId) {
        return false;
      }

      return (
        String(route.originAirportId || '') === normalizedAirportId ||
        String(route.destinationAirportId || '') === normalizedAirportId
      );
    });
  }

  removeRoutesWithAircraftCleanup(routesToRemove) {
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];
    const sourceRoutes = Array.isArray(routesToRemove) ? routesToRemove : [];
    const routeIdToAssignedAircraftIds = new Map();
    const routeIdsToRemove = [];
    const routeIdsToRemoveSet = new Set();
    const aircraftToUnassignById = new Map();

    for (const route of sourceRoutes) {
      if (!route || !route.routeId) {
        continue;
      }

      const normalizedRouteId = String(route.routeId || '').trim();
      if (!normalizedRouteId || routeIdsToRemoveSet.has(normalizedRouteId)) {
        continue;
      }

      const stateRoute = routes.find((candidate) => candidate && String(candidate.routeId) === normalizedRouteId);
      if (!stateRoute) {
        continue;
      }

      const assignedAircraftInstanceIds = Array.isArray(stateRoute.assignedAircraftInstanceIds)
        ? stateRoute.assignedAircraftInstanceIds
        : [];
      const normalizedAssignedAircraftIds = assignedAircraftInstanceIds
        .map((aircraftId) => String(aircraftId || '').trim())
        .filter((aircraftId) => aircraftId.length > 0);
      const listedAircraftIds = new Set(normalizedAssignedAircraftIds);

      for (const aircraftInstanceId of normalizedAssignedAircraftIds) {
        const aircraft = ownedAircraft.find(
          (candidate) => candidate && String(candidate.aircraftInstanceId) === aircraftInstanceId
        );
        if (!aircraft) {
          return {
            success: false,
            code: 'ASSIGNED_AIRCRAFT_NOT_FOUND',
            message: 'Route references an aircraft instance that does not exist.',
            aircraftInstanceId
          };
        }

        if (String(aircraft.assignedRouteId || '') !== String(stateRoute.routeId)) {
          return {
            success: false,
            code: 'ASSIGNMENT_MISMATCH',
            message: 'Route assignment state is inconsistent for one or more aircraft.',
            aircraftInstanceId
          };
        }

        aircraftToUnassignById.set(aircraftInstanceId, aircraft);
      }

      for (const aircraft of ownedAircraft) {
        if (!aircraft) {
          continue;
        }

        if (String(aircraft.assignedRouteId || '') !== String(stateRoute.routeId)) {
          continue;
        }

        const aircraftInstanceId = String(aircraft.aircraftInstanceId || '').trim();
        if (!listedAircraftIds.has(aircraftInstanceId)) {
          return {
            success: false,
            code: 'ASSIGNMENT_MISMATCH',
            message: 'Route assignment state is inconsistent for one or more aircraft.',
            aircraftInstanceId
          };
        }
      }

      routeIdsToRemoveSet.add(normalizedRouteId);
      routeIdsToRemove.push(normalizedRouteId);
      routeIdToAssignedAircraftIds.set(normalizedRouteId, normalizedAssignedAircraftIds);
    }

    for (const routeId of routeIdsToRemove) {
      const route = routes.find((candidate) => candidate && String(candidate.routeId || '').trim() === routeId);
      if (!route) {
        continue;
      }

      const assignedAircraftIds = routeIdToAssignedAircraftIds.get(routeId) || [];
      const assignedAircraftIdSet = new Set(assignedAircraftIds);
      const routeFlights = flights.filter((flight) => {
        if (!flight) {
          return false;
        }

        return String(flight.routeId || '').trim() === routeId;
      });

      if (routeFlights.length !== assignedAircraftIds.length) {
        return {
          success: false,
          code: 'FLIGHT_ASSIGNMENT_MISMATCH',
          message: 'Flight assignment state is inconsistent for one or more aircraft.'
        };
      }

      for (const routeFlight of routeFlights) {
        const flightAircraftInstanceId = String(routeFlight.aircraftInstanceId || '').trim();
        if (!assignedAircraftIdSet.has(flightAircraftInstanceId)) {
          return {
            success: false,
            code: 'FLIGHT_ASSIGNMENT_MISMATCH',
            message: 'Flight assignment state is inconsistent for one or more aircraft.',
            aircraftInstanceId: flightAircraftInstanceId
          };
        }

        const aircraft = aircraftToUnassignById.get(flightAircraftInstanceId);
        if (!aircraft) {
          return {
            success: false,
            code: 'ASSIGNED_AIRCRAFT_NOT_FOUND',
            message: 'Route references an aircraft instance that does not exist.',
            aircraftInstanceId: flightAircraftInstanceId
          };
        }

        const flightContext = this.resolveFlightRecordForAssignedAircraft(aircraft, route);
        if (!flightContext.success) {
          return flightContext;
        }
      }
    }

    for (const aircraft of aircraftToUnassignById.values()) {
      const detachResult = this.detachAircraftFromAssignment(aircraft.aircraftInstanceId);
      if (!detachResult.success) {
        return detachResult;
      }
    }

    this.authoritativeState.routes = routes.filter((route) => {
      if (!route || !route.routeId) {
        return true;
      }

      return !routeIdsToRemoveSet.has(String(route.routeId || '').trim());
    });

    return {
      success: true,
      removedRouteIds: routeIdsToRemove,
      routeIdToAssignedAircraftIds
    };
  }

  initiateAirportRouteShutdowns(playerId, airportId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const airports = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const normalizedPlayerId = String(playerId || '').trim();
    const normalizedAirportId = String(airportId || '').trim();

    const player = players.find((candidate) => candidate.id === normalizedPlayerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const airportState = airports.find((candidate) => candidate.airportId === normalizedAirportId);
    const airportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(normalizedAirportId);
    if (!airportState || !airportDefinition) {
      return {
        success: false,
        code: 'AIRPORT_NOT_FOUND',
        message: 'Airport was not found.'
      };
    }

    if (airportState.ownerPlayerId !== player.id) {
      return {
        success: false,
        code: 'NOT_AIRPORT_OWNER',
        message: 'Player does not own this airport.'
      };
    }

    const affectedRoutes = routes.filter((route) => {
      if (!route) {
        return false;
      }

      if (String(route.ownerPlayerId || '') !== normalizedPlayerId) {
        return false;
      }

      return (
        String(route.originAirportId || '') === normalizedAirportId ||
        String(route.destinationAirportId || '') === normalizedAirportId
      );
    });

    const affectedRouteIds = [];
    let changed = false;

    for (const route of affectedRoutes) {
      if (!route || !route.routeId) {
        continue;
      }

      if (route.pendingRemoval === true) {
        affectedRouteIds.push(route.routeId);
        continue;
      }

      route.pendingRemoval = true;
      route.reconfiguringModelCatalogIds = [];
      route.reconfigurationReferenceAircraftInstanceIds = {};
      affectedRouteIds.push(route.routeId);
      changed = true;
    }

    return {
      success: true,
      changed,
      affectedRouteIds
    };
  }

  purchaseListedAirport(buyerPlayerId, airportId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const airports = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];
    const normalizedAirportId = String(airportId || '').trim();

    const buyer = players.find((candidate) => candidate.id === buyerPlayerId);
    if (!buyer) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const airportState = airports.find((candidate) => candidate.airportId === normalizedAirportId);
    const airportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(normalizedAirportId);
    if (!airportState || !airportDefinition) {
      return {
        success: false,
        code: 'AIRPORT_NOT_FOUND',
        message: 'Airport was not found.'
      };
    }

    const listing = airportState.saleListing;
    if (!listing || typeof listing !== 'object') {
      return {
        success: false,
        code: 'AIRPORT_NOT_LISTED',
        message: 'Airport is not currently listed for sale.'
      };
    }

    const seller = players.find((candidate) => candidate.id === listing.sellerPlayerId);
    if (!seller) {
      return {
        success: false,
        code: 'SELLER_NOT_FOUND',
        message: 'Listing seller was not found in authoritative game state.'
      };
    }

    if (seller.id === buyer.id) {
      return {
        success: false,
        code: 'CANNOT_BUY_OWN_LISTING',
        message: 'Player cannot buy their own listing.'
      };
    }

    const askingPrice = listing.askingPrice;
    const buyerCapital = Number.isFinite(buyer.capital) ? buyer.capital : 0;
    if (!Number.isFinite(askingPrice) || askingPrice <= 0 || buyerCapital < askingPrice) {
      return {
        success: false,
        code: 'INSUFFICIENT_CAPITAL',
        message: 'Player does not have enough capital for this purchase.'
      };
    }

    if (airportState.pendingOwnershipChange != null) {
      return {
        success: false,
        code: 'AIRPORT_OWNERSHIP_CHANGE_PENDING',
        message: 'Airport ownership change is already pending.'
      };
    }

    const sellerRoutesUsingAirport = this.getOwnedRoutesContainingAirport(seller.id, airportDefinition.id);

    if (sellerRoutesUsingAirport.length === 0) {
      buyer.capital = buyerCapital - askingPrice;
      const sellerCapital = Number.isFinite(seller.capital) ? seller.capital : 0;
      seller.capital = sellerCapital + askingPrice;
      airportState.ownerPlayerId = buyer.id;
      airportState.saleListing = null;

      this.broadcastState();

      return {
        success: true,
        code: 'OK',
        buyerPlayerId: buyer.id,
        sellerPlayerId: seller.id,
        airportId: airportDefinition.id,
        pricePaid: askingPrice,
        buyerRemainingCapital: buyer.capital,
        sellerUpdatedCapital: seller.capital
      };
    }

    const previousBuyerCapital = buyer.capital;
    const previousSaleListing = airportState.saleListing;
    const previousPendingState = airportState.pendingOwnershipChange;

    buyer.capital = buyerCapital - askingPrice;

    airportState.pendingOwnershipChange = {
      type: 'player-transfer',
      sellerPlayerId: seller.id,
      buyerPlayerId: buyer.id,
      lockedAmount: askingPrice
    };

    airportState.saleListing = null;

    const shutdownResult = this.initiateAirportRouteShutdowns(seller.id, airportDefinition.id);
    if (!shutdownResult.success) {
      buyer.capital = previousBuyerCapital;
      airportState.saleListing = previousSaleListing;
      airportState.pendingOwnershipChange = previousPendingState;
      return shutdownResult;
    }

    this.broadcastState();

    return {
      success: true,
      code: 'AIRPORT_TRANSFER_PENDING',
      buyerPlayerId: buyer.id,
      sellerPlayerId: seller.id,
      airportId: airportDefinition.id,
      pricePaid: askingPrice,
      buyerRemainingCapital: buyer.capital,
      affectedRouteIds: shutdownResult.affectedRouteIds
    };
  }

  sellAirportToGame(playerId, airportId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const airports = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];
    const normalizedAirportId = String(airportId || '').trim();

    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const airportState = airports.find((candidate) => candidate.airportId === normalizedAirportId);
    const airportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(normalizedAirportId);
    if (!airportState || !airportDefinition) {
      return {
        success: false,
        code: 'AIRPORT_NOT_FOUND',
        message: 'Airport was not found.'
      };
    }

    if (airportState.ownerPlayerId !== player.id) {
      return {
        success: false,
        code: 'NOT_AIRPORT_OWNER',
        message: 'Player does not own this airport.'
      };
    }

    if (airportState.pendingOwnershipChange != null) {
      return {
        success: false,
        code: 'AIRPORT_OWNERSHIP_CHANGE_PENDING',
        message: 'Airport ownership change is already pending.'
      };
    }

    if (airportState.saleListing != null) {
      return {
        success: false,
        code: 'AIRPORT_ALREADY_LISTED',
        message: 'Airport is currently listed for sale. Cancel the listing first.'
      };
    }

    const basePrice = Number.isFinite(airportDefinition.basePrice) ? airportDefinition.basePrice : 0;
    const refundAmount = calculateAirportSellToGamePrice(basePrice);
    const currentCapital = Number.isFinite(player.capital) ? player.capital : 0;

    const playerRoutesUsingAirport = this.getOwnedRoutesContainingAirport(player.id, airportDefinition.id);

    if (playerRoutesUsingAirport.length === 0) {
      player.capital = currentCapital + refundAmount;
      airportState.ownerPlayerId = null;
      airportState.saleListing = null;

      this.broadcastState();

      return {
        success: true,
        code: 'OK',
        playerId: player.id,
        airportId: airportDefinition.id,
        refundAmount,
        updatedCapital: player.capital
      };
    }

    const previousPendingState = airportState.pendingOwnershipChange;

    airportState.pendingOwnershipChange = {
      type: 'sell-to-game',
      sellerPlayerId: player.id,
      buyerPlayerId: null,
      lockedAmount: refundAmount
    };

    const shutdownResult = this.initiateAirportRouteShutdowns(player.id, airportDefinition.id);
    if (!shutdownResult.success) {
      airportState.pendingOwnershipChange = previousPendingState;
      return shutdownResult;
    }

    this.broadcastState();

    return {
      success: true,
      code: 'AIRPORT_SALE_PENDING',
      playerId: player.id,
      airportId: airportDefinition.id,
      refundAmount,
      affectedRouteIds: shutdownResult.affectedRouteIds
    };
  }

  completePendingAirportSellToGame(airportId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const airports = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const normalizedAirportId = String(airportId || '').trim();

    const airportState = airports.find((candidate) => candidate.airportId === normalizedAirportId);
    if (!airportState) {
      return {
        success: false,
        code: 'AIRPORT_NOT_FOUND',
        message: 'Airport was not found.'
      };
    }

    const pendingChange = airportState.pendingOwnershipChange;
    if (!pendingChange || typeof pendingChange !== 'object') {
      return {
        success: false,
        code: 'NO_PENDING_OWNERSHIP_CHANGE',
        message: 'Airport has no pending ownership change.'
      };
    }

    if (pendingChange.type !== 'sell-to-game') {
      return {
        success: false,
        code: 'WRONG_TRANSACTION_TYPE',
        message: 'Pending ownership change is not a sell-to-game transaction.'
      };
    }

    const sellerPlayerId = pendingChange.sellerPlayerId;
    const lockedAmount = pendingChange.lockedAmount;

    if (!sellerPlayerId || typeof sellerPlayerId !== 'string') {
      return {
        success: false,
        code: 'INVALID_SELLER_ID',
        message: 'Pending transaction has invalid seller ID.'
      };
    }

    if (!Number.isFinite(lockedAmount) || lockedAmount < 0) {
      return {
        success: false,
        code: 'INVALID_LOCKED_AMOUNT',
        message: 'Pending transaction has invalid locked amount.'
      };
    }

    if (pendingChange.buyerPlayerId != null) {
      return {
        success: false,
        code: 'INVALID_BUYER_ID',
        message: 'Sell-to-game transaction should not have a buyer ID.'
      };
    }

    const seller = players.find((candidate) => candidate.id === sellerPlayerId);
    if (!seller) {
      return {
        success: false,
        code: 'SELLER_NOT_FOUND',
        message: 'Seller player was not found in authoritative game state.'
      };
    }

    if (airportState.ownerPlayerId !== sellerPlayerId) {
      return {
        success: false,
        code: 'SELLER_NO_LONGER_OWNER',
        message: 'Seller no longer owns this airport.'
      };
    }

    const affectedRoutes = routes.filter((route) => {
      if (!route) {
        return false;
      }

      if (String(route.ownerPlayerId || '') !== sellerPlayerId) {
        return false;
      }

      return (
        String(route.originAirportId || '') === normalizedAirportId ||
        String(route.destinationAirportId || '') === normalizedAirportId
      );
    });

    if (affectedRoutes.length > 0) {
      return {
        success: true,
        complete: false,
        changed: false
      };
    }

    const sellerCapital = Number.isFinite(seller.capital) ? seller.capital : 0;
    seller.capital = sellerCapital + lockedAmount;
    airportState.ownerPlayerId = null;
    airportState.saleListing = null;
    airportState.pendingOwnershipChange = null;

    return {
      success: true,
      complete: true,
      changed: true
    };
  }

  completePendingAirportPlayerTransfer(airportId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const airports = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const normalizedAirportId = String(airportId || '').trim();

    const airportState = airports.find((candidate) => candidate.airportId === normalizedAirportId);
    if (!airportState) {
      return {
        success: false,
        code: 'AIRPORT_NOT_FOUND',
        message: 'Airport was not found.'
      };
    }

    const pendingChange = airportState.pendingOwnershipChange;
    if (!pendingChange || typeof pendingChange !== 'object') {
      return {
        success: false,
        code: 'NO_PENDING_OWNERSHIP_CHANGE',
        message: 'Airport has no pending ownership change.'
      };
    }

    if (pendingChange.type !== 'player-transfer') {
      return {
        success: false,
        code: 'WRONG_TRANSACTION_TYPE',
        message: 'Pending ownership change is not a player-transfer transaction.'
      };
    }

    const sellerPlayerId = pendingChange.sellerPlayerId;
    const buyerPlayerId = pendingChange.buyerPlayerId;
    const lockedAmount = pendingChange.lockedAmount;

    if (!sellerPlayerId || typeof sellerPlayerId !== 'string') {
      return {
        success: false,
        code: 'INVALID_SELLER_ID',
        message: 'Pending transaction has invalid seller ID.'
      };
    }

    if (!buyerPlayerId || typeof buyerPlayerId !== 'string') {
      return {
        success: false,
        code: 'INVALID_BUYER_ID',
        message: 'Pending transaction has invalid buyer ID.'
      };
    }

    if (!Number.isFinite(lockedAmount) || lockedAmount < 0) {
      return {
        success: false,
        code: 'INVALID_LOCKED_AMOUNT',
        message: 'Pending transaction has invalid locked amount.'
      };
    }

    const seller = players.find((candidate) => candidate.id === sellerPlayerId);
    if (!seller) {
      return {
        success: false,
        code: 'SELLER_NOT_FOUND',
        message: 'Seller player was not found in authoritative game state.'
      };
    }

    const buyer = players.find((candidate) => candidate.id === buyerPlayerId);
    if (!buyer) {
      return {
        success: false,
        code: 'BUYER_NOT_FOUND',
        message: 'Buyer player was not found in authoritative game state.'
      };
    }

    if (airportState.ownerPlayerId !== sellerPlayerId) {
      return {
        success: false,
        code: 'SELLER_NO_LONGER_OWNER',
        message: 'Seller no longer owns this airport.'
      };
    }

    if (sellerPlayerId === buyerPlayerId) {
      return {
        success: false,
        code: 'SELLER_BUYER_SAME',
        message: 'Seller and buyer cannot be the same player.'
      };
    }

    if (airportState.saleListing != null) {
      return {
        success: false,
        code: 'LISTING_STILL_EXISTS',
        message: 'Airport listing still exists when it should have been consumed.'
      };
    }

    const affectedRoutes = routes.filter((route) => {
      if (!route) {
        return false;
      }

      if (String(route.ownerPlayerId || '') !== sellerPlayerId) {
        return false;
      }

      return (
        String(route.originAirportId || '') === normalizedAirportId ||
        String(route.destinationAirportId || '') === normalizedAirportId
      );
    });

    if (affectedRoutes.length > 0) {
      return {
        success: true,
        complete: false,
        changed: false
      };
    }

    const sellerCapital = Number.isFinite(seller.capital) ? seller.capital : 0;
    seller.capital = sellerCapital + lockedAmount;
    airportState.ownerPlayerId = buyerPlayerId;
    airportState.saleListing = null;
    airportState.pendingOwnershipChange = null;

    return {
      success: true,
      complete: true,
      changed: true
    };
  }

  createRoute(playerId, originAirportId, destinationAirportId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const airports = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const normalizedOriginAirportId = String(originAirportId || '').trim();
    const normalizedDestinationAirportId = String(destinationAirportId || '').trim();

    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const originAirportState = airports.find((candidate) => candidate.airportId === normalizedOriginAirportId);
    const destinationAirportState = airports.find((candidate) => candidate.airportId === normalizedDestinationAirportId);
    const originAirportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(normalizedOriginAirportId);
    const destinationAirportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(normalizedDestinationAirportId);

    if (
      !originAirportState ||
      !destinationAirportState ||
      !originAirportDefinition ||
      !destinationAirportDefinition
    ) {
      return {
        success: false,
        code: 'AIRPORT_NOT_FOUND',
        message: 'Airport was not found.'
      };
    }

    if (normalizedOriginAirportId === normalizedDestinationAirportId) {
      return {
        success: false,
        code: 'SAME_AIRPORT',
        message: 'Origin and destination airports must be different.'
      };
    }

    if (originAirportState.ownerPlayerId !== player.id || destinationAirportState.ownerPlayerId !== player.id) {
      return {
        success: false,
        code: 'AIRPORT_NOT_OWNED',
        message: 'Player does not own both airports.'
      };
    }

    const routeKey = canonicalRouteKey(normalizedOriginAirportId, normalizedDestinationAirportId);
    const existingRoute = routes.find((route) => {
      return route && String(route.ownerPlayerId) === String(player.id) && route.routeKey === routeKey;
    });

    if (existingRoute) {
      return {
        success: false,
        code: 'ROUTE_ALREADY_EXISTS',
        message: 'Route already exists for this player.'
      };
    }

    const route = {
      routeId: `route-${randomUUID()}`,
      ownerPlayerId: player.id,
      originAirportId: originAirportDefinition.id,
      destinationAirportId: destinationAirportDefinition.id,
      routeKey,
      distanceKm: calculateRouteDistanceKm(originAirportDefinition, destinationAirportDefinition),
      assignedAircraftInstanceIds: [],
      reconfiguringModelCatalogIds: [],
      reconfigurationReferenceAircraftInstanceIds: {},
      pendingRemoval: false,
      modelEditLockedUntilRealMs: {}
    };

    this.authoritativeState.routes = routes;
    this.authoritativeState.routes.push(route);
    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      ...route,
      assignedAircraftInstanceIds: route.assignedAircraftInstanceIds.slice()
    };
  }

  removeRoute(playerId, routeId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const normalizedRouteId = String(routeId || '').trim();

    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const routeIndex = routes.findIndex((route) => route && route.routeId === normalizedRouteId);
    if (routeIndex < 0) {
      return {
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'Route was not found.'
      };
    }

    const route = routes[routeIndex];
    if (String(route.ownerPlayerId) !== String(player.id)) {
      return {
        success: false,
        code: 'NOT_ROUTE_OWNER',
        message: 'Player does not own this route.'
      };
    }

    if (route.pendingRemoval === true) {
      return {
        success: false,
        code: 'ROUTE_REMOVAL_ALREADY_PENDING',
        message: 'Route removal is already pending.'
      };
    }

    const assignedAircraftInstanceIds = Array.isArray(route.assignedAircraftInstanceIds)
      ? route.assignedAircraftInstanceIds
      : [];

    if (assignedAircraftInstanceIds.length === 0) {
      route.pendingRemoval = true;
      route.reconfiguringModelCatalogIds = [];
      route.reconfigurationReferenceAircraftInstanceIds = {};
      route.pendingRemovalNotBeforeRealMs = Date.now() + 500;
      this.broadcastState();

      return {
        success: true,
        code: 'ROUTE_REMOVAL_PENDING',
        routeId: route.routeId,
        ownerPlayerId: route.ownerPlayerId
      };
    }

    route.pendingRemoval = true;
    route.reconfiguringModelCatalogIds = [];
    route.reconfigurationReferenceAircraftInstanceIds = {};
    this.broadcastState();

    return {
      success: true,
      code: 'ROUTE_REMOVAL_PENDING',
      routeId: route.routeId,
      ownerPlayerId: route.ownerPlayerId
    };
  }

  beginModelReconfiguration(routeId, aircraftCatalogId) {
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft) ? this.authoritativeState.ownedAircraft : [];
    const normalizedRouteId = String(routeId || '').trim();
    const normalizedAircraftCatalogId = String(aircraftCatalogId || '').trim();

    const route = routes.find((candidate) => candidate && candidate.routeId === normalizedRouteId);
    if (!route) {
      return {
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'Route was not found.'
      };
    }

    const reconfiguringModelCatalogIds = Array.isArray(route.reconfiguringModelCatalogIds)
      ? route.reconfiguringModelCatalogIds
      : [];
    const isAlreadyReconfiguring = reconfiguringModelCatalogIds.some((modelId) => {
      return String(modelId || '').trim() === normalizedAircraftCatalogId;
    });

    if (isAlreadyReconfiguring) {
      return { success: true, code: 'OK' };
    }

    const reconfigurationReferenceAircraftInstanceIds = route.reconfigurationReferenceAircraftInstanceIds || {};

    const drainingFlights = flights.filter((flight) => {
      if (!flight || !flight.flightId) {
        return false;
      }
      if (String(flight.routeId || '').trim() !== normalizedRouteId) {
        return false;
      }
      const aircraft = ownedAircraft.find((candidate) => {
        return candidate && String(candidate.aircraftInstanceId || '').trim() === String(flight.aircraftInstanceId || '').trim();
      });
      if (!aircraft) {
        return false;
      }
      if (String(aircraft.aircraftCatalogId || '').trim() !== normalizedAircraftCatalogId) {
        return false;
      }
      const currentStatus = String(flight.status || '').trim();
      return currentStatus === 'in-flight' || currentStatus === 'turnaround';
    });

    if (drainingFlights.length > 0) {
      const referenceFlight = drainingFlights.reduce((latest, current) => {
        const latestTimestamp = Number.isFinite(latest.lastOutboundDepartedAtSimulationMs)
          ? latest.lastOutboundDepartedAtSimulationMs
          : 0;
        const currentTimestamp = Number.isFinite(current.lastOutboundDepartedAtSimulationMs)
          ? current.lastOutboundDepartedAtSimulationMs
          : 0;
        return currentTimestamp > latestTimestamp ? current : latest;
      });
      reconfigurationReferenceAircraftInstanceIds[normalizedAircraftCatalogId] = referenceFlight.aircraftInstanceId;
    } else {
      reconfigurationReferenceAircraftInstanceIds[normalizedAircraftCatalogId] = null;
    }

    route.reconfiguringModelCatalogIds = reconfiguringModelCatalogIds;
    if (!route.reconfiguringModelCatalogIds.includes(normalizedAircraftCatalogId)) {
      route.reconfiguringModelCatalogIds.push(normalizedAircraftCatalogId);
    }
    route.reconfigurationReferenceAircraftInstanceIds = reconfigurationReferenceAircraftInstanceIds;

    return { success: true, code: 'OK' };
  }

  isModelReconfigurationDrainComplete(routeId, aircraftCatalogId) {
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft) ? this.authoritativeState.ownedAircraft : [];
    const normalizedRouteId = String(routeId || '').trim();
    const normalizedAircraftCatalogId = String(aircraftCatalogId || '').trim();

    const route = routes.find((candidate) => candidate && candidate.routeId === normalizedRouteId);
    if (!route) {
      return {
        success: false,
        complete: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'Route was not found.'
      };
    }

    const reconfigurationReferenceAircraftInstanceIds = route.reconfigurationReferenceAircraftInstanceIds || {};
    const referenceAircraftInstanceId = reconfigurationReferenceAircraftInstanceIds[normalizedAircraftCatalogId];

    if (referenceAircraftInstanceId === null || referenceAircraftInstanceId === undefined) {
      return { success: true, complete: true };
    }

    const normalizedReferenceAircraftInstanceId = String(referenceAircraftInstanceId || '').trim();
    const aircraft = ownedAircraft.find((candidate) => {
      return candidate && String(candidate.aircraftInstanceId || '').trim() === normalizedReferenceAircraftInstanceId;
    });
    if (!aircraft) {
      return {
        success: false,
        complete: false,
        code: 'RECONFIGURATION_REFERENCE_INVALID',
        message: 'Reference aircraft instance was not found.'
      };
    }

    if (String(aircraft.assignedRouteId || '').trim() !== normalizedRouteId) {
      return {
        success: false,
        complete: false,
        code: 'RECONFIGURATION_REFERENCE_INVALID',
        message: 'Reference aircraft no longer belongs to the expected route.'
      };
    }

    if (String(aircraft.aircraftCatalogId || '').trim() !== normalizedAircraftCatalogId) {
      return {
        success: false,
        complete: false,
        code: 'RECONFIGURATION_REFERENCE_INVALID',
        message: 'Reference aircraft model does not match expected catalog ID.'
      };
    }

    const flight = flights.find((candidate) => {
      return candidate && String(candidate.aircraftInstanceId || '').trim() === normalizedReferenceAircraftInstanceId;
    });
    if (!flight) {
      return {
        success: false,
        complete: false,
        code: 'RECONFIGURATION_REFERENCE_INVALID',
        message: 'Reference aircraft flight record was not found.'
      };
    }

    const currentStatus = String(flight.status || '').trim();
    const currentDirection = String(flight.direction || '').trim();
    const currentOriginAirportId = String(flight.originAirportId || '').trim();
    const routeOriginAirportId = String(route.originAirportId || '').trim();

    const isHomeReady = currentStatus === 'ready' &&
                        currentDirection === 'outbound' &&
                        currentOriginAirportId === routeOriginAirportId;

    return { success: true, complete: isHomeReady };
  }

  completePendingUnassignsForModelReconfiguration(routeId, aircraftCatalogId) {
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft) ? this.authoritativeState.ownedAircraft : [];
    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];
    const normalizedRouteId = String(routeId || '').trim();
    const normalizedAircraftCatalogId = String(aircraftCatalogId || '').trim();

    const route = routes.find((candidate) => candidate && candidate.routeId === normalizedRouteId);
    if (!route) {
      return {
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'Route was not found.'
      };
    }

    const routeOriginAirportId = String(route.originAirportId || '').trim();

    const pendingUnassignAircraft = ownedAircraft.filter((aircraft) => {
      if (!aircraft) {
        return false;
      }
      if (String(aircraft.assignedRouteId || '').trim() !== normalizedRouteId) {
        return false;
      }
      if (String(aircraft.aircraftCatalogId || '').trim() !== normalizedAircraftCatalogId) {
        return false;
      }
      const pendingAction = String(aircraft.pendingRouteExitAction || '').trim();
      return pendingAction === 'unassign';
    });

    if (pendingUnassignAircraft.length === 0) {
      return { success: true, changed: false };
    }

    for (const aircraft of pendingUnassignAircraft) {
      const flight = flights.find((candidate) => {
        return candidate && String(candidate.aircraftInstanceId || '').trim() === String(aircraft.aircraftInstanceId || '').trim();
      });

      if (!flight) {
        return {
          success: false,
          code: 'FLIGHT_NOT_FOUND',
          message: 'Flight record was not found for pending-unassign aircraft.'
        };
      }

      if (String(flight.routeId || '').trim() !== normalizedRouteId) {
        return {
          success: false,
          code: 'FLIGHT_ROUTE_MISMATCH',
          message: 'Pending-unassign aircraft flight does not belong to the expected route.'
        };
      }

      const currentStatus = String(flight.status || '').trim();
      const currentDirection = String(flight.direction || '').trim();
      const currentOriginAirportId = String(flight.originAirportId || '').trim();

      if (currentStatus !== 'ready' || currentDirection !== 'outbound' || currentOriginAirportId !== routeOriginAirportId) {
        return {
          success: false,
          code: 'AIRCRAFT_NOT_HOME_READY',
          message: 'Pending-unassign aircraft is not home-ready for detachment.'
        };
      }
    }

    for (const aircraft of pendingUnassignAircraft) {
      const detachResult = this.detachAircraftFromAssignment(aircraft.aircraftInstanceId);
      if (!detachResult.success) {
        return {
          success: false,
          code: 'DETACH_FAILED',
          message: 'Failed to detach pending-unassign aircraft.'
        };
      }

      aircraft.pendingRouteExitAction = null;
    }

    return { success: true, changed: true };
  }

  completePendingSalesForModelReconfiguration(routeId, aircraftCatalogId) {
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft) ? this.authoritativeState.ownedAircraft : [];
    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const normalizedRouteId = String(routeId || '').trim();
    const normalizedAircraftCatalogId = String(aircraftCatalogId || '').trim();

    const route = routes.find((candidate) => candidate && candidate.routeId === normalizedRouteId);
    if (!route) {
      return {
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'Route was not found.'
      };
    }

    const routeOriginAirportId = String(route.originAirportId || '').trim();

    const pendingSaleAircraft = ownedAircraft.filter((aircraft) => {
      if (!aircraft) {
        return false;
      }
      if (String(aircraft.assignedRouteId || '').trim() !== normalizedRouteId) {
        return false;
      }
      if (String(aircraft.aircraftCatalogId || '').trim() !== normalizedAircraftCatalogId) {
        return false;
      }
      const pendingAction = String(aircraft.pendingRouteExitAction || '').trim();
      return pendingAction === 'sell';
    });

    if (pendingSaleAircraft.length === 0) {
      return { success: true, changed: false, quantitySold: 0, totalRefund: 0 };
    }

    for (const aircraft of pendingSaleAircraft) {
      const flight = flights.find((candidate) => {
        return candidate && String(candidate.aircraftInstanceId || '').trim() === String(aircraft.aircraftInstanceId || '').trim();
      });

      if (!flight) {
        return {
          success: false,
          code: 'FLIGHT_NOT_FOUND',
          message: 'Flight record was not found for pending-sale aircraft.'
        };
      }

      if (String(flight.routeId || '').trim() !== normalizedRouteId) {
        return {
          success: false,
          code: 'FLIGHT_ROUTE_MISMATCH',
          message: 'Pending-sale aircraft flight does not belong to the expected route.'
        };
      }

      const currentStatus = String(flight.status || '').trim();
      const currentDirection = String(flight.direction || '').trim();
      const currentOriginAirportId = String(flight.originAirportId || '').trim();

      if (currentStatus !== 'ready' || currentDirection !== 'outbound' || currentOriginAirportId !== routeOriginAirportId) {
        return {
          success: false,
          code: 'AIRCRAFT_NOT_HOME_READY',
          message: 'Pending-sale aircraft is not home-ready for sale completion.'
        };
      }

      const pendingSaleRefund = Number(aircraft.pendingSaleRefund);
      if (!Number.isFinite(pendingSaleRefund) || pendingSaleRefund < 0) {
        return {
          success: false,
          code: 'INVALID_PENDING_REFUND',
          message: 'Pending-sale aircraft has an invalid refund amount.'
        };
      }

      const player = players.find((candidate) => candidate && candidate.id === aircraft.ownerPlayerId);
      if (!player) {
        return {
          success: false,
          code: 'OWNER_NOT_FOUND',
          message: 'Pending-sale aircraft owner was not found.'
        };
      }
    }

    const pendingSaleAircraftInstanceIds = new Set(
      pendingSaleAircraft.map((aircraft) => String(aircraft.aircraftInstanceId || '').trim())
    );

    let totalRefund = 0;

    for (const aircraft of pendingSaleAircraft) {
      const detachResult = this.detachAircraftFromAssignment(aircraft.aircraftInstanceId);
      if (!detachResult.success) {
        return {
          success: false,
          code: 'DETACH_FAILED',
          message: 'Failed to detach pending-sale aircraft.'
        };
      }

      const pendingSaleRefund = Number(aircraft.pendingSaleRefund);
      totalRefund += pendingSaleRefund;

      const player = players.find((candidate) => candidate && candidate.id === aircraft.ownerPlayerId);
      if (player) {
        const currentCapital = Number.isFinite(player.capital) ? player.capital : 0;
        player.capital = currentCapital + pendingSaleRefund;
      }
    }

    this.authoritativeState.ownedAircraft = this.authoritativeState.ownedAircraft.filter((aircraft) => {
      const aircraftInstanceId = String(aircraft?.aircraftInstanceId || '').trim();
      return !pendingSaleAircraftInstanceIds.has(aircraftInstanceId);
    });

    const remainingOwnedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    for (const pendingSaleId of pendingSaleAircraftInstanceIds) {
      const stillExists = remainingOwnedAircraft.some((aircraft) => {
        return aircraft && String(aircraft.aircraftInstanceId || '').trim() === pendingSaleId;
      });
      if (stillExists) {
        console.error(
          `Pending-sale aircraft ${pendingSaleId} was not removed from ownedAircraft after completion. This is a critical bug.`
        );
        return {
          success: false,
          code: 'SALE_REMOVAL_FAILED',
          message: 'Pending-sale aircraft was not removed from ownership after completion.'
        };
      }
    }

    return { success: true, changed: true, quantitySold: pendingSaleAircraft.length, totalRefund };
  }

  completePendingRouteRemoval(routeId) {
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft) ? this.authoritativeState.ownedAircraft : [];
    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const normalizedRouteId = String(routeId || '').trim();

    const route = routes.find((candidate) => candidate && candidate.routeId === normalizedRouteId);
    if (!route) {
      return {
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'Route was not found.'
      };
    }

    if (route.pendingRemoval !== true) {
      return {
        success: false,
        code: 'ROUTE_NOT_PENDING_REMOVAL',
        message: 'Route is not pending removal.'
      };
    }

    const routeOriginAirportId = String(route.originAirportId || '').trim();

    const assignedAircraftInstanceIds = Array.isArray(route.assignedAircraftInstanceIds)
      ? route.assignedAircraftInstanceIds
      : [];

    if (assignedAircraftInstanceIds.length === 0) {
      const notBeforeRealMs =
        Number(route.pendingRemovalNotBeforeRealMs);

      if (Date.now() < notBeforeRealMs) {
        return {
          success: true,
          complete: false,
          changed: false
        };
      }

      const cleanupResult = this.removeRoutesWithAircraftCleanup([route]);
      if (!cleanupResult.success) {
        return cleanupResult;
      }

      return {
        success: true,
        complete: true,
        changed: true
      };
    }

    const attachedAircraft = assignedAircraftInstanceIds
      .map((instanceId) => {
        const aircraft = ownedAircraft.find((candidate) => {
          return candidate && String(candidate.aircraftInstanceId || '').trim() === String(instanceId || '').trim();
        });
        return aircraft;
      })
      .filter((aircraft) => aircraft != null);

    for (const aircraft of attachedAircraft) {
      const flight = flights.find((candidate) => {
        return candidate && String(candidate.aircraftInstanceId || '').trim() === String(aircraft.aircraftInstanceId || '').trim();
      });

      if (!flight) {
        return {
          success: true,
          complete: false,
          changed: false
        };
      }

      if (String(flight.routeId || '').trim() !== normalizedRouteId) {
        return {
          success: true,
          complete: false,
          changed: false
        };
      }

      const currentStatus = String(flight.status || '').trim();
      const currentDirection = String(flight.direction || '').trim();
      const currentOriginAirportId = String(flight.originAirportId || '').trim();

      if (currentStatus !== 'ready' || currentDirection !== 'outbound' || currentOriginAirportId !== routeOriginAirportId) {
        return {
          success: true,
          complete: false,
          changed: false
        };
      }
    }

    const pendingSaleAircraft = [];
    const pendingUnassignAircraft = [];
    const ordinaryAircraft = [];

    for (const aircraft of attachedAircraft) {
      const pendingAction = String(aircraft.pendingRouteExitAction || '').trim();
      if (pendingAction === 'sell') {
        pendingSaleAircraft.push(aircraft);
      } else if (pendingAction === 'unassign') {
        pendingUnassignAircraft.push(aircraft);
      } else {
        ordinaryAircraft.push(aircraft);
      }
    }

    for (const aircraft of pendingSaleAircraft) {
      const pendingSaleRefund = Number(aircraft.pendingSaleRefund);
      if (!Number.isFinite(pendingSaleRefund) || pendingSaleRefund < 0) {
        return {
          success: false,
          code: 'INVALID_PENDING_REFUND',
          message: 'Pending-sale aircraft has an invalid refund amount.'
        };
      }

      const player = players.find((candidate) => candidate && candidate.id === aircraft.ownerPlayerId);
      if (!player) {
        return {
          success: false,
          code: 'OWNER_NOT_FOUND',
          message: 'Pending-sale aircraft owner was not found.'
        };
      }
    }

    for (const aircraft of pendingSaleAircraft) {
      const detachResult = this.detachAircraftFromAssignment(aircraft.aircraftInstanceId);
      if (!detachResult.success) {
        return {
          success: false,
          code: 'DETACH_FAILED',
          message: 'Failed to detach pending-sale aircraft.'
        };
      }

      const pendingSaleRefund = Number(aircraft.pendingSaleRefund);
      const player = players.find((candidate) => candidate && candidate.id === aircraft.ownerPlayerId);
      if (player) {
        const currentCapital = Number.isFinite(player.capital) ? player.capital : 0;
        player.capital = currentCapital + pendingSaleRefund;
      }
    }

    const pendingSaleAircraftInstanceIds = new Set(
      pendingSaleAircraft.map((aircraft) => String(aircraft.aircraftInstanceId || '').trim())
    );

    this.authoritativeState.ownedAircraft = this.authoritativeState.ownedAircraft.filter((aircraft) => {
      const aircraftInstanceId = String(aircraft?.aircraftInstanceId || '').trim();
      return !pendingSaleAircraftInstanceIds.has(aircraftInstanceId);
    });

    for (const aircraft of pendingUnassignAircraft) {
      const detachResult = this.detachAircraftFromAssignment(aircraft.aircraftInstanceId);
      if (!detachResult.success) {
        return {
          success: false,
          code: 'DETACH_FAILED',
          message: 'Failed to detach pending-unassign aircraft.'
        };
      }

      aircraft.pendingRouteExitAction = null;
    }

    for (const aircraft of ordinaryAircraft) {
      const detachResult = this.detachAircraftFromAssignment(aircraft.aircraftInstanceId);
      if (!detachResult.success) {
        return {
          success: false,
          code: 'DETACH_FAILED',
          message: 'Failed to detach ordinary aircraft.'
        };
      }
    }

    this.authoritativeState.flights = this.authoritativeState.flights.filter((flight) => {
      return String(flight.routeId || '').trim() !== normalizedRouteId;
    });

    this.authoritativeState.routes = this.authoritativeState.routes.filter((candidate) => {
      return !(candidate && candidate.routeId === normalizedRouteId);
    });

    return {
      success: true,
      complete: true,
      changed: true
    };
  }

  rebuildModelDepartureSchedule(routeId, aircraftCatalogId, rebuildStartSimulationMs) {
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft) ? this.authoritativeState.ownedAircraft : [];
    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];
    const normalizedRouteId = String(routeId || '').trim();
    const normalizedAircraftCatalogId = String(aircraftCatalogId || '').trim();

    if (!Number.isFinite(rebuildStartSimulationMs)) {
      return {
        success: false,
        code: 'REBUILD_START_INVALID',
        message: 'Rebuild start timestamp must be finite.'
      };
    }

    const route = routes.find((candidate) => candidate && candidate.routeId === normalizedRouteId);
    if (!route) {
      return {
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'Route was not found.'
      };
    }

    const reconfiguringModelCatalogIds = Array.isArray(route.reconfiguringModelCatalogIds)
      ? route.reconfiguringModelCatalogIds
      : [];
    const isModelReconfiguring = reconfiguringModelCatalogIds.some((modelId) => {
      return String(modelId || '').trim() === normalizedAircraftCatalogId;
    });

    if (!isModelReconfiguring) {
      return {
        success: false,
        code: 'MODEL_NOT_RECONFIGURING',
        message: 'Model is not currently reconfiguring on this route.'
      };
    }

    const aircraftDefinition = AIRCRAFT_CATALOG_BY_ID[normalizedAircraftCatalogId];
    if (!aircraftDefinition) {
      return {
        success: false,
        code: 'AIRCRAFT_DEFINITION_NOT_FOUND',
        message: 'Aircraft catalog definition was not found.'
      };
    }

    const cruiseSpeedKmH = Number(aircraftDefinition.cruiseSpeedKmH);
    if (!Number.isFinite(cruiseSpeedKmH) || cruiseSpeedKmH <= 0) {
      return {
        success: false,
        code: 'AIRCRAFT_SPEED_INVALID',
        message: 'Aircraft cruise speed is invalid for schedule calculation.'
      };
    }

    const routeDistanceKm = Number(route.distanceKm);
    if (!Number.isFinite(routeDistanceKm) || routeDistanceKm <= 0) {
      return {
        success: false,
        code: 'ROUTE_DISTANCE_INVALID',
        message: 'Route distance is invalid for schedule calculation.'
      };
    }

    const assignedAircraftInstanceIds = Array.isArray(route.assignedAircraftInstanceIds)
      ? route.assignedAircraftInstanceIds
      : [];
    const physicallyAttachedAircraft = ownedAircraft.filter((aircraft) => {
      if (!aircraft) {
        return false;
      }
      if (String(aircraft.assignedRouteId || '').trim() !== normalizedRouteId) {
        return false;
      }
      if (String(aircraft.aircraftCatalogId || '').trim() !== normalizedAircraftCatalogId) {
        return false;
      }
      return true;
    });

    const effectiveRosterAircraft = physicallyAttachedAircraft.filter((aircraft) => {
      const pendingAction = String(aircraft.pendingRouteExitAction || '').trim();
      return pendingAction !== 'unassign';
    });

    const effectiveRosterAircraftInstanceIds = effectiveRosterAircraft.map((aircraft) => aircraft.aircraftInstanceId);
    const rosterConsistent = effectiveRosterAircraftInstanceIds.every((instanceId) => {
      return assignedAircraftInstanceIds.includes(instanceId);
    });

    if (!rosterConsistent) {
      return {
        success: false,
        code: 'ROSTER_INCONSISTENT',
        message: 'Effective rebuild roster is inconsistent with route assignment state.'
      };
    }

    if (effectiveRosterAircraft.length === 0) {
      route.reconfiguringModelCatalogIds = reconfiguringModelCatalogIds.filter((modelId) => {
        return String(modelId || '').trim() !== normalizedAircraftCatalogId;
      });
      const reconfigurationReferenceAircraftInstanceIds = route.reconfigurationReferenceAircraftInstanceIds || {};
      delete reconfigurationReferenceAircraftInstanceIds[normalizedAircraftCatalogId];
      route.reconfigurationReferenceAircraftInstanceIds = reconfigurationReferenceAircraftInstanceIds;

      return { success: true, changed: true };
    }

    const routeOriginAirportId = String(route.originAirportId || '').trim();

    for (const aircraft of effectiveRosterAircraft) {
      const flight = flights.find((candidate) => {
        return candidate && String(candidate.aircraftInstanceId || '').trim() === String(aircraft.aircraftInstanceId || '').trim();
      });

      if (!flight) {
        return {
          success: false,
          code: 'FLIGHT_NOT_FOUND',
          message: 'Flight record was not found for roster aircraft.'
        };
      }

      if (String(flight.routeId || '').trim() !== normalizedRouteId) {
        return {
          success: false,
          code: 'FLIGHT_ROUTE_MISMATCH',
          message: 'Flight does not belong to the expected route.'
        };
      }

      const currentStatus = String(flight.status || '').trim();
      const currentDirection = String(flight.direction || '').trim();
      const currentOriginAirportId = String(flight.originAirportId || '').trim();

      if (currentStatus !== 'ready' || currentDirection !== 'outbound' || currentOriginAirportId !== routeOriginAirportId) {
        return {
          success: false,
          code: 'AIRCRAFT_NOT_HOME_READY',
          message: 'Aircraft is not home-ready for schedule rebuild.'
        };
      }
    }

    const oneWayFlightDurationSimulationMs = calculateFlightDurationSimulationMs(routeDistanceKm, cruiseSpeedKmH);
    if (!Number.isFinite(oneWayFlightDurationSimulationMs) || oneWayFlightDurationSimulationMs <= 0) {
      return {
        success: false,
        code: 'FLIGHT_DURATION_INVALID',
        message: 'Flight duration could not be calculated for schedule interval.'
      };
    }

    const departureIntervalSimulationMs = oneWayFlightDurationSimulationMs / effectiveRosterAircraft.length;

    const rosterOrder = assignedAircraftInstanceIds
      .filter((instanceId) => effectiveRosterAircraftInstanceIds.includes(instanceId))
      .map((instanceId) => effectiveRosterAircraft.find((aircraft) => aircraft.aircraftInstanceId === instanceId))
      .filter((aircraft) => aircraft !== undefined);

    for (let i = 0; i < rosterOrder.length; i++) {
      const aircraft = rosterOrder[i];
      const flight = flights.find((candidate) => {
        return candidate && String(candidate.aircraftInstanceId || '').trim() === String(aircraft.aircraftInstanceId || '').trim();
      });

      if (flight) {
        flight.nextTransitionAtSimulationMs = rebuildStartSimulationMs + (i * departureIntervalSimulationMs);
      }
    }

    route.reconfiguringModelCatalogIds = reconfiguringModelCatalogIds.filter((modelId) => {
      return String(modelId || '').trim() !== normalizedAircraftCatalogId;
    });
    const reconfigurationReferenceAircraftInstanceIds = route.reconfigurationReferenceAircraftInstanceIds || {};
    delete reconfigurationReferenceAircraftInstanceIds[normalizedAircraftCatalogId];
    route.reconfigurationReferenceAircraftInstanceIds = reconfigurationReferenceAircraftInstanceIds;

    return { success: true, changed: true };
  }

  assignAircraftToRoute(playerId, routeId, aircraftInstanceId, editOperationId = undefined) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    const normalizedRouteId = String(routeId || '').trim();
    const normalizedAircraftInstanceId = String(aircraftInstanceId || '').trim();

    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const route = routes.find((candidate) => candidate && candidate.routeId === normalizedRouteId);
    if (!route) {
      return {
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'Route was not found.'
      };
    }

    const aircraft = ownedAircraft.find(
      (candidate) => candidate && candidate.aircraftInstanceId === normalizedAircraftInstanceId
    );
    if (!aircraft) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_FOUND',
        message: 'Aircraft instance was not found.'
      };
    }

    if (String(route.ownerPlayerId) !== String(player.id)) {
      return {
        success: false,
        code: 'NOT_ROUTE_OWNER',
        message: 'Player does not own this route.'
      };
    }

    if (String(aircraft.ownerPlayerId) !== String(player.id)) {
      return {
        success: false,
        code: 'NOT_AIRCRAFT_OWNER',
        message: 'Player does not own this aircraft.'
      };
    }

    if (aircraft.status !== OWNED_AIRCRAFT_STATUS.AVAILABLE) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_AVAILABLE',
        message: 'Aircraft is not available for assignment.'
      };
    }

    if (aircraft.assignedRouteId !== null) {
      return {
        success: false,
        code: 'AIRCRAFT_ALREADY_ASSIGNED',
        message: 'Aircraft is already assigned to a route.'
      };
    }

    const aircraftDefinition = AIRCRAFT_CATALOG_BY_ID[String(aircraft.aircraftCatalogId || '')];
    const aircraftRangeKm = aircraftDefinition ? aircraftDefinition.rangeKm : null;
    const aircraftCruiseSpeedKmH = aircraftDefinition ? aircraftDefinition.cruiseSpeedKmH : null;
    const routeDistanceKm = Number(route.distanceKm);
    if (
      !aircraftDefinition ||
      !Number.isFinite(aircraftRangeKm) ||
      !Number.isFinite(routeDistanceKm) ||
      aircraftRangeKm < routeDistanceKm
    ) {
      return {
        success: false,
        code: 'AIRCRAFT_RANGE_INSUFFICIENT',
        message: 'Aircraft range is insufficient for this route.'
      };
    }

    if (!Number.isFinite(aircraftCruiseSpeedKmH) || aircraftCruiseSpeedKmH <= 0) {
      return {
        success: false,
        code: 'AIRCRAFT_SPEED_INVALID',
        message: 'Aircraft cruise speed is invalid for flight timing calculations.'
      };
    }

    const assignedAircraftInstanceIds = Array.isArray(route.assignedAircraftInstanceIds)
      ? route.assignedAircraftInstanceIds
      : [];

    if (assignedAircraftInstanceIds.includes(aircraft.aircraftInstanceId)) {
      return {
        success: false,
        code: 'AIRCRAFT_ALREADY_ASSIGNED',
        message: 'Aircraft is already assigned to this route.'
      };
    }

    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];
    const existingFlightsForAircraft = flights.filter((flight) => {
      if (!flight) {
        return false;
      }

      return String(flight.aircraftInstanceId || '').trim() === normalizedAircraftInstanceId;
    });

    if (existingFlightsForAircraft.length > 0) {
      return {
        success: false,
        code: existingFlightsForAircraft.length > 1 ? 'FLIGHT_DUPLICATE' : 'FLIGHT_ALREADY_EXISTS',
        message:
          existingFlightsForAircraft.length > 1
            ? 'More than one flight exists for this aircraft instance.'
            : 'Aircraft already has a flight record.'
      };
    }

    const lockedUntil = Number(route.modelEditLockedUntilRealMs?.[aircraft.aircraftCatalogId]);
    if (Number.isFinite(lockedUntil) && Date.now() < lockedUntil) {
      return {
        success: false,
        code: 'MODEL_EDIT_LOCKED',
        message: 'Aircraft scheduling is temporarily locked while the route schedule stabilizes.'
      };
    }

    this.beginModelReconfiguration(route.routeId, aircraft.aircraftCatalogId);

    route.assignedAircraftInstanceIds = assignedAircraftInstanceIds;
    route.assignedAircraftInstanceIds.push(aircraft.aircraftInstanceId);
    aircraft.status = OWNED_AIRCRAFT_STATUS.ASSIGNED;
    aircraft.assignedRouteId = route.routeId;
    flights.push(this.createReadyFlightRecord(route, aircraft));
    this.authoritativeState.flights = flights;

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      routeId: route.routeId,
      aircraftInstanceId: aircraft.aircraftInstanceId,
      aircraftStatus: aircraft.status,
      assignedRouteId: aircraft.assignedRouteId,
      assignedAircraftInstanceIds: route.assignedAircraftInstanceIds.slice()
    };
  }

  assignAircraftToRouteBulk(playerId, routeId, aircraftInstanceIds) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    const normalizedRouteId = String(routeId || '').trim();

    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const route = routes.find((candidate) => candidate && candidate.routeId === normalizedRouteId);
    if (!route) {
      return {
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'Route was not found.'
      };
    }

    if (String(route.ownerPlayerId) !== String(player.id)) {
      return {
        success: false,
        code: 'NOT_ROUTE_OWNER',
        message: 'Player does not own this route.'
      };
    }

    if (route.pendingRemoval === true) {
      return {
        success: false,
        code: 'ROUTE_REMOVAL_PENDING',
        message: 'Route is pending removal and cannot be edited.'
      };
    }

    if (!Array.isArray(aircraftInstanceIds) || aircraftInstanceIds.length === 0) {
      return {
        success: false,
        code: 'INVALID_AIRCRAFT_IDS',
        message: 'Aircraft instance IDs must be a non-empty array.'
      };
    }

    const normalizedAircraftInstanceIds = aircraftInstanceIds
      .map((aircraftInstanceId) => String(aircraftInstanceId || '').trim())
      .filter((aircraftInstanceId) => aircraftInstanceId.length > 0);

    if (normalizedAircraftInstanceIds.length === 0) {
      return {
        success: false,
        code: 'INVALID_AIRCRAFT_IDS',
        message: 'Aircraft instance IDs must be a non-empty array.'
      };
    }

    if (normalizedAircraftInstanceIds.length !== new Set(normalizedAircraftInstanceIds).size) {
      return {
        success: false,
        code: 'DUPLICATE_AIRCRAFT_IDS',
        message: 'Aircraft instance IDs must be unique.'
      };
    }

    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];
    const assignedAircraftInstanceIds = Array.isArray(route.assignedAircraftInstanceIds)
      ? route.assignedAircraftInstanceIds
      : [];

    const validAircraft = [];
    const seenCatalogIds = new Set();

    for (const normalizedAircraftInstanceId of normalizedAircraftInstanceIds) {
      const aircraft = ownedAircraft.find(
        (candidate) => candidate && candidate.aircraftInstanceId === normalizedAircraftInstanceId
      );
      if (!aircraft) {
        return {
          success: false,
          code: 'AIRCRAFT_NOT_FOUND',
          message: 'Aircraft instance was not found.',
          aircraftInstanceId: normalizedAircraftInstanceId
        };
      }

      if (String(aircraft.ownerPlayerId) !== String(player.id)) {
        return {
          success: false,
          code: 'NOT_AIRCRAFT_OWNER',
          message: 'Player does not own this aircraft.',
          aircraftInstanceId: normalizedAircraftInstanceId
        };
      }

      if (aircraft.status !== OWNED_AIRCRAFT_STATUS.AVAILABLE) {
        return {
          success: false,
          code: 'AIRCRAFT_NOT_AVAILABLE',
          message: 'Aircraft is not available for assignment.',
          aircraftInstanceId: normalizedAircraftInstanceId
        };
      }

      if (aircraft.assignedRouteId !== null) {
        return {
          success: false,
          code: 'AIRCRAFT_ALREADY_ASSIGNED',
          message: 'Aircraft is already assigned to a route.',
          aircraftInstanceId: normalizedAircraftInstanceId
        };
      }

      const aircraftDefinition = AIRCRAFT_CATALOG_BY_ID[String(aircraft.aircraftCatalogId || '')];
      const aircraftRangeKm = aircraftDefinition ? aircraftDefinition.rangeKm : null;
      const aircraftCruiseSpeedKmH = aircraftDefinition ? aircraftDefinition.cruiseSpeedKmH : null;
      const routeDistanceKm = Number(route.distanceKm);
      if (
        !aircraftDefinition ||
        !Number.isFinite(aircraftRangeKm) ||
        !Number.isFinite(routeDistanceKm) ||
        aircraftRangeKm < routeDistanceKm
      ) {
        return {
          success: false,
          code: 'AIRCRAFT_RANGE_INSUFFICIENT',
          message: 'Aircraft range is insufficient for this route.',
          aircraftInstanceId: normalizedAircraftInstanceId
        };
      }

      if (!Number.isFinite(aircraftCruiseSpeedKmH) || aircraftCruiseSpeedKmH <= 0) {
        return {
          success: false,
          code: 'AIRCRAFT_SPEED_INVALID',
          message: 'Aircraft cruise speed is invalid for flight timing calculations.',
          aircraftInstanceId: normalizedAircraftInstanceId
        };
      }

      if (assignedAircraftInstanceIds.includes(aircraft.aircraftInstanceId)) {
        return {
          success: false,
          code: 'AIRCRAFT_ALREADY_ASSIGNED',
          message: 'Aircraft is already assigned to this route.',
          aircraftInstanceId: normalizedAircraftInstanceId
        };
      }

      const existingFlightsForAircraft = flights.filter((flight) => {
        if (!flight) {
          return false;
        }

        return String(flight.aircraftInstanceId || '').trim() === normalizedAircraftInstanceId;
      });

      if (existingFlightsForAircraft.length > 0) {
        return {
          success: false,
          code: existingFlightsForAircraft.length > 1 ? 'FLIGHT_DUPLICATE' : 'FLIGHT_ALREADY_EXISTS',
          message:
            existingFlightsForAircraft.length > 1
              ? 'More than one flight exists for this aircraft instance.'
              : 'Aircraft already has a flight record.',
          aircraftInstanceId: normalizedAircraftInstanceId
        };
      }

      validAircraft.push(aircraft);
      seenCatalogIds.add(String(aircraft.aircraftCatalogId || '').trim());
    }

    if (seenCatalogIds.size !== 1) {
      return {
        success: false,
        code: 'MIXED_AIRCRAFT_MODEL',
        message: 'All requested aircraft must belong to the same model.'
      };
    }

    const aircraftCatalogId = Array.from(seenCatalogIds)[0];

    const lockedUntil = Number(route.modelEditLockedUntilRealMs?.[aircraftCatalogId]);
    if (Number.isFinite(lockedUntil) && Date.now() < lockedUntil) {
      return {
        success: false,
        code: 'MODEL_EDIT_LOCKED',
        message: 'Aircraft scheduling is temporarily locked while the route schedule stabilizes.'
      };
    }

    const beginResult = this.beginModelReconfiguration(route.routeId, aircraftCatalogId);
    if (!beginResult.success) {
      return beginResult;
    }

    route.assignedAircraftInstanceIds = assignedAircraftInstanceIds;

    for (const aircraft of validAircraft) {
      route.assignedAircraftInstanceIds.push(aircraft.aircraftInstanceId);
      aircraft.status = OWNED_AIRCRAFT_STATUS.ASSIGNED;
      aircraft.assignedRouteId = route.routeId;
      flights.push(this.createReadyFlightRecord(route, aircraft));
    }
    this.authoritativeState.flights = flights;

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      assignedCount: validAircraft.length,
      routeId: route.routeId,
      assignedAircraftInstanceIds: route.assignedAircraftInstanceIds.slice()
    };
  }

  unassignAircraftFromRoute(playerId, aircraftInstanceId, editOperationId = undefined) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    const normalizedAircraftInstanceId = String(aircraftInstanceId || '').trim();

    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const aircraft = ownedAircraft.find(
      (candidate) => candidate && candidate.aircraftInstanceId === normalizedAircraftInstanceId
    );
    if (!aircraft) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_FOUND',
        message: 'Aircraft instance was not found.'
      };
    }

    if (String(aircraft.ownerPlayerId) !== String(player.id)) {
      return {
        success: false,
        code: 'NOT_AIRCRAFT_OWNER',
        message: 'Player does not own this aircraft.'
      };
    }

    const assignedRouteId = String(aircraft.assignedRouteId || '').trim();
    if (!assignedRouteId) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_ASSIGNED',
        message: 'Aircraft is not assigned to a route.'
      };
    }

    const route = routes.find((candidate) => candidate && candidate.routeId === assignedRouteId);
    if (!route) {
      return {
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'Assigned route was not found.'
      };
    }

    if (String(route.ownerPlayerId) !== String(player.id)) {
      return {
        success: false,
        code: 'NOT_ROUTE_OWNER',
        message: 'Player does not own the assigned route.'
      };
    }

    const assignedAircraftInstanceIds = Array.isArray(route.assignedAircraftInstanceIds)
      ? route.assignedAircraftInstanceIds
      : [];
    const assignmentIndex = assignedAircraftInstanceIds.findIndex((id) => id === aircraft.aircraftInstanceId);
    if (assignmentIndex < 0) {
      return {
        success: false,
        code: 'ASSIGNMENT_NOT_FOUND',
        message: 'Aircraft assignment was not found on the route.'
      };
    }

    const lockedUntil = Number(route.modelEditLockedUntilRealMs?.[aircraft.aircraftCatalogId]);
    if (Number.isFinite(lockedUntil) && Date.now() < lockedUntil) {
      return {
        success: false,
        code: 'MODEL_EDIT_LOCKED',
        message: 'Aircraft scheduling is temporarily locked while the route schedule stabilizes.'
      };
    }

    this.beginModelReconfiguration(route.routeId, aircraft.aircraftCatalogId);

    const pendingAction = String(aircraft.pendingRouteExitAction || '').trim();
    if (pendingAction === 'unassign') {
      return {
        success: false,
        code: 'UNASSIGN_ALREADY_PENDING',
        message: 'Aircraft already has a pending unassign action.'
      };
    }

    if (pendingAction && pendingAction !== 'unassign') {
      return {
        success: false,
        code: 'PENDING_EXIT_ACTION_CONFLICT',
        message: 'Aircraft has a conflicting pending exit action.'
      };
    }

    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];
    const flight = flights.find((candidate) => {
      return candidate && String(candidate.aircraftInstanceId || '').trim() === normalizedAircraftInstanceId;
    });

    const routeOriginAirportId = String(route.originAirportId || '').trim();
    const isHomeReady = flight &&
                        String(flight.status || '').trim() === 'ready' &&
                        String(flight.direction || '').trim() === 'outbound' &&
                        String(flight.originAirportId || '').trim() === routeOriginAirportId;

    if (isHomeReady) {
      const detachResult = this.detachAircraftFromAssignment(aircraft.aircraftInstanceId);
      if (!detachResult.success) {
        return detachResult;
      }
    } else {
      aircraft.pendingRouteExitAction = 'unassign';
    }

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      routeId: route.routeId,
      aircraftInstanceId: aircraft.aircraftInstanceId,
      aircraftStatus: aircraft.status,
      assignedRouteId: aircraft.assignedRouteId,
      assignedAircraftInstanceIds: Array.isArray(route.assignedAircraftInstanceIds)
        ? route.assignedAircraftInstanceIds.slice()
        : []
    };
  }

  startFlightScheduler() {
    return this.flightEngine.startFlightScheduler(this.status);
  }

  stopFlightScheduler() {
    return this.flightEngine.stopFlightScheduler();
  }

  isFlightSchedulerRunning() {
    return this.flightEngine.isFlightSchedulerRunning();
  }

  getFlightTransitionDueSimulationTimestamp(flight) {
    return this.flightEngine.getFlightTransitionDueSimulationTimestamp(flight);
  }

  collectDueFlightTransitions(simulationNowMs) {
    return this.flightEngine.collectDueFlightTransitions(simulationNowMs);
  }

  validateFlightDirectionEndpoints(route, flight) {
    return this.flightEngine.validateFlightDirectionEndpoints(route, flight);
  }

  resolveFlightTransitionContext(flightId) {
    return this.flightEngine.resolveFlightTransitionContext(flightId);
  }

  resolveFlightArrivalSettlementContext(transitionContext) {
    if (!transitionContext || !transitionContext.flight || !transitionContext.route || !transitionContext.aircraftDefinition) {
      return {
        success: false,
        code: 'FLIGHT_SETTLEMENT_CONTEXT_INVALID',
        message: 'Flight settlement context is incomplete.'
      };
    }

    const sourcePlayers = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const normalizedOwnerPlayerId = String(transitionContext.flight.ownerPlayerId || '').trim();
    const ownerPlayer = sourcePlayers.find((player) => {
      return player && String(player.id || '').trim() === normalizedOwnerPlayerId;
    });

    if (!ownerPlayer) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Flight owner player was not found in authoritative game state.',
        flightId: transitionContext.flight.flightId,
        playerId: normalizedOwnerPlayerId || null
      };
    }

    const currentCapital = Number(ownerPlayer.capital);
    if (!Number.isFinite(currentCapital)) {
      return {
        success: false,
        code: 'PLAYER_CAPITAL_INVALID',
        message: 'Flight owner capital is invalid for settlement.',
        flightId: transitionContext.flight.flightId,
        playerId: ownerPlayer.id
      };
    }

    const settlementResult = calculateFlightSettlement({
      baseRevenuePerKm: transitionContext.aircraftDefinition.baseRevenuePerKm,
      routeDistanceKm: transitionContext.route.distanceKm
    });
    if (!settlementResult.success) {
      return {
        success: false,
        code: settlementResult.code,
        message: settlementResult.message,
        flightId: transitionContext.flight.flightId,
        playerId: ownerPlayer.id,
        routeId: transitionContext.route.routeId,
        aircraftCatalogId: transitionContext.aircraftDefinition.aircraftCatalogId
      };
    }

    const finalRevenue = Number(settlementResult.finalRevenue);
    if (!Number.isFinite(finalRevenue)) {
      return {
        success: false,
        code: 'FLIGHT_SETTLEMENT_INVALID',
        message: 'Flight settlement produced an invalid final revenue value.',
        flightId: transitionContext.flight.flightId,
        playerId: ownerPlayer.id,
        routeId: transitionContext.route.routeId,
        aircraftCatalogId: transitionContext.aircraftDefinition.aircraftCatalogId
      };
    }

    return {
      success: true,
      ownerPlayer,
      currentCapital,
      settlementResult
    };
  }

  applyFlightTransition(transition, simulationNowMs) {
    return this.flightEngine.applyFlightTransition(transition, simulationNowMs);
  }

  processFlightSchedulerTick(realNowMs = Date.now()) {
    const result = this.flightEngine.processFlightSchedulerTick(realNowMs);
    const simulationNowMs = this.flightEngine.getSimulationTimeMs(realNowMs);

    let anyRebuildChanged = false;

    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const routeSnapshot = routes.slice();

    for (const route of routeSnapshot) {
      if (!route) {
        continue;
      }

      if (route.pendingRemoval === true) {
        const removalResult = this.completePendingRouteRemoval(route.routeId);
        if (!removalResult.success) {
          console.error(
            `Route removal completion failed for route ${route.routeId}: ${removalResult.code} - ${removalResult.message}`
          );
        } else if (removalResult.changed) {
          anyRebuildChanged = true;
        }
        continue;
      }

      const reconfiguringModelCatalogIds = Array.isArray(route.reconfiguringModelCatalogIds)
        ? route.reconfiguringModelCatalogIds
        : [];

      const modelSnapshot = reconfiguringModelCatalogIds.slice();

      for (const aircraftCatalogId of modelSnapshot) {
        const checkResult = this.isModelReconfigurationDrainComplete(route.routeId, aircraftCatalogId);

        if (!checkResult.success) {
          console.error(
            `Reconfiguration reference corruption detected for route ${route.routeId}, model ${aircraftCatalogId}: ${checkResult.code} - ${checkResult.message}`
          );
        } else if (checkResult.complete) {
          const cleanupResult = this.completePendingUnassignsForModelReconfiguration(
            route.routeId,
            aircraftCatalogId
          );

          if (!cleanupResult.success) {
            console.error(
              `Pending-unassign cleanup failed for route ${route.routeId}, model ${aircraftCatalogId}: ${cleanupResult.code} - ${cleanupResult.message}`
            );
          } else if (cleanupResult.changed) {
            anyRebuildChanged = true;
          }

          const saleCleanupResult = this.completePendingSalesForModelReconfiguration(
            route.routeId,
            aircraftCatalogId
          );

          if (!saleCleanupResult.success) {
            console.error(
              `Pending-sale cleanup failed for route ${route.routeId}, model ${aircraftCatalogId}: ${saleCleanupResult.code} - ${saleCleanupResult.message}`
            );
          } else if (saleCleanupResult.changed) {
            anyRebuildChanged = true;
          }

          const rebuildResult = this.rebuildModelDepartureSchedule(
            route.routeId,
            aircraftCatalogId,
            simulationNowMs
          );

          if (rebuildResult.success && rebuildResult.changed) {
            anyRebuildChanged = true;
            if (!route.modelEditLockedUntilRealMs) {
              route.modelEditLockedUntilRealMs = {};
            }
            route.modelEditLockedUntilRealMs[aircraftCatalogId] = Date.now() + 500;
          } else if (!rebuildResult.success) {
            console.error(
              `Reconfiguration schedule rebuild failed for route ${route.routeId}, model ${aircraftCatalogId}: ${rebuildResult.code} - ${rebuildResult.message}`
            );
          }
        }
      }
    }

    const airports = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];
    const airportSnapshot = airports.slice();

    for (const airportState of airportSnapshot) {
      if (!airportState) {
        continue;
      }

      const pendingChange = airportState.pendingOwnershipChange;
      if (!pendingChange || typeof pendingChange !== 'object') {
        continue;
      }

      if (pendingChange.type === 'sell-to-game') {
        const completionResult = this.completePendingAirportSellToGame(airportState.airportId);
        if (!completionResult.success) {
          console.error(
            `Airport sell-to-game completion failed for airport ${airportState.airportId}: ${completionResult.code} - ${completionResult.message}`
          );
        } else if (completionResult.changed) {
          anyRebuildChanged = true;
        }
      } else if (pendingChange.type === 'player-transfer') {
        const completionResult = this.completePendingAirportPlayerTransfer(airportState.airportId);
        if (!completionResult.success) {
          console.error(
            `Airport player-transfer completion failed for airport ${airportState.airportId}: ${completionResult.code} - ${completionResult.message}`
          );
        } else if (completionResult.changed) {
          anyRebuildChanged = true;
        }
      }
    }

    if (result.changed || anyRebuildChanged) {
      this.broadcastState();
    }

    return result;
  }

  createPublicAirportSnapshot() {
    const airportStates = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];

    return airportStates.reduce((publicAirports, airportState) => {
      const definition = AIRPORT_DEFINITIONS_BY_ID.get(airportState.airportId);
      if (!definition) {
        console.warn(
          `Game ${this.id} has airport state for unknown airport ID: ${String(airportState.airportId)}`
        );
        return publicAirports;
      }

      publicAirports.push({
        id: definition.id,
        iata: definition.iata,
        name: definition.name,
        city: definition.city,
        country: definition.country,
        lat: definition.lat,
        lng: definition.lng,
        size: definition.size,
        basePrice: definition.basePrice,
        sellToGamePrice: calculateAirportSellToGamePrice(definition.basePrice),
        ownerPlayerId: airportState.ownerPlayerId ?? null,
        saleListing:
          airportState.saleListing && typeof airportState.saleListing === 'object'
            ? { ...airportState.saleListing }
            : null,
        isOwnershipChangePending: airportState.pendingOwnershipChange != null
      });

      return publicAirports;
    }, []);
  }

  createPublicPlayerSnapshot() {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const netWorthByPlayerId = calculateNetWorthByPlayer(this.authoritativeState);
    const scoreByPlayerId = calculateScoreByPlayer(this.authoritativeState);

    return players.map((player) => ({
      id: player.id,
      username: player.username,
      isBot: Boolean(player && player.isBot),
      score: scoreByPlayerId.has(String(player.id)) ? scoreByPlayerId.get(String(player.id)) : 0,
      capital: player.capital,
      netWorth:
        netWorthByPlayerId.has(String(player.id))
          ? netWorthByPlayerId.get(String(player.id))
          : Number.isFinite(player.capital)
            ? player.capital
            : 0,
      colorId: player.colorId ?? null,
      colorHex: player.colorHex ?? null
    }));
  }

  createPublicOwnedAircraftSnapshot() {
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];

    return ownedAircraft.map((aircraft) => {
      const { pendingRouteExitAction, pendingSaleRefund, ...publicAircraft } = aircraft;
      return {
        ...publicAircraft,
        isPendingUnassign: Boolean(pendingRouteExitAction === 'unassign')
      };
    });
  }

  createPublicRouteSnapshot() {
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const nowRealMs = Date.now();

    return routes.map((route) => {
      const { reconfiguringModelCatalogIds, reconfigurationReferenceAircraftInstanceIds, ...publicRoute } = route;
      const assignedAircraftInstanceIds = Array.isArray(route.assignedAircraftInstanceIds)
        ? route.assignedAircraftInstanceIds.slice()
        : [];
      const isReconfiguring = Array.isArray(reconfiguringModelCatalogIds) && reconfiguringModelCatalogIds.length > 0;
      const pendingRemoval = Boolean(route.pendingRemoval === true);
      const rawModelEditLockedUntilRealMs = route.modelEditLockedUntilRealMs;
      const modelEditLockedUntilRealMs = {};
      const rawLockedEntries = rawModelEditLockedUntilRealMs && typeof rawModelEditLockedUntilRealMs === 'object'
        ? Object.entries(rawModelEditLockedUntilRealMs)
        : [];

      for (const [catalogId, expiryRawValue] of rawLockedEntries) {
        const expiryMs = Number(expiryRawValue);
        if (Number.isFinite(expiryMs) && nowRealMs < expiryMs) {
          modelEditLockedUntilRealMs[catalogId] = expiryMs;
        }
      }

      return {
        ...publicRoute,
        assignedAircraftInstanceIds,
        activeFlightsCount: assignedAircraftInstanceIds.length,
        isReconfiguring,
        pendingRemoval,
        modelEditLockedUntilRealMs
      };
    });
  }

  createPublicFlightSnapshot() {
    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];

    return flights.map((flight) => {
      const { lastOutboundDepartedAtSimulationMs, ...publicFlight } = flight;
      return publicFlight;
    });
  }

  createPublicAircraftCatalogSnapshot() {
    return AIRCRAFT_CATALOG.map((aircraft) => ({
      ...aircraft
    }));
  }

  getPublicState() {
    return {
      game: {
        ...this.authoritativeState,
        simulationClock: this.getSimulationClockSnapshot(),
        players: this.createPublicPlayerSnapshot(),
        airports: this.createPublicAirportSnapshot(),
        ownedAircraft: this.createPublicOwnedAircraftSnapshot(),
        routes: this.createPublicRouteSnapshot(),
        flights: this.createPublicFlightSnapshot(),
        aircraftCatalog: this.createPublicAircraftCatalogSnapshot()
      }
    };
  }

  broadcastState() {
    this.manager.io.to(this.getRoomName()).emit('game:state', this.getPublicState());
  }

  broadcastStarted() {
    if (this.hasBroadcastStarted) {
      return;
    }

    this.hasBroadcastStarted = true;
    this.manager.io.to(this.getRoomName()).emit('game:started', this.getPublicState());
  }

  getRoomName() {
    return `game:${this.id}`;
  }

  handlePlayerDisconnect(playerId) {
    if (this.manager && this.manager.games && !this.manager.games.has(this.id)) {
      return;
    }

    const player = this.players.get(playerId);
    if (!player) {
      return;
    }

    player.connected = false;

    if (this.status === 'ended' && !player.isBot) {
      const sourcePlayers = Array.isArray(this.authoritativeState.players)
        ? this.authoritativeState.players
        : [];
      this.authoritativeState.players = sourcePlayers.filter((entry) => {
        return !!entry && String(entry.id) !== String(playerId);
      });
    }

    this.broadcastState();
  }

  dispose() {
    this.stopFlightScheduler();
    this.clearExpirationTimeout();
  }
}

module.exports = Game;
