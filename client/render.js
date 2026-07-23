(function bootstrapRenderer(globalScope) {
  const WAITING_DOTS = ['', '.', '. .', '. . .'];

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
      leaderboard: documentRef.getElementById('leaderboard')
    };

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
        item.textContent = `${player.displayName} ${player.connected ? '(connected)' : '(disconnected)'}`;
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

      if (isCountdown) {
        elements.statusText.textContent = `Starting in ${state.lobby.countdownSeconds}`;
        elements.statusDots.textContent = '';
        return;
      }

      const step = Number.isFinite(state.waitingAnimation.step) ? state.waitingAnimation.step : 0;
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
      if (elements.gameTimer) {
        elements.gameTimer.textContent = '00:00';
      }
      elements.leaderboard.innerHTML = '';

      const sourcePlayers = Array.isArray(state.game && state.game.players) ? state.game.players : [];
      const leaderboard = [...sourcePlayers].sort((left, right) => {
        const leftScore = Number.isFinite(left.score) ? left.score : 0;
        const rightScore = Number.isFinite(right.score) ? right.score : 0;
        return rightScore - leftScore;
      });

      const fragment = documentRef.createDocumentFragment();

      leaderboard.forEach((player) => {
        const item = documentRef.createElement('li');
        const username = player && player.username ? player.username : 'Unknown';
        const score = Number.isFinite(player && player.score) ? player.score : 0;
        item.textContent = `${username} — ${score}`;
        fragment.appendChild(item);
      });

      elements.leaderboard.appendChild(fragment);
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
      mapRenderer.render(state);
    }

    return {
      render,
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