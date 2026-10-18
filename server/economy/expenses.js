const REFERENCE_AIRPORT_PRICE = 500_000;
const REFERENCE_DAILY_AIRPORT_FEE = 3_000;
const AIRPORT_OPERATING_FEE_EXPONENT = 1.05;

function calculateAircraftFuelExpense({
  distanceKm,
  fuelCostPerKm,
  expenseFactor = 1.0
} = {}) {
  const normalizedDistance = Number(distanceKm);
  const safeDistance = Number.isFinite(normalizedDistance) && normalizedDistance >= 0
    ? normalizedDistance
    : 0;

  const normalizedFuelCost = Number(fuelCostPerKm);
  const safeFuelCost = Number.isFinite(normalizedFuelCost) && normalizedFuelCost >= 0
    ? normalizedFuelCost
    : 0;

  const normalizedFactor = Number(expenseFactor);
  const safeFactor = Number.isFinite(normalizedFactor) && normalizedFactor > 0
    ? normalizedFactor
    : 1.0;

  const baseFuelCost = Math.round(safeDistance * safeFuelCost);
  const finalFuelCost = Math.round(baseFuelCost * safeFactor);

  return {
    distanceKm: safeDistance,
    fuelCostPerKm: safeFuelCost,
    baseFuelCost,
    expenseFactor: safeFactor,
    finalFuelCost
  };
}

function calculateAircraftMaintenanceExpense({
  monthlyMaintenanceCost,
  expenseFactor = 1.0
} = {}) {
  const normalizedCost = Number(monthlyMaintenanceCost);
  const safeCost = Number.isFinite(normalizedCost) && normalizedCost >= 0
    ? normalizedCost
    : 0;

  const normalizedFactor = Number(expenseFactor);
  const safeFactor = Number.isFinite(normalizedFactor) && normalizedFactor > 0
    ? normalizedFactor
    : 1.0;

  const baseMaintenanceCost = Math.round(safeCost);
  const finalMaintenanceCost = Math.round(baseMaintenanceCost * safeFactor);

  return {
    baseMaintenanceCost,
    expenseFactor: safeFactor,
    finalMaintenanceCost
  };
}

function calculateAirportOperatingFee({
  basePrice,
  expenseFactor = 1.0
} = {}) {
  const normalizedBasePrice = Number(basePrice);
  if (!Number.isFinite(normalizedBasePrice) || normalizedBasePrice < 0) {
    return {
      baseFee: 0,
      expenseFactor: 1.0,
      finalFee: 0
    };
  }

  const normalizedFactor = Number(expenseFactor);
  const safeFactor = Number.isFinite(normalizedFactor) && normalizedFactor >= 0
    ? normalizedFactor
    : 1.0;

  const priceRatio = normalizedBasePrice / REFERENCE_AIRPORT_PRICE;
  const baseFee = Math.round(
    REFERENCE_DAILY_AIRPORT_FEE * Math.pow(priceRatio, AIRPORT_OPERATING_FEE_EXPONENT)
  );
  const finalFee = Math.round(baseFee * safeFactor);

  return {
    baseFee,
    expenseFactor: safeFactor,
    finalFee
  };
}

module.exports = {
  REFERENCE_AIRPORT_PRICE,
  REFERENCE_DAILY_AIRPORT_FEE,
  AIRPORT_OPERATING_FEE_EXPONENT,
  calculateAirportOperatingFee,
  calculateAircraftFuelExpense,
  calculateAircraftMaintenanceExpense
};
