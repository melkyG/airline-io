const AIRPORT_CAPACITY = Object.freeze({
  Cheap: Object.freeze({
    maxRoutes: 3,
    maxAircraftPerRoute: 10
  }),
  Standard: Object.freeze({
    maxRoutes: 5,
    maxAircraftPerRoute: 25
  }),
  Major: Object.freeze({
    maxRoutes: 8,
    maxAircraftPerRoute: 75
  }),
  Hub: Object.freeze({
    maxRoutes: 12,
    maxAircraftPerRoute: 200
  }),
  Elite: Object.freeze({
    maxRoutes: 20,
    maxAircraftPerRoute: 500
  })
});

module.exports = {
  AIRPORT_CAPACITY
};
