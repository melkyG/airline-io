const MIN_FLIGHT_DURATION_SIMULATION_MS = 180 * 60 * 1000;
const TURNAROUND_DURATION_SIMULATION_MS = 333 * 60 * 1000;
const FLIGHT_SCHEDULER_TICK_REAL_MS = 250;
const MAX_FLIGHT_TRANSITIONS_PER_TICK = 200;
const MAX_FLIGHT_PROCESSING_REAL_MS = 25;

function calculateFlightDurationSimulationMs(routeDistanceKm, cruiseSpeedKmH) {
  const normalizedRouteDistanceKm = Number(routeDistanceKm);
  const normalizedCruiseSpeedKmH = Number(cruiseSpeedKmH);

  if (
    !Number.isFinite(normalizedRouteDistanceKm) ||
    normalizedRouteDistanceKm < 0 ||
    !Number.isFinite(normalizedCruiseSpeedKmH) ||
    normalizedCruiseSpeedKmH <= 0
  ) {
    return null;
  }

  const rawDurationSimulationMs = (normalizedRouteDistanceKm / normalizedCruiseSpeedKmH) * 60 * 60 * 1000;
  return Math.max(rawDurationSimulationMs, MIN_FLIGHT_DURATION_SIMULATION_MS);
}

module.exports = {
  MIN_FLIGHT_DURATION_SIMULATION_MS,
  TURNAROUND_DURATION_SIMULATION_MS,
  FLIGHT_SCHEDULER_TICK_REAL_MS,
  MAX_FLIGHT_TRANSITIONS_PER_TICK,
  MAX_FLIGHT_PROCESSING_REAL_MS,
  calculateFlightDurationSimulationMs
};
