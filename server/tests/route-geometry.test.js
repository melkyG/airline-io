const test = require('node:test');
const assert = require('node:assert/strict');

const { buildGreatCircleRouteSegments } = require('../../client/routeGeometry.js');

function getAllPoints(segments) {
  return segments.flat();
}

function assertNoLargeLongitudeJumps(segments) {
  segments.forEach((segment) => {
    for (let index = 1; index < segment.length; index += 1) {
      const previousLng = segment[index - 1][0];
      const currentLng = segment[index][0];
      assert.ok(Math.abs(currentLng - previousLng) <= 180.000001);
    }
  });
}

function assertPointAlmostEqual(actualPoint, expectedPoint, epsilon = 1e-9) {
  assert.equal(actualPoint.length, 2);
  assert.equal(expectedPoint.length, 2);
  assert.ok(Math.abs(actualPoint[0] - expectedPoint[0]) <= epsilon);
  assert.ok(Math.abs(actualPoint[1] - expectedPoint[1]) <= epsilon);
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function interpolateGreatCirclePoint(origin, destination, t) {
  const originLat = toRadians(origin.lat);
  const originLng = toRadians(origin.lng);
  const destinationLat = toRadians(destination.lat);
  const destinationLng = toRadians(destination.lng);

  const originVector = {
    x: Math.cos(originLat) * Math.cos(originLng),
    y: Math.cos(originLat) * Math.sin(originLng),
    z: Math.sin(originLat)
  };

  const destinationVector = {
    x: Math.cos(destinationLat) * Math.cos(destinationLng),
    y: Math.cos(destinationLat) * Math.sin(destinationLng),
    z: Math.sin(destinationLat)
  };

  const dotProduct = Math.max(
    -1,
    Math.min(
      1,
      (originVector.x * destinationVector.x) +
      (originVector.y * destinationVector.y) +
      (originVector.z * destinationVector.z)
    )
  );
  const angularDistance = Math.acos(dotProduct);

  if (!Number.isFinite(angularDistance) || angularDistance < 1e-9) {
    return {
      lat: origin.lat + ((destination.lat - origin.lat) * t),
      lng: origin.lng + ((destination.lng - origin.lng) * t)
    };
  }

  const sinAngularDistance = Math.sin(angularDistance);
  const scaleOrigin = Math.sin((1 - t) * angularDistance) / sinAngularDistance;
  const scaleDestination = Math.sin(t * angularDistance) / sinAngularDistance;

  const x = (originVector.x * scaleOrigin) + (destinationVector.x * scaleDestination);
  const y = (originVector.y * scaleOrigin) + (destinationVector.y * scaleDestination);
  const z = (originVector.z * scaleOrigin) + (destinationVector.z * scaleDestination);

  return {
    lat: (Math.atan2(z, Math.sqrt((x * x) + (y * y))) * 180) / Math.PI,
    lng: (Math.atan2(y, x) * 180) / Math.PI
  };
}

function normalizeLongitude(lng) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function unwrapLongitude(lng, previousLng) {
  let unwrappedLng = normalizeLongitude(lng);

  while (unwrappedLng - previousLng > 180) {
    unwrappedLng -= 360;
  }

  while (unwrappedLng - previousLng < -180) {
    unwrappedLng += 360;
  }

  return unwrappedLng;
}

test('short ordinary route returns one sampled segment', () => {
  const origin = { lat: 43.6777, lng: -79.6248 };
  const destination = { lat: 40.6413, lng: -73.7781 };

  const segments = buildGreatCircleRouteSegments(origin, destination);

  assert.equal(segments.length, 1);
  assertPointAlmostEqual(segments[0][0], [origin.lng, origin.lat]);
  assertPointAlmostEqual(segments[0][segments[0].length - 1], [destination.lng, destination.lat]);
  assert.ok(segments[0].length > 2);
  assertNoLargeLongitudeJumps(segments);
});

test('long route NYC to Tokyo samples a curved great-circle path', () => {
  const origin = { lat: 40.6413, lng: -73.7781 };
  const destination = { lat: 35.5494, lng: 139.7798 };

  const segments = buildGreatCircleRouteSegments(origin, destination);
  const points = getAllPoints(segments);
  const maxLatitude = points.reduce((maximum, point) => Math.max(maximum, point[1]), -Infinity);
  const pureGreatCircleMaxLatitude = Array.from({ length: 24 }, (_, index) => index / 23).reduce(
    (maximum, progress) => Math.max(maximum, interpolateGreatCirclePoint(origin, destination, progress).lat),
    -Infinity
  );
  const straightPathMaxLatitude = Math.max(origin.lat, destination.lat);

  assert.ok(segments.length >= 2);
  assertPointAlmostEqual(segments[0][0], [origin.lng, origin.lat]);
  assertPointAlmostEqual(
    segments[segments.length - 1][segments[segments.length - 1].length - 1],
    [destination.lng, destination.lat]
  );
  assert.ok(points.length >= 30);
  assert.ok(maxLatitude < pureGreatCircleMaxLatitude);
  assert.ok(maxLatitude > straightPathMaxLatitude);
  assertNoLargeLongitudeJumps(segments);
});

test('170E to 170W splits across the dateline into two segments', () => {
  const origin = { lat: 0, lng: 170 };
  const destination = { lat: 0, lng: -170 };

  const segments = buildGreatCircleRouteSegments(origin, destination);

  assert.equal(segments.length, 2);
  assertPointAlmostEqual(segments[0][0], [170, 0]);
  assert.equal(segments[0][segments[0].length - 1][0], 180);
  assert.equal(segments[1][0][0], -180);
  assertPointAlmostEqual(segments[segments.length - 1][segments[segments.length - 1].length - 1], [-170, 0]);
  assert.equal(segments[0][segments[0].length - 1][1], segments[1][0][1]);
  assertNoLargeLongitudeJumps(segments);
});

test('170W to 170E splits across the dateline in reverse direction', () => {
  const origin = { lat: 0, lng: -170 };
  const destination = { lat: 0, lng: 170 };

  const segments = buildGreatCircleRouteSegments(origin, destination);

  assert.equal(segments.length, 2);
  assertPointAlmostEqual(segments[0][0], [-170, 0]);
  assert.equal(segments[0][segments[0].length - 1][0], -180);
  assert.equal(segments[1][0][0], 180);
  assertPointAlmostEqual(segments[segments.length - 1][segments[segments.length - 1].length - 1], [170, 0]);
  assert.equal(segments[0][segments[0].length - 1][1], segments[1][0][1]);
  assertNoLargeLongitudeJumps(segments);
});

test('near-boundary 179.5 to -179.5 splits without a 360-degree jump', () => {
  const origin = { lat: 12, lng: 179.5 };
  const destination = { lat: 14, lng: -179.5 };

  const segments = buildGreatCircleRouteSegments(origin, destination);

  assert.equal(segments.length, 2);
  assertPointAlmostEqual(segments[0][0], [179.5, 12]);
  assertPointAlmostEqual(segments[segments.length - 1][segments[segments.length - 1].length - 1], [-179.5, 14]);
  assertNoLargeLongitudeJumps(segments);
});

test('ordinary long route under 180 degrees longitude difference does not split', () => {
  const origin = { lat: 10, lng: -10 };
  const destination = { lat: 35, lng: 150 };

  const segments = buildGreatCircleRouteSegments(origin, destination);

  assert.equal(segments.length, 1);
  assertPointAlmostEqual(segments[0][0], [origin.lng, origin.lat]);
  assertPointAlmostEqual(segments[0][segments[0].length - 1], [destination.lng, destination.lat]);
  assertNoLargeLongitudeJumps(segments);
});

test('exact 180-degree longitude separation stays deterministic and unsplit', () => {
  const origin = { lat: 20, lng: 0 };
  const destination = { lat: 20, lng: 180 };

  const segments = buildGreatCircleRouteSegments(origin, destination);

  assert.equal(segments.length, 1);
  assertPointAlmostEqual(segments[0][0], [0, 20]);
  assertPointAlmostEqual(segments[0][segments[0].length - 1], [180, 20]);
  assertNoLargeLongitudeJumps(segments);
});
