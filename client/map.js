(function bootstrapMapModule(globalScope) {
  const WORLD_BOUNDS = [[-85.0511, -180], [85.0511, 180]];
  const BASEMAP_MAX_ZOOM = 6;
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
      });

      return mapInstance;
    }

    function render(state) {
      if (!state || !state.ui || state.ui.screen !== 'game') {
        return;
      }

      const map = ensureMapInitialized();
      if (!map) {
        return;
      }

      mapContainer.classList.add('map-visible');
      const shouldForceFit = !hasFittedWorld || Math.abs(map.getZoom() - map.getMinZoom()) < 0.0001;
      map.invalidateSize();
      updateViewportMinZoom(map, { forceFit: shouldForceFit });
      hasFittedWorld = true;
    }

    return {
      render,
      markerCollection,
      routeCollection
    };
  }

  globalScope.createMapRenderer = createMapRenderer;
})(window);