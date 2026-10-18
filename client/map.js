(function bootstrapMapModule(globalScope) {
  const CAMERA_BOUNDS = [[-60, -180], [84, 180]];
  const BASEMAP_MAX_ZOOM = 5.85;
  const INITIAL_CENTER = [0, 20];
  const INITIAL_ZOOM = 2;
  const AIRPORT_ICON_SIZE = 48;
  const AIRPORT_TOOLTIP_OFFSET_X = 14;
  const AIRPORT_TOOLTIP_OFFSET_Y = -10;
  const AIRPORT_LABEL_ZOOM_IATA = 4.6;
  const AIRPORT_LABEL_ZOOM_NAME = 6.1;
  const AIRPORT_MARKER_SCALE_MIN = 0.28;
  const AIRPORT_MARKER_SCALE_MAX = 1.28;
  const FILTERED_AIRPORT_MARKER_SCALE_MIN = 0.42;
  const AIRPORT_MARKER_SCALE_MIN_ZOOM = INITIAL_ZOOM;
  const AIRPORT_MARKER_SCALE_MAX_ZOOM = BASEMAP_MAX_ZOOM;
  const ROUTE_LINE_COLOR = '#000000';
  const ROUTE_LINE_WIDTH = 1.0;
  const OWNED_AIRPORT_FALLBACK_COLOR = '#0ea5e9';
  const MAPLIBRE_ROUTE_SOURCE_ID = 'airline-routes-source';
  const MAPLIBRE_ROUTE_LAYER_ID = 'airline-routes-layer';
  const MAPLIBRE_FLIGHT_SOURCE_ID = 'airline-flights-source';
  const MAPLIBRE_FLIGHT_LAYER_ID = 'airline-flights-layer';
  const MAPLIBRE_AIRPORT_BADGE_SOURCE_ID = 'airline-airport-badge-source';
  const MAPLIBRE_AIRPORT_BADGE_LAYER_ID = 'airline-airport-badge-layer';
  const MAPLIBRE_AIRPORT_BADGE_BEFORE_LAYER_ID = 'place_city';
  const MAPLIBRE_COUNTRY_SOURCE_ID = 'airline-country-source';
  const MAPLIBRE_COUNTRY_LAYER_ID = 'airline-country-layer';
  const MAPLIBRE_COUNTRY_HOVER_LAYER_ID = 'airline-country-hover-layer';
  const MAPLIBRE_COUNTRY_HOVER_LINE_COLOR = '#3d3d3d';
  const MAPLIBRE_COUNTRY_HOVER_LINE_WIDTH = 0.28;
  const MAPLIBRE_COUNTRY_HOVER_LINE_OPACITY = 0.7;
  const MAPLIBRE_COUNTRY_HOVER_FADE_IN_DURATION_MS = 2750;
  const MAPLIBRE_COUNTRY_HOVER_FADE_OUT_DURATION_MS = 16000;
  const MAPLIBRE_COUNTRY_HOVER_FADE_DELAY_MS = 50;
  const MAPLIBRE_COUNTRY_FILL_COLOR = '#00ff00';
  const MAPLIBRE_COUNTRY_FILL_OPACITY = 0.4;
  const MAPLIBRE_COUNTRY_PROFIT_NEUTRAL_FACTOR = 1.00;
  const MAPLIBRE_COUNTRY_PROFIT_RED_MAX_FACTOR = 0.30;
  const MAPLIBRE_COUNTRY_PROFIT_GREEN_MAX_FACTOR = 2.50;
  const MAPLIBRE_COUNTRY_PROFIT_MAX_OPACITY = 0.50;
  const COUNTRY_HOVER_POPUP_DWELL_MS = 500;
  const FLIGHT_DOT_COLOR = '#0e7ccf';
  const FLIGHT_DOT_RADIUS_MIN_PX = 4;
  const FLIGHT_DOT_RADIUS_MAX_PX = 7;
  const FLIGHT_DOT_RADIUS_MIN_ZOOM = INITIAL_ZOOM;
  const FLIGHT_DOT_RADIUS_MAX_ZOOM = BASEMAP_MAX_ZOOM;
  const FLIGHT_DOT_STROKE_COLOR = '#000000';
  const FLIGHT_DOT_STROKE_WIDTH_PX = 0.2;
  const AIRPORT_BADGE_FILL_OPACITY = 0.85;
  const AIRPORT_BADGE_UNOWNED_FILL_COLOR = '#ffffff';
  const AIRPORT_BADGE_STROKE_COLOR = '#000000';
  const AIRPORT_BADGE_STROKE_WIDTH_PX = 1.0;
  const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  });
  const buildGreatCircleRouteSegments =
    globalScope.createRouteGeometry && typeof globalScope.createRouteGeometry.buildGreatCircleRouteSegments === 'function'
      ? globalScope.createRouteGeometry.buildGreatCircleRouteSegments
      : null;
  const AIRPORT_MARKER_INNER_HTML =
    `<div class="airport-marker-content">` +
    `<div class="airport-marker-pulse-wrapper">` +
    `<span class="airport-marker-ownership-badge" aria-hidden="true"></span>` +
    `<div class="airport-marker airport-marker-visual airport-marker--control-tower-svg">` +
    `<svg class="airport-marker-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<rect class="airport-marker-base" x="5.5" y="18" width="13" height="3" rx="1.6"/>` +
    `<rect class="airport-marker-shaft" x="10.2" y="9.4" width="3.6" height="8.6" rx="1.6"/>` +
    `<rect class="airport-marker-room" x="6.2" y="4.2" width="11.6" height="6.2" rx="2.1"/>` +
    `<rect class="airport-marker-window" x="8" y="6.2" width="8" height="2" rx="0.8"/>` +
    `<rect class="airport-marker-antenna" x="11.55" y="2" width="1" height="2.4" rx="0.45"/>` +
    `</svg>` +
    `</div>` +
    `</div>` +
    `<div class="airport-marker-label" aria-hidden="true"></div>` +
    `</div>`;
  const AIRPORT_ICON =
    typeof globalScope.L !== 'undefined'
      ? globalScope.L.divIcon({
          className: 'airport-marker airport-marker--control-tower-svg',
          html: AIRPORT_MARKER_INNER_HTML,
          iconSize: [AIRPORT_ICON_SIZE, AIRPORT_ICON_SIZE],
          iconAnchor: [AIRPORT_ICON_SIZE / 2, AIRPORT_ICON_SIZE / 2]
        })
      : null;
  const BASEMAP_CONFIG = {
    name: 'Stadia.AlidadeSmoothVector',
    styleUrl: '/assets/map-style/airline-basemap.json',
    apiKey: '',
    attribution:
      '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a> ' +
      '&copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> ' +
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
  };

  function getBasemapStyleUrl() {
    if (!BASEMAP_CONFIG.apiKey) {
      return BASEMAP_CONFIG.styleUrl;
    }

    return `${BASEMAP_CONFIG.styleUrl}?api_key=${encodeURIComponent(BASEMAP_CONFIG.apiKey)}`;
  }

  function toMapLibreBounds(latLngBounds) {
    return [
      [latLngBounds[0][1], latLngBounds[0][0]],
      [latLngBounds[1][1], latLngBounds[1][0]]
    ];
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

  function interpolateLinearValue(value, inputMin, inputMax, outputMin, outputMax) {
    if (!Number.isFinite(value)) {
      return outputMin;
    }

    if (inputMax <= inputMin) {
      return outputMax;
    }

    const progress = clampNumber((value - inputMin) / (inputMax - inputMin), 0, 1);
    return outputMin + ((outputMax - outputMin) * progress);
  }

  function getAirportMarkerScaleForZoom(zoomLevel) {
    return interpolateLinearValue(
      zoomLevel,
      AIRPORT_MARKER_SCALE_MIN_ZOOM,
      AIRPORT_MARKER_SCALE_MAX_ZOOM,
      AIRPORT_MARKER_SCALE_MIN,
      AIRPORT_MARKER_SCALE_MAX
    );
  }

  function getFilteredAirportMarkerScaleAdjustmentForZoom(zoomLevel) {
    const markerScale = getAirportMarkerScaleForZoom(zoomLevel);
    const filteredMarkerScale = interpolateLinearValue(
      zoomLevel,
      AIRPORT_MARKER_SCALE_MIN_ZOOM,
      AIRPORT_MARKER_SCALE_MAX_ZOOM,
      FILTERED_AIRPORT_MARKER_SCALE_MIN,
      AIRPORT_MARKER_SCALE_MAX
    );

    return filteredMarkerScale / markerScale;
  }

  function getAirportBadgeDiameterPxForZoom(zoomLevel) {
    const markerSizePx = 26;
    const badgeExtraPx = 8;
    return (markerSizePx + badgeExtraPx) * getAirportMarkerScaleForZoom(zoomLevel);
  }

  function getMapLibreAirportBadgeRadiusExpression() {
    const minRadiusPx = getAirportBadgeDiameterPxForZoom(AIRPORT_MARKER_SCALE_MIN_ZOOM) / 2;
    const maxRadiusPx = getAirportBadgeDiameterPxForZoom(AIRPORT_MARKER_SCALE_MAX_ZOOM) / 2;

    return [
      'interpolate',
      ['linear'],
      ['zoom'],
      AIRPORT_MARKER_SCALE_MIN_ZOOM,
      minRadiusPx,
      AIRPORT_MARKER_SCALE_MAX_ZOOM,
      maxRadiusPx
    ];
  }

  function applyAirportMarkerScaleToElement(markerRootElement, zoomLevel) {
    if (!markerRootElement || !markerRootElement.style) {
      return;
    }

    markerRootElement.style.setProperty('--airport-marker-scale', getAirportMarkerScaleForZoom(zoomLevel).toFixed(3));
    markerRootElement.style.setProperty(
      '--airport-filtered-marker-scale-adjustment',
      getFilteredAirportMarkerScaleAdjustmentForZoom(zoomLevel).toFixed(3)
    );
  }

  function applyAirportMarkerScaleInContainer(containerElement, zoomLevel) {
    if (!containerElement || typeof containerElement.querySelectorAll !== 'function') {
      return;
    }

    containerElement
      .querySelectorAll('.airport-marker-root')
      .forEach((markerRootElement) => applyAirportMarkerScaleToElement(markerRootElement, zoomLevel));
  }

  function installLeafletAirportMarkerZoomScaling(leafletNamespace) {
    if (
      !leafletNamespace ||
      !leafletNamespace.Map ||
      typeof leafletNamespace.Map.addInitHook !== 'function' ||
      leafletNamespace.Map.prototype.__airportMarkerZoomScalingInstalled
    ) {
      return;
    }

    leafletNamespace.Map.prototype.__airportMarkerZoomScalingInstalled = true;
    leafletNamespace.Map.addInitHook(function addAirportMarkerZoomScalingHook() {
      const updateAirportMarkerScale = () => {
        const containerElement = typeof this.getContainer === 'function' ? this.getContainer() : null;
        const zoomLevel = typeof this.getZoom === 'function' ? this.getZoom() : INITIAL_ZOOM;
        applyAirportMarkerScaleInContainer(containerElement, zoomLevel);
      };

      this.on('zoom zoomend layeradd', updateAirportMarkerScale);

      if (typeof this.whenReady === 'function') {
        this.whenReady(updateAirportMarkerScale);
      }
    });
  }

  installLeafletAirportMarkerZoomScaling(globalScope.L);

  function isTouchDeviceLike() {
    const hasTouchPoints = Number(globalScope.navigator && globalScope.navigator.maxTouchPoints) > 0;
    const hasTouchEvent = 'ontouchstart' in globalScope;
    const coarsePointer =
      typeof globalScope.matchMedia === 'function' && globalScope.matchMedia('(pointer: coarse)').matches;

    return Boolean(hasTouchPoints || hasTouchEvent || coarsePointer);
  }

  function applyMobileRotationLockToMapLibre(mapInstance) {
    if (!mapInstance || !isTouchDeviceLike()) {
      return;
    }

    if (mapInstance.dragRotate && typeof mapInstance.dragRotate.disable === 'function') {
      mapInstance.dragRotate.disable();
    }

    if (mapInstance.touchZoomRotate && typeof mapInstance.touchZoomRotate.disableRotation === 'function') {
      mapInstance.touchZoomRotate.disableRotation();
    }
  }

  function createAirportLookupById(airports) {
    return (Array.isArray(airports) ? airports : []).reduce((lookup, airport) => {
      if (!airport) {
        return lookup;
      }

      const airportId = String(airport.id || airport.iata || '').trim();
      if (!airportId) {
        return lookup;
      }

      lookup.set(airportId, airport);
      return lookup;
    }, new Map());
  }

  function createPlayersById(players) {
    return (Array.isArray(players) ? players : []).reduce((lookup, player) => {
      if (!player || !player.id) {
        return lookup;
      }

      lookup.set(String(player.id), player);
      return lookup;
    }, new Map());
  }

  function isValidHexColor(value) {
    return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(value || '').trim());
  }

  function normalizeHexColor(value, fallbackColor) {
    const normalizedValue = String(value || '').trim();
    if (isValidHexColor(normalizedValue)) {
      return normalizedValue;
    }

    return fallbackColor;
  }

  function parseHexColorChannels(colorHex) {
    const normalizedColorHex = normalizeHexColor(colorHex, OWNED_AIRPORT_FALLBACK_COLOR);
    const compactHex = normalizedColorHex.slice(1);
    const expandedHex = compactHex.length === 3
      ? compactHex.split('').map((segment) => `${segment}${segment}`).join('')
      : compactHex;

    return {
      red: Number.parseInt(expandedHex.slice(0, 2), 16),
      green: Number.parseInt(expandedHex.slice(2, 4), 16),
      blue: Number.parseInt(expandedHex.slice(4, 6), 16)
    };
  }

  function toRgbaColor(colorHex, alpha = 1) {
    const { red, green, blue } = parseHexColorChannels(colorHex);
    const normalizedAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    return `rgba(${red}, ${green}, ${blue}, ${normalizedAlpha})`;
  }

  function getCountryProfitFactorFromState(state, countryName) {
    const world = state && state.game && state.game.world;
    const factors = world && world.countryProfitFactors;
    const normalizedCountry = countryName != null ? String(countryName).trim() : '';
    const value = normalizedCountry ? factors && factors[normalizedCountry] : undefined;

    if (value == null) {
      return MAPLIBRE_COUNTRY_PROFIT_NEUTRAL_FACTOR;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : MAPLIBRE_COUNTRY_PROFIT_NEUTRAL_FACTOR;
  }

  function getCountryProfitabilityColor(factor) {
    const neutral = MAPLIBRE_COUNTRY_PROFIT_NEUTRAL_FACTOR;
    const safeFactor = Number.isFinite(factor) ? factor : neutral;

    if (safeFactor === neutral) {
      return 'rgba(0, 0, 0, 0)';
    }

    return safeFactor < neutral ? 'rgb(255, 0, 0)' : 'rgb(0, 255, 0)';
  }

  function getCountryProfitabilityOpacity(factor) {
    const neutral = MAPLIBRE_COUNTRY_PROFIT_NEUTRAL_FACTOR;
    const safeFactor = Number.isFinite(factor) ? factor : neutral;

    if (safeFactor === neutral) {
      return 0;
    }

    const maxOpacity = MAPLIBRE_COUNTRY_PROFIT_MAX_OPACITY;

    if (safeFactor < neutral) {
      const distance = neutral - safeFactor;
      const maxDistance = neutral - MAPLIBRE_COUNTRY_PROFIT_RED_MAX_FACTOR;
      const intensity = Math.min(distance / maxDistance, 1);
      return Math.pow(intensity, 1.5) * maxOpacity;
    }

    const distance = safeFactor - neutral;
    const maxDistance = MAPLIBRE_COUNTRY_PROFIT_GREEN_MAX_FACTOR - neutral;
    const intensity = Math.min(distance / maxDistance, 1);
    return Math.pow(intensity, 1.5) * maxOpacity;
  }

  function formatCountryProfitabilityMultiplier(factor) {
    const numericFactor = factor == null ? NaN : Number(factor);
    const safeFactor = Number.isFinite(numericFactor) ? numericFactor : MAPLIBRE_COUNTRY_PROFIT_NEUTRAL_FACTOR;
    return `${safeFactor.toFixed(2)}×`;
  }

  function getCountryPopupMultiplierText(state, countryAdmin) {
    const factor = getCountryProfitFactorFromState(state, countryAdmin);
    return `Current multiplier: ${formatCountryProfitabilityMultiplier(factor)}`;
  }

  function isAirportVisibleAtPrice(airport, range = {}) {
    const { minPrice = null, maxPrice = null } = range || {};
    const rawPrice = airport && airport.basePrice;
    const price = rawPrice == null ? NaN : Number(rawPrice);

    if (!Number.isFinite(price)) {
      return true;
    }

    if (minPrice != null && Number.isFinite(Number(minPrice)) && price < Number(minPrice)) {
      return false;
    }

    if (maxPrice != null && Number.isFinite(Number(maxPrice)) && price > Number(maxPrice)) {
      return false;
    }

    return true;
  }

  function createCountryHoverPopupScheduler({
    dwellMs = COUNTRY_HOVER_POPUP_DWELL_MS,
    onShow = () => {},
    onHide = () => {},
    setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
    clearTimeoutFn = (id) => clearTimeout(id)
  } = {}) {
    let currentKey = null;
    let timerId = null;
    let blocked = false;

    function cancelTimer() {
      if (timerId !== null) {
        clearTimeoutFn(timerId);
        timerId = null;
      }
    }

    function setBlocked(nextBlocked) {
      blocked = Boolean(nextBlocked);
      if (blocked) {
        cancelTimer();
        currentKey = null;
        onHide();
      }
    }

    function schedule(key) {
      if (blocked) {
        return;
      }

      const normalizedKey = key != null && String(key).trim() !== '' ? String(key) : null;

      if (normalizedKey === currentKey) {
        return;
      }

      cancelTimer();
      onHide();
      currentKey = normalizedKey;

      if (!currentKey) {
        return;
      }

      const scheduledKey = currentKey;
      timerId = setTimeoutFn(() => {
        timerId = null;
        if (currentKey === scheduledKey) {
          onShow(scheduledKey);
        }
      }, dwellMs);
    }

    function clear() {
      cancelTimer();
      currentKey = null;
      onHide();
    }

    function isPending() {
      return timerId !== null;
    }

    return { schedule, clear, isPending, setBlocked };
  }

  function getCountryProfitabilityPaint(factor) {
    return {
      'fill-color': getCountryProfitabilityColor(factor),
      'fill-opacity': getCountryProfitabilityOpacity(factor)
    };
  }

  function buildCountryProfitabilityPaint(state) {
    const world = state && state.game && state.game.world;
    const factors = world && world.countryProfitFactors;
    const entries = [];

    if (factors && typeof factors === 'object') {
      for (const [country, value] of Object.entries(factors)) {
        const numericValue = Number(value);
        if (Number.isFinite(numericValue)) {
          entries.push([country, numericValue]);
        }
      }
    }

    if (entries.length === 0) {
      return getCountryProfitabilityPaint(MAPLIBRE_COUNTRY_PROFIT_NEUTRAL_FACTOR);
    }

    const colorStops = [];
    const opacityStops = [];

    for (const [country, factor] of entries) {
      colorStops.push(country, getCountryProfitabilityColor(factor));
      opacityStops.push(country, getCountryProfitabilityOpacity(factor));
    }

    return {
      'fill-color': ['match', ['get', 'ADMIN'], ...colorStops, getCountryProfitabilityColor(MAPLIBRE_COUNTRY_PROFIT_NEUTRAL_FACTOR)],
      'fill-opacity': ['match', ['get', 'ADMIN'], ...opacityStops, getCountryProfitabilityOpacity(MAPLIBRE_COUNTRY_PROFIT_NEUTRAL_FACTOR)]
    };
  }

  function resolvePlayerColorHexById(playerId, playersById, fallbackColor = null) {
    const normalizedPlayerId = playerId != null ? String(playerId).trim() : '';
    if (!normalizedPlayerId) {
      return fallbackColor;
    }

    const player = playersById instanceof Map ? playersById.get(normalizedPlayerId) : null;
    if (!player) {
      return fallbackColor;
    }

    return normalizeHexColor(player.colorHex, fallbackColor);
  }

  function resolveAirportOwnerColorHex(airport, playersById) {
    const ownerPlayerId = airport && airport.ownerPlayerId != null
      ? String(airport.ownerPlayerId).trim()
      : '';

    if (!ownerPlayerId) {
      return null;
    }

    return resolvePlayerColorHexById(ownerPlayerId, playersById, OWNED_AIRPORT_FALLBACK_COLOR);
  }

  function resolveAirportBadgeColorHex(airport, playersById) {
    const listingSellerPlayerId =
      airport &&
      airport.saleListing &&
      typeof airport.saleListing === 'object' &&
      Number.isFinite(airport.saleListing.askingPrice) &&
      airport.saleListing.sellerPlayerId != null
        ? String(airport.saleListing.sellerPlayerId).trim()
        : '';

    if (listingSellerPlayerId) {
      return resolvePlayerColorHexById(listingSellerPlayerId, playersById, OWNED_AIRPORT_FALLBACK_COLOR);
    }

    return resolveAirportOwnerColorHex(airport, playersById);
  }

  function applyAirportMarkerOwnershipStyling(markerElement, airport, playersById) {
    if (!markerElement) {
      return;
    }

    const colorTargetElement =
      markerElement.querySelector('.airport-marker-visual') ||
      markerElement.querySelector('.airport-marker') ||
      (markerElement.classList && markerElement.classList.contains('airport-marker') ? markerElement : null);
    const ownerPlayerId = airport && airport.ownerPlayerId;
    const hasListing =
      !!(airport && airport.saleListing && typeof airport.saleListing === 'object' && Number.isFinite(airport.saleListing.askingPrice));
    const ownerColorHex = resolveAirportOwnerColorHex(airport, playersById);

    markerElement.setAttribute('data-owned', ownerPlayerId == null ? 'false' : 'true');
    markerElement.setAttribute('data-listed', hasListing ? 'true' : 'false');

    if (colorTargetElement) {
      // Keep the airport icon styling static; ownership color is shown only in the badge fill.
      colorTargetElement.style.removeProperty('--airport-marker-room-fill');
      colorTargetElement.style.removeProperty('--airport-marker-stroke');
    }

    if (!ownerColorHex) {
      markerElement.style.removeProperty('--airport-marker-badge-ring');
      markerElement.style.removeProperty('--airport-marker-badge-fill');
      return;
    }

    markerElement.style.setProperty('--airport-marker-badge-ring', ownerColorHex);
    markerElement.style.setProperty('--airport-marker-badge-fill', toRgbaColor(ownerColorHex, AIRPORT_BADGE_FILL_OPACITY));
  }

  function applyAirportMarkerReconfigurationPulse(markerElement, airportId, routes) {
    if (!markerElement) {
      return;
    }

    const normalizedAirportId = String(airportId || '').trim();
    const pulseWrapperElement = markerElement.querySelector('.airport-marker-pulse-wrapper');
    if (!pulseWrapperElement) {
      return;
    }

    const hasReconfiguringOriginRoute = Array.isArray(routes) && routes.some((route) => {
      return String(route.originAirportId || '').trim() === normalizedAirportId && route.isReconfiguring === true;
    });

    if (hasReconfiguringOriginRoute) {
      pulseWrapperElement.classList.add('airport-marker-pulse-wrapper--reconfiguring');
    } else {
      pulseWrapperElement.classList.remove('airport-marker-pulse-wrapper--reconfiguring');
    }
  }

  function deriveSimulationNowGameMs(snapshot, realNowMs = Date.now()) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    if (Number.isFinite(source.simulationEndedAtGameMs)) {
      return source.simulationEndedAtGameMs;
    }

    if (
      Number.isFinite(source.simulationStartedAtRealMs) &&
      Number.isFinite(source.simulationStartedAtGameMs) &&
      Number.isFinite(source.simulationSpeedMultiplier) &&
      source.simulationSpeedMultiplier > 0
    ) {
      const elapsedRealMs = Math.max(0, realNowMs - source.simulationStartedAtRealMs);
      return source.simulationStartedAtGameMs + (elapsedRealMs * source.simulationSpeedMultiplier);
    }

    if (Number.isFinite(source.simulationNowGameMs)) {
      return source.simulationNowGameMs;
    }

    return null;
  }

  function clamp01(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }

    if (value <= 0) {
      return 0;
    }

    if (value >= 1) {
      return 1;
    }

    return value;
  }

  function easeFlightProgress(rawProgress) {
    const clampedProgress = clamp01(rawProgress);
    return clampedProgress * clampedProgress * (3 - (2 * clampedProgress));
  }

  function getFlightDotRadiusPxForZoom(zoom, minZoom, maxZoom) {
    const normalizedZoom = Number(zoom);
    const normalizedMinZoom = Number(minZoom);
    const normalizedMaxZoom = Number(maxZoom);

    if (
      !Number.isFinite(normalizedZoom) ||
      !Number.isFinite(normalizedMinZoom) ||
      !Number.isFinite(normalizedMaxZoom) ||
      normalizedMaxZoom <= normalizedMinZoom
    ) {
      return FLIGHT_DOT_RADIUS_MIN_PX;
    }

    const zoomSpan = normalizedMaxZoom - normalizedMinZoom;
    const zoomProgress = clamp01((normalizedZoom - normalizedMinZoom) / zoomSpan);
    return FLIGHT_DOT_RADIUS_MIN_PX + ((FLIGHT_DOT_RADIUS_MAX_PX - FLIGHT_DOT_RADIUS_MIN_PX) * zoomProgress);
  }

  function getMapLibreFlightDotRadiusExpression() {
    return [
      'interpolate',
      ['linear'],
      ['zoom'],
      FLIGHT_DOT_RADIUS_MIN_ZOOM,
      FLIGHT_DOT_RADIUS_MIN_PX,
      FLIGHT_DOT_RADIUS_MAX_ZOOM,
      FLIGHT_DOT_RADIUS_MAX_PX
    ];
  }

  function buildRouteLegKey(originAirportId, destinationAirportId) {
    return `${String(originAirportId || '').trim()}->${String(destinationAirportId || '').trim()}`;
  }

  function reverseRouteGeometrySegments(routeGeometrySegments) {
    if (!Array.isArray(routeGeometrySegments) || routeGeometrySegments.length < 1) {
      return [];
    }

    return routeGeometrySegments
      .slice()
      .reverse()
      .map((segmentCoordinates) => {
        if (!Array.isArray(segmentCoordinates)) {
          return [];
        }

        return segmentCoordinates
          .slice()
          .reverse()
          .map((coordinatePair) => [coordinatePair[0], coordinatePair[1]]);
      });
  }

  function buildRenderableRouteGeometryLookup(renderableRoutes) {
    const lookupByLeg = new Map();
    const lookupByRouteId = new Map();

    (Array.isArray(renderableRoutes) ? renderableRoutes : []).forEach((routeEntry) => {
      const routeId = String(routeEntry && routeEntry.routeId || '').trim();
      const originAirportId = String(routeEntry && routeEntry.originAirportId || '').trim();
      const destinationAirportId = String(routeEntry && routeEntry.destinationAirportId || '').trim();
      const routeGeometrySegments = Array.isArray(routeEntry && routeEntry.segments) ? routeEntry.segments : [];

      if (routeGeometrySegments.length < 1) {
        return;
      }

      const normalizedRouteEntry = {
        routeId,
        originAirportId,
        destinationAirportId,
        segments: routeGeometrySegments,
        reverseSegments: reverseRouteGeometrySegments(routeGeometrySegments)
      };

      if (routeId) {
        lookupByRouteId.set(routeId, normalizedRouteEntry);
      }

      if (!originAirportId || !destinationAirportId) {
        return;
      }

      lookupByLeg.set(buildRouteLegKey(originAirportId, destinationAirportId), {
        routeEntry: normalizedRouteEntry,
        direction: 'forward'
      });
      lookupByLeg.set(buildRouteLegKey(destinationAirportId, originAirportId), {
        routeEntry: normalizedRouteEntry,
        direction: 'reverse'
      });
    });

    return {
      byLeg: lookupByLeg,
      byRouteId: lookupByRouteId
    };
  }

  function resolveFlightRouteGeometrySegments(flight, routeGeometryLookup) {
    const lookupByLeg = routeGeometryLookup && routeGeometryLookup.byLeg instanceof Map
      ? routeGeometryLookup.byLeg
      : new Map();
    const lookupByRouteId = routeGeometryLookup && routeGeometryLookup.byRouteId instanceof Map
      ? routeGeometryLookup.byRouteId
      : new Map();

    const originAirportId = String(flight && flight.originAirportId || '').trim();
    const destinationAirportId = String(flight && flight.destinationAirportId || '').trim();
    const routeId = String(flight && flight.routeId || '').trim();
    const direction = String(flight && flight.direction || '').trim().toLowerCase();

    const byRouteIdMatch = lookupByRouteId.get(routeId);
    if (byRouteIdMatch && Array.isArray(byRouteIdMatch.segments) && byRouteIdMatch.segments.length > 0) {
      if (direction === 'inbound') {
        const reverseSegments = Array.isArray(byRouteIdMatch.reverseSegments) && byRouteIdMatch.reverseSegments.length > 0
          ? byRouteIdMatch.reverseSegments
          : reverseRouteGeometrySegments(byRouteIdMatch.segments);

        return {
          segments: reverseSegments
        };
      }

      if (
        byRouteIdMatch.originAirportId &&
        byRouteIdMatch.destinationAirportId &&
        originAirportId &&
        destinationAirportId &&
        originAirportId === byRouteIdMatch.destinationAirportId &&
        destinationAirportId === byRouteIdMatch.originAirportId
      ) {
        const reverseSegments = Array.isArray(byRouteIdMatch.reverseSegments) && byRouteIdMatch.reverseSegments.length > 0
          ? byRouteIdMatch.reverseSegments
          : reverseRouteGeometrySegments(byRouteIdMatch.segments);

        return {
          segments: reverseSegments
        };
      }

      return {
        segments: byRouteIdMatch.segments
      };
    }

    const byLegMatch = lookupByLeg.get(buildRouteLegKey(originAirportId, destinationAirportId));
    if (
      byLegMatch &&
      byLegMatch.routeEntry &&
      Array.isArray(byLegMatch.routeEntry.segments) &&
      byLegMatch.routeEntry.segments.length > 0
    ) {
      const routeEntry = byLegMatch.routeEntry;
      const segments = byLegMatch.direction === 'reverse'
        ? (Array.isArray(routeEntry.reverseSegments) && routeEntry.reverseSegments.length > 0
          ? routeEntry.reverseSegments
          : reverseRouteGeometrySegments(routeEntry.segments))
        : routeEntry.segments;

      return {
        segments
      };
    }

    return {
      segments: null
    };
  }

  function getFlightPositionAlongRouteGeometry(routeGeometrySegments, progress) {
    const segments = Array.isArray(routeGeometrySegments) ? routeGeometrySegments : [];
    if (segments.length < 1) {
      return null;
    }

    const orderedPoints = [];
    segments.forEach((segmentCoordinates) => {
      if (!Array.isArray(segmentCoordinates)) {
        return;
      }

      segmentCoordinates.forEach((coordinatePair) => {
        if (!Array.isArray(coordinatePair) || coordinatePair.length < 2) {
          return;
        }

        const lng = Number(coordinatePair[0]);
        const lat = Number(coordinatePair[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          return;
        }

        const previousPoint = orderedPoints[orderedPoints.length - 1];
        if (previousPoint && previousPoint[0] === lng && previousPoint[1] === lat) {
          return;
        }

        orderedPoints.push([lng, lat]);
      });
    });

    if (orderedPoints.length < 1) {
      return null;
    }

    if (orderedPoints.length === 1) {
      return {
        lng: orderedPoints[0][0],
        lat: orderedPoints[0][1]
      };
    }

    const unwrappedPoints = [];
    orderedPoints.forEach((point, index) => {
      if (index === 0) {
        unwrappedPoints.push([point[0], point[1]]);
        return;
      }

      const previousUnwrappedPoint = unwrappedPoints[unwrappedPoints.length - 1];
      const unwrappedLng = unwrapLongitude(point[0], previousUnwrappedPoint[0]);
      if (!Number.isFinite(unwrappedLng)) {
        return;
      }

      unwrappedPoints.push([unwrappedLng, point[1]]);
    });

    if (unwrappedPoints.length < 1) {
      return null;
    }

    if (unwrappedPoints.length === 1) {
      return {
        lng: normalizeLongitude(unwrappedPoints[0][0]),
        lat: unwrappedPoints[0][1]
      };
    }

    const clampedProgress = clamp01(progress);
    if (clampedProgress <= 0) {
      return {
        lng: normalizeLongitude(unwrappedPoints[0][0]),
        lat: unwrappedPoints[0][1]
      };
    }

    if (clampedProgress >= 1) {
      const finalPoint = unwrappedPoints[unwrappedPoints.length - 1];
      return {
        lng: normalizeLongitude(finalPoint[0]),
        lat: finalPoint[1]
      };
    }

    const cumulativeSegmentLengths = [0];
    let totalPathLength = 0;

    for (let index = 1; index < unwrappedPoints.length; index += 1) {
      const previousPoint = unwrappedPoints[index - 1];
      const currentPoint = unwrappedPoints[index];
      const deltaLng = currentPoint[0] - previousPoint[0];
      const deltaLat = currentPoint[1] - previousPoint[1];
      const segmentLength = Math.hypot(deltaLng, deltaLat);
      totalPathLength += segmentLength;
      cumulativeSegmentLengths.push(totalPathLength);
    }

    if (!(totalPathLength > 0)) {
      return {
        lng: normalizeLongitude(unwrappedPoints[0][0]),
        lat: unwrappedPoints[0][1]
      };
    }

    const targetPathLength = totalPathLength * clampedProgress;

    for (let index = 1; index < unwrappedPoints.length; index += 1) {
      const segmentStartLength = cumulativeSegmentLengths[index - 1];
      const segmentEndLength = cumulativeSegmentLengths[index];

      if (targetPathLength > segmentEndLength && index < unwrappedPoints.length - 1) {
        continue;
      }

      const segmentLength = segmentEndLength - segmentStartLength;
      const segmentProgress = segmentLength > 0
        ? (targetPathLength - segmentStartLength) / segmentLength
        : 0;
      const startPoint = unwrappedPoints[index - 1];
      const endPoint = unwrappedPoints[index];
      const lng = startPoint[0] + ((endPoint[0] - startPoint[0]) * segmentProgress);
      const lat = startPoint[1] + ((endPoint[1] - startPoint[1]) * segmentProgress);

      return {
        lng: normalizeLongitude(lng),
        lat
      };
    }

    const fallbackPoint = unwrappedPoints[unwrappedPoints.length - 1];
    return {
      lng: normalizeLongitude(fallbackPoint[0]),
      lat: fallbackPoint[1]
    };
  }

  function resolveAircraftCruiseSpeedKmH(game, aircraftInstanceId) {
    const ownedAircraft = game && Array.isArray(game.ownedAircraft) ? game.ownedAircraft : [];
    const aircraft = ownedAircraft.find((candidate) => {
      return candidate && String(candidate.aircraftInstanceId || '').trim() === String(aircraftInstanceId || '').trim();
    });
    const catalogId = aircraft && aircraft.aircraftCatalogId ? String(aircraft.aircraftCatalogId).trim() : '';
    const catalog = game && Array.isArray(game.aircraftCatalog) ? game.aircraftCatalog : [];
    const catalogEntry = catalog.find((candidate) => {
      return candidate && String(candidate.aircraftCatalogId || '').trim() === catalogId;
    });
    return Number(catalogEntry && catalogEntry.cruiseSpeedKmH);
  }

  function resolveRouteDistanceKm(game, routeId) {
    const routes = game && Array.isArray(game.routes) ? game.routes : [];
    const route = routes.find((candidate) => {
      return candidate && String(candidate.routeId || '').trim() === String(routeId || '').trim();
    });
    return Number(route && route.distanceKm);
  }

  function calculateClientFlightDurationSimulationMs(routeDistanceKm, cruiseSpeedKmH) {
    const normalizedDistance = Number(routeDistanceKm);
    const normalizedSpeed = Number(cruiseSpeedKmH);
    if (
      !Number.isFinite(normalizedDistance) ||
      normalizedDistance < 0 ||
      !Number.isFinite(normalizedSpeed) ||
      normalizedSpeed <= 0
    ) {
      return null;
    }
    return (normalizedDistance / normalizedSpeed) * 60 * 60 * 1000;
  }

  function calculateClientTurnaroundSimulationMs(cruiseSpeedKmH, routeDistanceKm) {
    const TURNAROUND_MINUTES_PER_KMH = 333 / 900;
    const TURNAROUND_REFERENCE_DISTANCE_KM = 10000;
    const TURNAROUND_DISTANCE_BASE_FACTOR = 0.105;
    const normalizedSpeed = Number(cruiseSpeedKmH);
    const normalizedDistance = Number(routeDistanceKm);
    if (
      !Number.isFinite(normalizedSpeed) ||
      normalizedSpeed <= 0 ||
      !Number.isFinite(normalizedDistance) ||
      normalizedDistance <= 0
    ) {
      return null;
    }
    const baseTurnaroundMinutes = normalizedSpeed * TURNAROUND_MINUTES_PER_KMH;
    const distanceRatio = normalizedDistance / TURNAROUND_REFERENCE_DISTANCE_KM;
    const distanceFactor =
      TURNAROUND_DISTANCE_BASE_FACTOR +
      ((1 - TURNAROUND_DISTANCE_BASE_FACTOR) * distanceRatio);
    const turnaroundMinutes = baseTurnaroundMinutes * distanceFactor;
    return turnaroundMinutes * 60 * 1000;
  }

  function getProjectedInFlightLeg(flight, game, simNow) {
    const routeId = String(flight && flight.routeId || '').trim();
    const aircraftInstanceId = String(flight && flight.aircraftInstanceId || '').trim();

    if (!routeId || !aircraftInstanceId) {
      return null;
    }

    const routes = game && Array.isArray(game.routes) ? game.routes : [];
    const route = routes.find((candidate) => {
      return candidate && String(candidate.routeId || '').trim() === routeId;
    });
    const ownedAircraft = game && Array.isArray(game.ownedAircraft) ? game.ownedAircraft : [];
    const aircraft = ownedAircraft.find((candidate) => {
      return candidate && String(candidate.aircraftInstanceId || '').trim() === aircraftInstanceId;
    });
    if (!route || !aircraft) {
      return null;
    }

    const distanceKm = resolveRouteDistanceKm(game, routeId);
    const cruiseSpeedKmH = resolveAircraftCruiseSpeedKmH(game, aircraftInstanceId);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isFinite(cruiseSpeedKmH) || cruiseSpeedKmH <= 0) {
      return null;
    }

    const flightDuration = calculateClientFlightDurationSimulationMs(distanceKm, cruiseSpeedKmH);
    const turnaround = calculateClientTurnaroundSimulationMs(cruiseSpeedKmH, distanceKm);
    if (!Number.isFinite(flightDuration) || flightDuration <= 0 || !Number.isFinite(turnaround) || turnaround <= 0) {
      return null;
    }

    const fullRoundTrip = (2 * flightDuration) + (2 * turnaround);
    if (fullRoundTrip <= 0) {
      return null;
    }

    const aircraftCatalogId = String(aircraft.aircraftCatalogId || '').trim();
    const reconfiguringModelCatalogIds = Array.isArray(route.reconfiguringModelCatalogIds)
      ? route.reconfiguringModelCatalogIds
      : [];
    const isReconfiguring = reconfiguringModelCatalogIds.some((candidateId) => {
      return String(candidateId || '').trim() === aircraftCatalogId;
    });

    const rawLastOutbound = flight && flight.lastOutboundDepartedAtSimulationMs;
    if (rawLastOutbound == null) {
      return null;
    }
    const lastOutbound = Number(rawLastOutbound);
    if (!Number.isFinite(lastOutbound)) {
      return null;
    }

    const elapsed = simNow - lastOutbound;
    if (isReconfiguring && elapsed >= fullRoundTrip) {
      return null;
    }

    const outboundAnchor = lastOutbound;

    if (simNow < outboundAnchor) {
      return null;
    }

    const phase = elapsed % fullRoundTrip;
    const cycleOffset = Math.floor(elapsed / fullRoundTrip) * fullRoundTrip;

    let legDirection = null;
    let legDeparture = null;
    let legArrival = null;

    if (phase < flightDuration) {
      legDirection = 'outbound';
      legDeparture = outboundAnchor + cycleOffset;
      legArrival = legDeparture + flightDuration;
    } else if (phase < flightDuration + turnaround) {
      return null;
    } else if (phase < (2 * flightDuration) + turnaround) {
      legDirection = 'inbound';
      legDeparture = outboundAnchor + cycleOffset + flightDuration + turnaround;
      legArrival = legDeparture + flightDuration;
    } else {
      return null;
    }

    const originAirportId = legDirection === 'outbound'
      ? route.originAirportId
      : route.destinationAirportId;
    const destinationAirportId = legDirection === 'outbound'
      ? route.destinationAirportId
      : route.originAirportId;

    if (!originAirportId || !destinationAirportId) {
      return null;
    }

    return {
      aircraftInstanceId,
      ownerPlayerId: route ? route.ownerPlayerId : null,
      routeId,
      originAirportId,
      destinationAirportId,
      direction: legDirection,
      departedAtSimulationMs: legDeparture,
      arrivesAtSimulationMs: legArrival
    };
  }

  function calculateFlightDotPosition(flight, simNow, airportLookupById, routeGeometryLookup) {
    const originAirportId = String(flight && flight.originAirportId || '').trim();
    const destinationAirportId = String(flight && flight.destinationAirportId || '').trim();
    const departedAtSimulationMs = Number(flight && flight.departedAtSimulationMs);
    const arrivesAtSimulationMs = Number(flight && flight.arrivesAtSimulationMs);

    if (
      !originAirportId ||
      !destinationAirportId ||
      !Number.isFinite(departedAtSimulationMs) ||
      !Number.isFinite(arrivesAtSimulationMs) ||
      arrivesAtSimulationMs <= departedAtSimulationMs
    ) {
      return null;
    }

    const originAirport = airportLookupById.get(originAirportId);
    const destinationAirport = airportLookupById.get(destinationAirportId);
    if (!originAirport || !destinationAirport) {
      return null;
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
      return null;
    }

    const rawProgress = clamp01(
      (simNow - departedAtSimulationMs) / (arrivesAtSimulationMs - departedAtSimulationMs)
    );
    const easedProgress = easeFlightProgress(rawProgress);
    let lng = originLng + ((destinationLng - originLng) * easedProgress);
    let lat = originLat + ((destinationLat - originLat) * easedProgress);

    if (easedProgress > 0 && easedProgress < 1) {
      let fallbackUsed = false;

      try {
        const lookupResult = resolveFlightRouteGeometrySegments(flight, routeGeometryLookup);
        const routeGeometrySegments =
          lookupResult && Array.isArray(lookupResult.segments) && lookupResult.segments.length > 0
            ? lookupResult.segments
            : (typeof buildGreatCircleRouteSegments === 'function'
              ? buildGreatCircleRouteSegments(
                  { lat: originLat, lng: originLng },
                  { lat: destinationLat, lng: destinationLng }
                )
              : []);
        const routePosition = getFlightPositionAlongRouteGeometry(routeGeometrySegments, easedProgress);

        if (routePosition && Number.isFinite(routePosition.lng) && Number.isFinite(routePosition.lat)) {
          lng = routePosition.lng;
          lat = routePosition.lat;
        } else {
          fallbackUsed = true;
        }
      } catch (error) {
        fallbackUsed = true;
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          const aircraftInstanceId = String(flight && flight.aircraftInstanceId || '').trim();
          const routeId = String(flight && flight.routeId || '').trim();
          const errorMessage = error && typeof error === 'object' && 'message' in error
            ? String(error.message)
            : String(error);

          console.warn('[flight-route-geometry:fallback]', {
            aircraftInstanceId,
            routeId,
            originAirportId,
            destinationAirportId,
            reason: errorMessage
          });
        }
      }

      if (fallbackUsed) {
        lng = originLng + ((destinationLng - originLng) * easedProgress);
        lat = originLat + ((destinationLat - originLat) * easedProgress);
      }
    }

    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      lng = originLng + ((destinationLng - originLng) * easedProgress);
      lat = originLat + ((destinationLat - originLat) * easedProgress);
    }

    return {
      lng,
      lat
    };
  }

  function getFlightDot(flight, game, simNow, playersById, airportLookupById, routeGeometryLookup) {
    if (!flight || !flight.aircraftInstanceId) {
      return null;
    }

    const aircraftInstanceId = String(flight.aircraftInstanceId || '').trim();
    const dotFlight = getProjectedInFlightLeg(flight, game, simNow);
    if (!dotFlight) {
      return null;
    }

    const dotPosition = calculateFlightDotPosition(dotFlight, simNow, airportLookupById, routeGeometryLookup);
    if (!dotPosition) {
      return null;
    }

    return {
      aircraftInstanceId,
      colorHex: resolvePlayerColorHexById(dotFlight.ownerPlayerId, playersById, FLIGHT_DOT_COLOR),
      lng: dotPosition.lng,
      lat: dotPosition.lat
    };
  }

  function getDrawableFlights(gameSnapshot, renderableRoutes = [], realNowMs = Date.now()) {
    const game = gameSnapshot && typeof gameSnapshot === 'object' ? gameSnapshot : null;
    if (!game) {
      return [];
    }

    const airports = Array.isArray(game.airports) ? game.airports : [];
    const flights = Array.isArray(game.flights) ? game.flights : [];
    const playersById = createPlayersById(game.players);
    const airportLookupById = createAirportLookupById(airports);
    const simulationClock = game.simulationClock && typeof game.simulationClock === 'object'
      ? game.simulationClock
      : game;
    const simulationNowGameMs = deriveSimulationNowGameMs(simulationClock, realNowMs);
    const routeGeometryLookup = buildRenderableRouteGeometryLookup(renderableRoutes);
    if (!Number.isFinite(simulationNowGameMs)) {
      return [];
    }

    return flights.reduce((drawableFlights, flight) => {
      const dot = getFlightDot(flight, game, simulationNowGameMs, playersById, airportLookupById, routeGeometryLookup);
      if (dot) {
        drawableFlights.push(dot);
      }
      return drawableFlights;
    }, []);
  }

  function isActiveGameSnapshot(gameSnapshot) {
    return Boolean(gameSnapshot && String(gameSnapshot.status || '') === 'active');
  }

  function getRenderableRouteSegments(routes, airports) {
    const airportLookupById = createAirportLookupById(airports);
    return (Array.isArray(routes) ? routes : []).reduce((segments, route) => {
      if (!route || !route.routeId) {
        return segments;
      }

      const originAirport = airportLookupById.get(String(route.originAirportId || ''));
      const destinationAirport = airportLookupById.get(String(route.destinationAirportId || ''));
      if (!originAirport || !destinationAirport) {
        return segments;
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
        return segments;
      }

      const routeSegments = typeof buildGreatCircleRouteSegments === 'function'
        ? buildGreatCircleRouteSegments(
            { lat: originLat, lng: originLng },
            { lat: destinationLat, lng: destinationLng }
          )
        : [[[originLng, originLat], [destinationLng, destinationLat]]];

      if (!Array.isArray(routeSegments) || routeSegments.length < 1) {
        return segments;
      }

      segments.push({
        routeId: String(route.routeId),
        originAirportId: String(route.originAirportId),
        destinationAirportId: String(route.destinationAirportId),
        pendingRemoval: Boolean(route.pendingRemoval === true),
        segments: routeSegments
      });
      return segments;
    }, []);
  }

  function createNativeMapRenderer(documentRef) {
    const mapContainer = documentRef.getElementById('mapContainer');
    const markerCollection = [];
    const routeCollection = [];
    const initialCameraBounds = toMapLibreBounds(CAMERA_BOUNDS);
    const airportMarkersById = new Map();
    const airportMarkerMetadataById = new Map();
    const tooltipElement = mapContainer ? documentRef.createElement('div') : null;
    const tooltipCodeElement = tooltipElement ? documentRef.createElement('div') : null;
    const tooltipCodeTextElement = tooltipCodeElement ? documentRef.createElement('span') : null;
    const tooltipTierBadgeElement = tooltipCodeElement ? documentRef.createElement('span') : null;
    const tooltipPriceElement = tooltipElement ? documentRef.createElement('div') : null;
    const tooltipOwnerElement = tooltipElement ? documentRef.createElement('div') : null;
    const countryTooltipElement = mapContainer ? documentRef.createElement('div') : null;
    const countryTooltipNameElement = countryTooltipElement ? documentRef.createElement('div') : null;
    const countryTooltipFactorElement = countryTooltipElement ? documentRef.createElement('div') : null;
    let mapInstance = null;
    let mapLoaded = false;
    let hasAppliedInitialCameraSetup = false;
    let hasBoundResizeListener = false;
    let lastKnownContainerWidth = null;
    let lastKnownContainerHeight = null;
    let airportSelectHandler = null;
    let activeHoveredAirportId = null;
    let latestGameSnapshot = null;
    let flightAnimationFrameId = null;
    let isFlightAnimationRunning = false;
    let lastCountryProfitabilityFillColor = null;
    let lastCountryProfitabilityFillOpacity = null;
    let hoveredCountryAdmin = '';
    let isAirportHoverSuppressed = false;
    let hasBoundCountryHoverHandlers = false;
    let lastCountryHoverPoint = null;
    let shownCountryPopupAdmin = null;
    let countryHoverChangeHandler = null;
    let airportPriceFilterMin = null;
    let airportPriceFilterMax = null;
    const PENDING_REMOVAL_DASH_SEQUENCE = [[4, 6], [5, 5], [6, 4], [5, 5]];
    const PENDING_REMOVAL_DASH_UPDATE_INTERVAL_MS = 150;
    let pendingRemovalDashTimerId = null;
    let pendingRemovalDashSequenceIndex = 0;

    if (tooltipElement) {
      tooltipElement.className = 'airport-tooltip airport-tooltip-hidden';
      tooltipCodeElement.className = 'airport-tooltip-code';
      tooltipTierBadgeElement.className = 'airport-tier-badge airport-tier-badge-hidden';
      tooltipCodeElement.appendChild(tooltipCodeTextElement);
      tooltipCodeElement.appendChild(tooltipTierBadgeElement);
      tooltipPriceElement.className = 'airport-tooltip-price';
      tooltipOwnerElement.className = 'airport-tooltip-owner';
      tooltipElement.appendChild(tooltipCodeElement);
      tooltipElement.appendChild(tooltipPriceElement);
      tooltipElement.appendChild(tooltipOwnerElement);
      mapContainer.appendChild(tooltipElement);
    }

    if (countryTooltipElement) {
      countryTooltipElement.className = 'airport-tooltip country-tooltip airport-tooltip-hidden';
      countryTooltipNameElement.className = 'airport-tooltip-code';
      countryTooltipFactorElement.className = 'airport-tooltip-price';
      countryTooltipElement.appendChild(countryTooltipNameElement);
      countryTooltipElement.appendChild(countryTooltipFactorElement);
      mapContainer.appendChild(countryTooltipElement);
    }

    function formatCurrencyValue(value) {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        return CURRENCY_FORMATTER.format(0);
      }

      return CURRENCY_FORMATTER.format(numericValue);
    }

    function getAirportTooltipData(airportId) {
      const game = latestGameSnapshot || {};
      const airports = Array.isArray(game.airports) ? game.airports : [];
      const playersById = createPlayersById(game.players);
      const airport = airports.find((candidate) => {
        if (!candidate) {
          return false;
        }

        const candidateId = candidate.id || candidate.iata;
        return String(candidateId) === String(airportId);
      });

      if (!airport) {
        return null;
      }

      const hasListingPrice =
        airport.saleListing && typeof airport.saleListing === 'object' && Number.isFinite(airport.saleListing.askingPrice);
      const relevantPrice = hasListingPrice ? airport.saleListing.askingPrice : airport.basePrice;
      const ownerPlayerId = airport.ownerPlayerId;
      const ownerText =
        ownerPlayerId == null
          ? 'Unowned'
          : ((playersById.get(String(ownerPlayerId)) || {}).username || 'Unknown');

      return {
        code: airport.iata || airport.id || String(airportId),
        price: formatCurrencyValue(relevantPrice),
        ownerText,
        economicClass: airport.economicClass ?? null
      };
    }

    function hideAirportTooltip() {
      activeHoveredAirportId = null;
      if (!tooltipElement) {
        return;
      }

      tooltipElement.classList.add('airport-tooltip-hidden');
    }

    function positionAirportTooltip(marker) {
      if (!tooltipElement || !mapInstance || !marker || !mapContainer) {
        return;
      }

      const markerLngLat = marker.getLngLat();
      if (!markerLngLat) {
        return;
      }

      const markerPoint = mapInstance.project(markerLngLat);
      const containerWidth = mapContainer.clientWidth;
      const containerHeight = mapContainer.clientHeight;
      const tooltipWidth = tooltipElement.offsetWidth;
      const tooltipHeight = tooltipElement.offsetHeight;

      let left = markerPoint.x + AIRPORT_TOOLTIP_OFFSET_X;
      let top = markerPoint.y + AIRPORT_TOOLTIP_OFFSET_Y;

      left = Math.max(6, Math.min(left, Math.max(6, containerWidth - tooltipWidth - 6)));
      top = Math.max(6, Math.min(top, Math.max(6, containerHeight - tooltipHeight - 6)));

      tooltipElement.style.left = `${Math.round(left)}px`;
      tooltipElement.style.top = `${Math.round(top)}px`;
    }

    function refreshAirportTooltip() {
      if (!tooltipElement || !activeHoveredAirportId) {
        return;
      }

      const marker = airportMarkersById.get(activeHoveredAirportId);
      const tooltipData = getAirportTooltipData(activeHoveredAirportId);
      if (!marker || !tooltipData) {
        hideAirportTooltip();
        return;
      }

      tooltipCodeTextElement.textContent = tooltipData.code;
      if (globalScope.airportTiers && typeof globalScope.airportTiers.syncAirportTierBadge === 'function') {
        globalScope.airportTiers.syncAirportTierBadge(tooltipTierBadgeElement, tooltipData.economicClass);
      }
      tooltipPriceElement.textContent = tooltipData.price;
      tooltipOwnerElement.textContent = tooltipData.ownerText;
      tooltipElement.classList.remove('airport-tooltip-hidden');
      positionAirportTooltip(marker);
    }

    function showAirportTooltip(airportId) {
      activeHoveredAirportId = airportId;
      refreshAirportTooltip();
    }

    function hideCountryTooltip() {
      shownCountryPopupAdmin = null;
      if (!countryTooltipElement) {
        return;
      }

      countryTooltipElement.classList.add('airport-tooltip-hidden');
    }

    function positionCountryTooltip() {
      if (!countryTooltipElement || !mapContainer || !lastCountryHoverPoint) {
        return;
      }

      const containerWidth = mapContainer.clientWidth;
      const containerHeight = mapContainer.clientHeight;
      const tooltipWidth = countryTooltipElement.offsetWidth;
      const tooltipHeight = countryTooltipElement.offsetHeight;

      let left = lastCountryHoverPoint.x + AIRPORT_TOOLTIP_OFFSET_X;
      let top = lastCountryHoverPoint.y + AIRPORT_TOOLTIP_OFFSET_Y;

      left = Math.max(6, Math.min(left, Math.max(6, containerWidth - tooltipWidth - 6)));
      top = Math.max(6, Math.min(top, Math.max(6, containerHeight - tooltipHeight - 6)));

      countryTooltipElement.style.left = `${Math.round(left)}px`;
      countryTooltipElement.style.top = `${Math.round(top)}px`;
    }

    function showCountryTooltip(countryAdmin) {
      if (!countryTooltipElement || !countryAdmin || countryAdmin !== hoveredCountryAdmin) {
        return;
      }

      shownCountryPopupAdmin = countryAdmin;
      countryTooltipNameElement.textContent = countryAdmin;
      countryTooltipFactorElement.textContent = getCountryPopupMultiplierText({ game: latestGameSnapshot }, countryAdmin);
      countryTooltipElement.classList.remove('airport-tooltip-hidden');
      positionCountryTooltip();
    }

    function refreshCountryTooltip() {
      if (
        !countryTooltipElement ||
        !shownCountryPopupAdmin ||
        countryTooltipElement.classList.contains('airport-tooltip-hidden')
      ) {
        return;
      }

      countryTooltipFactorElement.textContent = getCountryPopupMultiplierText(
        { game: latestGameSnapshot },
        shownCountryPopupAdmin
      );
    }

    const countryPopupScheduler = createCountryHoverPopupScheduler({
      onShow: showCountryTooltip,
      onHide: hideCountryTooltip
    });

    function notifyAirportSelected(airportId) {
      if (typeof airportSelectHandler !== 'function') {
        return;
      }

      airportSelectHandler(airportId);
    }

    function setAirportSelectHandler(handler) {
      airportSelectHandler = typeof handler === 'function' ? handler : null;
    }

    function setCountryHoverChangeHandler(handler) {
      countryHoverChangeHandler = typeof handler === 'function' ? handler : null;
    }

    function setAirportPriceFilter(range) {
      const nextRange = range && typeof range === 'object' ? range : {};
      const nextMin = nextRange.minPrice != null ? Number(nextRange.minPrice) : null;
      const nextMax = nextRange.maxPrice != null ? Number(nextRange.maxPrice) : null;

      airportPriceFilterMin = Number.isFinite(nextMin) ? nextMin : null;
      airportPriceFilterMax = Number.isFinite(nextMax) ? nextMax : null;

      refreshAirportPriceFilter();
      syncAirportBadges(
        latestGameSnapshot && latestGameSnapshot.airports,
        latestGameSnapshot && latestGameSnapshot.players
      );
    }

    function getAirportMarkerId(airport, index) {
      if (airport && airport.id) {
        return String(airport.id);
      }

      if (airport && airport.iata) {
        return String(airport.iata);
      }

      return `airport-${index}`;
    }

    function getAirportLabelModeForZoom(zoom) {
      if (!Number.isFinite(zoom)) {
        return 'none';
      }

      if (zoom >= AIRPORT_LABEL_ZOOM_NAME) {
        return 'name';
      }

      if (zoom >= AIRPORT_LABEL_ZOOM_IATA) {
        return 'iata';
      }

      return 'none';
    }

    function getAirportLabelText(airport, labelMode) {
      if (!airport || labelMode === 'none') {
        return '';
      }

      const code = airport.iata || airport.id || '';
      const name = airport.name || code;

      if (labelMode === 'name') {
        if (code && name && String(name).toUpperCase() !== String(code).toUpperCase()) {
          return `${code} - ${name}`;
        }

        return String(name || code || '');
      }

      return String(code || name || '');
    }

    function applyAirportMarkerLabel(markerElement, airport, zoom) {
      if (!markerElement) {
        return;
      }

      const labelElement = markerElement.querySelector('.airport-marker-label');
      if (!labelElement) {
        return;
      }

      const labelMode = getAirportLabelModeForZoom(zoom);
      markerElement.setAttribute('data-label-mode', labelMode);
      labelElement.textContent = getAirportLabelText(airport, labelMode);
    }

    function refreshAirportMarkerLabels() {
      if (!mapInstance) {
        return;
      }

      const zoom = mapInstance.getZoom();
      airportMarkersById.forEach((marker, markerId) => {
        const markerElement = marker.getElement();
        const airport = airportMarkerMetadataById.get(markerId);
        applyAirportMarkerLabel(markerElement, airport, zoom);
      });
    }

    function refreshAirportMarkerScales() {
      if (!mapInstance) {
        return;
      }

      const zoom = mapInstance.getZoom();
      airportMarkersById.forEach((marker) => {
        applyAirportMarkerScaleToElement(marker.getElement(), zoom);
      });
    }

    function refreshAirportPriceFilter() {
      airportMarkersById.forEach((marker, markerId) => {
        const airport = airportMarkerMetadataById.get(markerId);
        const isVisible = isAirportVisibleAtPrice(airport, {
          minPrice: airportPriceFilterMin,
          maxPrice: airportPriceFilterMax
        });
        const markerElement = marker && typeof marker.getElement === 'function' ? marker.getElement() : null;

        if (markerElement && markerElement.classList) {
          markerElement.classList.toggle('airport-marker-root--filtered', !isVisible);
        }

        if (!isVisible && activeHoveredAirportId === markerId) {
          hideAirportTooltip();
        }
      });
    }

    function clearAirportMarkers() {
      airportMarkersById.forEach((marker) => {
        marker.remove();
      });

      airportMarkersById.clear();
      airportMarkerMetadataById.clear();
      hideAirportTooltip();
    }

    function setNativeRouteCollection(routeSegments) {
      routeCollection.length = 0;
      routeSegments.forEach((routeSegment) => {
        routeCollection.push(routeSegment);
      });
    }

    function getEmptyRouteFeatureCollection() {
      return {
        type: 'FeatureCollection',
        features: []
      };
    }

    function clearRouteLines() {
      setNativeRouteCollection([]);
      stopPendingRemovalDashAnimation();
      if (!mapInstance || !mapLoaded) {
        return;
      }

      const existingSource = mapInstance.getSource(MAPLIBRE_ROUTE_SOURCE_ID);
      if (existingSource && typeof existingSource.setData === 'function') {
        existingSource.setData(getEmptyRouteFeatureCollection());
      }
    }

    function getEmptyAirportBadgeFeatureCollection() {
      return {
        type: 'FeatureCollection',
        features: []
      };
    }

    function ensureAirportBadgeLayer() {
      if (!mapInstance) {
        return false;
      }

      try {
        if (!mapInstance.getSource(MAPLIBRE_AIRPORT_BADGE_SOURCE_ID)) {
          mapInstance.addSource(MAPLIBRE_AIRPORT_BADGE_SOURCE_ID, {
            type: 'geojson',
            data: getEmptyAirportBadgeFeatureCollection()
          });
        }

        if (!mapInstance.getLayer(MAPLIBRE_AIRPORT_BADGE_LAYER_ID)) {
          const badgeLayerDefinition = {
            id: MAPLIBRE_AIRPORT_BADGE_LAYER_ID,
            type: 'circle',
            source: MAPLIBRE_AIRPORT_BADGE_SOURCE_ID,
            paint: {
              'circle-radius': getMapLibreAirportBadgeRadiusExpression(),
              'circle-color': ['coalesce', ['get', 'badgeFillColor'], toRgbaColor(AIRPORT_BADGE_UNOWNED_FILL_COLOR, AIRPORT_BADGE_FILL_OPACITY)],
              'circle-stroke-color': AIRPORT_BADGE_STROKE_COLOR,
              'circle-stroke-width': AIRPORT_BADGE_STROKE_WIDTH_PX,
              'circle-opacity': 1
            }
          };

          if (mapInstance.getLayer(MAPLIBRE_AIRPORT_BADGE_BEFORE_LAYER_ID)) {
            mapInstance.addLayer(badgeLayerDefinition, MAPLIBRE_AIRPORT_BADGE_BEFORE_LAYER_ID);
          } else {
            mapInstance.addLayer(badgeLayerDefinition);
          }
        }
      } catch (_error) {
        return false;
      }

      return true;
    }

    function ensureCountryProfitabilityLayer() {
      if (!mapInstance || !mapLoaded) {
        return false;
      }

      try {
        if (!mapInstance.getSource(MAPLIBRE_COUNTRY_SOURCE_ID)) {
          mapInstance.addSource(MAPLIBRE_COUNTRY_SOURCE_ID, {
            type: 'geojson',
            data: '/assets/world-countries.geojson'
          });
        }

        if (!mapInstance.getLayer(MAPLIBRE_COUNTRY_LAYER_ID)) {
          const countryFillLayerDefinition = {
            id: MAPLIBRE_COUNTRY_LAYER_ID,
            type: 'fill',
            source: MAPLIBRE_COUNTRY_SOURCE_ID,
            paint: getCountryProfitabilityPaint(MAPLIBRE_COUNTRY_PROFIT_NEUTRAL_FACTOR)
          };

          const beforeId = mapInstance.getLayer('water')
            ? 'water'
            : (mapInstance.getLayer(MAPLIBRE_AIRPORT_BADGE_LAYER_ID)
                ? MAPLIBRE_AIRPORT_BADGE_LAYER_ID
                : (mapInstance.getLayer(MAPLIBRE_AIRPORT_BADGE_BEFORE_LAYER_ID)
                    ? MAPLIBRE_AIRPORT_BADGE_BEFORE_LAYER_ID
                    : null));

          if (beforeId) {
            mapInstance.addLayer(countryFillLayerDefinition, beforeId);
          } else {
            mapInstance.addLayer(countryFillLayerDefinition);
          }
        }

        if (!mapInstance.getLayer(MAPLIBRE_COUNTRY_HOVER_LAYER_ID)) {
          const countryHoverLineLayerDefinition = {
            id: MAPLIBRE_COUNTRY_HOVER_LAYER_ID,
            type: 'line',
            source: MAPLIBRE_COUNTRY_SOURCE_ID,
            filter: ['has', 'ADMIN'],
            layout: {
              'line-cap': 'round',
              'line-join': 'round'
            },
            paint: {
              'line-color': MAPLIBRE_COUNTRY_HOVER_LINE_COLOR,
              'line-width': MAPLIBRE_COUNTRY_HOVER_LINE_WIDTH,
              'line-opacity': ['case', ['==', ['get', 'ADMIN'], ['literal', '']], MAPLIBRE_COUNTRY_HOVER_LINE_OPACITY, 0],
              'line-opacity-transition': {
                duration: MAPLIBRE_COUNTRY_HOVER_FADE_IN_DURATION_MS,
                delay: MAPLIBRE_COUNTRY_HOVER_FADE_DELAY_MS
              }
            }
          };

          if (mapInstance.getLayer(MAPLIBRE_AIRPORT_BADGE_BEFORE_LAYER_ID)) {
            mapInstance.addLayer(countryHoverLineLayerDefinition, MAPLIBRE_AIRPORT_BADGE_BEFORE_LAYER_ID);
          } else {
            mapInstance.addLayer(countryHoverLineLayerDefinition);
          }
        }

        if (!hasBoundCountryHoverHandlers) {
          mapInstance.on('mousemove', MAPLIBRE_COUNTRY_LAYER_ID, (event) => {
            if (isAirportHoverSuppressed || isPointerOverAirportMarkerOrBadge(event)) {
              setHoveredCountry(null);
              countryPopupScheduler.clear();
              return;
            }

            const feature = event && Array.isArray(event.features) ? event.features[0] : null;
            const admin = feature && feature.properties ? feature.properties.ADMIN : null;
            lastCountryHoverPoint = event && event.point
              ? { x: event.point.x, y: event.point.y }
              : lastCountryHoverPoint;
            setHoveredCountry(admin);
            countryPopupScheduler.schedule(admin);
          });
          mapInstance.on('mouseleave', MAPLIBRE_COUNTRY_LAYER_ID, () => {
            setHoveredCountry(null);
            countryPopupScheduler.clear();
          });
          hasBoundCountryHoverHandlers = true;
        }
      } catch (_error) {
        return false;
      }

      return true;
    }

    function isPointerOverAirportMarkerOrBadge(event) {
      if (!event) {
        return false;
      }

      const originalEvent = event.originalEvent;
      if (
        originalEvent &&
        originalEvent.target &&
        typeof originalEvent.target.closest === 'function' &&
        originalEvent.target.closest('.airport-marker-root')
      ) {
        return true;
      }

      if (mapInstance && mapInstance.getLayer(MAPLIBRE_AIRPORT_BADGE_LAYER_ID) && event.point) {
        try {
          const badgeFeatures = mapInstance.queryRenderedFeatures(event.point, {
            layers: [MAPLIBRE_AIRPORT_BADGE_LAYER_ID]
          });
          return Array.isArray(badgeFeatures) && badgeFeatures.length > 0;
        } catch (_error) {
          return false;
        }
      }

      return false;
    }

    function setHoveredCountry(countryAdmin) {
      const normalizedAdmin = countryAdmin != null ? String(countryAdmin).trim() : '';

      if (isAirportHoverSuppressed && normalizedAdmin !== '') {
        return;
      }

      if (normalizedAdmin === hoveredCountryAdmin) {
        return;
      }

      hoveredCountryAdmin = normalizedAdmin;

      if (typeof countryHoverChangeHandler === 'function') {
        countryHoverChangeHandler(normalizedAdmin);
      }

      if (!mapInstance || !mapInstance.getLayer(MAPLIBRE_COUNTRY_HOVER_LAYER_ID)) {
        return;
      }

      try {
        const isFadingIn = normalizedAdmin !== '';

        mapInstance.setPaintProperty(
          MAPLIBRE_COUNTRY_HOVER_LAYER_ID,
          'line-opacity-transition',
          {
            duration: isFadingIn
              ? MAPLIBRE_COUNTRY_HOVER_FADE_IN_DURATION_MS
              : MAPLIBRE_COUNTRY_HOVER_FADE_OUT_DURATION_MS,
            delay: MAPLIBRE_COUNTRY_HOVER_FADE_DELAY_MS
          }
        );

        mapInstance.setPaintProperty(
          MAPLIBRE_COUNTRY_HOVER_LAYER_ID,
          'line-opacity',
          [
            'case',
            ['==', ['get', 'ADMIN'], ['literal', normalizedAdmin]],
            MAPLIBRE_COUNTRY_HOVER_LINE_OPACITY,
            0
          ]
        );
      } catch (_error) {
        // Ignore hover styling failures; the base map remains usable.
      }
    }

    function syncCountryProfitability(state) {
      if (!mapInstance || !mapLoaded) {
        return false;
      }

      if (!mapInstance.getLayer(MAPLIBRE_COUNTRY_LAYER_ID)) {
        return false;
      }

      try {
        const paint = buildCountryProfitabilityPaint(state);
        const fillColor = paint['fill-color'];
        const fillOpacity = paint['fill-opacity'];

        if (JSON.stringify(fillColor) !== lastCountryProfitabilityFillColor) {
          mapInstance.setPaintProperty(MAPLIBRE_COUNTRY_LAYER_ID, 'fill-color', fillColor);
          lastCountryProfitabilityFillColor = JSON.stringify(fillColor);
        }

        if (JSON.stringify(fillOpacity) !== lastCountryProfitabilityFillOpacity) {
          mapInstance.setPaintProperty(MAPLIBRE_COUNTRY_LAYER_ID, 'fill-opacity', fillOpacity);
          lastCountryProfitabilityFillOpacity = JSON.stringify(fillOpacity);
        }

        return true;
      } catch (_error) {
        return false;
      }
    }

    function syncAirportBadges(airports, players) {
      if (!mapInstance) {
        return;
      }

      if (!ensureAirportBadgeLayer()) {
        return;
      }

      const sourceAirports = Array.isArray(airports) ? airports : [];
      const playersById = createPlayersById(players);
      const badgeFeatureCollection = {
        type: 'FeatureCollection',
        features: sourceAirports.reduce((features, airport, index) => {
          const lat = Number(airport && airport.lat);
          const lng = Number(airport && airport.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return features;
          }

          if (!isAirportVisibleAtPrice(airport, { minPrice: airportPriceFilterMin, maxPrice: airportPriceFilterMax })) {
            return features;
          }

          const markerId = getAirportMarkerId(airport, index);
          const badgeColorHex = resolveAirportBadgeColorHex(airport, playersById) || AIRPORT_BADGE_UNOWNED_FILL_COLOR;
          features.push({
            type: 'Feature',
            properties: {
              markerId,
              badgeFillColor: toRgbaColor(badgeColorHex, AIRPORT_BADGE_FILL_OPACITY)
            },
            geometry: {
              type: 'Point',
              coordinates: [lng, lat]
            }
          });

          return features;
        }, [])
      };

      const source = mapInstance.getSource(MAPLIBRE_AIRPORT_BADGE_SOURCE_ID);
      if (source && typeof source.setData === 'function') {
        source.setData(badgeFeatureCollection);
      }
    }

    function clearAirportBadges() {
      if (!mapInstance) {
        return;
      }

      const source = mapInstance.getSource(MAPLIBRE_AIRPORT_BADGE_SOURCE_ID);
      if (source && typeof source.setData === 'function') {
        source.setData(getEmptyAirportBadgeFeatureCollection());
      }
    }

    function getEmptyFlightFeatureCollection() {
      return {
        type: 'FeatureCollection',
        features: []
      };
    }

    function ensureFlightLayer() {
      if (!mapInstance || !mapLoaded) {
        return false;
      }

      const existingSource = mapInstance.getSource(MAPLIBRE_FLIGHT_SOURCE_ID);
      if (!existingSource) {
        mapInstance.addSource(MAPLIBRE_FLIGHT_SOURCE_ID, {
          type: 'geojson',
          data: getEmptyFlightFeatureCollection()
        });
      }

      if (!mapInstance.getLayer(MAPLIBRE_FLIGHT_LAYER_ID)) {
        mapInstance.addLayer({
          id: MAPLIBRE_FLIGHT_LAYER_ID,
          type: 'circle',
          source: MAPLIBRE_FLIGHT_SOURCE_ID,
          paint: {
            'circle-radius': getMapLibreFlightDotRadiusExpression(),
            'circle-color': ['coalesce', ['get', 'colorHex'], FLIGHT_DOT_COLOR],
            'circle-stroke-color': FLIGHT_DOT_STROKE_COLOR,
            'circle-stroke-width': FLIGHT_DOT_STROKE_WIDTH_PX,
            'circle-opacity': 0.95
          }
        });
      }

      if (mapInstance.getLayer(MAPLIBRE_ROUTE_LAYER_ID) && mapInstance.getLayer(MAPLIBRE_FLIGHT_LAYER_ID)) {
        mapInstance.moveLayer(MAPLIBRE_FLIGHT_LAYER_ID);
      }

      return true;
    }

    function syncNativeFlightDotsNow(realNowMs = Date.now()) {
      if (!mapInstance || !mapLoaded) {
        return 0;
      }

      if (!ensureFlightLayer()) {
        return 0;
      }

      const drawableFlights = getDrawableFlights(latestGameSnapshot, routeCollection, realNowMs);
      const flightFeatureCollection = {
        type: 'FeatureCollection',
        features: drawableFlights.map((flight) => ({
          type: 'Feature',
          properties: {
            aircraftInstanceId: flight.aircraftInstanceId,
            colorHex: flight.colorHex
          },
          geometry: {
            type: 'Point',
            coordinates: [flight.lng, flight.lat]
          }
        }))
      };

      const source = mapInstance.getSource(MAPLIBRE_FLIGHT_SOURCE_ID);
      if (source && typeof source.setData === 'function') {
        source.setData(flightFeatureCollection);
      }

      return drawableFlights.length;
    }

    function stopNativeFlightAnimation() {
      if (flightAnimationFrameId != null) {
        globalScope.cancelAnimationFrame(flightAnimationFrameId);
        flightAnimationFrameId = null;
      }

      isFlightAnimationRunning = false;
    }

    function runNativeFlightAnimationFrame() {
      if (!isFlightAnimationRunning) {
        return;
      }

      if (!latestGameSnapshot || !isActiveGameSnapshot(latestGameSnapshot) || !mapInstance || !mapLoaded) {
        clearNativeFlightDots();
        stopNativeFlightAnimation();
        return;
      }

      const drawableCount = syncNativeFlightDotsNow(Date.now());
      if (drawableCount < 1) {
        stopNativeFlightAnimation();
        return;
      }

      flightAnimationFrameId = globalScope.requestAnimationFrame(runNativeFlightAnimationFrame);
    }

    function ensureNativeFlightAnimationState() {
      if (!latestGameSnapshot || !isActiveGameSnapshot(latestGameSnapshot) || !mapInstance || !mapLoaded) {
        clearNativeFlightDots();
        stopNativeFlightAnimation();
        return;
      }

      const drawableCount = syncNativeFlightDotsNow(Date.now());
      if (drawableCount < 1) {
        stopNativeFlightAnimation();
        return;
      }

      if (isFlightAnimationRunning) {
        return;
      }

      isFlightAnimationRunning = true;
      flightAnimationFrameId = globalScope.requestAnimationFrame(runNativeFlightAnimationFrame);
    }

    function clearNativeFlightDots() {
      stopNativeFlightAnimation();

      if (!mapInstance || !mapLoaded) {
        return;
      }

      const source = mapInstance.getSource(MAPLIBRE_FLIGHT_SOURCE_ID);
      if (source && typeof source.setData === 'function') {
        source.setData(getEmptyFlightFeatureCollection());
      }
    }

    function syncRouteLines(routes, airports) {
      const routeSegments = getRenderableRouteSegments(routes, airports);
      setNativeRouteCollection(routeSegments);

      if (!mapInstance || !mapLoaded) {
        return;
      }

      const routeFeatureCollection = {
        type: 'FeatureCollection',
        features: routeSegments.flatMap((routeSegment) => {
          const routeGeometrySegments = Array.isArray(routeSegment.segments) ? routeSegment.segments : [];
          return routeGeometrySegments.map((segmentCoordinates, segmentIndex) => ({
            type: 'Feature',
            properties: {
              routeId: routeSegment.routeId,
              segmentIndex,
              pendingRemoval: Boolean(routeSegment.pendingRemoval === true)
            },
            geometry: {
              type: 'LineString',
              coordinates: segmentCoordinates
            }
          }));
        })
      };

      const existingSource = mapInstance.getSource(MAPLIBRE_ROUTE_SOURCE_ID);
      if (existingSource && typeof existingSource.setData === 'function') {
        existingSource.setData(routeFeatureCollection);
      } else {
        mapInstance.addSource(MAPLIBRE_ROUTE_SOURCE_ID, {
          type: 'geojson',
          data: routeFeatureCollection
        });
      }

      if (!mapInstance.getLayer(MAPLIBRE_ROUTE_LAYER_ID)) {
        mapInstance.addLayer({
          id: MAPLIBRE_ROUTE_LAYER_ID,
          type: 'line',
          source: MAPLIBRE_ROUTE_SOURCE_ID,
          layout: {
            'line-cap': 'round',
            'line-join': 'round'
          },
          paint: {
            'line-color': ROUTE_LINE_COLOR,
            'line-width': ROUTE_LINE_WIDTH,
            'line-opacity': 1,
            'line-dasharray': [
              'case',
              ['==', ['get', 'pendingRemoval'], true],
              ['literal', [2, 2]],
              ['literal', [1, 0]]
            ]
          }
        });
      }

      if (hasPendingRemovalRoutes()) {
        startPendingRemovalDashAnimation();
      } else {
        stopPendingRemovalDashAnimation();
      }
    }

    function hasPendingRemovalRoutes() {
      return routeCollection.some((routeSegment) => routeSegment && routeSegment.pendingRemoval === true);
    }

    function updatePendingRemovalDashPattern() {
      if (!mapInstance || !mapLoaded) {
        return;
      }

      if (!mapInstance.getLayer(MAPLIBRE_ROUTE_LAYER_ID)) {
        return;
      }

      pendingRemovalDashSequenceIndex = (pendingRemovalDashSequenceIndex + 1) % PENDING_REMOVAL_DASH_SEQUENCE.length;
      const currentDashPattern = PENDING_REMOVAL_DASH_SEQUENCE[pendingRemovalDashSequenceIndex];

      mapInstance.setPaintProperty(MAPLIBRE_ROUTE_LAYER_ID, 'line-dasharray', [
        'case',
        ['==', ['get', 'pendingRemoval'], true],
        ['literal', currentDashPattern],
        ['literal', [1, 0]]
      ]);
    }

    function startPendingRemovalDashAnimation() {
      if (pendingRemovalDashTimerId !== null) {
        return;
      }

      if (!hasPendingRemovalRoutes()) {
        return;
      }

      pendingRemovalDashTimerId = globalScope.setInterval(() => {
        if (!hasPendingRemovalRoutes()) {
          stopPendingRemovalDashAnimation();
          return;
        }
        updatePendingRemovalDashPattern();
      }, PENDING_REMOVAL_DASH_UPDATE_INTERVAL_MS);
    }

    function stopPendingRemovalDashAnimation() {
      if (pendingRemovalDashTimerId !== null) {
        globalScope.clearInterval(pendingRemovalDashTimerId);
        pendingRemovalDashTimerId = null;
      }

      pendingRemovalDashSequenceIndex = 0;

      if (!mapInstance || !mapLoaded) {
        return;
      }

      if (!mapInstance.getLayer(MAPLIBRE_ROUTE_LAYER_ID)) {
        return;
      }

      mapInstance.setPaintProperty(MAPLIBRE_ROUTE_LAYER_ID, 'line-dasharray', [
        'case',
        ['==', ['get', 'pendingRemoval'], true],
        ['literal', [2, 2]],
        ['literal', [1, 0]]
      ]);
    }

    function setNativeDraggingClass(isDragging, reason) {
      if (!mapContainer) {
        return;
      }

      mapContainer.classList.toggle('map-is-dragging', Boolean(isDragging));

      if (isDragging || !reason) {
        mapContainer.removeAttribute('data-drag-termination');
        return;
      }

      mapContainer.setAttribute('data-drag-termination', String(reason));
    }

    function clearNativeDraggingState(reason) {
      setNativeDraggingClass(false, reason);
    }

    function createNativeAirportMarkerElement(markerId) {
      const markerElement = documentRef.createElement('div');
      markerElement.className = 'airport-marker-root';
      markerElement.setAttribute('aria-label', `Airport ${markerId}`);

      const contentElement = documentRef.createElement('div');
      contentElement.className = 'airport-marker-content';

      const pulseWrapperElement = documentRef.createElement('div');
      pulseWrapperElement.className = 'airport-marker-pulse-wrapper';

      const ownershipBadgeElement = documentRef.createElement('span');
      ownershipBadgeElement.className = 'airport-marker-ownership-badge';
      ownershipBadgeElement.setAttribute('aria-hidden', 'true');

      const visualElement = documentRef.createElement('div');
      visualElement.className = 'airport-marker airport-marker-visual airport-marker--control-tower-svg';

      const svgNamespace = 'http://www.w3.org/2000/svg';
      const svgElement = documentRef.createElementNS(svgNamespace, 'svg');
      svgElement.setAttribute('class', 'airport-marker-svg');
      svgElement.setAttribute('viewBox', '0 0 24 24');
      svgElement.setAttribute('aria-hidden', 'true');
      svgElement.setAttribute('focusable', 'false');

      const rectSpecs = [
        { className: 'airport-marker-base', x: '5.5', y: '18', width: '13', height: '3', rx: '1.6' },
        { className: 'airport-marker-shaft', x: '10.2', y: '9.4', width: '3.6', height: '8.6', rx: '1.6' },
        { className: 'airport-marker-room', x: '6.2', y: '4.2', width: '11.6', height: '6.2', rx: '2.1' },
        { className: 'airport-marker-window', x: '8', y: '6.2', width: '8', height: '2', rx: '0.8' },
        { className: 'airport-marker-antenna', x: '11.55', y: '2', width: '1', height: '2.4', rx: '0.45' }
      ];

      rectSpecs.forEach((spec) => {
        const rect = documentRef.createElementNS(svgNamespace, 'rect');
        rect.setAttribute('class', spec.className);
        rect.setAttribute('x', spec.x);
        rect.setAttribute('y', spec.y);
        rect.setAttribute('width', spec.width);
        rect.setAttribute('height', spec.height);
        rect.setAttribute('rx', spec.rx);
        svgElement.appendChild(rect);
      });

      visualElement.appendChild(svgElement);

      const labelElement = documentRef.createElement('div');
      labelElement.className = 'airport-marker-label';
      labelElement.setAttribute('aria-hidden', 'true');

      const filteredDotElement = documentRef.createElement('span');
      filteredDotElement.className = 'airport-marker-filtered-dot';
      filteredDotElement.setAttribute('aria-hidden', 'true');

      pulseWrapperElement.appendChild(ownershipBadgeElement);
      pulseWrapperElement.appendChild(visualElement);
      contentElement.appendChild(pulseWrapperElement);
      contentElement.appendChild(labelElement);
      contentElement.appendChild(filteredDotElement);
      markerElement.appendChild(contentElement);
      return markerElement;
    }

    function syncAirportMarkers(airports, players, routes) {
      if (!mapInstance) {
        return;
      }

      const sourceAirports = Array.isArray(airports) ? airports : [];
      const playersById = createPlayersById(players);
      const sourceRoutes = Array.isArray(routes) ? routes : [];
      const activeMarkerIds = new Set();

      sourceAirports.forEach((airport, index) => {
        const lat = Number(airport && airport.lat);
        const lng = Number(airport && airport.lng);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return;
        }

        const markerId = getAirportMarkerId(airport, index);
        activeMarkerIds.add(markerId);
        airportMarkerMetadataById.set(markerId, airport || null);

        const existingMarker = airportMarkersById.get(markerId);
        if (existingMarker) {
          existingMarker.setLngLat([lng, lat]);
          const existingElement = existingMarker.getElement();
          applyAirportMarkerOwnershipStyling(existingElement, airport, playersById);
          applyAirportMarkerReconfigurationPulse(existingElement, airport.id, sourceRoutes);
          applyAirportMarkerLabel(existingElement, airport, mapInstance.getZoom());
          applyAirportMarkerScaleToElement(existingElement, mapInstance.getZoom());
          return;
        }

        const markerElement = createNativeAirportMarkerElement(markerId);
        const marker = new globalScope.maplibregl.Marker({
          element: markerElement,
          anchor: 'center'
        })
          .setLngLat([lng, lat])
          .addTo(mapInstance);

        markerElement.addEventListener('mouseenter', () => {
          isAirportHoverSuppressed = true;
          setHoveredCountry(null);
          countryPopupScheduler.setBlocked(true);
          showAirportTooltip(markerId);
        });

        markerElement.addEventListener('mouseleave', () => {
          isAirportHoverSuppressed = false;
          if (activeHoveredAirportId === markerId) {
            hideAirportTooltip();
          }
          countryPopupScheduler.setBlocked(false);
        });

        markerElement.addEventListener('click', () => {
          notifyAirportSelected(markerId);
        });

        airportMarkersById.set(markerId, marker);
        applyAirportMarkerOwnershipStyling(markerElement, airport, playersById);
        applyAirportMarkerLabel(markerElement, airport, mapInstance.getZoom());
        applyAirportMarkerScaleToElement(markerElement, mapInstance.getZoom());
      });

      Array.from(airportMarkersById.entries()).forEach(([markerId, marker]) => {
        if (activeMarkerIds.has(markerId)) {
          return;
        }

        marker.remove();
        airportMarkersById.delete(markerId);
        airportMarkerMetadataById.delete(markerId);
        if (activeHoveredAirportId === markerId) {
          hideAirportTooltip();
        }
      });

      refreshAirportMarkerLabels();
      refreshAirportPriceFilter();
      refreshAirportTooltip();
    }

    function canMeasureViewport() {
      return !!mapContainer && mapContainer.clientWidth > 0 && mapContainer.clientHeight > 0;
    }

    function resizeMapIfNeeded({ force = false } = {}) {
      if (!mapInstance || !canMeasureViewport()) {
        return false;
      }

      const currentWidth = mapContainer.clientWidth;
      const currentHeight = mapContainer.clientHeight;
      const sizeChanged =
        lastKnownContainerWidth !== currentWidth ||
        lastKnownContainerHeight !== currentHeight;

      if (!force && !sizeChanged) {
        return false;
      }

      mapInstance.resize();
      lastKnownContainerWidth = currentWidth;
      lastKnownContainerHeight = currentHeight;
      return true;
    }

    function applyInitialCameraSetupIfReady() {
      if (!mapInstance || !mapLoaded || hasAppliedInitialCameraSetup || !canMeasureViewport()) {
        return;
      }

      resizeMapIfNeeded({ force: true });
      mapInstance.fitBounds(initialCameraBounds, {
        duration: 0,
        linear: true,
        padding: 0
      });
      hasAppliedInitialCameraSetup = true;
    }

    function ensureMapInitialized() {
      if (mapInstance || !mapContainer || typeof globalScope.maplibregl === 'undefined') {
        return mapInstance;
      }

      mapInstance = new globalScope.maplibregl.Map({
        container: mapContainer,
        style: getBasemapStyleUrl(),
        center: INITIAL_CENTER,
        zoom: INITIAL_ZOOM,
        maxZoom: BASEMAP_MAX_ZOOM,
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: false,
        attributionControl: true
      });

      const canvasContainer = typeof mapInstance.getCanvasContainer === 'function'
        ? mapInstance.getCanvasContainer()
        : null;

      const handlePointerCancel = () => {
        clearNativeDraggingState('pointercancel');
      };

      const handleTouchCancel = () => {
        clearNativeDraggingState('touchcancel');
      };

      const handleWindowBlur = () => {
        clearNativeDraggingState('blur');
      };

      applyMobileRotationLockToMapLibre(mapInstance);

      mapInstance.on('dragstart', () => {
        setNativeDraggingClass(true);
      });

      mapInstance.on('dragend', () => {
        clearNativeDraggingState('dragend');
      });

      mapInstance.on('remove', () => {
        clearNativeDraggingState('remove');
        globalScope.removeEventListener('blur', handleWindowBlur);
        if (canvasContainer) {
          canvasContainer.removeEventListener('pointercancel', handlePointerCancel);
          canvasContainer.removeEventListener('touchcancel', handleTouchCancel);
        }
      });

      if (canvasContainer) {
        canvasContainer.addEventListener('pointercancel', handlePointerCancel);
        canvasContainer.addEventListener('touchcancel', handleTouchCancel);
      }

      globalScope.addEventListener('blur', handleWindowBlur);

      mapInstance.once('load', () => {
        mapLoaded = true;
        ensureAirportBadgeLayer();
        ensureCountryProfitabilityLayer();
        syncAirportBadges(latestGameSnapshot && latestGameSnapshot.airports, latestGameSnapshot && latestGameSnapshot.players);
        globalScope.requestAnimationFrame(() => {
          if (!mapInstance) {
            return;
          }

          resizeMapIfNeeded({ force: true });
          applyInitialCameraSetupIfReady();
        });
      });

      mapInstance.on('move', () => {
        refreshAirportMarkerLabels();
        refreshAirportTooltip();
      });

      mapInstance.on('zoom', () => {
        refreshAirportMarkerLabels();
        refreshAirportMarkerScales();
        refreshAirportTooltip();
      });

      if (!hasBoundResizeListener) {
        globalScope.addEventListener('resize', () => {
          if (!mapInstance) {
            return;
          }

          resizeMapIfNeeded({ force: true });
        });
        hasBoundResizeListener = true;
      }

      return mapInstance;
    }

    function render(state) {
      if (!state || !state.ui || state.ui.screen !== 'game') {
        if (mapContainer) {
          mapContainer.classList.remove('map-visible');
        }
        clearNativeDraggingState('screen-hidden');
        countryPopupScheduler.clear();
        if (mapInstance) {
          clearAirportMarkers();
          clearAirportBadges();
          clearRouteLines();
          clearNativeFlightDots();
        }
        return;
      }

      const map = ensureMapInitialized();
      if (!map) {
        return;
      }

      mapContainer.classList.add('map-visible');
      latestGameSnapshot = state.game || null;
  resizeMapIfNeeded();
      applyInitialCameraSetupIfReady();
      syncAirportBadges(state.game && state.game.airports, state.game && state.game.players);
      syncAirportMarkers(state.game && state.game.airports, state.game && state.game.players, state.game && state.game.routes);
      syncRouteLines(state.game && state.game.routes, state.game && state.game.airports);
      syncCountryProfitability(state);
      ensureNativeFlightAnimationState();
      refreshAirportTooltip();
      refreshCountryTooltip();
    }

    return {
      render,
      setAirportSelectHandler,
      setCountryHoverChangeHandler,
      setAirportPriceFilter,
      markerCollection,
      routeCollection
    };
  }

  function createLeafletMapRenderer(documentRef) {
    const mapContainer = documentRef.getElementById('mapContainer');
    let mapInstance = null;
    let viewportMinZoom = null;
    let hasFittedWorld = false;
    let lastKnownContainerWidth = null;
    let lastKnownContainerHeight = null;
    const markerCollection = [];
    const routeCollection = [];
    const routeGeometryCollection = [];
    const airportMarkersById = new Map();
    const airportMarkerMetadataById = new Map();
    const flightMarkersById = new Map();
    let airportSelectHandler = null;
    let activeHoveredAirportId = null;
    let latestGameSnapshot = null;
    let flightAnimationFrameId = null;
    let isFlightAnimationRunning = false;
    const tooltipElement = mapContainer ? documentRef.createElement('div') : null;
    const tooltipCodeElement = tooltipElement ? documentRef.createElement('div') : null;
    const tooltipCodeTextElement = tooltipCodeElement ? documentRef.createElement('span') : null;
    const tooltipTierBadgeElement = tooltipCodeElement ? documentRef.createElement('span') : null;
    const tooltipPriceElement = tooltipElement ? documentRef.createElement('div') : null;
    const tooltipOwnerElement = tooltipElement ? documentRef.createElement('div') : null;

    if (tooltipElement) {
      tooltipElement.className = 'airport-tooltip airport-tooltip-hidden';
      tooltipCodeElement.className = 'airport-tooltip-code';
      tooltipTierBadgeElement.className = 'airport-tier-badge airport-tier-badge-hidden';
      tooltipCodeElement.appendChild(tooltipCodeTextElement);
      tooltipCodeElement.appendChild(tooltipTierBadgeElement);
      tooltipPriceElement.className = 'airport-tooltip-price';
      tooltipOwnerElement.className = 'airport-tooltip-owner';
      tooltipElement.appendChild(tooltipCodeElement);
      tooltipElement.appendChild(tooltipPriceElement);
      tooltipElement.appendChild(tooltipOwnerElement);
      mapContainer.appendChild(tooltipElement);
    }

    function formatCurrencyValue(value) {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        return CURRENCY_FORMATTER.format(0);
      }

      return CURRENCY_FORMATTER.format(numericValue);
    }

    function getAirportTooltipData(airportId) {
      const game = latestGameSnapshot || {};
      const airports = Array.isArray(game.airports) ? game.airports : [];
      const playersById = createPlayersById(game.players);
      const airport = airports.find((candidate) => {
        if (!candidate) {
          return false;
        }

        const candidateId = candidate.id || candidate.iata;
        return String(candidateId) === String(airportId);
      });

      if (!airport) {
        return null;
      }

      const hasListingPrice =
        airport.saleListing && typeof airport.saleListing === 'object' && Number.isFinite(airport.saleListing.askingPrice);
      const relevantPrice = hasListingPrice ? airport.saleListing.askingPrice : airport.basePrice;
      const ownerPlayerId = airport.ownerPlayerId;
      const ownerText =
        ownerPlayerId == null
          ? 'Unowned'
          : ((playersById.get(String(ownerPlayerId)) || {}).username || 'Unknown');

      return {
        code: airport.iata || airport.id || String(airportId),
        price: formatCurrencyValue(relevantPrice),
        ownerText,
        economicClass: airport.economicClass ?? null
      };
    }

    function hideAirportTooltip() {
      activeHoveredAirportId = null;
      if (!tooltipElement) {
        return;
      }

      tooltipElement.classList.add('airport-tooltip-hidden');
    }

    function positionAirportTooltip(map, marker) {
      if (!tooltipElement || !map || !marker || !mapContainer) {
        return;
      }

      const markerPoint = map.latLngToContainerPoint(marker.getLatLng());
      const containerWidth = mapContainer.clientWidth;
      const containerHeight = mapContainer.clientHeight;
      const tooltipWidth = tooltipElement.offsetWidth;
      const tooltipHeight = tooltipElement.offsetHeight;

      let left = markerPoint.x + AIRPORT_TOOLTIP_OFFSET_X;
      let top = markerPoint.y + AIRPORT_TOOLTIP_OFFSET_Y;

      left = Math.max(6, Math.min(left, Math.max(6, containerWidth - tooltipWidth - 6)));
      top = Math.max(6, Math.min(top, Math.max(6, containerHeight - tooltipHeight - 6)));

      tooltipElement.style.left = `${Math.round(left)}px`;
      tooltipElement.style.top = `${Math.round(top)}px`;
    }

    function refreshAirportTooltip(map) {
      if (!tooltipElement || !activeHoveredAirportId) {
        return;
      }

      const marker = airportMarkersById.get(activeHoveredAirportId);
      const tooltipData = getAirportTooltipData(activeHoveredAirportId);
      if (!marker || !tooltipData) {
        hideAirportTooltip();
        return;
      }

      tooltipCodeTextElement.textContent = tooltipData.code;
      if (globalScope.airportTiers && typeof globalScope.airportTiers.syncAirportTierBadge === 'function') {
        globalScope.airportTiers.syncAirportTierBadge(tooltipTierBadgeElement, tooltipData.economicClass);
      }
      tooltipPriceElement.textContent = tooltipData.price;
      tooltipOwnerElement.textContent = tooltipData.ownerText;
      tooltipElement.classList.remove('airport-tooltip-hidden');
      positionAirportTooltip(map, marker);
    }

    function showAirportTooltip(map, airportId) {
      activeHoveredAirportId = airportId;
      refreshAirportTooltip(map);
    }

    function notifyAirportSelected(airportId) {
      if (typeof airportSelectHandler !== 'function') {
        return;
      }

      airportSelectHandler(airportId);
    }

    function setAirportSelectHandler(handler) {
      airportSelectHandler = typeof handler === 'function' ? handler : null;
    }

    function getAirportMarkerId(airport, index) {
      if (airport && airport.id) {
        return String(airport.id);
      }

      if (airport && airport.iata) {
        return String(airport.iata);
      }

      return `airport-${index}`;
    }

    function getAirportLabelModeForZoom(zoom) {
      if (!Number.isFinite(zoom)) {
        return 'none';
      }

      if (zoom >= AIRPORT_LABEL_ZOOM_NAME) {
        return 'name';
      }

      if (zoom >= AIRPORT_LABEL_ZOOM_IATA) {
        return 'iata';
      }

      return 'none';
    }

    function getAirportLabelText(airport, labelMode) {
      if (!airport || labelMode === 'none') {
        return '';
      }

      const code = airport.iata || airport.id || '';
      const name = airport.name || code;

      if (labelMode === 'name') {
        if (code && name && String(name).toUpperCase() !== String(code).toUpperCase()) {
          return `${code} - ${name}`;
        }

        return String(name || code || '');
      }

      return String(code || name || '');
    }

    function applyAirportMarkerLabel(marker, airport, zoom) {
      if (!marker) {
        return;
      }

      const markerElement = marker.getElement();
      if (!markerElement) {
        return;
      }

      const labelElement = markerElement.querySelector('.airport-marker-label');
      if (!labelElement) {
        return;
      }

      const labelMode = getAirportLabelModeForZoom(zoom);
      markerElement.setAttribute('data-label-mode', labelMode);
      labelElement.textContent = getAirportLabelText(airport, labelMode);
    }

    function refreshAirportMarkerLabels(map) {
      if (!map) {
        return;
      }

      const zoom = map.getZoom();
      airportMarkersById.forEach((marker, markerId) => {
        const airport = airportMarkerMetadataById.get(markerId);
        applyAirportMarkerLabel(marker, airport, zoom);
      });
    }

    function clearAirportMarkers(map) {
      airportMarkersById.forEach((marker) => {
        map.removeLayer(marker);
      });

      airportMarkersById.clear();
      airportMarkerMetadataById.clear();
      hideAirportTooltip();
    }

    function clearRouteLines(map) {
      routeCollection.forEach((routeLineLayer) => {
        if (routeLineLayer) {
          map.removeLayer(routeLineLayer);
        }
      });
      routeCollection.length = 0;
    }

    function stopLeafletFlightAnimation() {
      if (flightAnimationFrameId != null) {
        globalScope.cancelAnimationFrame(flightAnimationFrameId);
        flightAnimationFrameId = null;
      }

      isFlightAnimationRunning = false;
    }

    function clearLeafletFlightMarkers(map) {
      stopLeafletFlightAnimation();
      if (!map) {
        return;
      }

      flightMarkersById.forEach((marker) => {
        map.removeLayer(marker);
      });
      flightMarkersById.clear();
    }

    function syncLeafletFlightMarkers(map, realNowMs = Date.now()) {
      if (!map) {
        return 0;
      }

      const drawableFlights = getDrawableFlights(latestGameSnapshot, routeGeometryCollection, realNowMs);
      const radiusPx = getFlightDotRadiusPxForZoom(
        map.getZoom(),
        Number.isFinite(viewportMinZoom) ? viewportMinZoom : FLIGHT_DOT_RADIUS_MIN_ZOOM,
        FLIGHT_DOT_RADIUS_MAX_ZOOM
      );
      const activeFlightIds = new Set();

      drawableFlights.forEach((flight) => {
        activeFlightIds.add(flight.aircraftInstanceId);
        const existingMarker = flightMarkersById.get(flight.aircraftInstanceId);
        if (existingMarker) {
          existingMarker.setLatLng([flight.lat, flight.lng]);
          existingMarker.setRadius(radiusPx);
          existingMarker.setStyle({
            fillColor: flight.colorHex
          });
          return;
        }

        const marker = globalScope.L.circleMarker([flight.lat, flight.lng], {
          radius: radiusPx,
          color: FLIGHT_DOT_STROKE_COLOR,
          weight: FLIGHT_DOT_STROKE_WIDTH_PX,
          fillColor: flight.colorHex,
          fillOpacity: 0.95,
          interactive: false
        });
        marker.addTo(map);
        flightMarkersById.set(flight.aircraftInstanceId, marker);
      });

      Array.from(flightMarkersById.entries()).forEach(([aircraftInstanceId, marker]) => {
        if (activeFlightIds.has(aircraftInstanceId)) {
          return;
        }

        map.removeLayer(marker);
        flightMarkersById.delete(aircraftInstanceId);
      });

      return drawableFlights.length;
    }

    function syncLeafletFlightMarkerRadiiForZoom(map) {
      if (!map || flightMarkersById.size < 1) {
        return;
      }

      const radiusPx = getFlightDotRadiusPxForZoom(
        map.getZoom(),
        Number.isFinite(viewportMinZoom) ? viewportMinZoom : FLIGHT_DOT_RADIUS_MIN_ZOOM,
        FLIGHT_DOT_RADIUS_MAX_ZOOM
      );

      flightMarkersById.forEach((marker) => {
        marker.setRadius(radiusPx);
      });
    }

    function runLeafletFlightAnimationFrame(map) {
      if (!isFlightAnimationRunning) {
        return;
      }

      if (!latestGameSnapshot || !isActiveGameSnapshot(latestGameSnapshot) || !map) {
        clearLeafletFlightMarkers(map);
        stopLeafletFlightAnimation();
        return;
      }

      const drawableCount = syncLeafletFlightMarkers(map, Date.now());
      if (drawableCount < 1) {
        stopLeafletFlightAnimation();
        return;
      }

      flightAnimationFrameId = globalScope.requestAnimationFrame(() => runLeafletFlightAnimationFrame(map));
    }

    function ensureLeafletFlightAnimationState(map) {
      if (!latestGameSnapshot || !isActiveGameSnapshot(latestGameSnapshot) || !map) {
        clearLeafletFlightMarkers(map);
        stopLeafletFlightAnimation();
        return;
      }

      const drawableCount = syncLeafletFlightMarkers(map, Date.now());
      if (drawableCount < 1) {
        stopLeafletFlightAnimation();
        return;
      }

      if (isFlightAnimationRunning) {
        return;
      }

      isFlightAnimationRunning = true;
      flightAnimationFrameId = globalScope.requestAnimationFrame(() => runLeafletFlightAnimationFrame(map));
    }

    function syncRouteLines(map, routes, airports) {
      clearRouteLines(map);
      routeGeometryCollection.length = 0;

      const routeSegments = getRenderableRouteSegments(routes, airports);
      routeSegments.forEach((routeSegment) => {
        routeGeometryCollection.push(routeSegment);
      });
      routeSegments.forEach((routeSegment) => {
        const routeGeometrySegments = Array.isArray(routeSegment.segments) ? routeSegment.segments : [];
        routeGeometrySegments.forEach((segmentCoordinates) => {
          const routeLineLayer = globalScope.L.polyline(
            segmentCoordinates.map((coordinatePair) => [coordinatePair[1], coordinatePair[0]]),
            {
              color: ROUTE_LINE_COLOR,
              weight: ROUTE_LINE_WIDTH,
              opacity: 1,
              interactive: false
            }
          ).addTo(map);
          routeCollection.push(routeLineLayer);
        });
      });
    }

    function syncAirportMarkers(map, airports, players, routes) {
      const sourceAirports = Array.isArray(airports) ? airports : [];
      const playersById = createPlayersById(players);
      const sourceRoutes = Array.isArray(routes) ? routes : [];
      const activeMarkerIds = new Set();

      sourceAirports.forEach((airport, index) => {
        const lat = Number(airport && airport.lat);
        const lng = Number(airport && airport.lng);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return;
        }

        const markerId = getAirportMarkerId(airport, index);
        activeMarkerIds.add(markerId);
        airportMarkerMetadataById.set(markerId, airport || null);

        const existingMarker = airportMarkersById.get(markerId);
        if (existingMarker) {
          existingMarker.setLatLng([lat, lng]);
          applyAirportMarkerOwnershipStyling(existingMarker.getElement(), airport, playersById);
          applyAirportMarkerReconfigurationPulse(existingMarker.getElement(), airport.id, sourceRoutes);
          applyAirportMarkerLabel(existingMarker, airport, map.getZoom());
          return;
        }

        const markerOptions = {
          interactive: true,
          keyboard: false
        };

        if (AIRPORT_ICON) {
          markerOptions.icon = AIRPORT_ICON;
        }

        const marker = globalScope.L.marker([lat, lng], markerOptions);

        marker.on('mouseover', () => {
          showAirportTooltip(map, markerId);
        });

        marker.on('mouseout', () => {
          if (activeHoveredAirportId === markerId) {
            hideAirportTooltip();
          }
        });

        marker.on('click', () => {
          notifyAirportSelected(markerId);
        });

        marker.addTo(map);
        airportMarkersById.set(markerId, marker);
        applyAirportMarkerOwnershipStyling(marker.getElement(), airport, playersById);
        applyAirportMarkerLabel(marker, airport, map.getZoom());
      });

      Array.from(airportMarkersById.entries()).forEach(([markerId, marker]) => {
        if (activeMarkerIds.has(markerId)) {
          return;
        }

        map.removeLayer(marker);
        airportMarkersById.delete(markerId);
        airportMarkerMetadataById.delete(markerId);
        if (activeHoveredAirportId === markerId) {
          hideAirportTooltip();
        }
      });

      refreshAirportMarkerLabels(map);
      refreshAirportTooltip(map);
    }

    function canMeasureViewport() {
      return !!mapContainer && mapContainer.clientWidth > 0 && mapContainer.clientHeight > 0;
    }

    function updateViewportMinZoom(map, { forceFit = false } = {}) {
      if (!canMeasureViewport()) {
        return;
      }

      const minZoom = map.getBoundsZoom(CAMERA_BOUNDS);
      const minZoomChanged = viewportMinZoom !== minZoom;
      let adjustedZoom = false;

      viewportMinZoom = minZoom;
      map.setMinZoom(viewportMinZoom);

      if (forceFit && minZoomChanged) {
        map.fitBounds(CAMERA_BOUNDS, { animate: false });
      } else if (map.getZoom() < viewportMinZoom) {
        map.setZoom(viewportMinZoom, { animate: false });
        adjustedZoom = true;
      }

      if (minZoomChanged || adjustedZoom) {
        map.panInsideBounds(CAMERA_BOUNDS, { animate: false });
      }
    }

    function invalidateMapSizeIfNeeded(map, { force = false } = {}) {
      if (!map || !canMeasureViewport()) {
        return;
      }

      const currentWidth = mapContainer.clientWidth;
      const currentHeight = mapContainer.clientHeight;
      const sizeChanged =
        lastKnownContainerWidth !== currentWidth ||
        lastKnownContainerHeight !== currentHeight;

      if (!force && !sizeChanged) {
        return;
      }

      map.invalidateSize({
        pan: false,
        debounceMoveend: true
      });

      lastKnownContainerWidth = currentWidth;
      lastKnownContainerHeight = currentHeight;
    }

    function ensureMapInitialized() {
      if (mapInstance || !mapContainer || typeof globalScope.L === 'undefined') {
        return mapInstance;
      }

      mapInstance = globalScope.L.map(mapContainer, {
        zoomControl: false,
        zoomSnap: 0,
        minZoom: 2,
        maxZoom: BASEMAP_MAX_ZOOM,
        maxBounds: CAMERA_BOUNDS,
        maxBoundsViscosity: 0.85
      }).setView([INITIAL_CENTER[1], INITIAL_CENTER[0]], INITIAL_ZOOM);

      globalScope.L.maplibreGL({
        style: getBasemapStyleUrl(),
        attribution: BASEMAP_CONFIG.attribution,
        noWrap: true,
        maplibreOptions: {
          dragRotate: false,
          pitchWithRotate: false,
          renderWorldCopies: false
        }
      }).addTo(mapInstance);
      mapInstance.setMaxBounds(CAMERA_BOUNDS);
      updateViewportMinZoom(mapInstance, { forceFit: true });

      globalScope.addEventListener('resize', () => {
        if (!mapInstance) {
          return;
        }

        invalidateMapSizeIfNeeded(mapInstance, { force: true });
        updateViewportMinZoom(mapInstance);
        refreshAirportTooltip(mapInstance);
      });

      mapInstance.on('move zoom', () => {
        refreshAirportMarkerLabels(mapInstance);
        refreshAirportTooltip(mapInstance);
        syncLeafletFlightMarkerRadiiForZoom(mapInstance);
      });

      return mapInstance;
    }

    function render(state) {
      if (!state || !state.ui || state.ui.screen !== 'game') {
        if (mapInstance) {
          clearRouteLines(mapInstance);
          clearAirportMarkers(mapInstance);
          clearLeafletFlightMarkers(mapInstance);
          mapContainer.classList.remove('map-visible');
        }
        return;
      }

      const map = ensureMapInitialized();
      if (!map) {
        return;
      }

      mapContainer.classList.add('map-visible');
      latestGameSnapshot = state.game || null;
      invalidateMapSizeIfNeeded(map);
      updateViewportMinZoom(map, { forceFit: !hasFittedWorld });
      syncRouteLines(map, state.game && state.game.routes, state.game && state.game.airports);
      syncAirportMarkers(map, state.game && state.game.airports, state.game && state.game.players, state.game && state.game.routes);
      ensureLeafletFlightAnimationState(map);
      refreshAirportTooltip(map);
      hasFittedWorld = true;
    }

    return {
      render,
      setAirportSelectHandler,
      markerCollection,
      routeCollection
    };
  }

  function createMapRenderer(documentRef) {
    let persistedMode = '';
    try {
      persistedMode = globalScope.localStorage ? globalScope.localStorage.getItem('airline.mapMode') || '' : '';
    } catch (_error) {
      persistedMode = '';
    }

    const requestedMode = String(globalScope.__AIRLINE_MAP_MODE__ || persistedMode || 'native-maplibre').toLowerCase();
    const shouldUseNativeMaplibre = requestedMode !== 'leaflet';

    if (shouldUseNativeMaplibre && typeof globalScope.maplibregl !== 'undefined') {
      return createNativeMapRenderer(documentRef);
    }

    return createLeafletMapRenderer(documentRef);
  }

  globalScope.createMapRenderer = createMapRenderer;

  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    globalScope.__airlineFlightProjection = {
      getProjectedInFlightLeg,
      resolveAircraftCruiseSpeedKmH,
      resolveRouteDistanceKm,
      calculateClientFlightDurationSimulationMs,
      calculateClientTurnaroundSimulationMs
    };
    globalScope.__airlineCountryProfitability = {
      getCountryProfitFactorFromState,
      getCountryProfitabilityColor,
      getCountryProfitabilityOpacity,
      getCountryProfitabilityPaint,
      buildCountryProfitabilityPaint
    };
    globalScope.__airlineCountryHoverPopup = {
      COUNTRY_HOVER_POPUP_DWELL_MS,
      createCountryHoverPopupScheduler,
      formatCountryProfitabilityMultiplier,
      getCountryPopupMultiplierText
    };
    globalScope.__airlineAirportPriceFilter = {
      isAirportVisibleAtPrice
    };
  }
})(window);