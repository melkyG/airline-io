const MAX_DISTANCE_BONUS = 0.85;
const DISTANCE_BONUS_MIDPOINT_KM = 7000;
const DISTANCE_BONUS_SCALE_KM = 1500;
const FLIGHT_REVENUE_MULTIPLIER = 0.55;

const AIRPORT_REVENUE_REFERENCE_PRICE = 650_000;
const AIRPORT_REVENUE_EXPONENT = 0.27;

function calculateDistanceBonusFactor(distanceKm) {
  return 1 + MAX_DISTANCE_BONUS / (1 + Math.exp(-(distanceKm - DISTANCE_BONUS_MIDPOINT_KM) / DISTANCE_BONUS_SCALE_KM));
}

function resolveAirportValueFactor(basePrice) {
  const price = Number(basePrice);
  if (!Number.isFinite(price) || price <= 0) {
    return 1.0;
  }
  return Math.pow(price / AIRPORT_REVENUE_REFERENCE_PRICE, AIRPORT_REVENUE_EXPONENT);
}

function calculateFlightSettlement({
  baseRevenuePerKm,
  routeDistanceKm
}) {
  const normalizedBaseRevenuePerKm = Number(baseRevenuePerKm);
  if (!Number.isFinite(normalizedBaseRevenuePerKm) || normalizedBaseRevenuePerKm <= 0) {
    return {
      success: false,
      code: 'BASE_REVENUE_PER_KM_INVALID',
      message: 'Aircraft baseRevenuePerKm must be a finite positive number.'
    };
  }

  const normalizedRouteDistanceKm = Number(routeDistanceKm);
  if (!Number.isFinite(normalizedRouteDistanceKm) || normalizedRouteDistanceKm <= 0) {
    return {
      success: false,
      code: 'ROUTE_DISTANCE_INVALID',
      message: 'Route distanceKm must be a finite positive number.'
    };
  }

  const distanceBonusFactor = calculateDistanceBonusFactor(normalizedRouteDistanceKm);
  const linearRevenue = normalizedBaseRevenuePerKm * normalizedRouteDistanceKm;
  const finalRevenue = linearRevenue * distanceBonusFactor * FLIGHT_REVENUE_MULTIPLIER;

  return {
    success: true,
    baseRevenue: finalRevenue,
    finalRevenue
  };
}

module.exports = {
  FLIGHT_REVENUE_MULTIPLIER,
  AIRPORT_REVENUE_REFERENCE_PRICE,
  AIRPORT_REVENUE_EXPONENT,
  resolveAirportValueFactor,
  calculateFlightSettlement
};