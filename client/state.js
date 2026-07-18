(function bootstrapState(globalScope) {
  function mergeSection(currentValue, patchValue) {
    if (typeof patchValue === 'undefined') {
      return currentValue;
    }

    if (Array.isArray(patchValue)) {
      return patchValue.slice();
    }

    if (
      patchValue &&
      typeof patchValue === 'object' &&
      !Array.isArray(patchValue) &&
      currentValue &&
      typeof currentValue === 'object' &&
      !Array.isArray(currentValue)
    ) {
      return { ...currentValue, ...patchValue };
    }

    return patchValue;
  }

  function createGameState(initialState) {
    let state = {
      connection: { ...initialState.connection },
      session: { ...initialState.session },
      lobby: {
        ...initialState.lobby,
        players: Array.isArray(initialState.lobby.players) ? initialState.lobby.players.slice() : []
      },
      ui: { ...initialState.ui },
      game: {
        ...initialState.game,
        leaderboard: Array.isArray(initialState.game.leaderboard) ? initialState.game.leaderboard.slice() : []
      },
      waitingAnimation: { ...initialState.waitingAnimation }
    };

    const listeners = new Set();

    function getState() {
      return structuredClone(state);
    }

    function update(updater) {
      if (typeof updater !== 'function') {
        throw new Error('GameState.update expects an updater function.');
      }

      const patch = updater(state);
      if (!patch || typeof patch !== 'object') {
        return state;
      }

      state = {
        connection: mergeSection(state.connection, patch.connection),
        session: mergeSection(state.session, patch.session),
        lobby: mergeSection(state.lobby, patch.lobby),
        ui: mergeSection(state.ui, patch.ui),
        game: mergeSection(state.game, patch.game),
        waitingAnimation: mergeSection(state.waitingAnimation, patch.waitingAnimation)
      };

      listeners.forEach((listener) => listener(state));
      return state;
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new Error('GameState.subscribe expects a function listener.');
      }

      listeners.add(listener);
      return function unsubscribe() {
        listeners.delete(listener);
      };
    }

    return {
      getState,
      update,
      subscribe
    };
  }

  globalScope.createGameState = createGameState;
})(window);