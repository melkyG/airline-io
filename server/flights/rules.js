const TURNAROUND_MINUTES_PER_KMH = 333 / 900;
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

  return (normalizedRouteDistanceKm / normalizedCruiseSpeedKmH) * 60 * 60 * 1000;
}

function calculateAircraftTurnaroundSimulationMs(cruiseSpeedKmH) {
  const normalizedSpeed = Number(cruiseSpeedKmH);
  if (!Number.isFinite(normalizedSpeed) || normalizedSpeed <= 0) {
    return null;
  }
  const turnaroundMinutes = normalizedSpeed * TURNAROUND_MINUTES_PER_KMH;
  return turnaroundMinutes * 60 * 1000;
}

module.exports = {
  TURNAROUND_MINUTES_PER_KMH,
  FLIGHT_SCHEDULER_TICK_REAL_MS,
  MAX_FLIGHT_TRANSITIONS_PER_TICK,
  MAX_FLIGHT_PROCESSING_REAL_MS,
  calculateFlightDurationSimulationMs,
  calculateAircraftTurnaroundSimulationMs
};
