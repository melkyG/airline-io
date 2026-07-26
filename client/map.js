(function bootstrapMapModule(globalScope) {
  const CAMERA_BOUNDS = [[-60, -180], [84, 180]];
  const BASEMAP_MAX_ZOOM = 7.5;
  const INITIAL_CENTER = [0, 20];
  const INITIAL_ZOOM = 2;
  const AIRPORT_ICON_SIZE = 48;
  const AIRPORT_TOOLTIP_OFFSET_X = 14;
  const AIRPORT_TOOLTIP_OFFSET_Y = -10;
  const AIRPORT_LABEL_ZOOM_IATA = 4.6;
  const AIRPORT_LABEL_ZOOM_NAME = 6.1;
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
    let airportSelectHandler = null;
    let activeHoveredAirportId = null;
    let latestGameSnapshot = null;

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

    function createPlayersById(players) {
      return (Array.isArray(players) ? players : []).reduce((lookup, player) => {
        if (!player || !player.id) {
          return lookup;
        }

        lookup.set(String(player.id), player);
        return lookup;
      }, new Map());
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

    function applyAirportOwnershipStyling(markerElement, airport) {
      if (!markerElement) {
        return;
      }

      const ownerPlayerId = airport && airport.ownerPlayerId;
      const hasListing =
        !!(airport && airport.saleListing && typeof airport.saleListing === 'object' && Number.isFinite(airport.saleListing.askingPrice));

      markerElement.setAttribute('data-owned', ownerPlayerId == null ? 'false' : 'true');
      markerElement.setAttribute('data-listed', hasListing ? 'true' : 'false');
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

    function clearAirportMarkers() {
      airportMarkersById.forEach((marker) => {
        marker.remove();
      });

      airportMarkersById.clear();
      airportMarkerMetadataById.clear();
      hideAirportTooltip();
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

    function syncAirportMarkers(airports) {
      if (!mapInstance) {
        return;
      }

      const sourceAirports = Array.isArray(airports) ? airports : [];
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
          applyAirportOwnershipStyling(existingElement, airport);
          applyAirportMarkerLabel(existingElement, airport, mapInstance.getZoom());
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
        applyAirportOwnershipStyling(markerElement, airport);
        applyAirportMarkerLabel(markerElement, airport, mapInstance.getZoom());
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

    function applyInitialCameraSetupIfReady() {
      if (!mapInstance || !mapLoaded || hasAppliedInitialCameraSetup || !canMeasureViewport()) {
        return;
      }

      mapInstance.resize();
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
        renderWorldCopies: false,
        attributionControl: true
      });

      mapInstance.once('load', () => {
        mapLoaded = true;
        applyInitialCameraSetupIfReady();
      });

      mapInstance.on('move', () => {
        refreshAirportMarkerLabels();
        refreshAirportTooltip();
      });

      mapInstance.on('zoom', () => {
        refreshAirportMarkerLabels();
        refreshAirportTooltip();
      });

      if (!hasBoundResizeListener) {
        globalScope.addEventListener('resize', () => {
          if (!mapInstance) {
            return;
          }

          mapInstance.resize();
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
        if (mapInstance) {
          clearAirportMarkers();
        }
        return;
      }

      const map = ensureMapInitialized();
      if (!map) {
        return;
      }

      mapContainer.classList.add('map-visible');
      latestGameSnapshot = state.game || null;
      applyInitialCameraSetupIfReady();
      syncAirportMarkers(state.game && state.game.airports);
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
    let airportSelectHandler = null;
    let activeHoveredAirportId = null;
    let latestGameSnapshot = null;
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

    function createPlayersById(players) {
      return (Array.isArray(players) ? players : []).reduce((lookup, player) => {
        if (!player || !player.id) {
          return lookup;
        }

        lookup.set(String(player.id), player);
        return lookup;
      }, new Map());
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

    function syncAirportMarkers(map, airports) {
      const sourceAirports = Array.isArray(airports) ? airports : [];
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
      });

      return mapInstance;
    }

    function render(state) {
      if (!state || !state.ui || state.ui.screen !== 'game') {
        if (mapInstance) {
          clearAirportMarkers(mapInstance);
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
      syncAirportMarkers(map, state.game && state.game.airports);
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