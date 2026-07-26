const { AIRPORT_CATALOG } = require('./airports/catalog');
const { AIRCRAFT_CATALOG, AIRCRAFT_CATALOG_BY_ID } = require('./aircraft/catalog');
const { createOwnedAircraftInstance } = require('./aircraft/ownership');

const AIRPORT_DEFINITIONS_BY_ID = AIRPORT_CATALOG.reduce((lookup, airport) => {
  lookup.set(airport.id, airport);
  return lookup;
}, new Map());

class Game {
  constructor(initialState, manager) {
    this.id = initialState.id;
    this.status = initialState.status;
    this.players = new Map();
    this.createdAt = initialState.createdAt;
    this.authoritativeState = {
      ...initialState,
      status: initialState.status,
      ownedAircraft: Array.isArray(initialState.ownedAircraft) ? initialState.ownedAircraft : []
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

  purchaseAircraftFromGame(playerId, aircraftCatalogId) {
    const players = Array.isArray(this.authoritativeState.players) ? this.authoritativeState.players : [];
    const ownedAircraft = Array.isArray(this.authoritativeState.ownedAircraft)
      ? this.authoritativeState.ownedAircraft
      : [];
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
    if (currentCapital < purchasePrice) {
      return {
        success: false,
        code: 'INSUFFICIENT_CAPITAL',
        message: 'Player does not have enough capital for this purchase.'
      };
    }

    const ownedAircraftInstance = createOwnedAircraftInstance({
      ownerPlayerId: player.id,
      aircraftCatalogId: aircraftDefinition.aircraftCatalogId,
      acquisitionPrice: purchasePrice
    });

    player.capital = currentCapital - purchasePrice;
    ownedAircraft.push(ownedAircraftInstance);
    this.authoritativeState.ownedAircraft = ownedAircraft;

    this.broadcastState();

    return {
      success: true,
      code: 'OK',
      playerId: player.id,
      aircraftInstanceId: ownedAircraftInstance.aircraftInstanceId,
      aircraftCatalogId: aircraftDefinition.aircraftCatalogId,
      pricePaid: purchasePrice,
      remainingCapital: player.capital
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
    const refundAmount = Math.round(basePrice * 0.8);
    const currentCapital = Number.isFinite(player.capital) ? player.capital : 0;

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
    const player = this.players.get(playerId);
    if (!player) {
      return;
    }

    player.connected = false;
    this.broadcastState();
  }

  dispose() {
    this.clearExpirationTimeout();
  }
}

module.exports = Game;
