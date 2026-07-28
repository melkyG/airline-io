(function bootstrapRenderer(globalScope) {
  const WAITING_DOTS = ['', '.', '. .', '. . .'];
  const CAPITAL_FORMATTER = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  });

  function getConnectionPresentation(status) {
    if (status === 'connected') {
      return { text: 'Connected', className: 'connected' };
    }

    if (status === 'disconnected') {
      return { text: 'Disconnected', className: 'disconnected' };
    }

    return { text: 'Connecting...', className: 'connected' };
  }

  function createRenderer(documentRef) {
    const mapRenderer = globalScope.createMapRenderer(documentRef);
    let renderedResultsKey = null;
    let aircraftSelectHandler = null;
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
        name.textContent = player && player.displayName ? player.displayName : 'Unknown player';

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

      let buttonText = isJoined ? 'Leave' : 'Join';
      if (isPending) {
        buttonText = isJoined ? 'Leaving...' : 'Joining...';
      }

      elements.joinButton.disabled = !isConnected || isPending;
      elements.joinButton.textContent = buttonText;
      elements.joinButton.classList.toggle('leave-state', isJoined);
      elements.joinButton.classList.toggle('join-state', !isJoined);

      elements.usernameInput.disabled = isJoined || isPending;
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
        const username = player && player.username ? player.username : 'Unknown';
        const isLocalPlayer =
          !!player &&
          player.id != null &&
          localPlayerId != null &&
          String(player.id) === String(localPlayerId);
        const score = Number.isFinite(player && player.score) ? player.score : 0;

        item.textContent = isLocalPlayer ? `${username} (You) — ${score}` : `${username} — ${score}`;
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
      const winnerName = results && results.winner && results.winner.username ? results.winner.username : 'Unavailable';

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
        const username = entry && entry.username ? entry.username : 'Unknown';
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
      renderConnectionStatus(state);
      renderLobbyPreview(state);
      renderPlayerList(state);
      renderLobbyControls(state);
      renderCountdown(state);
      renderError(state);
      renderScreens(state);
      renderGameState(state);
      renderLocalCapitalHud(state);
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