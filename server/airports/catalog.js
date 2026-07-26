const AIRPORT_CATALOG = Object.freeze([
  Object.freeze({
    id: 'YYZ',
    iata: 'YYZ',
    name: 'Toronto Pearson International Airport',
    city: 'Toronto',
    country: 'Canada',
    lat: 43.6777,
    lng: -79.6248,
    size: 'large',
    basePrice: 300000
  }),
  Object.freeze({
    id: 'DFW',
    iata: 'DFW',
    name: 'Dallas/Fort Worth International Airport',
    city: 'Dallas-Fort Worth',
    country: 'United States',
    lat: 32.8998,
    lng: -97.0403,
    size: 'large',
    basePrice: 320000
  })
]);

module.exports = {
  AIRPORT_CATALOG
};
