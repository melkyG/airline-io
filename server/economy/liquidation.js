const MARKET_LIQUIDATION_RATE = 0.8;

function calculateMarketLiquidationValue(baseValue) {
  const normalizedBaseValue = Number(baseValue);
  if (!Number.isFinite(normalizedBaseValue) || normalizedBaseValue < 0) {
    return 0;
  }

  return Math.round(normalizedBaseValue * MARKET_LIQUIDATION_RATE);
}

function calculateAirportSellToGamePrice(basePrice) {
  return calculateMarketLiquidationValue(basePrice);
}

function calculateAircraftSellToGamePrice(purchasePrice) {
  return calculateMarketLiquidationValue(purchasePrice);
}

module.exports = {
  MARKET_LIQUIDATION_RATE,
  calculateMarketLiquidationValue,
  calculateAirportSellToGamePrice,
  calculateAircraftSellToGamePrice
};