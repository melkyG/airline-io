const { AIRCRAFT_CATALOG_BY_ID } = require('./aircraft/catalog');
const {
  MAX_FLIGHT_TRANSITIONS_PER_TICK,
  MAX_FLIGHT_PROCESSING_REAL_MS,
  calculateFlightDurationSimulationMs,
  calculateAircraftTurnaroundSimulationMs
} = require('./flights/rules');
const { OWNED_AIRCRAFT_STATUS } = require('./aircraft/ownership');

class SchedulerDueHeap {
  constructor(comparator) {
    this.items = [];
    this.comparator = comparator;
  }

  size() {
    return this.items.length;
  }

  push(value) {
    this.items.push(value);
    this._siftUp(this.items.length - 1);
  }

  pop() {
    if (this.items.length === 0) {
      return undefined;
    }
    const result = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      this._siftDown(0);
    }
    return result;
  }

  _siftUp(index) {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.comparator(this.items[index], this.items[parentIndex]) < 0) {
        [this.items[index], this.items[parentIndex]] = [this.items[parentIndex], this.items[index]];
        index = parentIndex;
      } else {
        break;
      }
    }
  }

  _siftDown(index) {
    const length = this.items.length;
    while (true) {
      let smallest = index;
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      if (left < length && this.comparator(this.items[left], this.items[smallest]) < 0) {
        smallest = left;
      }
      if (right < length && this.comparator(this.items[right], this.items[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === index) {
        break;
      }
      [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
      index = smallest;
    }
  }
}

class FlightEngine {
  constructor({
    authoritativeState,
    getSimulationTimeMs,
    resolveFlightArrivalSettlementContext,
    createBoundedScheduler,
    onRevenueCredited,
    onFlightLegCompleted,
    onTransitionProcessed,
    onSchedulerProfile,
    onTick
  }) {
    this.authoritativeState = authoritativeState;
    this.getSimulationTimeMs = getSimulationTimeMs;
    this.resolveFlightArrivalSettlementContext = resolveFlightArrivalSettlementContext;
    this.onRevenueCredited = typeof onRevenueCredited === 'function' ? onRevenueCredited : null;
    this.onFlightLegCompleted = typeof onFlightLegCompleted === 'function' ? onFlightLegCompleted : null;
    this.onTransitionProcessed = typeof onTransitionProcessed === 'function' ? onTransitionProcessed : null;
    this.onSchedulerProfile = typeof onSchedulerProfile === 'function' ? onSchedulerProfile : null;
    this.onTick = typeof onTick === 'function' ? onTick : null;
    this.flightScheduler = createBoundedScheduler({
      onTick: () => {
        if (this.onTick) {
          this.onTick();
        }
      }
    });
  }

  startFlightScheduler(status) {
    if (status !== 'active' || !this.flightScheduler) {
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
    const ctx = this._schedulerLookupContext || this._buildSchedulerLookupContext();
    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];

    return flights
      .map((flight) => {
        if (!flight || !flight.flightId) {
          return null;
        }

        const currentStatus = String(flight.status || '').trim();
        const currentDirection = String(flight.direction || '').trim();

        if (currentStatus === 'ready' && currentDirection === 'outbound') {
          const route = ctx.routeById.get(String(flight.routeId || '').trim());
          if (route) {
            if (route.pendingRemoval === true) {
              return null;
            }

            const reconfiguringModelCatalogIds = Array.isArray(route.reconfiguringModelCatalogIds)
              ? route.reconfiguringModelCatalogIds
              : [];
            const aircraft = ctx.aircraftByInstanceId.get(String(flight.aircraftInstanceId || '').trim());
            if (aircraft && reconfiguringModelCatalogIds.length > 0) {
              const aircraftCatalogId = String(aircraft.aircraftCatalogId || '').trim();
              const isModelReconfiguring = reconfiguringModelCatalogIds.some((modelId) => {
                return String(modelId || '').trim() === aircraftCatalogId;
              });
              if (isModelReconfiguring) {
                return null;
              }
            }
          }
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

  countDueFlightTransitions(simulationNowMs) {
    return this.collectDueFlightTransitions(simulationNowMs).length;
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

  _buildSchedulerLookupContext() {
    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];

    const flightById = new Map();
    const flightIndexById = new Map();
    flights.forEach((flight, index) => {
      if (flight && flight.flightId) {
        const flightId = String(flight.flightId || '').trim();
        flightById.set(flightId, flight);
        flightIndexById.set(flightId, index);
      }
    });

    const routeById = new Map();
    const assignedAircraftSetByRouteId = new Map();
    routes.forEach((route) => {
      if (route && route.routeId) {
        const routeId = String(route.routeId || '').trim();
        routeById.set(routeId, route);

        const assignedAircraftInstanceIds = Array.isArray(route.assignedAircraftInstanceIds)
          ? route.assignedAircraftInstanceIds
          : [];
        const assignedAircraftSet = new Set();
        for (const aircraftInstanceId of assignedAircraftInstanceIds) {
          assignedAircraftSet.add(String(aircraftInstanceId || '').trim());
        }
        assignedAircraftSetByRouteId.set(routeId, assignedAircraftSet);
      }
    });

    const aircraftByInstanceId = new Map();
    ownedAircraft.forEach((aircraft) => {
      if (aircraft && aircraft.aircraftInstanceId) {
        aircraftByInstanceId.set(String(aircraft.aircraftInstanceId || '').trim(), aircraft);
      }
    });

    return {
      flightById,
      flightIndexById,
      routeById,
      aircraftByInstanceId,
      assignedAircraftSetByRouteId
    };
  }

  resolveFlightTransitionContext(flightId) {
    const normalizedFlightId = String(flightId || '').trim();
    const ctx = this._schedulerLookupContext || this._buildSchedulerLookupContext();

    const flight = ctx.flightById.get(normalizedFlightId);
    if (!flight) {
      return {
        success: false,
        code: 'FLIGHT_NOT_FOUND',
        message: 'Flight was not found.'
      };
    }

    const flightIndex = ctx.flightIndexById.get(normalizedFlightId);
    const route = ctx.routeById.get(String(flight.routeId || '').trim());
    if (!route) {
      return {
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'Assigned route was not found.',
        flightId: normalizedFlightId
      };
    }

    const aircraft = ctx.aircraftByInstanceId.get(String(flight.aircraftInstanceId || '').trim());
    if (!aircraft) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_FOUND',
        message: 'Aircraft instance was not found.',
        flightId: normalizedFlightId
      };
    }

    const assignedAircraftSet = ctx.assignedAircraftSetByRouteId.get(String(route.routeId || '').trim());
    const isAircraftListedOnRoute = assignedAircraftSet
      ? assignedAircraftSet.has(String(aircraft.aircraftInstanceId || '').trim())
      : false;
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

    if (!this._schedulerLookupContext) {
      if (this.onSchedulerProfile) {
        this.onSchedulerProfile({ aircraftLinearLookups: 1, routeLinearLookups: 1 });
      }
    }

    return {
      success: true,
      flight,
      flightIndex,
      route,
      aircraftDefinition,
      aircraft,
      flightDurationSimulationMs
    };
  }

  applyFlightTransition(transition, simulationNowMs) {
    const context = this.resolveFlightTransitionContext(transition.flightId);
    if (!context.success) {
      return context;
    }

    const { flight, route, flightDurationSimulationMs, aircraftDefinition, aircraft } = context;
    const cruiseSpeedKmH = aircraftDefinition ? Number(aircraftDefinition.cruiseSpeedKmH) : null;
    const currentStatus = String(flight.status || '').trim();
    const normalizedDueAtSimulationMs = Number.isFinite(transition.dueAtSimulationMs)
      ? transition.dueAtSimulationMs
      : simulationNowMs;

    if (currentStatus === 'ready') {
      if (route.pendingRemoval === true) {
        return { success: true, changed: false };
      }

      const reconfiguringModelCatalogIds = Array.isArray(route.reconfiguringModelCatalogIds)
        ? route.reconfiguringModelCatalogIds
        : [];
      const aircraftCatalogId = String(aircraft.aircraftCatalogId || '').trim();
      const isModelReconfiguring = reconfiguringModelCatalogIds.some((modelId) => {
        return String(modelId || '').trim() === aircraftCatalogId;
      });

      if (isModelReconfiguring) {
        return { success: true, changed: false };
      }

      const departureSimulationMs = Number.isFinite(normalizedDueAtSimulationMs)
        ? Math.min(normalizedDueAtSimulationMs, simulationNowMs)
        : simulationNowMs;
      flight.status = 'in-flight';
      flight.direction = 'outbound';
      flight.originAirportId = route.originAirportId;
      flight.destinationAirportId = route.destinationAirportId;
      flight.departedAtSimulationMs = departureSimulationMs;
      flight.lastOutboundDepartedAtSimulationMs = departureSimulationMs;
      flight.arrivesAtSimulationMs = departureSimulationMs + flightDurationSimulationMs;
      flight.nextTransitionAtSimulationMs = flight.arrivesAtSimulationMs;
      if (this.onTransitionProcessed) {
        this.onTransitionProcessed(Math.max(0, simulationNowMs - normalizedDueAtSimulationMs));
      }
      return { success: true, changed: true };
    }

    if (currentStatus === 'in-flight') {
      const settlementContext = this.resolveFlightArrivalSettlementContext(context, simulationNowMs);
      if (!settlementContext.success) {
        return settlementContext;
      }

      const arrivalSimulationMs = Number.isFinite(flight.arrivesAtSimulationMs)
        ? flight.arrivesAtSimulationMs
        : Math.min(normalizedDueAtSimulationMs, simulationNowMs);

      const turnaroundDurationSimulationMs = calculateAircraftTurnaroundSimulationMs(cruiseSpeedKmH, route.distanceKm);
      if (!Number.isFinite(turnaroundDurationSimulationMs) || turnaroundDurationSimulationMs <= 0) {
        return {
          success: false,
          code: 'TURNAROUND_DURATION_INVALID',
          message: 'Turnaround duration could not be calculated from aircraft speed and route distance.',
          flightId: transition.flightId
        };
      }

      settlementContext.ownerPlayer.capital =
        settlementContext.currentCapital + settlementContext.settlementResult.finalRevenue;

      if (this.onRevenueCredited) {
        this.onRevenueCredited(
          settlementContext.ownerPlayer,
          settlementContext.settlementResult.finalRevenue
        );
      }

      if (this.onFlightLegCompleted) {
        this.onFlightLegCompleted(
          context.aircraft,
          Number(context.route.distanceKm) || 0
        );
      }

      flight.status = 'turnaround';
      flight.departedAtSimulationMs = null;
      flight.arrivesAtSimulationMs = null;
      flight.nextTransitionAtSimulationMs = arrivalSimulationMs + turnaroundDurationSimulationMs;
      if (this.onTransitionProcessed) {
        this.onTransitionProcessed(Math.max(0, simulationNowMs - normalizedDueAtSimulationMs));
      }
      return { success: true, changed: true };
    }

    if (currentStatus === 'turnaround') {
      const previousDirection = String(flight.direction || '').trim();

      if (previousDirection === 'inbound') {
        flight.status = 'ready';
        flight.direction = 'outbound';
        flight.originAirportId = route.originAirportId;
        flight.destinationAirportId = route.destinationAirportId;
        flight.departedAtSimulationMs = null;
        flight.arrivesAtSimulationMs = null;

        const lastOutboundDepartedAtSimulationMs = Number(flight.lastOutboundDepartedAtSimulationMs);
        if (Number.isFinite(lastOutboundDepartedAtSimulationMs)) {
          const turnaroundDurationSimulationMs = calculateAircraftTurnaroundSimulationMs(cruiseSpeedKmH, route.distanceKm);
          if (Number.isFinite(turnaroundDurationSimulationMs) && turnaroundDurationSimulationMs > 0) {
            const fullRoundTripDurationSimulationMs = (2 * flightDurationSimulationMs) + (2 * turnaroundDurationSimulationMs);
            if (Number.isFinite(fullRoundTripDurationSimulationMs) && fullRoundTripDurationSimulationMs > 0) {
              flight.nextTransitionAtSimulationMs = lastOutboundDepartedAtSimulationMs + fullRoundTripDurationSimulationMs;
            } else {
              flight.nextTransitionAtSimulationMs = null;
            }
          } else {
            flight.nextTransitionAtSimulationMs = null;
          }
        } else {
          flight.nextTransitionAtSimulationMs = null;
        }

        if (this.onTransitionProcessed) {
          this.onTransitionProcessed(Math.max(0, simulationNowMs - normalizedDueAtSimulationMs));
        }
        return { success: true, changed: true };
      }

      const nextDirection = 'inbound';
      const departureSimulationMs = Math.min(normalizedDueAtSimulationMs, simulationNowMs);

      flight.direction = nextDirection;
      flight.originAirportId = route.destinationAirportId;
      flight.destinationAirportId = route.originAirportId;
      flight.status = 'in-flight';
      flight.departedAtSimulationMs = departureSimulationMs;
      flight.arrivesAtSimulationMs = departureSimulationMs + flightDurationSimulationMs;
      flight.nextTransitionAtSimulationMs = flight.arrivesAtSimulationMs;
      if (this.onTransitionProcessed) {
        this.onTransitionProcessed(Math.max(0, simulationNowMs - normalizedDueAtSimulationMs));
      }
      return { success: true, changed: true };
    }

    return {
      success: false,
      code: 'FLIGHT_STATUS_INVALID',
      message: 'Flight has an unknown status and cannot be transitioned safely.',
      flightId: transition.flightId
    };
  }

  getDueTransitionForSingleFlight(flight, simulationNowMs) {
    if (!flight || !flight.flightId) {
      return null;
    }

    const currentStatus = String(flight.status || '').trim();
    const currentDirection = String(flight.direction || '').trim();

    if (currentStatus === 'ready' && currentDirection === 'outbound') {
      const ctx = this._schedulerLookupContext || this._buildSchedulerLookupContext();
      const route = ctx.routeById.get(String(flight.routeId || '').trim());
      if (route) {
        if (route.pendingRemoval === true) {
          return null;
        }

        const reconfiguringModelCatalogIds = Array.isArray(route.reconfiguringModelCatalogIds)
          ? route.reconfiguringModelCatalogIds
          : [];
        const aircraft = ctx.aircraftByInstanceId.get(String(flight.aircraftInstanceId || '').trim());
        if (aircraft && reconfiguringModelCatalogIds.length > 0) {
          const aircraftCatalogId = String(aircraft.aircraftCatalogId || '').trim();
          const isModelReconfiguring = reconfiguringModelCatalogIds.some((modelId) => {
            return String(modelId || '').trim() === aircraftCatalogId;
          });
          if (isModelReconfiguring) {
            return null;
          }
        }
      }
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
  }

  processFlightSchedulerTick(realNowMs = Date.now()) {
    const simulationNowMs = this.getSimulationTimeMs(realNowMs);
    if (!Number.isFinite(simulationNowMs)) {
      return {
        success: true,
        changed: false,
        processedTransitions: 0
      };
    }

    this._schedulerLookupContext = this._buildSchedulerLookupContext();
    try {
      let changed = false;
      let processedTransitions = 0;
      const processingStartedRealMs = Date.now();
      let lastError = null;
      let transitionCapHit = false;
      let timeCapHit = false;
      let dueScanMs = 0;
      let applyTransitionMs = 0;
      let fullFlightScans = 0;

      const dueQueueStart = Date.now();
      const initialDueTransitions = this.collectDueFlightTransitions(simulationNowMs);
      const dueQueue = new SchedulerDueHeap((left, right) => {
        if (left.dueAtSimulationMs !== right.dueAtSimulationMs) {
          return left.dueAtSimulationMs - right.dueAtSimulationMs;
        }
        return String(left.flightId).localeCompare(String(right.flightId));
      });
      for (const transition of initialDueTransitions) {
        dueQueue.push(transition);
      }
      dueScanMs += Date.now() - dueQueueStart;
      fullFlightScans = 1;

      while (
        processedTransitions < MAX_FLIGHT_TRANSITIONS_PER_TICK &&
        Date.now() - processingStartedRealMs <= MAX_FLIGHT_PROCESSING_REAL_MS &&
        dueQueue.size() > 0
      ) {
        const transition = dueQueue.pop();
        const applyStart = Date.now();
        const transitionResult = this.applyFlightTransition(transition, simulationNowMs);
        applyTransitionMs += Date.now() - applyStart;
        if (!transitionResult.success) {
          lastError = transitionResult;
          break;
        }

        changed = changed || Boolean(transitionResult.changed);
        processedTransitions += 1;

        const updatedFlight = this._schedulerLookupContext.flightById.get(transition.flightId);
        if (updatedFlight) {
          const nextTransition = this.getDueTransitionForSingleFlight(updatedFlight, simulationNowMs);
          if (nextTransition) {
            dueQueue.push(nextTransition);
          }
        }
      }

      const schedulerWorkMs = Date.now() - processingStartedRealMs;
      if (processedTransitions >= MAX_FLIGHT_TRANSITIONS_PER_TICK) {
        transitionCapHit = true;
      }
      if (schedulerWorkMs >= MAX_FLIGHT_PROCESSING_REAL_MS) {
        timeCapHit = true;
      }

      return {
        success: !lastError,
        changed,
        processedTransitions,
        error: lastError,
        transitionCapHit,
        timeCapHit,
        schedulerWorkMs,
        dueScanMs,
        applyTransitionMs,
        fullFlightScans
      };
    } finally {
      this._schedulerLookupContext = null;
    }
  }
}

module.exports = FlightEngine;