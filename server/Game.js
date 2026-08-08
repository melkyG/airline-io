const { randomUUID } = require('node:crypto');
const { AIRPORT_CATALOG } = require('./airports/catalog');
const { AIRCRAFT_CATALOG, AIRCRAFT_CATALOG_BY_ID } = require('./aircraft/catalog');
const { createOwnedAircraftInstance, OWNED_AIRCRAFT_STATUS } = require('./aircraft/ownership');
const { canonicalRouteKey, calculateRouteDistanceKm } = require('./routes');
const {
  TURNAROUND_DURATION_SIMULATION_MS,
  MAX_FLIGHT_TRANSITIONS_PER_TICK,
  MAX_FLIGHT_PROCESSING_REAL_MS,
  calculateFlightDurationSimulationMs
} = require('./flights/rules');
const { createBoundedScheduler } = require('./flights/scheduler');
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
    this.flightScheduler = createBoundedScheduler({
      onTick: () => {
        this.processFlightSchedulerTick();
      }
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
    const isOriginMatch = String(flight.originAirportId || '').trim() === String(route.originAirportId || '').trim();
    const isDestinationMatch =
      String(flight.destinationAirportId || '').trim() === String(route.destinationAirportId || '').trim();

    if (!isRouteMatch || !isOwnerMatch || !isOriginMatch || !isDestinationMatch) {
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
      nextTransitionAtSimulationMs: null
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

    const detachmentContextsByAircraftInstanceId = new Map();
    for (const aircraft of selection.assignedAircraftToDetach) {
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

    for (const aircraft of selection.assignedAircraftToDetach) {
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

    const selectedAircraftInstanceIdSet = new Set(
      selectedAircraft.map((aircraft) => String(aircraft && aircraft.aircraftInstanceId ? aircraft.aircraftInstanceId : '').trim())
    );
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    const updatedOwnedAircraft = ownedAircraft.filter((aircraft) => {
      if (!aircraft) {
        return true;
      }

      const normalizedAircraftInstanceId = String(aircraft.aircraftInstanceId || '').trim();
      return !selectedAircraftInstanceIdSet.has(normalizedAircraftInstanceId);
    });

    const totalRefund = sellQuote.unitSellPrice * quantity;
    const currentCapital = Number.isFinite(context.player.capital) ? context.player.capital : 0;
    context.player.capital = currentCapital + totalRefund;
    this.authoritativeState.ownedAircraft = updatedOwnedAircraft;

    const remainingOwnedQuantity = sellQuote.ownedQuantity - quantity;

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      aircraftCatalogId: sellQuote.aircraftCatalogId,
      quantitySold: quantity,
      availableQuantitySold: selection.availableQuantitySold,
      assignedQuantitySold: selection.assignedQuantitySold,
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

    const sellerRoutesUsingAirport = this.getOwnedRoutesContainingAirport(seller.id, airportDefinition.id);
    const cleanupResult = this.removeRoutesWithAircraftCleanup(sellerRoutesUsingAirport);
    if (!cleanupResult.success) {
      return cleanupResult;
    }

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

    const basePrice = Number.isFinite(airportDefinition.basePrice) ? airportDefinition.basePrice : 0;
    const refundAmount = calculateAirportSellToGamePrice(basePrice);
    const currentCapital = Number.isFinite(player.capital) ? player.capital : 0;

    const playerRoutesUsingAirport = this.getOwnedRoutesContainingAirport(player.id, airportDefinition.id);
    const cleanupResult = this.removeRoutesWithAircraftCleanup(playerRoutesUsingAirport);
    if (!cleanupResult.success) {
      return cleanupResult;
    }

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
      assignedAircraftInstanceIds: []
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

    const cleanupResult = this.removeRoutesWithAircraftCleanup([route]);
    if (!cleanupResult.success) {
      return cleanupResult;
    }

    const unassignedAircraftInstanceIds = cleanupResult.routeIdToAssignedAircraftIds.get(route.routeId) || [];
    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      routeId: route.routeId,
      ownerPlayerId: route.ownerPlayerId,
      unassignedAircraftInstanceIds
    };
  }

  assignAircraftToRoute(playerId, routeId, aircraftInstanceId) {
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

  unassignAircraftFromRoute(playerId, aircraftInstanceId) {
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

    const detachResult = this.detachAircraftFromAssignment(aircraft.aircraftInstanceId);
    if (!detachResult.success) {
      return detachResult;
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
    if (this.status !== 'active' || !this.flightScheduler) {
      return false;
    }

    return this.flightScheduler.start();
  }

  stopFlightScheduler() {
    if (!this.flightScheduler) {
      return false;
    }

    return this.flightScheduler.stop();
  }

  isFlightSchedulerRunning() {
    return Boolean(this.flightScheduler && this.flightScheduler.isRunning());
  }

  getFlightTransitionDueSimulationTimestamp(flight) {
    if (!flight || typeof flight !== 'object') {
      return null;
    }

    if (flight.status === 'ready') {
      return Number.isFinite(flight.nextTransitionAtSimulationMs)
        ? flight.nextTransitionAtSimulationMs
        : Number.NEGATIVE_INFINITY;
    }

    if (flight.status === 'in-flight' || flight.status === 'turnaround') {
      return Number.isFinite(flight.nextTransitionAtSimulationMs)
        ? flight.nextTransitionAtSimulationMs
        : null;
    }

    return null;
  }

  collectDueFlightTransitions(simulationNowMs) {
    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];

    return flights
      .map((flight) => {
        if (!flight || !flight.flightId) {
          return null;
        }

        const dueAtSimulationMs = this.getFlightTransitionDueSimulationTimestamp(flight);
        if (!Number.isFinite(dueAtSimulationMs) && dueAtSimulationMs !== Number.NEGATIVE_INFINITY) {
          return null;
        }

        if (dueAtSimulationMs > simulationNowMs) {
          return null;
        }

        return {
          flightId: String(flight.flightId || '').trim(),
          dueAtSimulationMs
        };
      })
      .filter((entry) => entry && entry.flightId)
      .sort((left, right) => {
        if (left.dueAtSimulationMs !== right.dueAtSimulationMs) {
          return left.dueAtSimulationMs - right.dueAtSimulationMs;
        }

        return String(left.flightId).localeCompare(String(right.flightId));
      });
  }

  validateFlightDirectionEndpoints(route, flight) {
    const normalizedDirection = String(flight.direction || '').trim();
    const routeOriginAirportId = String(route.originAirportId || '').trim();
    const routeDestinationAirportId = String(route.destinationAirportId || '').trim();
    const flightOriginAirportId = String(flight.originAirportId || '').trim();
    const flightDestinationAirportId = String(flight.destinationAirportId || '').trim();

    if (normalizedDirection === 'outbound') {
      return flightOriginAirportId === routeOriginAirportId && flightDestinationAirportId === routeDestinationAirportId;
    }

    if (normalizedDirection === 'inbound') {
      return flightOriginAirportId === routeDestinationAirportId && flightDestinationAirportId === routeOriginAirportId;
    }

    return false;
  }

  resolveFlightTransitionContext(flightId) {
    const normalizedFlightId = String(flightId || '').trim();
    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];

    const flightIndex = flights.findIndex((flight) => flight && String(flight.flightId || '').trim() === normalizedFlightId);
    if (flightIndex < 0) {
      return {
        success: false,
        code: 'FLIGHT_NOT_FOUND',
        message: 'Flight was not found.'
      };
    }

    const flight = flights[flightIndex];
    const route = routes.find((candidate) => candidate && String(candidate.routeId || '').trim() === String(flight.routeId || '').trim());
    if (!route) {
      return {
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'Assigned route was not found.',
        flightId: normalizedFlightId
      };
    }

    const aircraft = ownedAircraft.find((candidate) => {
      return candidate && String(candidate.aircraftInstanceId || '').trim() === String(flight.aircraftInstanceId || '').trim();
    });
    if (!aircraft) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_FOUND',
        message: 'Aircraft instance was not found.',
        flightId: normalizedFlightId
      };
    }

    const assignedAircraftInstanceIds = Array.isArray(route.assignedAircraftInstanceIds)
      ? route.assignedAircraftInstanceIds
      : [];
    const isAircraftListedOnRoute = assignedAircraftInstanceIds.some((aircraftInstanceId) => {
      return String(aircraftInstanceId || '').trim() === String(aircraft.aircraftInstanceId || '').trim();
    });
    if (!isAircraftListedOnRoute) {
      return {
        success: false,
        code: 'ASSIGNMENT_NOT_FOUND',
        message: 'Aircraft assignment was not found on the route.',
        flightId: normalizedFlightId,
        aircraftInstanceId: aircraft.aircraftInstanceId
      };
    }

    if (String(aircraft.assignedRouteId || '').trim() !== String(route.routeId || '').trim()) {
      return {
        success: false,
        code: 'ASSIGNMENT_MISMATCH',
        message: 'Aircraft assignment state is inconsistent for one or more aircraft.',
        flightId: normalizedFlightId,
        aircraftInstanceId: aircraft.aircraftInstanceId
      };
    }

    if (aircraft.status !== OWNED_AIRCRAFT_STATUS.ASSIGNED) {
      return {
        success: false,
        code: 'ASSIGNMENT_MISMATCH',
        message: 'Aircraft assignment state is inconsistent for one or more aircraft.',
        flightId: normalizedFlightId,
        aircraftInstanceId: aircraft.aircraftInstanceId
      };
    }

    const normalizedFlightOwnerId = String(flight.ownerPlayerId || '').trim();
    const normalizedRouteOwnerId = String(route.ownerPlayerId || '').trim();
    const normalizedAircraftOwnerId = String(aircraft.ownerPlayerId || '').trim();
    if (
      !normalizedFlightOwnerId ||
      normalizedFlightOwnerId !== normalizedRouteOwnerId ||
      normalizedFlightOwnerId !== normalizedAircraftOwnerId
    ) {
      return {
        success: false,
        code: 'FLIGHT_ASSIGNMENT_MISMATCH',
        message: 'Flight assignment state is inconsistent for one or more aircraft.',
        flightId: normalizedFlightId,
        aircraftInstanceId: aircraft.aircraftInstanceId
      };
    }

    if (!this.validateFlightDirectionEndpoints(route, flight)) {
      return {
        success: false,
        code: 'FLIGHT_ASSIGNMENT_MISMATCH',
        message: 'Flight assignment state is inconsistent for one or more aircraft.',
        flightId: normalizedFlightId,
        aircraftInstanceId: aircraft.aircraftInstanceId
      };
    }

    const aircraftDefinition = AIRCRAFT_CATALOG_BY_ID[String(aircraft.aircraftCatalogId || '').trim()];
    const cruiseSpeedKmH = aircraftDefinition ? Number(aircraftDefinition.cruiseSpeedKmH) : null;
    if (!aircraftDefinition || !Number.isFinite(cruiseSpeedKmH) || cruiseSpeedKmH <= 0) {
      return {
        success: false,
        code: 'AIRCRAFT_SPEED_INVALID',
        message: 'Aircraft cruise speed is invalid for flight timing calculations.',
        flightId: normalizedFlightId,
        aircraftInstanceId: aircraft.aircraftInstanceId,
        aircraftCatalogId: aircraft.aircraftCatalogId
      };
    }

    const flightDurationSimulationMs = calculateFlightDurationSimulationMs(route.distanceKm, cruiseSpeedKmH);
    if (!Number.isFinite(flightDurationSimulationMs) || flightDurationSimulationMs <= 0) {
      return {
        success: false,
        code: 'FLIGHT_DURATION_INVALID',
        message: 'Flight duration could not be calculated from route distance and aircraft speed.',
        flightId: normalizedFlightId,
        aircraftInstanceId: aircraft.aircraftInstanceId
      };
    }

    return {
      success: true,
      flight,
      flightIndex,
      route,
      aircraft,
      aircraftDefinition,
      flightDurationSimulationMs
    };
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
    const context = this.resolveFlightTransitionContext(transition.flightId);
    if (!context.success) {
      return context;
    }

    const { flight, route, flightDurationSimulationMs } = context;
    const currentStatus = String(flight.status || '').trim();
    const normalizedDueAtSimulationMs = Number.isFinite(transition.dueAtSimulationMs)
      ? transition.dueAtSimulationMs
      : simulationNowMs;

    if (currentStatus === 'ready') {
      const departureSimulationMs = Number.isFinite(normalizedDueAtSimulationMs)
        ? Math.min(normalizedDueAtSimulationMs, simulationNowMs)
        : simulationNowMs;
      flight.status = 'in-flight';
      flight.direction = 'outbound';
      flight.originAirportId = route.originAirportId;
      flight.destinationAirportId = route.destinationAirportId;
      flight.departedAtSimulationMs = departureSimulationMs;
      flight.arrivesAtSimulationMs = departureSimulationMs + flightDurationSimulationMs;
      flight.nextTransitionAtSimulationMs = flight.arrivesAtSimulationMs;
      return { success: true, changed: true };
    }

    if (currentStatus === 'in-flight') {
      const settlementContext = this.resolveFlightArrivalSettlementContext(context);
      if (!settlementContext.success) {
        return settlementContext;
      }

      const arrivalSimulationMs = Number.isFinite(flight.arrivesAtSimulationMs)
        ? flight.arrivesAtSimulationMs
        : Math.min(normalizedDueAtSimulationMs, simulationNowMs);

      settlementContext.ownerPlayer.capital =
        settlementContext.currentCapital + settlementContext.settlementResult.finalRevenue;

      flight.status = 'turnaround';
      flight.departedAtSimulationMs = null;
      flight.arrivesAtSimulationMs = null;
      flight.nextTransitionAtSimulationMs = arrivalSimulationMs + TURNAROUND_DURATION_SIMULATION_MS;
      return { success: true, changed: true };
    }

    if (currentStatus === 'turnaround') {
      const previousDirection = String(flight.direction || '').trim();
      const nextDirection = previousDirection === 'outbound' ? 'inbound' : 'outbound';
      const departureSimulationMs = Math.min(normalizedDueAtSimulationMs, simulationNowMs);

      flight.direction = nextDirection;
      flight.originAirportId = nextDirection === 'outbound' ? route.originAirportId : route.destinationAirportId;
      flight.destinationAirportId = nextDirection === 'outbound' ? route.destinationAirportId : route.originAirportId;
      flight.status = 'in-flight';
      flight.departedAtSimulationMs = departureSimulationMs;
      flight.arrivesAtSimulationMs = departureSimulationMs + flightDurationSimulationMs;
      flight.nextTransitionAtSimulationMs = flight.arrivesAtSimulationMs;
      return { success: true, changed: true };
    }

    return {
      success: false,
      code: 'FLIGHT_STATUS_INVALID',
      message: 'Flight has an unknown status and cannot be transitioned safely.',
      flightId: transition.flightId
    };
  }

  processFlightSchedulerTick(realNowMs = Date.now()) {
    if (this.status !== 'active') {
      return {
        success: true,
        changed: false,
        processedTransitions: 0
      };
    }

    const simulationNowMs = this.getSimulationTimeMs(realNowMs);
    if (!Number.isFinite(simulationNowMs)) {
      return {
        success: true,
        changed: false,
        processedTransitions: 0
      };
    }

    let changed = false;
    let processedTransitions = 0;
    const processingStartedRealMs = Date.now();
    let lastError = null;

    while (
      processedTransitions < MAX_FLIGHT_TRANSITIONS_PER_TICK &&
      Date.now() - processingStartedRealMs <= MAX_FLIGHT_PROCESSING_REAL_MS
    ) {
      const dueTransitions = this.collectDueFlightTransitions(simulationNowMs);
      if (dueTransitions.length === 0) {
        break;
      }

      const transition = dueTransitions[0];
      const transitionResult = this.applyFlightTransition(transition, simulationNowMs);
      if (!transitionResult.success) {
        lastError = transitionResult;
        break;
      }

      changed = changed || Boolean(transitionResult.changed);
      processedTransitions += 1;
    }

    if (changed) {
      this.broadcastState();
    }

    return {
      success: !lastError,
      changed,
      processedTransitions,
      error: lastError
    };
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
            : null
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

    return ownedAircraft.map((aircraft) => ({
      ...aircraft
    }));
  }

  createPublicRouteSnapshot() {
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];

    return routes.map((route) => {
      const assignedAircraftInstanceIds = Array.isArray(route.assignedAircraftInstanceIds)
        ? route.assignedAircraftInstanceIds.slice()
        : [];

      return {
        ...route,
        assignedAircraftInstanceIds,
        activeFlightsCount: assignedAircraftInstanceIds.length
      };
    });
  }

  createPublicFlightSnapshot() {
    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];

    return flights.map((flight) => ({
      ...flight
    }));
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
