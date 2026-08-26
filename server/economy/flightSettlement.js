const REVENUE_DISTANCE_REFERENCE_KM = 10000;
const REVENUE_DISTANCE_EXPONENT = 1.015;

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

  const distanceRatio = normalizedRouteDistanceKm / REVENUE_DISTANCE_REFERENCE_KM;
  const scaledDistanceKm =
    REVENUE_DISTANCE_REFERENCE_KM * Math.pow(distanceRatio, REVENUE_DISTANCE_EXPONENT);
  const finalRevenue = normalizedBaseRevenuePerKm * scaledDistanceKm;

  return {
    success: true,
    baseRevenue: finalRevenue,
    finalRevenue
  };
}

module.exports = {
  calculateFlightSettlement
};