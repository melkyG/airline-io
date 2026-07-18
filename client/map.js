(function bootstrapMapModule(globalScope) {
  const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const TILE_OPTIONS = {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  };

  function createMapRenderer(documentRef) {
    const mapContainer = documentRef.getElementById('mapContainer');
    let mapInstance = null;
    const markerCollection = [];
    const routeCollection = [];

    function ensureMapInitialized() {
      if (mapInstance || !mapContainer || typeof globalScope.L === 'undefined') {
        return mapInstance;
      }

      mapInstance = globalScope.L.map(mapContainer, {
        zoomControl: true,
        minZoom: 2,
        maxZoom: 18
      }).setView([20, 0], 2);

      globalScope.L.tileLayer(TILE_URL, TILE_OPTIONS).addTo(mapInstance);
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
      map.invalidateSize();
    }

    return {
      render,
      markerCollection,
      routeCollection
    };
  }

  globalScope.createMapRenderer = createMapRenderer;
})(window);