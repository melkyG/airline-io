(function bootstrapMapModule(globalScope) {
  const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const WORLD_BOUNDS = [[-85.0511, -180], [85.0511, 180]];
  const TILE_OPTIONS = {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    noWrap: true,
    bounds: WORLD_BOUNDS
  };

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
        zoomControl: true,
        zoomSnap: 0,
        minZoom: 2,
        maxZoom: 18,
        maxBounds: WORLD_BOUNDS,
        maxBoundsViscosity: 1
      }).setView([20, 0], 2);

      globalScope.L.tileLayer(TILE_URL, TILE_OPTIONS).addTo(mapInstance);
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