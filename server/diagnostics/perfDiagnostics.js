'use strict';

const SAMPLE_INTERVAL_MS = 5000;
const ENABLE_PERF_DIAGNOSTICS = process.env.ENABLE_PERF_DIAGNOSTICS !== 'false';
const PERF_DIAGNOSTICS_VERBOSE = process.env.PERF_DIAGNOSTICS_VERBOSE === 'true';

function formatMemory(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 MB';
  }
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function formatPayload(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function formatCompactMoney(amount) {
  if (!Number.isFinite(amount)) {
    return '$?';
  }
  const abs = Math.abs(amount);
  if (abs >= 1e9) {
    return `$${(amount / 1e9).toFixed(1)}B`;
  }
  if (abs >= 1e6) {
    return `$${(amount / 1e6).toFixed(1)}M`;
  }
  if (abs >= 1e3) {
    return `$${(amount / 1e3).toFixed(1)}K`;
  }
  return `$${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`;
}

function formatCompactError(amount) {
  if (!Number.isFinite(amount) || Math.abs(amount) < 1e-6) {
    return '$0';
  }
  return formatCompactMoney(amount);
}

function formatReasonBreakdown(reasons, total) {
  if (!reasons || reasons.size === 0) {
    return 'none';
  }

  const entries = Array.from(reasons.entries())
    .sort((left, right) => right[1] - left[1]);

  return entries.map(([reason, count]) => {
    const percentage = total > 0 ? (count / total) * 100 : 0;
    return `${reason}=${count} ${percentage.toFixed(1)}%`;
  }).join(' ');
}

class PerfDiagnostics {
  constructor(manager, options = {}) {
    this.manager = manager;
    this.enabled = options.enabled !== undefined
      ? Boolean(options.enabled)
      : ENABLE_PERF_DIAGNOSTICS;
    this.verbose = options.verbose !== undefined
      ? Boolean(options.verbose)
      : PERF_DIAGNOSTICS_VERBOSE;
    this.sampleMs = Number.isFinite(options.sampleMs)
      ? Math.max(1000, options.sampleMs)
      : SAMPLE_INTERVAL_MS;
    this.intervalId = null;
    this.gameStats = new Map();
    this.maxPayloadBytes = 0;
    this.maxHeapUsed = 0;
    this.maxRss = 0;
    this.socketProbes = new WeakMap();
    this.instrumentedConns = new WeakSet();
    this.connFlushAt = new WeakMap();
  }

  isEnabled() {
    return this.enabled;
  }

  isVerbose() {
    return this.verbose;
  }

  start() {
    if (!this.enabled || this.intervalId) {
      return;
    }
    this.intervalId = setInterval(() => this.sample(), this.sampleMs);
    if (this.intervalId && typeof this.intervalId.unref === 'function') {
      this.intervalId.unref();
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  beginStateBroadcast(game, publicState, reason = 'OTHER') {
    if (!this.enabled || !game) {
      return;
    }

    const json = JSON.stringify(publicState);
    const payloadBytes = Buffer.byteLength(json, 'utf8');
    const nowMs = Date.now();

    if (payloadBytes > this.maxPayloadBytes) {
      this.maxPayloadBytes = payloadBytes;
    }

    let stats = this.gameStats.get(game.id);
    if (!stats) {
      stats = {
        broadcasts: 0,
        totalBytes: 0,
        lastBytes: 0,
        reasons: new Map(),
        burstCount: 0,
        sameActionBurstCount: 0,
        lastBroadcastMs: null,
        lastReason: null,
        latestPublicState: null,
        lastSampledPublicState: null,
        backpressure: {
          attemptedStateBroadcasts: 0,
          preEmitBlocked: 0,
          postEmitBlocked: 0,
          maxObservedWriteBuffer: 0,
          flushes: 0,
          drains: 0,
          totalDrainMs: 0,
          maxDrainMs: 0
        }
      };
      this.gameStats.set(game.id, stats);
    }

    if (!stats.backpressure) {
      stats.backpressure = {
        attemptedStateBroadcasts: 0,
        preEmitBlocked: 0,
        postEmitBlocked: 0,
        maxObservedWriteBuffer: 0,
        flushes: 0,
        drains: 0,
        totalDrainMs: 0,
        maxDrainMs: 0
      };
    }

    stats.broadcasts += 1;
    stats.totalBytes += payloadBytes;
    stats.lastBytes = payloadBytes;
    stats.reasons.set(reason, (stats.reasons.get(reason) || 0) + 1);

    if (stats.lastBroadcastMs !== null) {
      const deltaMs = nowMs - stats.lastBroadcastMs;
      if (deltaMs < 10) {
        stats.burstCount += 1;
        if (deltaMs === 0 && reason === stats.lastReason) {
          stats.sameActionBurstCount += 1;
        }
      }
    }

    stats.lastBroadcastMs = nowMs;
    stats.lastReason = reason;
    stats.latestPublicState = publicState;

    this._samplePreEmitState(game, nowMs);
  }

  removeGame(gameId) {
    this.gameStats.delete(gameId);
  }

  _ensureConnListeners(conn) {
    if (!conn || this.instrumentedConns.has(conn)) {
      return;
    }
    this.instrumentedConns.add(conn);
    conn.on('flush', (writeBuffer) => this._onEngineFlush(conn, writeBuffer));
    conn.on('drain', () => this._onEngineDrain(conn));
  }

  _gameIdForConn(conn) {
    if (!conn || !this.manager || !this.manager.playerGameIds) {
      return null;
    }
    return this.manager.playerGameIds.get(conn.id) || null;
  }

  _onEngineFlush(conn, writeBuffer) {
    const gameId = this._gameIdForConn(conn);
    if (!gameId) {
      return;
    }
    const stats = this.gameStats.get(gameId);
    if (!stats || !stats.backpressure) {
      return;
    }
    const bp = stats.backpressure;
    bp.flushes += 1;
    if (Array.isArray(writeBuffer)) {
      if (writeBuffer.length > bp.maxObservedWriteBuffer) {
        bp.maxObservedWriteBuffer = writeBuffer.length;
      }
    }
    this.connFlushAt.set(conn, Date.now());
  }

  _onEngineDrain(conn) {
    const flushAt = this.connFlushAt.get(conn);
    const gameId = this._gameIdForConn(conn);
    if (!gameId) {
      return;
    }
    const stats = this.gameStats.get(gameId);
    if (!stats || !stats.backpressure) {
      return;
    }
    const bp = stats.backpressure;
    bp.drains += 1;
    if (flushAt) {
      const ms = Date.now() - flushAt;
      bp.totalDrainMs += ms;
      if (ms > bp.maxDrainMs) {
        bp.maxDrainMs = ms;
      }
    }
  }

  _samplePreEmitState(game, nowMs) {
    if (!this.manager || !this.manager.io || !this.manager.io.sockets || !game) {
      return;
    }
    const adapter = this.manager.io.sockets.adapter;
    const rooms = adapter ? adapter.rooms : null;
    const room = rooms ? rooms.get(game.getRoomName()) : null;
    if (!room || room.size === 0) {
      return;
    }

    const socketsMap = this.manager.io.sockets.sockets;
    const stats = this.gameStats.get(game.id);
    if (!stats || !stats.backpressure) {
      return;
    }
    const bp = stats.backpressure;
    bp.attemptedStateBroadcasts += room.size;

    for (const socketId of room) {
      const socket = socketsMap.get(socketId);
      if (!socket) {
        continue;
      }
      const conn = socket.conn;
      const transport = conn ? conn.transport : null;
      const writable = !!(transport && transport.writable);
      const writeBufferLen = (conn && Array.isArray(conn.writeBuffer))
        ? conn.writeBuffer.length
        : 0;

      this._ensureConnListeners(conn);

      this.socketProbes.set(socket, {
        preWritable: writable,
        preWriteBuffer: writeBufferLen
      });

      if (!writable || writeBufferLen > 0) {
        bp.preEmitBlocked += 1;
      }
      if (writeBufferLen > bp.maxObservedWriteBuffer) {
        bp.maxObservedWriteBuffer = writeBufferLen;
      }
    }
  }

  endStateBroadcast(game) {
    if (!this.enabled || !game) {
      return;
    }
    this._samplePostEmitState(game);
  }

  _samplePostEmitState(game) {
    if (!this.manager || !this.manager.io || !this.manager.io.sockets || !game) {
      return;
    }
    const adapter = this.manager.io.sockets.adapter;
    const rooms = adapter ? adapter.rooms : null;
    const room = rooms ? rooms.get(game.getRoomName()) : null;
    if (!room || room.size === 0) {
      return;
    }

    const socketsMap = this.manager.io.sockets.sockets;
    const stats = this.gameStats.get(game.id);
    if (!stats || !stats.backpressure) {
      return;
    }
    const bp = stats.backpressure;

    for (const socketId of room) {
      const socket = socketsMap.get(socketId);
      if (!socket) {
        continue;
      }
      const conn = socket.conn;
      const transport = conn ? conn.transport : null;
      const postWritable = !!(transport && transport.writable);
      const postWriteBuffer = (conn && Array.isArray(conn.writeBuffer))
        ? conn.writeBuffer.length
        : 0;

      if (!postWritable) {
        bp.postEmitBlocked += 1;
      }
      if (postWriteBuffer > bp.maxObservedWriteBuffer) {
        bp.maxObservedWriteBuffer = postWriteBuffer;
      }

      this.socketProbes.delete(socket);
    }
  }

  getSocketCountForGame(game) {
    const rooms = this.manager && this.manager.io && this.manager.io.sockets
      ? this.manager.io.sockets.adapter && this.manager.io.sockets.adapter.rooms
      : null;
    const room = rooms ? rooms.get(game.getRoomName()) : null;
    return room ? room.size : 0;
  }

  sample() {
    const mem = process.memoryUsage();
    const { rss, heapTotal, heapUsed, external, arrayBuffers } = mem;

    if (heapUsed > this.maxHeapUsed) {
      this.maxHeapUsed = heapUsed;
    }
    if (rss > this.maxRss) {
      this.maxRss = rss;
    }

    const gameCount = this.manager && this.manager.games
      ? this.manager.games.size
      : 0;
    const intervalSec = this.sampleMs / 1000;

    const lines = [];
    lines.push(
      `[PERF] heap ${formatMemory(heapUsed)}/${formatMemory(heapTotal)} MB ` +
      `| rss ${formatMemory(rss)} MB ` +
      `| ext ${formatMemory(external)} MB ` +
      `| arrBuf ${formatMemory(arrayBuffers)} MB ` +
      `| games ${gameCount} ` +
      `| maxPayload ${formatPayload(this.maxPayloadBytes)} ` +
      `| maxHeap ${formatMemory(this.maxHeapUsed)} ` +
      `| maxRss ${formatMemory(this.maxRss)}`
    );

    if (this.manager && this.manager.games) {
      for (const game of this.manager.games.values()) {
        const stats = this.gameStats.get(game.id);
        const broadcasts = stats ? stats.broadcasts : 0;
        const totalBytes = stats ? stats.totalBytes : 0;
        const lastBytes = stats ? stats.lastBytes : 0;
        const burstCount = stats ? stats.burstCount : 0;
        const sameActionBurstCount = stats ? stats.sameActionBurstCount : 0;
        const reasons = stats ? new Map(stats.reasons) : new Map();
        const reasonsStr = formatReasonBreakdown(reasons, broadcasts);

        const players = game.authoritativeState && Array.isArray(game.authoritativeState.players)
          ? game.authoritativeState.players.length
          : 0;
        const aircraft = game.authoritativeState && Array.isArray(game.authoritativeState.ownedAircraft)
          ? game.authoritativeState.ownedAircraft.length
          : 0;
        const routes = game.authoritativeState && Array.isArray(game.authoritativeState.routes)
          ? game.authoritativeState.routes.length
          : 0;
        const flights = game.authoritativeState && Array.isArray(game.authoritativeState.flights)
          ? game.authoritativeState.flights.length
          : 0;
        const airports = game.authoritativeState && Array.isArray(game.authoritativeState.airports)
          ? game.authoritativeState.airports.length
          : 0;

        const sockets = this.getSocketCountForGame(game);
        const broadcastsPerSec = broadcasts / intervalSec;
        const avgBytes = broadcasts > 0 ? totalBytes / broadcasts : 0;
        const perSocketBps = avgBytes * broadcastsPerSec;
        const roomBps = perSocketBps * sockets;
        const bp = stats ? stats.backpressure : null;
        const bpAttempts = bp ? bp.attemptedStateBroadcasts : 0;
        const bpPreBlocked = bp ? bp.preEmitBlocked : 0;
        const bpPostBlocked = bp ? bp.postEmitBlocked : 0;
        const bpPrePercent = bpAttempts > 0 ? (bpPreBlocked / bpAttempts) * 100 : 0;
        const bpAvgDrainMs = bp && bp.drains > 0 ? bp.totalDrainMs / bp.drains : 0;

        const economySnapshot = game.getEconomyDiagnosticsSnapshot();
        const revenueEvents = economySnapshot.revenueEvents;
        const revenueCredited = economySnapshot.revenueCredited;
        const transitionsProcessed = economySnapshot.transitionsProcessed;
        const totalTransitionLagMs = economySnapshot.totalTransitionLagMs;
        const maxTransitionLagMs = economySnapshot.maxTransitionLagMs;
        const avgLagSimMs = transitionsProcessed > 0
          ? Math.round(totalTransitionLagMs / transitionsProcessed)
          : 0;
        const maxLagSimMs = maxTransitionLagMs;
        const simulationSpeedMultiplier =
          Number.isFinite(game.authoritativeState.simulationSpeedMultiplier) &&
          game.authoritativeState.simulationSpeedMultiplier > 0
            ? game.authoritativeState.simulationSpeedMultiplier
            : 1;
        const avgLagRealMs = transitionsProcessed > 0
          ? Math.round(avgLagSimMs / simulationSpeedMultiplier)
          : 0;
        const maxLagRealMs = transitionsProcessed > 0
          ? Math.round(maxLagSimMs / simulationSpeedMultiplier)
          : 0;

        const dueBacklog = game.getDueFlightBacklog();
        const schedulerTicks = economySnapshot.schedulerTicks;
        const transitionCapHits = economySnapshot.transitionCapHits;
        const processingTimeCapHits = economySnapshot.processingTimeCapHits;
        const totalSchedulerWorkMs = economySnapshot.totalSchedulerWorkMs;
        const maxSchedulerWorkMs = economySnapshot.maxSchedulerWorkMs;
        const avgSchedulerWorkMs = schedulerTicks > 0
          ? Math.round(totalSchedulerWorkMs / schedulerTicks)
          : 0;

        const dueScanMs = economySnapshot.dueScanMs || 0;
        const applyTransitionMs = economySnapshot.applyTransitionMs || 0;
        const routeCleanupMs = economySnapshot.routeCleanupMs || 0;
        const airportCleanupMs = economySnapshot.airportCleanupMs || 0;
        const broadcastPrepMs = economySnapshot.broadcastPrepMs || 0;
        const fullFlightScans = economySnapshot.fullFlightScans || 0;
        const aircraftLinearLookups = economySnapshot.aircraftLinearLookups || 0;
        const routeLinearLookups = economySnapshot.routeLinearLookups || 0;
        const scheduleRebuilds = economySnapshot.scheduleRebuilds || 0;

        let maxAccountingErrorRaw = 0;
        let maxAccountingErrorAbs = 0;
        const authoritativePlayers = game.authoritativeState && Array.isArray(game.authoritativeState.players)
          ? game.authoritativeState.players
          : [];
        for (const player of authoritativePlayers) {
          if (!player || !player.id) {
            continue;
          }
          const expected = economySnapshot.expectedCapitalByPlayerId.get(player.id) || 0;
          const actual = Number.isFinite(player.capital) ? player.capital : 0;
          const raw = actual - expected;
          const abs = Math.abs(raw);
          if (abs > maxAccountingErrorAbs) {
            maxAccountingErrorAbs = abs;
            maxAccountingErrorRaw = raw;
          }
        }

        const revenueStr = formatCompactMoney(revenueCredited);
        const acctErrRawStr = formatCompactError(maxAccountingErrorRaw);
        const acctErrAbsStr = formatCompactError(maxAccountingErrorAbs);

        lines.push(
          `  game ${game.id}: players=${players} aircraft=${aircraft} ` +
          `routes=${routes} flights=${flights} airports=${airports} sockets=${sockets} ` +
          `| state ${broadcastsPerSec.toFixed(1)}/s ` +
          `| last=${formatPayload(lastBytes)} ` +
          `| avg=${formatPayload(avgBytes)} ` +
          `| max=${formatPayload(this.maxPayloadBytes)} ` +
          `| economy: revenueEvents=${revenueEvents} revenue=${revenueStr} acctErrRaw=${acctErrRawStr} acctErr=${acctErrAbsStr}` +
          ` | scheduler: transitions=${transitionsProcessed} avgLagReal=${avgLagRealMs}ms maxLagReal=${maxLagRealMs}ms dueBacklog=${dueBacklog} transCapHits=${transitionCapHits} timeCapHits=${processingTimeCapHits} ticks=${schedulerTicks} avgWork=${avgSchedulerWorkMs}ms maxWork=${maxSchedulerWorkMs}ms`
        );

        if (this.verbose) {
          lines.push(
            `  game ${game.id}: ` +
            `| outbound=${formatPayload(perSocketBps)}/s/socket ` +
            `| room=${formatPayload(roomBps)}/s | broadcasts=${broadcasts} ` +
            `| reasons: ${reasonsStr} ` +
            `| bursts=${burstCount} sameAction=${sameActionBurstCount} ` +
            `| backpressure: attempts=${bpAttempts} preBlocked=${bpPreBlocked} ${bpPrePercent.toFixed(0)}% ` +
            `postBlocked=${bpPostBlocked} maxWriteBuf=${bp ? bp.maxObservedWriteBuffer : 0} ` +
            `flushes=${bp ? bp.flushes : 0} drains=${bp ? bp.drains : 0} ` +
            `avgDrainMs=${bpAvgDrainMs.toFixed(2)} maxDrainMs=${bp ? bp.maxDrainMs : 0}` +
            ` | scheduler detail: avgLagSim=${avgLagSimMs}ms maxLagSim=${maxLagSimMs}ms ` +
            `schedCost: dueScan=${dueScanMs}ms transitions=${applyTransitionMs}ms routeCleanup=${routeCleanupMs}ms airportCleanup=${airportCleanupMs}ms broadcastPrep=${broadcastPrepMs}ms scans=${fullFlightScans} acLooks=${aircraftLinearLookups} rtLooks=${routeLinearLookups} rebuilds=${scheduleRebuilds}`
          );

          if (stats && stats.latestPublicState && stats.latestPublicState !== stats.lastSampledPublicState) {
            const comp = this._measurePayloadComposition(stats.latestPublicState);
            lines.push(`  game ${game.id}: payloadParts: ${comp.partsLine}`);
            lines.push(`  game ${game.id}: perRecord: ${comp.perRecordLine}`);
            stats.lastSampledPublicState = stats.latestPublicState;
          }
        }

        if (stats) {
          stats.broadcasts = 0;
          stats.totalBytes = 0;
          stats.lastBytes = 0;
          stats.burstCount = 0;
          stats.sameActionBurstCount = 0;
          stats.reasons.clear();
          if (stats.backpressure) {
            const bp = stats.backpressure;
            bp.attemptedStateBroadcasts = 0;
            bp.preEmitBlocked = 0;
            bp.postEmitBlocked = 0;
            bp.maxObservedWriteBuffer = 0;
            bp.flushes = 0;
            bp.drains = 0;
            bp.totalDrainMs = 0;
            bp.maxDrainMs = 0;
          }
          game.resetEconomyDiagnosticsCounters();
        }
      }
    }

    console.log(lines.join('\n'));
  }

  _measurePayloadComposition(publicState) {
    const game = publicState && publicState.game ? publicState.game : publicState;
    const keys = ['airports', 'players', 'ownedAircraft', 'routes', 'flights', 'aircraftCatalog'];
    const total = Buffer.byteLength(JSON.stringify(publicState), 'utf8');
    const gameTotal = Buffer.byteLength(JSON.stringify(game), 'utf8');

    const parts = [];
    const perRecordParts = [];
    let sumBytes = 0;

    for (const key of keys) {
      const section = game[key];
      if (section == null) {
        if (key === 'ownedAircraft') {
          parts.push('ownedAircraft=OMITTED');
          perRecordParts.push('ownedAircraft=OMITTED');
        }
        continue;
      }
      const sectionBytes = Buffer.byteLength(JSON.stringify(section), 'utf8');
      sumBytes += sectionBytes;
      const pct = total > 0 ? (sectionBytes / total) * 100 : 0;
      const count = Array.isArray(section) ? section.length : 1;
      const avg = count > 0 ? sectionBytes / count : 0;
      parts.push(`${key}=${formatPayload(sectionBytes)}(${pct.toFixed(1)}%)`);
      perRecordParts.push(`${key}=n=${count} total=${formatPayload(sectionBytes)} avg=${Math.round(avg)}B`);
    }

    const otherBytes = Math.max(0, gameTotal - sumBytes);
    const otherPct = total > 0 ? (otherBytes / total) * 100 : 0;
    parts.push(`other=${formatPayload(otherBytes)}(${otherPct.toFixed(1)}%)`);

    return {
      total,
      partsLine: `total=${formatPayload(total)} ` + parts.join(' '),
      perRecordLine: perRecordParts.join(' ')
    };
  }

  logSocketEvent(socket, event, extra = {}) {
    if (!this.enabled || !socket) {
      return;
    }
    const conn = socket.conn;
    const transport = conn ? conn.transport : null;
    const name = (transport && transport.name) || 'unknown';
    const writable = !!(transport && transport.writable);
    const writeBufferLen = (conn && Array.isArray(conn.writeBuffer)) ? conn.writeBuffer.length : 0;
    const connected = !!socket.connected;
    const upgrading = !!(conn && conn.upgrading);
    const reason = extra && extra.reason !== undefined ? extra.reason : '';
    const mem = process.memoryUsage();
    console.log(
      `[DIAG] socket event=${event} id=${socket.id} transport=${name} connected=${connected} ` +
      `upgrading=${upgrading} writable=${writable} writeBuf=${writeBufferLen} ` +
      `heap=${formatMemory(mem.heapUsed)} rss=${formatMemory(mem.rss)} ext=${formatMemory(mem.external)} arrBuf=${formatMemory(mem.arrayBuffers)} ` +
      `reason=${reason}`
    );
  }

  logGameDestroy(game, reason) {
    if (!this.enabled) {
      return;
    }
    const mem = process.memoryUsage();
    const stats = game ? this.gameStats.get(game.id) : null;
    const bp = stats && stats.backpressure ? stats.backpressure : null;
    const bpStr = bp
      ? `attempted=${bp.attemptedStateBroadcasts} preBlocked=${bp.preEmitBlocked} postBlocked=${bp.postEmitBlocked} ` +
        `maxWriteBuf=${bp.maxObservedWriteBuffer} flushes=${bp.flushes} drains=${bp.drains} ` +
        `maxDrainMs=${bp.maxDrainMs}`
      : 'n/a';
    console.log(
      `[DIAG] game destroyed id=${game ? game.id : 'unknown'} reason=${reason} ` +
      `heap=${formatMemory(mem.heapUsed)} rss=${formatMemory(mem.rss)} ext=${formatMemory(mem.external)} arrBuf=${formatMemory(mem.arrayBuffers)} ` +
      `backpressure=[${bpStr}]`
    );
  }
}

module.exports = PerfDiagnostics;
