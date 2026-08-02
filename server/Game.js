const { randomUUID } = require('node:crypto');
const { AIRPORT_CATALOG } = require('./airports/catalog');
const { AIRCRAFT_CATALOG, AIRCRAFT_CATALOG_BY_ID } = require('./aircraft/catalog');
const { createOwnedAircraftInstance, OWNED_AIRCRAFT_STATUS } = require('./aircraft/ownership');
const { canonicalRouteKey, calculateRouteDistanceKm } = require('./routes');

const AIRPORT_DEFINITIONS_BY_ID = AIRPORT_CATALOG.reduce((lookup, airport) => {
  lookup.set(airport.id, airport);
  return lookup;
}, new Map());

function calculateAirportSellToGamePrice(basePrice) {
  const normalizedBasePrice = Number.isFinite(basePrice) ? basePrice : 0;
  if (normalizedBasePrice < 0) {
    return 0;
  }

  return Math.round(normalizedBasePrice * 0.8);
}

class Game {
  constructor(initialState, manager) {
    this.id = initialState.id;
    this.status = initialState.status;
    this.players = new Map();
    this.createdAt = initialState.createdAt;
    this.authoritativeState = {
      ...initialState,
      status: initialState.status,
      ownedAircraft: Array.isArray(initialState.ownedAircraft) ? initialState.ownedAircraft : [],
      routes: Array.isArray(initialState.routes) ? initialState.routes : []
    };
    this.endTimeoutId = null;
    this.hasBroadcastStarted = false;
    this.gameState = {
      mapPlaceholder: 'Map Placeholder'
    };
    this.manager = manager;
  }

  initialize() {
    Array.from(this.players.values()).forEach((player) => {
      player.gameId = this.id;
      player.lobbyId = null;
    });

    this.scheduleExpirationTimeout();
    this.broadcastStarted();
    this.checkWinConditions();
  }

  scheduleExpirationTimeout() {
    this.clearExpirationTimeout();

    if (this.status !== 'active' || !Number.isFinite(this.authoritativeState.endsAt)) {
      return;
    }

    const delayMs = Math.max(0, this.authoritativeState.endsAt - Date.now());
    this.endTimeoutId = setTimeout(() => {
      this.checkWinConditions();
    }, delayMs);
  }

  clearExpirationTimeout() {
    if (!this.endTimeoutId) {
      return;
    }

    clearTimeout(this.endTimeoutId);
    this.endTimeoutId = null;
  }

  endGame(reason) {
    if (this.status !== 'active') {
      return false;
    }

    this.status = 'ended';
    this.authoritativeState.status = 'ended';
    this.authoritativeState.endReason = reason;
    this.authoritativeState.endedAt = Date.now();
    this.generateResults();
    this.clearExpirationTimeout();
    this.broadcastState();

    if (this.manager && typeof this.manager.handleGameEnded === 'function') {
      this.manager.handleGameEnded(this.id);
    }

    return true;
  }

  createCoinFlipValue(bitCount = 16) {
    let value = 0;
    for (let index = 0; index < bitCount; index += 1) {
      value = (value << 1) | (Math.random() < 0.5 ? 0 : 1);
    }

    return value;
  }

  generateResults() {
    if (this.authoritativeState.results) {
      return this.authoritativeState.results;
    }

    const sourcePlayers = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const rankedPlayers = sourcePlayers
      .map((player) => {
        const score = Number.isFinite(player.score) ? player.score : 0;
        const capital = Number.isFinite(player.capital) ? player.capital : 0;
        return {
          id: player.id,
          username: player.username,
          score,
          capital,
          tieBreaker: this.createCoinFlipValue()
        };
      })
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        if (right.capital !== left.capital) {
          return right.capital - left.capital;
        }

        if (right.tieBreaker !== left.tieBreaker) {
          return right.tieBreaker - left.tieBreaker;
        }

        return String(left.id).localeCompare(String(right.id));
      });

    const standings = rankedPlayers.map((player, index) => ({
      rank: index + 1,
      id: player.id,
      username: player.username,
      score: player.score,
      capital: player.capital
    }));

    const winner = standings.length > 0 ? { ...standings[0] } : null;
    const results = {
      winner,
      standings,
      generatedAt: Date.now()
    };

    this.authoritativeState.results = results;
    return results;
  }

  checkWinConditions() {
    if (this.status !== 'active') {
      return false;
    }

    const scoreToWin = this.authoritativeState.scoreToWin;
    if (Number.isFinite(scoreToWin) && scoreToWin > 0) {
      const scoreReached = this.authoritativeState.players.some((player) => {
        const playerScore = Number.isFinite(player.score) ? player.score : 0;
        return playerScore >= scoreToWin;
      });

      if (scoreReached) {
        return this.endGame('score');
      }
    }

    if (Number.isFinite(this.authoritativeState.endsAt) && Date.now() >= this.authoritativeState.endsAt) {
      return this.endGame('time');
    }

    return false;
  }

  evaluateWinConditions() {
    return this.checkWinConditions();
  }

  addScore(playerId, amount) {
    if (this.status !== 'active') {
      return false;
    }

    const delta = Number.isFinite(amount) ? amount : 0;
    if (delta === 0) {
      return false;
    }

    const targetPlayer = this.authoritativeState.players.find((player) => player.id === playerId);
    if (!targetPlayer) {
      return false;
    }

    const currentScore = Number.isFinite(targetPlayer.score) ? targetPlayer.score : 0;
    targetPlayer.score = currentScore + delta;

    const runtimePlayer = this.players.get(playerId);
    if (runtimePlayer) {
      const runtimeScore = Number.isFinite(runtimePlayer.score) ? runtimePlayer.score : 0;
      runtimePlayer.score = runtimeScore + delta;
    }

    const ended = this.checkWinConditions();
    if (!ended) {
      this.broadcastState();
    }

    return true;
  }

  purchaseUnownedAirport(playerId, airportId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const airports = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];
    const normalizedAirportId = String(airportId || '').trim();

    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const airportState = airports.find((candidate) => candidate.airportId === normalizedAirportId);
    const airportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(normalizedAirportId);
    const basePrice = airportDefinition ? airportDefinition.basePrice : null;

    if (!airportState || !airportDefinition || !Number.isFinite(basePrice) || basePrice < 0) {
      return {
        success: false,
        code: 'AIRPORT_NOT_FOUND',
        message: 'Airport was not found.'
      };
    }

    if (airportState.ownerPlayerId) {
      return {
        success: false,
        code: 'AIRPORT_ALREADY_OWNED',
        message: 'Airport is already owned.'
      };
    }

    const currentCapital = Number.isFinite(player.capital) ? player.capital : 0;
    if (currentCapital < basePrice) {
      return {
        success: false,
        code: 'INSUFFICIENT_CAPITAL',
        message: 'Player does not have enough capital for this purchase.'
      };
    }

    player.capital = currentCapital - basePrice;
    airportState.ownerPlayerId = player.id;
    airportState.saleListing = null;

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      playerId: player.id,
      airportId: airportDefinition.id,
      pricePaid: basePrice,
      remainingCapital: player.capital
    };
  }

  resolveAircraftPurchaseContext(playerId, aircraftCatalogId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const normalizedAircraftCatalogId = String(aircraftCatalogId || '').trim();

    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const aircraftDefinition = AIRCRAFT_CATALOG_BY_ID[normalizedAircraftCatalogId];
    const purchasePrice = aircraftDefinition ? aircraftDefinition.purchasePrice : null;
    if (!aircraftDefinition || !Number.isFinite(purchasePrice) || purchasePrice < 0) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_FOUND',
        message: 'Aircraft was not found.'
      };
    }

    const currentCapital = Number.isFinite(player.capital) ? player.capital : 0;
    const maxPurchasable = Math.max(0, Math.floor(currentCapital / purchasePrice));

    return {
      success: true,
      player,
      aircraftDefinition,
      purchasePrice,
      currentCapital,
      maxPurchasable
    };
  }

  getAircraftPurchaseQuote(playerId, aircraftCatalogId) {
    const context = this.resolveAircraftPurchaseContext(playerId, aircraftCatalogId);
    if (!context.success) {
      return context;
    }

    return {
      success: true,
      code: 'OK',
      playerId: context.player.id,
      aircraftCatalogId: context.aircraftDefinition.aircraftCatalogId,
      unitPrice: context.purchasePrice,
      currentCapital: context.currentCapital,
      maxPurchasable: context.maxPurchasable
    };
  }

  getAircraftSellQuote(playerId, aircraftCatalogId) {
    const context = this.resolveAircraftPurchaseContext(playerId, aircraftCatalogId);
    if (!context.success) {
      return context;
    }

    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    const ownedQuantity = ownedAircraft.reduce((count, aircraft) => {
      if (!aircraft) {
        return count;
      }

      const isOwnerMatch = String(aircraft.ownerPlayerId) === String(context.player.id);
      const isCatalogMatch = String(aircraft.aircraftCatalogId) === String(context.aircraftDefinition.aircraftCatalogId);
      return isOwnerMatch && isCatalogMatch ? count + 1 : count;
    }, 0);
    const unitSellPrice = Math.round(context.purchasePrice * 0.8);

    return {
      success: true,
      code: 'OK',
      aircraftCatalogId: context.aircraftDefinition.aircraftCatalogId,
      ownedQuantity,
      maxSellable: ownedQuantity,
      unitSellPrice
    };
  }

  sellAircraftToGame(playerId, aircraftCatalogId, quantity = 1) {
    const sellQuote = this.getAircraftSellQuote(playerId, aircraftCatalogId);
    if (!sellQuote.success) {
      return sellQuote;
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      return {
        success: false,
        code: 'INVALID_QUANTITY',
        message: 'Quantity must be an integer greater than or equal to 1.',
        aircraftCatalogId: sellQuote.aircraftCatalogId,
        ownedQuantity: sellQuote.ownedQuantity,
        maxSellable: sellQuote.maxSellable,
        unitSellPrice: sellQuote.unitSellPrice
      };
    }

    if (quantity > sellQuote.ownedQuantity) {
      return {
        success: false,
        code: 'INSUFFICIENT_OWNED_QUANTITY',
        message: 'Player does not own enough aircraft of this model to sell that quantity.',
        aircraftCatalogId: sellQuote.aircraftCatalogId,
        ownedQuantity: sellQuote.ownedQuantity,
        maxSellable: sellQuote.maxSellable,
        unitSellPrice: sellQuote.unitSellPrice
      };
    }

    const context = this.resolveAircraftPurchaseContext(playerId, aircraftCatalogId);
    if (!context.success) {
      return context;
    }

    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    let remainingToSell = quantity;
    const updatedOwnedAircraft = [];

    ownedAircraft.forEach((aircraft) => {
      if (!aircraft) {
        updatedOwnedAircraft.push(aircraft);
        return;
      }

      const isOwnerMatch = String(aircraft.ownerPlayerId) === String(context.player.id);
      const isCatalogMatch = String(aircraft.aircraftCatalogId) === String(sellQuote.aircraftCatalogId);
      const shouldSellThisInstance = remainingToSell > 0 && isOwnerMatch && isCatalogMatch;

      if (shouldSellThisInstance) {
        remainingToSell -= 1;
        return;
      }

      updatedOwnedAircraft.push(aircraft);
    });

    const totalRefund = sellQuote.unitSellPrice * quantity;
    const currentCapital = Number.isFinite(context.player.capital) ? context.player.capital : 0;
    context.player.capital = currentCapital + totalRefund;
    this.authoritativeState.ownedAircraft = updatedOwnedAircraft;

    const remainingOwnedQuantity = sellQuote.ownedQuantity - quantity;

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      aircraftCatalogId: sellQuote.aircraftCatalogId,
      quantitySold: quantity,
      unitSellPrice: sellQuote.unitSellPrice,
      totalRefund,
      ownedQuantity: remainingOwnedQuantity,
      maxSellable: remainingOwnedQuantity,
      updatedCapital: context.player.capital
    };
  }

  purchaseAircraftFromGame(playerId, aircraftCatalogId, quantity = 1) {
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    const context = this.resolveAircraftPurchaseContext(playerId, aircraftCatalogId);
    if (!context.success) {
      return context;
    }

    const {
      player,
      aircraftDefinition,
      purchasePrice,
      currentCapital,
      maxPurchasable
    } = context;

    if (!Number.isInteger(quantity) || quantity < 1) {
      return {
        success: false,
        code: 'INVALID_QUANTITY',
        message: 'Quantity must be an integer greater than or equal to 1.',
        maxPurchasable
      };
    }

    const totalCost = purchasePrice * quantity;

    if (currentCapital < totalCost) {
      return {
        success: false,
        code: 'INSUFFICIENT_CAPITAL',
        message: 'Player does not have enough capital for this purchase.',
        maxPurchasable
      };
    }

    const purchasedAircraftInstances = [];
    for (let index = 0; index < quantity; index += 1) {
      purchasedAircraftInstances.push(
        createOwnedAircraftInstance({
          ownerPlayerId: player.id,
          aircraftCatalogId: aircraftDefinition.aircraftCatalogId,
          acquisitionPrice: purchasePrice
        })
      );
    }

    player.capital = currentCapital - totalCost;
    ownedAircraft.push(...purchasedAircraftInstances);
    this.authoritativeState.ownedAircraft = ownedAircraft;

    this.broadcastState();

    const primaryAircraftInstance = purchasedAircraftInstances[0] || null;

    return {
      success: true,
      code: 'OK',
      playerId: player.id,
      aircraftInstanceId: primaryAircraftInstance ? primaryAircraftInstance.aircraftInstanceId : null,
      aircraftInstanceIds: purchasedAircraftInstances.map((instance) => instance.aircraftInstanceId),
      aircraftCatalogId: aircraftDefinition.aircraftCatalogId,
      quantityPurchased: quantity,
      unitPrice: purchasePrice,
      pricePaid: totalCost,
      remainingCapital: player.capital,
      maxPurchasable: Math.max(0, Math.floor(player.capital / purchasePrice))
    };
  }

  listAirportForSale(playerId, airportId, askingPrice) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const airports = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];
    const normalizedAirportId = String(airportId || '').trim();
    const player = players.find((candidate) => candidate.id === playerId);

    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const airportState = airports.find((candidate) => candidate.airportId === normalizedAirportId);
    const airportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(normalizedAirportId);
    if (!airportState || !airportDefinition) {
      return {
        success: false,
        code: 'AIRPORT_NOT_FOUND',
        message: 'Airport was not found.'
      };
    }

    if (airportState.ownerPlayerId !== player.id) {
      return {
        success: false,
        code: 'NOT_AIRPORT_OWNER',
        message: 'Player does not own this airport.'
      };
    }

    if (airportState.saleListing) {
      return {
        success: false,
        code: 'AIRPORT_ALREADY_LISTED',
        message: 'Airport is already listed for sale.'
      };
    }

    if (!Number.isFinite(askingPrice) || askingPrice <= 0) {
      return {
        success: false,
        code: 'INVALID_ASKING_PRICE',
        message: 'Asking price must be a finite positive number.'
      };
    }

    airportState.saleListing = {
      sellerPlayerId: player.id,
      askingPrice
    };

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      playerId: player.id,
      airportId: airportDefinition.id,
      saleListing: { ...airportState.saleListing }
    };
  }

  cancelAirportListing(playerId, airportId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const airports = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];
    const normalizedAirportId = String(airportId || '').trim();
    const player = players.find((candidate) => candidate.id === playerId);

    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const airportState = airports.find((candidate) => candidate.airportId === normalizedAirportId);
    const airportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(normalizedAirportId);
    if (!airportState || !airportDefinition) {
      return {
        success: false,
        code: 'AIRPORT_NOT_FOUND',
        message: 'Airport was not found.'
      };
    }

    if (airportState.ownerPlayerId !== player.id) {
      return {
        success: false,
        code: 'NOT_AIRPORT_OWNER',
        message: 'Player does not own this airport.'
      };
    }

    if (!airportState.saleListing) {
      return {
        success: false,
        code: 'AIRPORT_NOT_LISTED',
        message: 'Airport is not currently listed for sale.'
      };
    }

    if (airportState.saleListing.sellerPlayerId !== player.id) {
      return {
        success: false,
        code: 'LISTING_SELLER_MISMATCH',
        message: 'Airport listing does not belong to this player.'
      };
    }

    airportState.saleListing = null;

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      playerId: player.id,
      airportId: airportDefinition.id,
      saleListing: null
    };
  }

  getOwnedRoutesContainingAirport(playerId, airportId) {
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const normalizedPlayerId = String(playerId || '').trim();
    const normalizedAirportId = String(airportId || '').trim();

    if (!normalizedPlayerId || !normalizedAirportId) {
      return [];
    }

    return routes.filter((route) => {
      if (!route) {
        return false;
      }

      if (String(route.ownerPlayerId || '') !== normalizedPlayerId) {
        return false;
      }

      return (
        String(route.originAirportId || '') === normalizedAirportId ||
        String(route.destinationAirportId || '') === normalizedAirportId
      );
    });
  }

  removeRoutesWithAircraftCleanup(routesToRemove) {
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    const sourceRoutes = Array.isArray(routesToRemove) ? routesToRemove : [];
    const routeIdToAssignedAircraftIds = new Map();
    const routeIdsToRemove = [];
    const routeIdsToRemoveSet = new Set();
    const aircraftToUnassignById = new Map();

    for (const route of sourceRoutes) {
      if (!route || !route.routeId) {
        continue;
      }

      const normalizedRouteId = String(route.routeId || '').trim();
      if (!normalizedRouteId || routeIdsToRemoveSet.has(normalizedRouteId)) {
        continue;
      }

      const stateRoute = routes.find((candidate) => candidate && String(candidate.routeId) === normalizedRouteId);
      if (!stateRoute) {
        continue;
      }

      const assignedAircraftInstanceIds = Array.isArray(stateRoute.assignedAircraftInstanceIds)
        ? stateRoute.assignedAircraftInstanceIds
        : [];
      const normalizedAssignedAircraftIds = assignedAircraftInstanceIds
        .map((aircraftId) => String(aircraftId || '').trim())
        .filter((aircraftId) => aircraftId.length > 0);
      const listedAircraftIds = new Set(normalizedAssignedAircraftIds);

      for (const aircraftInstanceId of normalizedAssignedAircraftIds) {
        const aircraft = ownedAircraft.find(
          (candidate) => candidate && String(candidate.aircraftInstanceId) === aircraftInstanceId
        );
        if (!aircraft) {
          return {
            success: false,
            code: 'ASSIGNED_AIRCRAFT_NOT_FOUND',
            message: 'Route references an aircraft instance that does not exist.',
            aircraftInstanceId
          };
        }

        if (String(aircraft.assignedRouteId || '') !== String(stateRoute.routeId)) {
          return {
            success: false,
            code: 'ASSIGNMENT_MISMATCH',
            message: 'Route assignment state is inconsistent for one or more aircraft.',
            aircraftInstanceId
          };
        }

        aircraftToUnassignById.set(aircraftInstanceId, aircraft);
      }

      for (const aircraft of ownedAircraft) {
        if (!aircraft) {
          continue;
        }

        if (String(aircraft.assignedRouteId || '') !== String(stateRoute.routeId)) {
          continue;
        }

        const aircraftInstanceId = String(aircraft.aircraftInstanceId || '').trim();
        if (!listedAircraftIds.has(aircraftInstanceId)) {
          return {
            success: false,
            code: 'ASSIGNMENT_MISMATCH',
            message: 'Route assignment state is inconsistent for one or more aircraft.',
            aircraftInstanceId
          };
        }
      }

      routeIdsToRemoveSet.add(normalizedRouteId);
      routeIdsToRemove.push(normalizedRouteId);
      routeIdToAssignedAircraftIds.set(normalizedRouteId, normalizedAssignedAircraftIds);
    }

    aircraftToUnassignById.forEach((aircraft) => {
      aircraft.status = OWNED_AIRCRAFT_STATUS.AVAILABLE;
      aircraft.assignedRouteId = null;
    });

    this.authoritativeState.routes = routes.filter((route) => {
      if (!route || !route.routeId) {
        return true;
      }

      return !routeIdsToRemoveSet.has(String(route.routeId || '').trim());
    });

    return {
      success: true,
      removedRouteIds: routeIdsToRemove,
      routeIdToAssignedAircraftIds
    };
  }

  purchaseListedAirport(buyerPlayerId, airportId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const airports = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];
    const normalizedAirportId = String(airportId || '').trim();

    const buyer = players.find((candidate) => candidate.id === buyerPlayerId);
    if (!buyer) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const airportState = airports.find((candidate) => candidate.airportId === normalizedAirportId);
    const airportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(normalizedAirportId);
    if (!airportState || !airportDefinition) {
      return {
        success: false,
        code: 'AIRPORT_NOT_FOUND',
        message: 'Airport was not found.'
      };
    }

    const listing = airportState.saleListing;
    if (!listing || typeof listing !== 'object') {
      return {
        success: false,
        code: 'AIRPORT_NOT_LISTED',
        message: 'Airport is not currently listed for sale.'
      };
    }

    const seller = players.find((candidate) => candidate.id === listing.sellerPlayerId);
    if (!seller) {
      return {
        success: false,
        code: 'SELLER_NOT_FOUND',
        message: 'Listing seller was not found in authoritative game state.'
      };
    }

    if (seller.id === buyer.id) {
      return {
        success: false,
        code: 'CANNOT_BUY_OWN_LISTING',
        message: 'Player cannot buy their own listing.'
      };
    }

    const askingPrice = listing.askingPrice;
    const buyerCapital = Number.isFinite(buyer.capital) ? buyer.capital : 0;
    if (!Number.isFinite(askingPrice) || askingPrice <= 0 || buyerCapital < askingPrice) {
      return {
        success: false,
        code: 'INSUFFICIENT_CAPITAL',
        message: 'Player does not have enough capital for this purchase.'
      };
    }

    const sellerRoutesUsingAirport = this.getOwnedRoutesContainingAirport(seller.id, airportDefinition.id);
    const cleanupResult = this.removeRoutesWithAircraftCleanup(sellerRoutesUsingAirport);
    if (!cleanupResult.success) {
      return cleanupResult;
    }

    buyer.capital = buyerCapital - askingPrice;
    const sellerCapital = Number.isFinite(seller.capital) ? seller.capital : 0;
    seller.capital = sellerCapital + askingPrice;
    airportState.ownerPlayerId = buyer.id;
    airportState.saleListing = null;

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      buyerPlayerId: buyer.id,
      sellerPlayerId: seller.id,
      airportId: airportDefinition.id,
      pricePaid: askingPrice,
      buyerRemainingCapital: buyer.capital,
      sellerUpdatedCapital: seller.capital
    };
  }

  sellAirportToGame(playerId, airportId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const airports = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];
    const normalizedAirportId = String(airportId || '').trim();

    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const airportState = airports.find((candidate) => candidate.airportId === normalizedAirportId);
    const airportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(normalizedAirportId);
    if (!airportState || !airportDefinition) {
      return {
        success: false,
        code: 'AIRPORT_NOT_FOUND',
        message: 'Airport was not found.'
      };
    }

    if (airportState.ownerPlayerId !== player.id) {
      return {
        success: false,
        code: 'NOT_AIRPORT_OWNER',
        message: 'Player does not own this airport.'
      };
    }

    const basePrice = Number.isFinite(airportDefinition.basePrice) ? airportDefinition.basePrice : 0;
    const refundAmount = calculateAirportSellToGamePrice(basePrice);
    const currentCapital = Number.isFinite(player.capital) ? player.capital : 0;

    const playerRoutesUsingAirport = this.getOwnedRoutesContainingAirport(player.id, airportDefinition.id);
    const cleanupResult = this.removeRoutesWithAircraftCleanup(playerRoutesUsingAirport);
    if (!cleanupResult.success) {
      return cleanupResult;
    }

    player.capital = currentCapital + refundAmount;
    airportState.ownerPlayerId = null;
    airportState.saleListing = null;

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      playerId: player.id,
      airportId: airportDefinition.id,
      refundAmount,
      updatedCapital: player.capital
    };
  }

  createRoute(playerId, originAirportId, destinationAirportId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const airports = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const normalizedOriginAirportId = String(originAirportId || '').trim();
    const normalizedDestinationAirportId = String(destinationAirportId || '').trim();

    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const originAirportState = airports.find((candidate) => candidate.airportId === normalizedOriginAirportId);
    const destinationAirportState = airports.find((candidate) => candidate.airportId === normalizedDestinationAirportId);
    const originAirportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(normalizedOriginAirportId);
    const destinationAirportDefinition = AIRPORT_DEFINITIONS_BY_ID.get(normalizedDestinationAirportId);

    if (
      !originAirportState ||
      !destinationAirportState ||
      !originAirportDefinition ||
      !destinationAirportDefinition
    ) {
      return {
        success: false,
        code: 'AIRPORT_NOT_FOUND',
        message: 'Airport was not found.'
      };
    }

    if (normalizedOriginAirportId === normalizedDestinationAirportId) {
      return {
        success: false,
        code: 'SAME_AIRPORT',
        message: 'Origin and destination airports must be different.'
      };
    }

    if (originAirportState.ownerPlayerId !== player.id || destinationAirportState.ownerPlayerId !== player.id) {
      return {
        success: false,
        code: 'AIRPORT_NOT_OWNED',
        message: 'Player does not own both airports.'
      };
    }

    const routeKey = canonicalRouteKey(normalizedOriginAirportId, normalizedDestinationAirportId);
    const existingRoute = routes.find((route) => {
      return route && String(route.ownerPlayerId) === String(player.id) && route.routeKey === routeKey;
    });

    if (existingRoute) {
      return {
        success: false,
        code: 'ROUTE_ALREADY_EXISTS',
        message: 'Route already exists for this player.'
      };
    }

    const route = {
      routeId: `route-${randomUUID()}`,
      ownerPlayerId: player.id,
      originAirportId: originAirportDefinition.id,
      destinationAirportId: destinationAirportDefinition.id,
      routeKey,
      distanceKm: calculateRouteDistanceKm(originAirportDefinition, destinationAirportDefinition),
      assignedAircraftInstanceIds: []
    };

    this.authoritativeState.routes = routes;
    this.authoritativeState.routes.push(route);
    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      ...route,
      assignedAircraftInstanceIds: route.assignedAircraftInstanceIds.slice()
    };
  }

  removeRoute(playerId, routeId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const normalizedRouteId = String(routeId || '').trim();

    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const routeIndex = routes.findIndex((route) => route && route.routeId === normalizedRouteId);
    if (routeIndex < 0) {
      return {
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'Route was not found.'
      };
    }

    const route = routes[routeIndex];
    if (String(route.ownerPlayerId) !== String(player.id)) {
      return {
        success: false,
        code: 'NOT_ROUTE_OWNER',
        message: 'Player does not own this route.'
      };
    }

    const cleanupResult = this.removeRoutesWithAircraftCleanup([route]);
    if (!cleanupResult.success) {
      return cleanupResult;
    }

    const unassignedAircraftInstanceIds = cleanupResult.routeIdToAssignedAircraftIds.get(route.routeId) || [];
    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      routeId: route.routeId,
      ownerPlayerId: route.ownerPlayerId,
      unassignedAircraftInstanceIds
    };
  }

  assignAircraftToRoute(playerId, routeId, aircraftInstanceId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    const normalizedRouteId = String(routeId || '').trim();
    const normalizedAircraftInstanceId = String(aircraftInstanceId || '').trim();

    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const route = routes.find((candidate) => candidate && candidate.routeId === normalizedRouteId);
    if (!route) {
      return {
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'Route was not found.'
      };
    }

    const aircraft = ownedAircraft.find(
      (candidate) => candidate && candidate.aircraftInstanceId === normalizedAircraftInstanceId
    );
    if (!aircraft) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_FOUND',
        message: 'Aircraft instance was not found.'
      };
    }

    if (String(route.ownerPlayerId) !== String(player.id)) {
      return {
        success: false,
        code: 'NOT_ROUTE_OWNER',
        message: 'Player does not own this route.'
      };
    }

    if (String(aircraft.ownerPlayerId) !== String(player.id)) {
      return {
        success: false,
        code: 'NOT_AIRCRAFT_OWNER',
        message: 'Player does not own this aircraft.'
      };
    }

    if (aircraft.status !== OWNED_AIRCRAFT_STATUS.AVAILABLE) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_AVAILABLE',
        message: 'Aircraft is not available for assignment.'
      };
    }

    if (aircraft.assignedRouteId !== null) {
      return {
        success: false,
        code: 'AIRCRAFT_ALREADY_ASSIGNED',
        message: 'Aircraft is already assigned to a route.'
      };
    }

    const aircraftDefinition = AIRCRAFT_CATALOG_BY_ID[String(aircraft.aircraftCatalogId || '')];
    const aircraftRangeKm = aircraftDefinition ? aircraftDefinition.rangeKm : null;
    const routeDistanceKm = Number(route.distanceKm);
    if (
      !aircraftDefinition ||
      !Number.isFinite(aircraftRangeKm) ||
      !Number.isFinite(routeDistanceKm) ||
      aircraftRangeKm < routeDistanceKm
    ) {
      return {
        success: false,
        code: 'AIRCRAFT_RANGE_INSUFFICIENT',
        message: 'Aircraft range is insufficient for this route.'
      };
    }

    const assignedAircraftInstanceIds = Array.isArray(route.assignedAircraftInstanceIds)
      ? route.assignedAircraftInstanceIds
      : [];

    if (assignedAircraftInstanceIds.includes(aircraft.aircraftInstanceId)) {
      return {
        success: false,
        code: 'AIRCRAFT_ALREADY_ASSIGNED',
        message: 'Aircraft is already assigned to this route.'
      };
    }

    route.assignedAircraftInstanceIds = assignedAircraftInstanceIds;
    route.assignedAircraftInstanceIds.push(aircraft.aircraftInstanceId);
    aircraft.status = OWNED_AIRCRAFT_STATUS.ASSIGNED;
    aircraft.assignedRouteId = route.routeId;

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      routeId: route.routeId,
      aircraftInstanceId: aircraft.aircraftInstanceId,
      aircraftStatus: aircraft.status,
      assignedRouteId: aircraft.assignedRouteId,
      assignedAircraftInstanceIds: route.assignedAircraftInstanceIds.slice()
    };
  }

  unassignAircraftFromRoute(playerId, aircraftInstanceId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
    const normalizedAircraftInstanceId = String(aircraftInstanceId || '').trim();

    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) {
      return {
        success: false,
        code: 'PLAYER_NOT_FOUND',
        message: 'Player was not found in authoritative game state.'
      };
    }

    const aircraft = ownedAircraft.find(
      (candidate) => candidate && candidate.aircraftInstanceId === normalizedAircraftInstanceId
    );
    if (!aircraft) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_FOUND',
        message: 'Aircraft instance was not found.'
      };
    }

    if (String(aircraft.ownerPlayerId) !== String(player.id)) {
      return {
        success: false,
        code: 'NOT_AIRCRAFT_OWNER',
        message: 'Player does not own this aircraft.'
      };
    }

    const assignedRouteId = String(aircraft.assignedRouteId || '').trim();
    if (!assignedRouteId) {
      return {
        success: false,
        code: 'AIRCRAFT_NOT_ASSIGNED',
        message: 'Aircraft is not assigned to a route.'
      };
    }

    const route = routes.find((candidate) => candidate && candidate.routeId === assignedRouteId);
    if (!route) {
      return {
        success: false,
        code: 'ROUTE_NOT_FOUND',
        message: 'Assigned route was not found.'
      };
    }

    if (String(route.ownerPlayerId) !== String(player.id)) {
      return {
        success: false,
        code: 'NOT_ROUTE_OWNER',
        message: 'Player does not own the assigned route.'
      };
    }

    const assignedAircraftInstanceIds = Array.isArray(route.assignedAircraftInstanceIds)
      ? route.assignedAircraftInstanceIds
      : [];
    const assignmentIndex = assignedAircraftInstanceIds.findIndex((id) => id === aircraft.aircraftInstanceId);
    if (assignmentIndex < 0) {
      return {
        success: false,
        code: 'ASSIGNMENT_NOT_FOUND',
        message: 'Aircraft assignment was not found on the route.'
      };
    }

    assignedAircraftInstanceIds.splice(assignmentIndex, 1);
    route.assignedAircraftInstanceIds = assignedAircraftInstanceIds;
    aircraft.status = OWNED_AIRCRAFT_STATUS.AVAILABLE;
    aircraft.assignedRouteId = null;

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      routeId: route.routeId,
      aircraftInstanceId: aircraft.aircraftInstanceId,
      aircraftStatus: aircraft.status,
      assignedRouteId: aircraft.assignedRouteId,
      assignedAircraftInstanceIds: route.assignedAircraftInstanceIds.slice()
    };
  }

  createPublicAirportSnapshot() {
    const airportStates = Array.isArray(this.authoritativeState.airports) ? this.authoritativeState.airports : [];

    return airportStates.reduce((publicAirports, airportState) => {
      const definition = AIRPORT_DEFINITIONS_BY_ID.get(airportState.airportId);
      if (!definition) {
        console.warn(
          `Game ${this.id} has airport state for unknown airport ID: ${String(airportState.airportId)}`
        );
        return publicAirports;
      }

      publicAirports.push({
        id: definition.id,
        iata: definition.iata,
        name: definition.name,
        city: definition.city,
        country: definition.country,
        lat: definition.lat,
        lng: definition.lng,
        size: definition.size,
        basePrice: definition.basePrice,
        sellToGamePrice: calculateAirportSellToGamePrice(definition.basePrice),
        ownerPlayerId: airportState.ownerPlayerId ?? null,
        saleListing:
          airportState.saleListing && typeof airportState.saleListing === 'object'
            ? { ...airportState.saleListing }
            : null
      });

      return publicAirports;
    }, []);
  }

  createPublicPlayerSnapshot() {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];

    return players.map((player) => ({
      id: player.id,
      username: player.username,
      isBot: Boolean(player && player.isBot),
      score: player.score,
      capital: player.capital
    }));
  }

  createPublicOwnedAircraftSnapshot() {
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];

    return ownedAircraft.map((aircraft) => ({
      ...aircraft
    }));
  }

  createPublicRouteSnapshot() {
    const routes = Array.isArray(this.authoritativeState.routes) ? this.authoritativeState.routes : [];

    return routes.map((route) => {
      const assignedAircraftInstanceIds = Array.isArray(route.assignedAircraftInstanceIds)
        ? route.assignedAircraftInstanceIds.slice()
        : [];

      return {
        ...route,
        assignedAircraftInstanceIds,
        activeFlightsCount: assignedAircraftInstanceIds.length
      };
    });
  }

  createPublicAircraftCatalogSnapshot() {
    return AIRCRAFT_CATALOG.map((aircraft) => ({
      ...aircraft
    }));
  }

  getPublicState() {
    return {
      game: {
        ...this.authoritativeState,
        players: this.createPublicPlayerSnapshot(),
        airports: this.createPublicAirportSnapshot(),
        ownedAircraft: this.createPublicOwnedAircraftSnapshot(),
        routes: this.createPublicRouteSnapshot(),
        aircraftCatalog: this.createPublicAircraftCatalogSnapshot()
      }
    };
  }

  broadcastState() {
    this.manager.io.to(this.getRoomName()).emit('game:state', this.getPublicState());
  }

  broadcastStarted() {
    if (this.hasBroadcastStarted) {
      return;
    }

    this.hasBroadcastStarted = true;
    this.manager.io.to(this.getRoomName()).emit('game:started', this.getPublicState());
  }

  getRoomName() {
    return `game:${this.id}`;
  }

  handlePlayerDisconnect(playerId) {
    if (this.manager && this.manager.games && !this.manager.games.has(this.id)) {
      return;
    }

    const player = this.players.get(playerId);
    if (!player) {
      return;
    }

    player.connected = false;

    if (this.status === 'ended' && !player.isBot) {
      const sourcePlayers = Array.isArray(this.authoritativeState.players)
        ? this.authoritativeState.players
        : [];
      this.authoritativeState.players = sourcePlayers.filter((entry) => {
        return !!entry && String(entry.id) !== String(playerId);
      });
    }

    this.broadcastState();
  }

  dispose() {
    this.clearExpirationTimeout();
  }
}

module.exports = Game;
