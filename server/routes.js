const EARTH_RADIUS_KM = 6371;

function normalizeAirportId(airportId) {
  return String(airportId || '').trim();
}

function canonicalRouteKey(originAirportId, destinationAirportId) {
  const normalizedIds = [normalizeAirportId(originAirportId), normalizeAirportId(destinationAirportId)].sort();
  return normalizedIds.join('::');
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function calculateRouteDistanceKm(originAirport, destinationAirport) {
  if (!originAirport || !destinationAirport) {
    return 0;
  }

  const originLat = Number(originAirport.lat);
  const originLng = Number(originAirport.lng);
  const destinationLat = Number(destinationAirport.lat);
  const destinationLng = Number(destinationAirport.lng);

  if (
    !Number.isFinite(originLat) ||
    !Number.isFinite(originLng) ||
    !Number.isFinite(destinationLat) ||
    !Number.isFinite(destinationLng)
  ) {
    return 0;
  }

  const latDelta = toRadians(destinationLat - originLat);
  const lngDelta = toRadians(destinationLng - originLng);
  const originLatRadians = toRadians(originLat);
  const destinationLatRadians = toRadians(destinationLat);

  const sinHalfLat = Math.sin(latDelta / 2);
  const sinHalfLng = Math.sin(lngDelta / 2);
  const haversine =
    sinHalfLat * sinHalfLat +
    Math.cos(originLatRadians) * Math.cos(destinationLatRadians) * sinHalfLng * sinHalfLng;
  const angularDistance = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return Math.round(EARTH_RADIUS_KM * angularDistance);
}

module.exports = {
  canonicalRouteKey,
  calculateRouteDistanceKm
};