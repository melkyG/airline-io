(function bootstrapRouteGeometry(globalScope) {
  const MIN_SAMPLE_POINTS = 8;
  const MAX_SAMPLE_POINTS = 96;
  const SAMPLE_DEGREES_PER_POINT = 2.5;
  const ROUTE_CURVE_STRENGTH = 0.3;

  function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  function toDegrees(radians) {
    return (radians * 180) / Math.PI;
  }

  function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeLongitude(lng) {
    const numericLng = Number(lng);
    if (!Number.isFinite(numericLng)) {
      return null;
    }

    const normalizedLng = ((((numericLng + 180) % 360) + 360) % 360) - 180;
    return normalizedLng === -180 && numericLng > 0 ? 180 : normalizedLng;
  }

  function unwrapLongitude(lng, previousLng) {
    let unwrappedLng = normalizeLongitude(lng);
    if (!Number.isFinite(unwrappedLng)) {
      return null;
    }

    if (!Number.isFinite(previousLng)) {
      return unwrappedLng;
    }

    while (unwrappedLng - previousLng > 180) {
      unwrappedLng -= 360;
    }

    while (unwrappedLng - previousLng < -180) {
      unwrappedLng += 360;
    }

    return unwrappedLng;
  }

  function interpolateShortestLongitudePoint(origin, destination, t) {
    const originLat = Number(origin && origin.lat);
    const originLng = Number(origin && origin.lng);
    const destinationLat = Number(destination && destination.lat);
    const destinationLng = Number(destination && destination.lng);
    const unwrappedDestinationLng = unwrapLongitude(destinationLng, originLng);

    if (
      !Number.isFinite(originLat) ||
      !Number.isFinite(originLng) ||
      !Number.isFinite(destinationLat) ||
      !Number.isFinite(unwrappedDestinationLng)
    ) {
      return null;
    }

    return {
      lat: originLat + ((destinationLat - originLat) * t),
      lng: originLng + ((unwrappedDestinationLng - originLng) * t)
    };
  }

  function getUnitVectorFromLatLng(lat, lng) {
    const latitudeRadians = toRadians(lat);
    const longitudeRadians = toRadians(lng);
    const cosLatitude = Math.cos(latitudeRadians);

    return {
      x: cosLatitude * Math.cos(longitudeRadians),
      y: cosLatitude * Math.sin(longitudeRadians),
      z: Math.sin(latitudeRadians)
    };
  }

  function interpolateGreatCirclePoint(origin, destination, t) {
    const originLat = Number(origin && origin.lat);
    const originLng = Number(origin && origin.lng);
    const destinationLat = Number(destination && destination.lat);
    const destinationLng = Number(destination && destination.lng);

    const originVector = getUnitVectorFromLatLng(originLat, originLng);
    const destinationVector = getUnitVectorFromLatLng(destinationLat, destinationLng);
    const dotProduct = clampNumber(
      (originVector.x * destinationVector.x) +
      (originVector.y * destinationVector.y) +
      (originVector.z * destinationVector.z),
      -1,
      1
    );
    const angularDistance = Math.acos(dotProduct);

    if (!Number.isFinite(angularDistance) || angularDistance < 1e-9) {
      return {
        lat: originLat + ((destinationLat - originLat) * t),
        lng: originLng + ((destinationLng - originLng) * t)
      };
    }

    const sinAngularDistance = Math.sin(angularDistance);
    if (Math.abs(sinAngularDistance) < 1e-9) {
      return {
        lat: originLat + ((destinationLat - originLat) * t),
        lng: originLng + ((destinationLng - originLng) * t)
      };
    }

    const scaleOrigin = Math.sin((1 - t) * angularDistance) / sinAngularDistance;
    const scaleDestination = Math.sin(t * angularDistance) / sinAngularDistance;

    const x = (originVector.x * scaleOrigin) + (destinationVector.x * scaleDestination);
    const y = (originVector.y * scaleOrigin) + (destinationVector.y * scaleDestination);
    const z = (originVector.z * scaleOrigin) + (destinationVector.z * scaleDestination);

    return {
      lat: toDegrees(Math.atan2(z, Math.sqrt((x * x) + (y * y)))),
      lng: toDegrees(Math.atan2(y, x))
    };
  }

  function interpolateSoftenedRoutePoint(origin, destination, t) {
    if (t <= 0) {
      return {
        lat: Number(origin && origin.lat),
        lng: Number(origin && origin.lng)
      };
    }

    if (t >= 1) {
      return {
        lat: Number(destination && destination.lat),
        lng: Number(destination && destination.lng)
      };
    }

    const greatCirclePoint = interpolateGreatCirclePoint(origin, destination, t);
    const straightPoint = interpolateShortestLongitudePoint(origin, destination, t);
    if (!greatCirclePoint || !straightPoint) {
      return greatCirclePoint || straightPoint || null;
    }

    const unwrappedGreatCircleLng = unwrapLongitude(greatCirclePoint.lng, straightPoint.lng);
    if (!Number.isFinite(unwrappedGreatCircleLng)) {
      return straightPoint;
    }

    return {
      lat: straightPoint.lat + ((greatCirclePoint.lat - straightPoint.lat) * ROUTE_CURVE_STRENGTH),
      lng: straightPoint.lng + ((unwrappedGreatCircleLng - straightPoint.lng) * ROUTE_CURVE_STRENGTH)
    };
  }

  function getGreatCircleSampleCount(origin, destination, requestedSampleCount) {
    if (Number.isInteger(requestedSampleCount) && requestedSampleCount >= 2) {
      return clampNumber(requestedSampleCount, 2, MAX_SAMPLE_POINTS);
    }

    const originVector = getUnitVectorFromLatLng(Number(origin && origin.lat), Number(origin && origin.lng));
    const destinationVector = getUnitVectorFromLatLng(Number(destination && destination.lat), Number(destination && destination.lng));
    const dotProduct = clampNumber(
      (originVector.x * destinationVector.x) +
      (originVector.y * destinationVector.y) +
      (originVector.z * destinationVector.z),
      -1,
      1
    );
    const angularDistanceDegrees = toDegrees(Math.acos(dotProduct));
    const estimatedSampleCount = Math.ceil(angularDistanceDegrees / SAMPLE_DEGREES_PER_POINT) + 1;

    return clampNumber(estimatedSampleCount, MIN_SAMPLE_POINTS, MAX_SAMPLE_POINTS);
  }

  function appendSegment(segments, currentSegment) {
    if (Array.isArray(currentSegment) && currentSegment.length >= 2) {
      segments.push(currentSegment.map((point) => [point[0], point[1]]));
    }
  }

  function buildGreatCircleRouteSegments(origin, destination, options = {}) {
    const originLat = Number(origin && origin.lat);
    const originLng = Number(origin && origin.lng);
    const destinationLat = Number(destination && destination.lat);
    const destinationLng = Number(destination && destination.lng);

    if (
      !Number.isFinite(originLat) ||
      !Number.isFinite(originLng) ||
      !Number.isFinite(destinationLat) ||
      !Number.isFinite(destinationLng)
    ) {
      return [];
    }

    const sampleCount = getGreatCircleSampleCount(origin, destination, options.sampleCount);
    const samples = [];

    for (let index = 0; index < sampleCount; index += 1) {
      const progress = sampleCount === 1 ? 0 : index / (sampleCount - 1);
      const point = interpolateSoftenedRoutePoint(origin, destination, progress);
      if (!point) {
        continue;
      }

      samples.push({
        lat: point.lat,
        lng: index === 0 ? originLng : (index === sampleCount - 1 ? destinationLng : point.lng)
      });
    }

    const segments = [];
    let currentSegment = [[samples[0].lng, samples[0].lat]];
    let previousSample = {
      lat: samples[0].lat,
      lng: samples[0].lng
    };

    for (let index = 1; index < samples.length; index += 1) {
      const sample = samples[index];
      const unwrappedLng = unwrapLongitude(sample.lng, previousSample.lng);
      if (!Number.isFinite(unwrappedLng)) {
        continue;
      }

      const segmentDeltaLng = unwrappedLng - previousSample.lng;
      const crossesPositiveDateLine = previousSample.lng < 180 && unwrappedLng > 180;
      const crossesNegativeDateLine = previousSample.lng > -180 && unwrappedLng < -180;

      if (crossesPositiveDateLine || crossesNegativeDateLine) {
        const boundaryLng = crossesPositiveDateLine ? 180 : -180;
        const progressToBoundary = segmentDeltaLng === 0 ? 0 : (boundaryLng - previousSample.lng) / segmentDeltaLng;
        const crossingLat = previousSample.lat + ((sample.lat - previousSample.lat) * progressToBoundary);

        currentSegment.push([boundaryLng, crossingLat]);
        appendSegment(segments, currentSegment);

        currentSegment = [[boundaryLng === 180 ? -180 : 180, crossingLat]];
      }

      currentSegment.push([normalizeLongitude(unwrappedLng), sample.lat]);
      previousSample = {
        lat: sample.lat,
        lng: unwrappedLng
      };
    }

    appendSegment(segments, currentSegment);

    if (segments.length < 1) {
      return [[[originLng, originLat], [destinationLng, destinationLat]]];
    }

    return segments;
  }

  const api = {
    ROUTE_CURVE_STRENGTH,
    buildGreatCircleRouteSegments
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.createRouteGeometry = api;
})(typeof window !== 'undefined' ? window : globalThis);