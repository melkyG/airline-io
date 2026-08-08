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

  const baseRevenue = normalizedBaseRevenuePerKm * normalizedRouteDistanceKm;

  return {
    success: true,
    baseRevenue,
    finalRevenue: baseRevenue
  };
}

module.exports = {
  calculateFlightSettlement
};