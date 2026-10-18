(function bootstrapAirportTiers(globalScope) {
  const AIRPORT_TIER_LABELS = Object.freeze({
    Cheap: 'Tier 1',
    Standard: 'Tier 2',
    Major: 'Tier 3',
    Hub: 'Tier 4',
    Elite: 'Tier 5'
  });

  function getAirportTierLabel(economicClass) {
    const label = AIRPORT_TIER_LABELS[String(economicClass || '').trim()];
    return typeof label === 'string' ? label : null;
  }

  function createAirportTierBadge(documentRef, economicClass) {
    const label = getAirportTierLabel(economicClass);
    if (!label || !documentRef || typeof documentRef.createElement !== 'function') {
      return null;
    }

    const badgeElement = documentRef.createElement('span');
    badgeElement.className = 'airport-tier-badge';
    badgeElement.textContent = label;
    return badgeElement;
  }

  function syncAirportTierBadge(badgeElement, economicClass) {
    if (!badgeElement) {
      return;
    }

    const label = getAirportTierLabel(economicClass);
    if (label) {
      badgeElement.textContent = label;
      badgeElement.classList.remove('airport-tier-badge-hidden');
    } else {
      badgeElement.textContent = '';
      badgeElement.classList.add('airport-tier-badge-hidden');
    }
  }

  const api = {
    AIRPORT_TIER_LABELS,
    getAirportTierLabel,
    createAirportTierBadge,
    syncAirportTierBadge
  };

  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = api;
  }

  globalScope.airportTiers = api;
})(typeof window !== 'undefined' ? window : globalThis);
