const {
  FLIGHT_SCHEDULER_TICK_REAL_MS
} = require('./rules');

function createBoundedScheduler({
  onTick,
  tickRealMs = FLIGHT_SCHEDULER_TICK_REAL_MS,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
}) {
  let timeoutId = null;
  let running = false;

  function scheduleNextTick() {
    if (!running) {
      return;
    }

    timeoutId = setTimeoutImpl(() => {
      if (!running) {
        return;
      }

      try {
        onTick();
      } finally {
        scheduleNextTick();
      }
    }, tickRealMs);

    if (timeoutId && typeof timeoutId.unref === 'function') {
      timeoutId.unref();
    }
  }

  return {
    start() {
      if (running) {
        return false;
      }

      running = true;
      scheduleNextTick();
      return true;
    },

    stop() {
      if (!running && !timeoutId) {
        return false;
      }

      running = false;
      if (timeoutId) {
        clearTimeoutImpl(timeoutId);
        timeoutId = null;
      }

      return true;
    },

    isRunning() {
      return running;
    }
  };
}

module.exports = {
  createBoundedScheduler
};
