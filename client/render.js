(function bootstrapRenderer(globalScope) {
  const WAITING_DOTS = ['', '.', '. .', '. . .'];
  const CAPITAL_FORMATTER = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  });
  const EVENT_LOG_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const EVENT_LOG_MAX_VISIBLE = 25;

  function getConnectionPresentation(status) {
    if (status === 'connected') {
      return { text: 'Connected', className: 'connected' };
    }

    if (status === 'disconnected') {
      return { text: 'Disconnected', className: 'disconnected' };
    }

    return { text: 'Connecting...', className: 'connected' };
  }
  
  function formatDisplayName(name, isBot) {
    const resolvedName = typeof name === 'string' && name.trim().length > 0 ? name : 'Unknown';
    return isBot ? `[Bot] ${resolvedName}` : resolvedName;
  }
  
  function getBotLookupByPlayerId(state) {
    const sourcePlayers = Array.isArray(state && state.game && state.game.players) ? state.game.players : [];
    return sourcePlayers.reduce((lookup, player) => {
      if (!player || player.id == null) {
        return lookup;
      }
  
      lookup.set(String(player.id), Boolean(player.isBot));
      return lookup;
    }, new Map());
  }

  function formatEventLogTimestamp(occurredAt) {
    if (!Number.isFinite(occurredAt)) {
      return '--:--:--';
    }

    return EVENT_LOG_TIME_FORMATTER.format(new Date(occurredAt));
  }

  function formatAssetIdForDisplay(assetId) {
    if (typeof assetId !== 'string') {
      return '';
    }

    const trimmedId = assetId.trim();
    if (!trimmedId) {
      return '';
    }

    const words = trimmedId
      .replace(/[_-]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((segment) => {
        if (/^\d+$/.test(segment)) {
          return segment;
        }

        const lower = segment.toLowerCase();
        return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
      });

    return words.join(' ');
  }

  function resolveAssetTransactionName(eventData) {
    if (eventData && typeof eventData.assetName === 'string' && eventData.assetName.trim().length > 0) {
      return eventData.assetName.trim();
    }

    if (eventData && typeof eventData.assetId === 'string' && eventData.assetId.trim().length > 0) {
      const fromAssetId = formatAssetIdForDisplay(eventData.assetId);
      if (fromAssetId) {
        return fromAssetId;
      }
    }

    return 'Asset';
  }

  function formatAssetTransactionLogEntry({
    action,
    assetType,
    assetName,
    quantity,
    totalAmount,
    counterpartyName
  }) {
    const normalizedQuantity = Number.isInteger(quantity) && quantity >= 1 ? quantity : 1;
    const normalizedAssetType = assetType === 'airport' ? 'airport' : (assetType === 'aircraft' ? 'aircraft' : 'asset');
    const resolvedAssetName =
      typeof assetName === 'string' && assetName.trim().length > 0 ? assetName.trim() : 'Asset';

    if (action === 'purchased-from-player') {
      const sellerName = typeof counterpartyName === 'string' && counterpartyName.trim().length > 0
        ? counterpartyName.trim()
        : 'another player';

      if (!Number.isFinite(totalAmount)) {
        return `Purchased ${resolvedAssetName} from ${sellerName}.`;
      }

      return `Purchased ${resolvedAssetName} from ${sellerName} for ${CAPITAL_FORMATTER.format(totalAmount)}.`;
    }

    if (action === 'sold-to-player') {
      const buyerName = typeof counterpartyName === 'string' && counterpartyName.trim().length > 0
        ? counterpartyName.trim()
        : 'another player';

      if (!Number.isFinite(totalAmount)) {
        return `You sold ${resolvedAssetName} to ${buyerName}.`;
      }

      return `You sold ${resolvedAssetName} to ${buyerName} for ${CAPITAL_FORMATTER.format(totalAmount)}.`;
    }

    const actionVerb = action === 'sold-to-game' ? 'sold' : 'purchased';

    const baseMessage = normalizedAssetType === 'airport'
      ? `You ${actionVerb} ${resolvedAssetName}`
      : `You ${actionVerb} ${normalizedQuantity} ${resolvedAssetName} ${normalizedAssetType}`;
    if (!Number.isFinite(totalAmount)) {
      return `${baseMessage}.`;
    }

    return `${baseMessage} for ${CAPITAL_FORMATTER.format(totalAmount)}.`;
  }

  function formatAssetListingLogEntry({ action, assetType, assetName, assetId, askingPrice }) {
    const resolvedAssetName =
      typeof assetName === 'string' && assetName.trim().length > 0
        ? assetName.trim()
        : resolveAssetTransactionName({ assetId });

    const normalizedAction = action === 'listed' ? 'listed' : 'listed';
    if (!Number.isFinite(askingPrice)) {
      const fallbackAssetType = assetType === 'airport' ? 'airport' : (assetType === 'aircraft' ? 'aircraft' : 'asset');
      return `You ${normalizedAction} ${resolvedAssetName} ${fallbackAssetType}.`;
    }

    return `You ${normalizedAction} ${resolvedAssetName} for ${CAPITAL_FORMATTER.format(askingPrice)}.`;
  }

  function formatEventLogEntry(eventPayload) {
    if (!eventPayload || typeof eventPayload !== 'object') {
      return 'Unknown event';
    }

    const eventType = typeof eventPayload.type === 'string' ? eventPayload.type : '';
    const eventData = eventPayload.data && typeof eventPayload.data === 'object' ? eventPayload.data : null;

    if (eventType === 'asset:transaction') {
      return formatAssetTransactionLogEntry({
        action: eventData && eventData.action,
        assetType: eventData && eventData.assetType,
        assetName: resolveAssetTransactionName(eventData),
        quantity: eventData && eventData.quantity,
        totalAmount: eventData && eventData.totalAmount,
        counterpartyName: eventData && eventData.counterpartyName
      });
    }

    if (eventType === 'asset:listing') {
      return formatAssetListingLogEntry({
        action: eventData && eventData.action,
        assetType: eventData && eventData.assetType,
        assetName: resolveAssetTransactionName(eventData),
        assetId: eventData && eventData.assetId,
        askingPrice: eventData && eventData.askingPrice
      });
    }

    if (eventData && typeof eventData.message === 'string' && eventData.message.trim().length > 0) {
      return eventData.message.trim();
    }

    return eventType || 'Game event';
  }

  function createRenderer(documentRef) {
    const mapRenderer = globalScope.createMapRenderer(documentRef);
    let renderedResultsKey = null;
    let aircraftSelectHandler = null;
    let eventLogExpanded = false;
    let lastRenderedState = null;
    let lastRenderedEventCount = 0;
    let previousEventLogExpanded = false;
    const scheduleAfterRender =
      typeof globalScope.requestAnimationFrame === 'function'
        ? globalScope.requestAnimationFrame.bind(globalScope)
        : (callback) => setTimeout(callback, 0);
    const elements = {
      mainContent: documentRef.querySelector('.main-content'),
      connectionStatus: documentRef.getElementById('connectionStatus'),
      lobbyPreview: documentRef.getElementById('lobbyPreview'),
      joinButton: documentRef.getElementById('joinButton'),
      usernameInput: documentRef.getElementById('usernameInput'),
      statusText: documentRef.getElementById('statusText'),
      statusDots: documentRef.getElementById('statusDots'),
      lobbyPlayerList: documentRef.getElementById('lobbyPlayerList'),
      statusMessage: documentRef.getElementById('statusMessage'),
      botFillButton: documentRef.getElementById('botFillButton'),
      lobbyScreen: documentRef.getElementById('lobbyScreen'),
      gameScreen: documentRef.getElementById('gameScreen'),
      gameStatus: documentRef.getElementById('gameStatus'),
      gameTimer: documentRef.getElementById('gameTimer'),
      leaderboard: documentRef.getElementById('leaderboard'),
      capitalHud: documentRef.getElementById('capitalHud'),
      resultsOverlay: documentRef.getElementById('resultsOverlay'),
      resultsWinner: documentRef.getElementById('resultsWinner'),
      resultsEndReason: documentRef.getElementById('resultsEndReason'),
      resultsStandingsHeader: documentRef.getElementById('resultsStandingsHeader'),
      resultsStandings: documentRef.getElementById('resultsStandings')
    };
    const capitalHudContentEl = documentRef.createElement('span');
    capitalHudContentEl.className = 'capital-hud-content';
    const capitalHudActionButtonEl = documentRef.createElement('button');
    capitalHudActionButtonEl.type = 'button';
    capitalHudActionButtonEl.className = 'capital-hud-action-button';
    capitalHudActionButtonEl.textContent = 'Shop';
    if (typeof capitalHudActionButtonEl.addEventListener === 'function') {
      capitalHudActionButtonEl.addEventListener('click', () => {  
        if (typeof aircraftSelectHandler === 'function') {
          aircraftSelectHandler();
        }
      });
    }

    if (elements.capitalHud) {
      elements.capitalHud.appendChild(capitalHudContentEl);
      elements.capitalHud.appendChild(capitalHudActionButtonEl);
    }

    const eventLogHudEl = documentRef.createElement('div');
    eventLogHudEl.className = 'event-log-hud hidden';

    const eventLogPanelEl = documentRef.createElement('div');
    eventLogPanelEl.className = 'event-log-panel hidden';

    const eventLogListEl = documentRef.createElement('ul');
    eventLogListEl.className = 'event-log-list';

    const eventLogToggleButtonEl = documentRef.createElement('button');
    eventLogToggleButtonEl.type = 'button';
    eventLogToggleButtonEl.className = 'event-log-toggle';
    eventLogToggleButtonEl.textContent = 'Event Log';
    if (typeof eventLogToggleButtonEl.setAttribute === 'function') {
      eventLogToggleButtonEl.setAttribute('aria-expanded', 'false');
    }

    if (typeof eventLogToggleButtonEl.addEventListener === 'function') {
      eventLogToggleButtonEl.addEventListener('click', () => {
        eventLogExpanded = !eventLogExpanded;
        if (lastRenderedState) {
          renderEventLogHud(lastRenderedState);
        }
      });
    }

    eventLogHudEl.appendChild(eventLogToggleButtonEl);
    eventLogPanelEl.appendChild(eventLogListEl);
    eventLogHudEl.appendChild(eventLogPanelEl);

    if (elements.gameScreen) {
      elements.gameScreen.appendChild(eventLogHudEl);
    }

    function renderConnectionStatus(state) {
      const presentation = getConnectionPresentation(state.connection.status);
      elements.connectionStatus.textContent = presentation.text;
      elements.connectionStatus.className = `status ${presentation.className}`;
    }

    function renderLobbyPreview(state) {
      const playerCount = Number.isFinite(state.lobby.playerCount) ? state.lobby.playerCount : 0;
      const maxPlayers = Number.isFinite(state.lobby.maxPlayers) ? state.lobby.maxPlayers : 5;
      elements.lobbyPreview.textContent = `${playerCount}/${maxPlayers} players`;
    }

    function renderPlayerList(state) {
      elements.lobbyPlayerList.innerHTML = '';

      if (!Array.isArray(state.lobby.players)) {
        return;
      }

      const fragment = documentRef.createDocumentFragment();

      state.lobby.players.forEach((player) => {
        const item = documentRef.createElement('li');
        const name = documentRef.createElement('span');
        name.className = 'lobby-player-name';
        name.textContent = formatDisplayName(player && player.displayName ? player.displayName : 'Unknown player', Boolean(player && player.isBot));

        const status = documentRef.createElement('span');
        status.className = 'lobby-player-status';
        status.textContent = player && player.connected ? '(connected)' : '(disconnected)';

        item.appendChild(name);
        item.appendChild(status);
        fragment.appendChild(item);
      });

      elements.lobbyPlayerList.appendChild(fragment);
    }

    function renderLobbyControls(state) {
      const isConnected = state.connection.status === 'connected';
      const isPending = state.session.joinPending;
      const isJoined = state.session.joined;
      const isBotFillPending = Boolean(state.session.botFillPending);
      const lobbyPlayers = Array.isArray(state.lobby.players) ? state.lobby.players : [];
      const localPlayer = lobbyPlayers.find((player) => {
        if (!player || player.id == null || state.session.playerId == null) {
          return false;
        }

        return String(player.id) === String(state.session.playerId);
      });
      const realPlayerCount = lobbyPlayers.filter((player) => player && !player.isBot).length;
      const isLobbyWaiting = state.lobby.status === 'waiting';
      const isLobbyFull =
        Number.isFinite(state.lobby.playerCount) &&
        Number.isFinite(state.lobby.maxPlayers) &&
        state.lobby.playerCount >= state.lobby.maxPlayers;
      const canRequestBotFill =
        isConnected &&
        isJoined &&
        !isPending &&
        !isBotFillPending &&
        !state.lobby.botFillInProgress &&
        isLobbyWaiting &&
        !isLobbyFull &&
        realPlayerCount > 0 &&
        !!localPlayer &&
        !localPlayer.isBot;

      let buttonText = isJoined ? 'Leave' : 'Join';
      if (isPending) {
        buttonText = isJoined ? 'Leaving...' : 'Joining...';
      }

      elements.joinButton.disabled = !isConnected || isPending;
      elements.joinButton.textContent = buttonText;
      elements.joinButton.classList.toggle('leave-state', isJoined);
      elements.joinButton.classList.toggle('join-state', !isJoined);

      elements.usernameInput.disabled = isJoined || isPending;

      if (elements.botFillButton) {
        elements.botFillButton.disabled = !canRequestBotFill;
        elements.botFillButton.textContent = isBotFillPending || state.lobby.botFillInProgress ? 'Filling...' : 'Bot Fill';
      }
    }

    function renderCountdown(state) {
      const isCountdown = state.lobby.status === 'countdown' && Number.isFinite(state.lobby.countdownSeconds);
      const step = Number.isFinite(state.waitingAnimation.step) ? state.waitingAnimation.step : 0;

      if (isCountdown) {
        elements.statusText.textContent = `Starting in ${state.lobby.countdownSeconds}`;
        elements.statusDots.textContent = WAITING_DOTS[step % WAITING_DOTS.length];
        return;
      }

      elements.statusText.textContent = 'Waiting for players';
      elements.statusDots.textContent = WAITING_DOTS[step % WAITING_DOTS.length];
    }

    function renderError(state) {
      elements.statusMessage.textContent = state.ui.errorMessage || '';
    }

    function renderScreens(state) {
      const showGameScreen = state.ui.screen === 'game';
      elements.mainContent.classList.toggle('game-active', showGameScreen);
      elements.lobbyScreen.classList.toggle('hidden', showGameScreen);
      elements.gameScreen.classList.toggle('hidden', !showGameScreen);
    }

    function renderGameState(state) {
      const gameId = state.game && state.game.id ? state.game.id : null;
      elements.gameStatus.textContent = gameId ? `Game ${gameId} is active` : 'Game has started.';
      elements.leaderboard.innerHTML = '';
      const localPlayerId = state && state.session ? state.session.playerId : null;

      const sourcePlayers = Array.isArray(state.game && state.game.players) ? state.game.players : [];
      const leaderboard = [...sourcePlayers].sort((left, right) => {
        const leftScore = Number.isFinite(left.score) ? left.score : 0;
        const rightScore = Number.isFinite(right.score) ? right.score : 0;
        return rightScore - leftScore;
      });

      const fragment = documentRef.createDocumentFragment();

      leaderboard.forEach((player) => {
        const item = documentRef.createElement('li');
        item.className = 'leaderboard-row';
        const username = formatDisplayName(player && player.username ? player.username : 'Unknown', Boolean(player && player.isBot));
        const isLocalPlayer =
          !!player &&
          player.id != null &&
          localPlayerId != null &&
          String(player.id) === String(localPlayerId);
        const score = Number.isFinite(player && player.score) ? player.score : 0;

        if (isLocalPlayer) {
          item.classList.add('leaderboard-row--local');
        }

        const content = documentRef.createElement('div');
        content.className = 'leaderboard-content';

        const playerName = documentRef.createElement('span');
        playerName.className = 'leaderboard-player';
        playerName.textContent = isLocalPlayer ? `${username} (You)` : username;

        const spacer = documentRef.createElement('span');
        spacer.className = 'leaderboard-spacer';
        if (typeof spacer.setAttribute === 'function') {
          spacer.setAttribute('aria-hidden', 'true');
        }

        const scoreValue = documentRef.createElement('span');
        scoreValue.className = 'leaderboard-score';
        scoreValue.textContent = String(score);

        content.appendChild(playerName);
        content.appendChild(spacer);
        content.appendChild(scoreValue);
        item.appendChild(content);
        fragment.appendChild(item);
      });

      elements.leaderboard.appendChild(fragment);
    }

    function renderLocalCapitalHud(state) {
      if (!elements.capitalHud) {
        return;
      }

      const isActiveGame =
        state &&
        state.ui &&
        state.ui.screen === 'game' &&
        state.game &&
        state.game.status === 'active';

      if (!isActiveGame) {
        capitalHudContentEl.textContent = '';
        elements.capitalHud.classList.add('hidden');
        return;
      }

      const localPlayerId = state && state.session ? state.session.playerId : null;
      const players = Array.isArray(state && state.game && state.game.players) ? state.game.players : [];
      const localPlayer = players.find((player) => player && String(player.id) === String(localPlayerId));
      const airports = Array.isArray(state && state.game && state.game.airports) ? state.game.airports : [];
      const ownedAircraft = Array.isArray(state && state.game && state.game.ownedAircraft) ? state.game.ownedAircraft : [];

      if (!localPlayer || !Number.isFinite(localPlayer.capital)) {
        capitalHudContentEl.textContent = '';
        elements.capitalHud.classList.add('hidden');
        return;
      }

      const ownedAirportCount = airports.reduce((count, airport) => {
        if (!airport || airport.ownerPlayerId == null || localPlayerId == null) {
          return count;
        }

        return String(airport.ownerPlayerId) === String(localPlayerId) ? count + 1 : count;
      }, 0);

      const ownedAircraftCount = ownedAircraft.reduce((count, aircraft) => {
        if (!aircraft || aircraft.ownerPlayerId == null || localPlayerId == null) {
          return count;
        }

        return String(aircraft.ownerPlayerId) === String(localPlayerId) ? count + 1 : count;
      }, 0);

      capitalHudContentEl.textContent =
        `Capital: ${CAPITAL_FORMATTER.format(localPlayer.capital)}\n` +
        `🏢: ${ownedAirportCount} | 🛫: ${ownedAircraftCount}`;
      elements.capitalHud.classList.remove('hidden');
    }

    function renderEventLogHud(state) {
      if (!elements.gameScreen) {
        return;
      }

      const isGameScreenVisible = state && state.ui && state.ui.screen === 'game';
      if (!isGameScreenVisible) {
        eventLogExpanded = false;
        previousEventLogExpanded = false;
        lastRenderedEventCount = 0;
        eventLogHudEl.classList.toggle('hidden', true);
        eventLogHudEl.classList.toggle('event-log-hud--expanded', false);
        eventLogPanelEl.classList.toggle('hidden', true);
        if (typeof eventLogToggleButtonEl.setAttribute === 'function') {
          eventLogToggleButtonEl.setAttribute('aria-expanded', 'false');
        }
        eventLogToggleButtonEl.textContent = 'Event Log';
        eventLogListEl.innerHTML = '';
        return;
      }

      eventLogHudEl.classList.toggle('hidden', false);

      const history =
        state && state.session && Array.isArray(state.session.gameEvents) ? state.session.gameEvents : [];
      const visibleHistory = history.slice(-EVENT_LOG_MAX_VISIBLE);
      const shouldScrollToLatest =
        eventLogExpanded &&
        (history.length > lastRenderedEventCount || (!previousEventLogExpanded && eventLogExpanded));

      if (eventLogExpanded) {
        eventLogPanelEl.classList.toggle('hidden', false);
      } else {
        eventLogPanelEl.classList.toggle('hidden', true);
      }
      eventLogHudEl.classList.toggle('event-log-hud--expanded', eventLogExpanded);

      if (typeof eventLogToggleButtonEl.setAttribute === 'function') {
        eventLogToggleButtonEl.setAttribute('aria-expanded', eventLogExpanded ? 'true' : 'false');
      }
      eventLogToggleButtonEl.textContent = 'Events';

      eventLogListEl.innerHTML = '';
      if (visibleHistory.length === 0) {
        const emptyItem = documentRef.createElement('li');
        emptyItem.className = 'event-log-item event-log-item--empty';
        emptyItem.textContent = 'No events yet.';
        eventLogListEl.appendChild(emptyItem);
        lastRenderedEventCount = history.length;
        previousEventLogExpanded = eventLogExpanded;
        return;
      }

      const eventFragment = documentRef.createDocumentFragment();
      visibleHistory.forEach((eventPayload) => {
        const item = documentRef.createElement('li');
        item.className = 'event-log-item';

        const timestamp = documentRef.createElement('span');
        timestamp.className = 'event-log-time';
        timestamp.textContent = formatEventLogTimestamp(eventPayload && eventPayload.occurredAt);

        const message = documentRef.createElement('span');
        message.className = 'event-log-message';
        message.textContent = formatEventLogEntry(eventPayload);

        item.appendChild(timestamp);
        item.appendChild(message);
        eventFragment.appendChild(item);
      });

      eventLogListEl.appendChild(eventFragment);

      if (shouldScrollToLatest) {
        scheduleAfterRender(() => {
          eventLogPanelEl.scrollTop = eventLogPanelEl.scrollHeight;
        });
      }

      lastRenderedEventCount = history.length;
      previousEventLogExpanded = eventLogExpanded;
    }

    function getResultsRenderKey(state) {
      const game = state.game || {};
      const gameId = game.id || 'unknown';
      const endedAt = Number.isFinite(game.endedAt) ? game.endedAt : 'na';
      const generatedAt = game.results && Number.isFinite(game.results.generatedAt) ? game.results.generatedAt : 'na';
      return `${gameId}:${endedAt}:${generatedAt}`;
    }

    function renderResultsOverlay(state) {
      if (!elements.resultsOverlay || !elements.gameScreen) {
        return;
      }

      const game = state.game || {};
      const shouldShow = state.ui.screen === 'game' && game.status === 'ended';

      elements.gameScreen.classList.toggle('results-overlay-active', shouldShow);
      elements.resultsOverlay.classList.toggle('hidden', !shouldShow);
      elements.resultsOverlay.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');

      if (!shouldShow) {
        renderedResultsKey = null;
        return;
      }

      const nextKey = getResultsRenderKey(state);
      if (nextKey === renderedResultsKey) {
        return;
      }

      const results = game.results && typeof game.results === 'object' ? game.results : null;
      const botLookupByPlayerId = getBotLookupByPlayerId(state);
      const winnerName = formatDisplayName(
        results && results.winner && results.winner.username ? results.winner.username : 'Unavailable',
        Boolean(results && results.winner && botLookupByPlayerId.get(String(results.winner.id)))
      );

      if (elements.resultsWinner) {
        elements.resultsWinner.innerHTML = '';
        const winnerLabel = documentRef.createElement('span');
        winnerLabel.textContent = 'Winner: ';
        const winnerNameElement = documentRef.createElement('strong');
        winnerNameElement.textContent = winnerName;
        elements.resultsWinner.appendChild(winnerLabel);
        elements.resultsWinner.appendChild(winnerNameElement);
      }

      if (!elements.resultsStandings) {
        renderedResultsKey = nextKey;
        return;
      }

      elements.resultsStandings.innerHTML = '';

      const standings = results && Array.isArray(results.standings) ? results.standings : [];
      if (standings.length === 0) {
        if (elements.resultsStandingsHeader) {
          elements.resultsStandingsHeader.classList.add('hidden');
        }

        const emptyItem = documentRef.createElement('li');
        emptyItem.textContent = 'Final standings unavailable.';
        elements.resultsStandings.appendChild(emptyItem);
        renderedResultsKey = nextKey;
        return;
      }

      if (elements.resultsStandingsHeader) {
        elements.resultsStandingsHeader.classList.remove('hidden');
      }

      const standingsFragment = documentRef.createDocumentFragment();
      standings.forEach((entry, index) => {
        const isBot = Boolean(entry && botLookupByPlayerId.get(String(entry.id)));
        const username = formatDisplayName(entry && entry.username ? entry.username : 'Unknown', isBot);
        const score = Number.isFinite(entry && entry.score) ? entry.score : 0;

        const item = documentRef.createElement('li');
        item.className = 'results-standing-row';

        const content = documentRef.createElement('div');
        content.className = 'results-standing-content';

        const playerName = documentRef.createElement('span');
        playerName.className = 'results-standing-player';
        playerName.textContent = username;

        const dots = documentRef.createElement('span');
        dots.className = 'results-standing-dots';
        dots.setAttribute('aria-hidden', 'true');

        const scoreValue = documentRef.createElement('span');
        scoreValue.className = 'results-standing-score';
        scoreValue.textContent = String(score);

        content.appendChild(playerName);
        content.appendChild(dots);
        content.appendChild(scoreValue);
        item.appendChild(content);
        standingsFragment.appendChild(item);
      });

      elements.resultsStandings.appendChild(standingsFragment);
      renderedResultsKey = nextKey;
    }

    function render(state) {
      lastRenderedState = state;
      renderConnectionStatus(state);
      renderLobbyPreview(state);
      renderPlayerList(state);
      renderLobbyControls(state);
      renderCountdown(state);
      renderError(state);
      renderScreens(state);
      renderGameState(state);
      renderLocalCapitalHud(state);
      renderEventLogHud(state);
      renderResultsOverlay(state);
      mapRenderer.render(state);
    }

    function setAirportSelectHandler(handler) {
      if (!mapRenderer || typeof mapRenderer.setAirportSelectHandler !== 'function') {
        return;
      }

      mapRenderer.setAirportSelectHandler(handler);
    }

    function setAircraftSelectHandler(handler) {
      aircraftSelectHandler = handler;
    }

    return {
      render,
      setAirportSelectHandler,
      setAircraftSelectHandler,
      renderConnectionStatus,
      renderLobbyPreview,
      renderPlayerList,
      renderLobbyControls,
      renderCountdown,
      renderError
    };
  }

  globalScope.createRenderer = createRenderer;
})(window);