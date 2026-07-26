(function bootstrapMapModule(globalScope) {
  const WORLD_BOUNDS = [[-85.0511, -180], [85.0511, 180]];
  const BASEMAP_MAX_ZOOM = 7;
  const AIRPORT_ICON_SIZE = 48;
  const AIRPORT_TOOLTIP_OFFSET_X = 14;
  const AIRPORT_TOOLTIP_OFFSET_Y = -10;
  const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  });
  const AIRPORT_ICON =
    typeof globalScope.L !== 'undefined'
      ? globalScope.L.divIcon({
          className: 'airport-marker airport-marker--control-tower-svg',
          html:
            `<svg class="airport-marker-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
            `<rect class="airport-marker-base" x="5.5" y="18" width="13" height="3" rx="1.6"/>` +
            `<rect class="airport-marker-shaft" x="10.2" y="9.4" width="3.6" height="8.6" rx="1.6"/>` +
            `<rect class="airport-marker-room" x="6.2" y="4.2" width="11.6" height="6.2" rx="2.1"/>` +
            `<rect class="airport-marker-window" x="8" y="6.2" width="8" height="2" rx="0.8"/>` +
            `<rect class="airport-marker-antenna" x="11.55" y="2" width="1" height="2.4" rx="0.45"/>` +
            `</svg>`,
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

  function createMapRenderer(documentRef) {
    const mapContainer = documentRef.getElementById('mapContainer');
    let mapInstance = null;
    let viewportMinZoom = null;
    let hasFittedWorld = false;
    const markerCollection = [];
    const routeCollection = [];
    const airportMarkersById = new Map();
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

    function clearAirportMarkers(map) {
      airportMarkersById.forEach((marker) => {
        map.removeLayer(marker);
      });

      airportMarkersById.clear();
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

        const existingMarker = airportMarkersById.get(markerId);
        if (existingMarker) {
          existingMarker.setLatLng([lat, lng]);
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
      });

      Array.from(airportMarkersById.entries()).forEach(([markerId, marker]) => {
        if (activeMarkerIds.has(markerId)) {
          return;
        }

        map.removeLayer(marker);
        airportMarkersById.delete(markerId);
        if (activeHoveredAirportId === markerId) {
          hideAirportTooltip();
        }
      });

      refreshAirportTooltip(map);
    }

    function canMeasureViewport() {
      return !!mapContainer && mapContainer.clientWidth > 0 && mapContainer.clientHeight > 0;
    }

    function updateViewportMinZoom(map, { forceFit = false } = {}) {
      if (!canMeasureViewport()) {
        return;
      }

      const previousZoom = map.getZoom();
      const minZoom = map.getBoundsZoom(WORLD_BOUNDS);

      if (viewportMinZoom === minZoom) {
        if (forceFit) {
          map.fitBounds(WORLD_BOUNDS, { animate: false });
          map.panInsideBounds(WORLD_BOUNDS, { animate: false });
        }
        return;
      }

      viewportMinZoom = minZoom;
      map.setMinZoom(viewportMinZoom);

      const atOrBelowMinBeforeUpdate = previousZoom <= viewportMinZoom + 0.0001;

      if (forceFit || atOrBelowMinBeforeUpdate) {
        map.fitBounds(WORLD_BOUNDS, { animate: false });
      } else if (map.getZoom() < viewportMinZoom) {
        map.setZoom(viewportMinZoom, { animate: false });
      }

      map.panInsideBounds(WORLD_BOUNDS, { animate: false });
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
        maxBounds: WORLD_BOUNDS,
        maxBoundsViscosity: 1
      }).setView([20, 0], 2);

      globalScope.L.maplibreGL({
        style: getBasemapStyleUrl(),
        attribution: BASEMAP_CONFIG.attribution
      }).addTo(mapInstance);
      mapInstance.setMaxBounds(WORLD_BOUNDS);
      updateViewportMinZoom(mapInstance, { forceFit: true });

      globalScope.addEventListener('resize', () => {
        if (!mapInstance) {
          return;
        }

        const wasAtMinZoom = Math.abs(mapInstance.getZoom() - mapInstance.getMinZoom()) < 0.0001;
        mapInstance.invalidateSize({ debounceMoveend: true });
        updateViewportMinZoom(mapInstance, { forceFit: wasAtMinZoom });
        refreshAirportTooltip(mapInstance);
      });

      mapInstance.on('move zoom', () => {
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
      const shouldForceFit = !hasFittedWorld || Math.abs(map.getZoom() - map.getMinZoom()) < 0.0001;
      map.invalidateSize();
      updateViewportMinZoom(map, { forceFit: shouldForceFit });
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

  globalScope.createMapRenderer = createMapRenderer;
})(window);