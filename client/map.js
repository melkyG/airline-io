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
  const AIRPORT_MARKER_SCALE_MIN = 0.84;
  const AIRPORT_MARKER_SCALE_MAX = 1.45;
  const AIRPORT_MARKER_SCALE_MIN_ZOOM = INITIAL_ZOOM;
  const AIRPORT_MARKER_SCALE_MAX_ZOOM = BASEMAP_MAX_ZOOM;
  const ROUTE_LINE_COLOR = '#000000';
  const ROUTE_LINE_WIDTH = 2;
  const OWNED_AIRPORT_FALLBACK_COLOR = '#0ea5e9';
  const MAPLIBRE_ROUTE_SOURCE_ID = 'airline-routes-source';
  const MAPLIBRE_ROUTE_LAYER_ID = 'airline-routes-layer';
  const MAPLIBRE_FLIGHT_SOURCE_ID = 'airline-flights-source';
  const MAPLIBRE_FLIGHT_LAYER_ID = 'airline-flights-layer';
  const FLIGHT_DOT_COLOR = '#0e7ccf';
  const FLIGHT_DOT_RADIUS_MIN_PX = 4;
  const FLIGHT_DOT_RADIUS_MAX_PX = 7;
  const FLIGHT_DOT_RADIUS_MIN_ZOOM = INITIAL_ZOOM;
  const FLIGHT_DOT_RADIUS_MAX_ZOOM = BASEMAP_MAX_ZOOM;
  const FLIGHT_DOT_STROKE_COLOR = '#ffffff';
  const FLIGHT_DOT_STROKE_WIDTH_PX = 1.2;
  const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  });
  const AIRPORT_MARKER_INNER_HTML =
    `<div class="airport-marker-content">` +
    `<div class="airport-marker airport-marker-visual airport-marker--control-tower-svg">` +
    `<svg class="airport-marker-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    `<rect class="airport-marker-base" x="5.5" y="18" width="13" height="3" rx="1.6"/>` +
    `<rect class="airport-marker-shaft" x="10.2" y="9.4" width="3.6" height="8.6" rx="1.6"/>` +
    `<rect class="airport-marker-room" x="6.2" y="4.2" width="11.6" height="6.2" rx="2.1"/>` +
    `<rect class="airport-marker-window" x="8" y="6.2" width="8" height="2" rx="0.8"/>` +
    `<rect class="airport-marker-antenna" x="11.55" y="2" width="1" height="2.4" rx="0.45"/>` +
    `</svg>` +
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

  function applyAirportMarkerScaleToElement(markerRootElement, zoomLevel) {
    if (!markerRootElement || !markerRootElement.style) {
      return;
    }

    markerRootElement.style.setProperty('--airport-marker-scale', getAirportMarkerScaleForZoom(zoomLevel).toFixed(3));
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

  function darkenHexColor(colorHex, multiplier = 0.45) {
    const { red, green, blue } = parseHexColorChannels(colorHex);
    const toHexChannel = (channel) => {
      const nextChannel = Math.max(0, Math.min(255, Math.round(channel * multiplier)));
      return nextChannel.toString(16).padStart(2, '0');
    };

    return `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`;
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

    if (!colorTargetElement) {
      return;
    }

    if (!ownerColorHex) {
      colorTargetElement.style.removeProperty('--airport-marker-room-fill');
      colorTargetElement.style.removeProperty('--airport-marker-stroke');
      return;
    }

    colorTargetElement.style.setProperty('--airport-marker-room-fill', ownerColorHex);
    colorTargetElement.style.setProperty('--airport-marker-stroke', darkenHexColor(ownerColorHex));
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

  function getDrawableFlights(gameSnapshot, realNowMs = Date.now()) {
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
    if (!Number.isFinite(simulationNowGameMs)) {
      return [];
    }

    return flights.reduce((drawableFlights, flight) => {
      if (!flight || String(flight.status || '') !== 'in-flight') {
        return drawableFlights;
      }

      const flightId = String(flight.flightId || '').trim();
      const originAirportId = String(flight.originAirportId || '').trim();
      const destinationAirportId = String(flight.destinationAirportId || '').trim();
      const departedAtSimulationMs = Number(flight.departedAtSimulationMs);
      const arrivesAtSimulationMs = Number(flight.arrivesAtSimulationMs);

      if (
        !flightId ||
        !originAirportId ||
        !destinationAirportId ||
        !Number.isFinite(departedAtSimulationMs) ||
        !Number.isFinite(arrivesAtSimulationMs) ||
        arrivesAtSimulationMs <= departedAtSimulationMs
      ) {
        return drawableFlights;
      }

      const originAirport = airportLookupById.get(originAirportId);
      const destinationAirport = airportLookupById.get(destinationAirportId);
      if (!originAirport || !destinationAirport) {
        return drawableFlights;
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
        return drawableFlights;
      }

      const rawProgress = clamp01(
        (simulationNowGameMs - departedAtSimulationMs) / (arrivesAtSimulationMs - departedAtSimulationMs)
      );
      const easedProgress = easeFlightProgress(rawProgress);
      const colorHex = resolvePlayerColorHexById(flight.ownerPlayerId, playersById, FLIGHT_DOT_COLOR);

      const lng = originLng + ((destinationLng - originLng) * easedProgress);
      const lat = originLat + ((destinationLat - originLat) * easedProgress);
      drawableFlights.push({
        flightId,
        colorHex,
        lng,
        lat
      });

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

      segments.push({
        routeId: String(route.routeId),
        from: [originLng, originLat],
        to: [destinationLng, destinationLat]
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
    const tooltipPriceElement = tooltipElement ? documentRef.createElement('div') : null;
    const tooltipOwnerElement = tooltipElement ? documentRef.createElement('div') : null;
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

    if (tooltipElement) {
      tooltipElement.className = 'airport-tooltip airport-tooltip-hidden';
      tooltipCodeElement.className = 'airport-tooltip-code';
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
        ownerText
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

      tooltipCodeElement.textContent = tooltipData.code;
      tooltipPriceElement.textContent = tooltipData.price;
      tooltipOwnerElement.textContent = tooltipData.ownerText;
      tooltipElement.classList.remove('airport-tooltip-hidden');
      positionAirportTooltip(marker);
    }

    function showAirportTooltip(airportId) {
      activeHoveredAirportId = airportId;
      refreshAirportTooltip();
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
      if (!mapInstance || !mapLoaded) {
        return;
      }

      const existingSource = mapInstance.getSource(MAPLIBRE_ROUTE_SOURCE_ID);
      if (existingSource && typeof existingSource.setData === 'function') {
        existingSource.setData(getEmptyRouteFeatureCollection());
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

      const drawableFlights = getDrawableFlights(latestGameSnapshot, realNowMs);
      const flightFeatureCollection = {
        type: 'FeatureCollection',
        features: drawableFlights.map((flight) => ({
          type: 'Feature',
          properties: {
            flightId: flight.flightId,
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
        features: routeSegments.map((routeSegment) => ({
          type: 'Feature',
          properties: {
            routeId: routeSegment.routeId
          },
          geometry: {
            type: 'LineString',
            coordinates: [routeSegment.from, routeSegment.to]
          }
        }))
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
            'line-opacity': 1
          }
        });
      }
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

      contentElement.appendChild(visualElement);
      contentElement.appendChild(labelElement);
      markerElement.appendChild(contentElement);
      return markerElement;
    }

    function syncAirportMarkers(airports, players) {
      if (!mapInstance) {
        return;
      }

      const sourceAirports = Array.isArray(airports) ? airports : [];
      const playersById = createPlayersById(players);
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
          showAirportTooltip(markerId);
        });

        markerElement.addEventListener('mouseleave', () => {
          if (activeHoveredAirportId === markerId) {
            hideAirportTooltip();
          }
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
        if (mapInstance) {
          clearAirportMarkers();
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
      syncAirportMarkers(state.game && state.game.airports, state.game && state.game.players);
      syncRouteLines(state.game && state.game.routes, state.game && state.game.airports);
      ensureNativeFlightAnimationState();
      refreshAirportTooltip();
    }

    return {
      render,
      setAirportSelectHandler,
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
    const tooltipPriceElement = tooltipElement ? documentRef.createElement('div') : null;
    const tooltipOwnerElement = tooltipElement ? documentRef.createElement('div') : null;

    if (tooltipElement) {
      tooltipElement.className = 'airport-tooltip airport-tooltip-hidden';
      tooltipCodeElement.className = 'airport-tooltip-code';
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
        ownerText
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

      tooltipCodeElement.textContent = tooltipData.code;
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

      const drawableFlights = getDrawableFlights(latestGameSnapshot, realNowMs);
      const radiusPx = getFlightDotRadiusPxForZoom(
        map.getZoom(),
        Number.isFinite(viewportMinZoom) ? viewportMinZoom : FLIGHT_DOT_RADIUS_MIN_ZOOM,
        FLIGHT_DOT_RADIUS_MAX_ZOOM
      );
      const activeFlightIds = new Set();

      drawableFlights.forEach((flight) => {
        activeFlightIds.add(flight.flightId);
        const existingMarker = flightMarkersById.get(flight.flightId);
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
        flightMarkersById.set(flight.flightId, marker);
      });

      Array.from(flightMarkersById.entries()).forEach(([flightId, marker]) => {
        if (activeFlightIds.has(flightId)) {
          return;
        }

        map.removeLayer(marker);
        flightMarkersById.delete(flightId);
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

      const routeSegments = getRenderableRouteSegments(routes, airports);
      routeSegments.forEach((routeSegment) => {
        const routeLineLayer = globalScope.L.polyline(
          [
            [routeSegment.from[1], routeSegment.from[0]],
            [routeSegment.to[1], routeSegment.to[0]]
          ],
          {
            color: ROUTE_LINE_COLOR,
            weight: ROUTE_LINE_WIDTH,
            opacity: 1,
            interactive: false
          }
        ).addTo(map);
        routeCollection.push(routeLineLayer);
      });
    }

    function syncAirportMarkers(map, airports, players) {
      const sourceAirports = Array.isArray(airports) ? airports : [];
      const playersById = createPlayersById(players);
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
      syncAirportMarkers(map, state.game && state.game.airports, state.game && state.game.players);
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
})(window);