const { AIRCRAFT_CATALOG_BY_ID } = require('./aircraft/catalog');
const {
  MAX_FLIGHT_TRANSITIONS_PER_TICK,
  MAX_FLIGHT_PROCESSING_REAL_MS,
  calculateFlightDurationSimulationMs,
  calculateAircraftTurnaroundSimulationMs
} = require('./flights/rules');
const { OWNED_AIRCRAFT_STATUS } = require('./aircraft/ownership');

class FlightEngine {
  constructor({
    authoritativeState,
    getSimulationTimeMs,
    resolveFlightArrivalSettlementContext,
    createBoundedScheduler,
    onTick
  }) {
    this.authoritativeState = authoritativeState;
    this.getSimulationTimeMs = getSimulationTimeMs;
    this.resolveFlightArrivalSettlementContext = resolveFlightArrivalSettlementContext;
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
    const flights = Array.isArray(this.authoritativeState.flights) ? this.authoritativeState.flights : [];
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft) ? this.authoritativeState.ownedAircraft : [];

    return flights
      .map((flight) => {
        if (!flight || !flight.flightId) {
          return null;
        }

        const currentStatus = String(flight.status || '').trim();
        const currentDirection = String(flight.direction || '').trim();

        if (currentStatus === 'ready' && currentDirection === 'outbound') {
          const route = routes.find((candidate) => candidate && String(candidate.routeId || '').trim() === String(flight.routeId || '').trim());
          if (route) {
            const reconfiguringModelCatalogIds = Array.isArray(route.reconfiguringModelCatalogIds)
              ? route.reconfiguringModelCatalogIds
              : [];
            const aircraft = ownedAircraft.find((candidate) => candidate && String(candidate.aircraftInstanceId || '').trim() === String(flight.aircraftInstanceId || '').trim());
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

      const turnaroundDurationSimulationMs = calculateAircraftTurnaroundSimulationMs(cruiseSpeedKmH);
      if (!Number.isFinite(turnaroundDurationSimulationMs) || turnaroundDurationSimulationMs <= 0) {
        return {
          success: false,
          code: 'TURNAROUND_DURATION_INVALID',
          message: 'Turnaround duration could not be calculated from aircraft speed.',
          flightId: transition.flightId
        };
      }

      settlementContext.ownerPlayer.capital =
        settlementContext.currentCapital + settlementContext.settlementResult.finalRevenue;

      flight.status = 'turnaround';
      flight.departedAtSimulationMs = null;
      flight.arrivesAtSimulationMs = null;
      flight.nextTransitionAtSimulationMs = arrivalSimulationMs + turnaroundDurationSimulationMs;
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
          const turnaroundDurationSimulationMs = calculateAircraftTurnaroundSimulationMs(cruiseSpeedKmH);
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

    return {
      success: !lastError,
      changed,
      processedTransitions,
      error: lastError
    };
  }
}

module.exports = FlightEngine;