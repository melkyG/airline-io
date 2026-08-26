const TURNAROUND_MINUTES_PER_KMH = 333 / 900;
const TURNAROUND_REFERENCE_DISTANCE_KM = 10000;
const TURNAROUND_DISTANCE_BASE_FACTOR = 0.105;
const FLIGHT_SCHEDULER_TICK_REAL_MS = 50;
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

function calculateAircraftTurnaroundSimulationMs(cruiseSpeedKmH, routeDistanceKm) {
  const normalizedSpeed = Number(cruiseSpeedKmH);
  const normalizedDistance = Number(routeDistanceKm);
  if (
    !Number.isFinite(normalizedSpeed) ||
    normalizedSpeed <= 0 ||
    !Number.isFinite(normalizedDistance) ||
    normalizedDistance <= 0
  ) {
    return null;
  }
  const baseTurnaroundMinutes = normalizedSpeed * TURNAROUND_MINUTES_PER_KMH;
  const distanceRatio = normalizedDistance / TURNAROUND_REFERENCE_DISTANCE_KM;
  const distanceFactor =
    TURNAROUND_DISTANCE_BASE_FACTOR +
    ((1 - TURNAROUND_DISTANCE_BASE_FACTOR) * distanceRatio);
  const turnaroundMinutes = baseTurnaroundMinutes * distanceFactor;
  return turnaroundMinutes * 60 * 1000;
}

module.exports = {
  TURNAROUND_MINUTES_PER_KMH,
  TURNAROUND_REFERENCE_DISTANCE_KM,
  FLIGHT_SCHEDULER_TICK_REAL_MS,
  MAX_FLIGHT_TRANSITIONS_PER_TICK,
  MAX_FLIGHT_PROCESSING_REAL_MS,
  calculateFlightDurationSimulationMs,
  calculateAircraftTurnaroundSimulationMs
};
