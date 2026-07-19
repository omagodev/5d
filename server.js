/**
 * STARFORGE: Eternal Assault — Multiplayer WebSocket Server
 *
 * Relay + authoritative enemy spawns for 2-player co-op.
 * Run: node server.js
 * Default port: 4050 (env PORT overrides)
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const {
  databasePath,
  recordMatch,
  getRanking,
  getRecentMatches,
  closeDatabase,
} = require("./database");

const PORT = parseInt(process.env.PORT, 10) || 4050;

const clampInteger = (value, min, max) =>
  Math.max(min, Math.min(max, Math.floor(Number(value) || 0)));
const cleanName = (value) =>
  String(value || "PILOTO")
    .replace(/[\u0000-\u001f<>]/g, "")
    .trim()
    .slice(0, 14)
    .toUpperCase() || "PILOTO";
const cleanShipId = (value) =>
  ["vanguarda", "colosso", "espectro", "tempestade"].includes(value)
    ? value
    : "vanguarda";

function normalizedResult(data = {}) {
  return {
    score: clampInteger(data.score, 0, 1_000_000_000),
    kills: clampInteger(data.kills, 0, 10_000_000),
    stage: clampInteger(data.stage || 1, 1, 1_000_000),
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function handleApi(req, res, urlPath) {
  if (req.method === "GET" && urlPath === "/api/ranking") {
    sendJson(res, 200, {
      ranking: getRanking(50),
      matches: getRecentMatches(10),
    });
    return true;
  }

  if (req.method === "POST" && urlPath === "/api/matches") {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 32_768) req.destroy();
    });
    req.on("end", () => {
      try {
        const body = JSON.parse(raw || "{}");
        const result = normalizedResult(body);
        const endedAt = new Date();
        const durationSeconds = clampInteger(body.durationSeconds, 0, 86_400);
        const matchId = recordMatch({
          roomId: null,
          mode: "solo",
          startedAt: new Date(endedAt.getTime() - durationSeconds * 1000).toISOString(),
          endedAt: endedAt.toISOString(),
          stage: result.stage,
          durationSeconds,
          players: [{
            playerId: null,
            name: cleanName(body.name),
            shipId: cleanShipId(body.shipId),
            ...result,
          }],
        });
        sendJson(res, 201, { ok: true, matchId });
      } catch (error) {
        console.error("[db] Falha ao registrar partida solo:", error.message);
        sendJson(res, 400, { ok: false, error: "Partida inválida" });
      }
    });
    return true;
  }

  return false;
}

/* ======================== STATIC FILE SERVER ======================== */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const httpServer = http.createServer((req, res) => {
  let urlPath = req.url.split("?")[0];
  if (handleApi(req, res, urlPath)) return;
  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.join(__dirname, urlPath);
  const ext = path.extname(filePath).toLowerCase();

  // Security: prevent path traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  });
});

/* ======================== WEBSOCKET SERVER ======================== */

const wss = new WebSocketServer({ server: httpServer });

/* ---- helpers ---- */
let nextRoomId = 1;
let nextPlayerId = 1;
let nextEnemyId = 1;

/** @type {Map<number, Room>} */
const rooms = new Map();

/** @type {Map<WebSocket, PlayerSession>} */
const sessions = new Map();

/** Waiting room (room with 1 player) */
let waitingRoom = null;

/* ---- data structures ---- */

class PlayerSession {
  constructor(ws, id) {
    this.ws = ws;
    this.id = id;
    /** @type {Room|null} */
    this.room = null;
    this.shipId = "vanguarda";
    this.name = "PILOTO";
    this.alive = true;
    this.lastState = null;
    this.score = 0;
    this.kills = 0;
    this.stage = 1;
  }
  send(msg) {
    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

class Room {
  constructor(id) {
    this.id = id;
    /** @type {PlayerSession[]} */
    this.players = [];
    this.stage = 1;
    this.stageKills = 0;
    this.targetKills = 12;
    this.bossActive = false;
    this.running = false;
    this.paused = false;
    this.spawnTimer = 0.35;
    this.stageClearTimer = 0;
    this.time = 0;
    this.enemies = new Map(); // id -> enemy state
    this.tickInterval = null;
    this.lastTick = Date.now();
    this.startedAt = new Date();
    this.recorded = false;
  }

  playersPayload() {
    return this.players.map((player) => ({
      id: player.id,
      name: player.name,
      shipId: player.shipId,
      alive: player.alive,
    }));
  }

  broadcast(msg, exclude = null) {
    const data = JSON.stringify(msg);
    for (const p of this.players) {
      if (p !== exclude && p.ws.readyState === 1) {
        p.ws.send(data);
      }
    }
  }

  addPlayer(session) {
    const slot = this.players.length; // 0 or 1
    this.players.push(session);
    session.room = this;
    session.send({
      type: "room:joined",
      roomId: this.id,
      playerId: session.id,
      slot,
      playerCount: this.players.length,
      players: this.playersPayload(),
    });
    this.broadcast({ type: "room:players", players: this.playersPayload() });
  }

  removePlayer(session) {
    this.players = this.players.filter((p) => p !== session);
    session.room = null;
    if (this.players.length === 0) {
      this.stop();
      rooms.delete(this.id);
    } else {
      this.broadcast({
        type: "player:left",
        playerId: session.id,
      });
      this.broadcast({ type: "room:players", players: this.playersPayload() });
      if (this.paused) {
        this.paused = false;
        this.lastTick = Date.now();
        this.broadcast({
          type: "game:pause",
          paused: false,
          by: "SISTEMA",
          playerId: 0,
        });
      }
      // If game was running and only 1 player left, they continue solo
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.recorded = false;
    this.startedAt = new Date();
    this.stage = 1;
    this.stageKills = 0;
    this.targetKills = 12;
    this.bossActive = false;
    this.spawnTimer = 0.35;
    this.stageClearTimer = 0;
    this.time = 0;
    this.enemies.clear();
    this.lastTick = Date.now();

    // Notify all players to start
    for (let i = 0; i < this.players.length; i++) {
      this.players[i].alive = true;
      this.players[i].score = 0;
      this.players[i].kills = 0;
      this.players[i].stage = 1;
      this.players[i].send({
        type: "game:start",
        slot: i,
        players: this.playersPayload(),
        stage: this.stage,
        seed: Math.floor(Math.random() * 999999),
      });
    }

    // Start server tick for enemy spawns
    this.tickInterval = setInterval(() => this.tick(), 50); // 20Hz
  }

  stop() {
    this.running = false;
    this.paused = false;
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  tick() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (!this.running) return;
    if (this.paused) return;

    this.time += dt;

    // Stage clear countdown
    if (this.stageClearTimer > 0) {
      this.stageClearTimer -= dt;
      if (this.stageClearTimer <= 0) {
        this.nextStage();
      }
      return;
    }

    // Boss stage: don't spawn normal enemies
    if (this.bossActive) return;
    if (this.stage % 5 === 0 && this.stageKills === 0) return;

    // Spawn enemies
    this.spawnTimer -= dt;
    const aliveCount = this.enemies.size;
    const cap = Math.min(22, 5 + Math.floor(this.stage * 0.65));

    if (
      this.spawnTimer <= 0 &&
      this.stageKills + aliveCount < this.targetKills &&
      aliveCount < cap
    ) {
      const s = this.stage;
      const pool = ["scout", "scout", "zigzag"];
      if (s >= 2) pool.push("shooter");
      if (s >= 3) pool.push("tank");
      if (s >= 4) pool.push("splitter");
      if (s >= 7) pool.push("charger");

      const willGroup = Math.random() < Math.min(0.42, s * 0.018);
      const groupSize = willGroup ? Math.floor(Math.random() * 3) + 2 : 1;

      for (let i = 0; i < groupSize; i++) {
        const type = pool[Math.floor(Math.random() * pool.length)];
        const id = nextEnemyId++;

        // Pick spawn position (top/sides, same logic as client)
        const side = Math.floor(Math.random() * 3);
        let x, y;
        // We use a reference area of 1920x1080 — clients will scale
        const refW = 1920,
          refH = 1080;
        const margin = 42;
        if (side === 0) {
          x = Math.random() * (refW - 2 * margin) + margin;
          y = margin;
        } else if (side === 1) {
          x = refW - margin;
          y =
            Math.random() * Math.max(margin + 1, refH * 0.68 - margin) + margin;
        } else {
          x = margin;
          y =
            Math.random() * Math.max(margin + 1, refH * 0.68 - margin) + margin;
        }

        const enemyData = { id, type, x, y, scale: 1 };
        this.enemies.set(id, enemyData);

        this.broadcast({
          type: "enemy:spawn",
          enemy: enemyData,
          stage: this.stage,
        });
      }

      this.spawnTimer =
        Math.max(0.12, 1.05 - this.stage * 0.022) *
        (0.72 + Math.random() * 0.48);
    }

    // Boss spawn at stage multiples of 5
    if (this.stage % 5 === 0 && this.stageKills === 0 && !this.bossActive) {
      this.bossActive = true;
      const bossId = nextEnemyId++;
      const kind = Math.floor(this.stage / 5) % 3;
      const bossData = {
        id: bossId,
        type: "boss",
        kind,
        x: 960,
        y: -110,
        scale: 1,
      };
      this.enemies.set(bossId, bossData);

      // Delay boss spawn slightly
      setTimeout(() => {
        this.broadcast({
          type: "enemy:spawn",
          enemy: bossData,
          stage: this.stage,
          isBoss: true,
        });
      }, 2400);
    }
  }

  onEnemyKilled(enemyId, killerPlayerId) {
    if (!this.enemies.has(enemyId)) return;
    const enemy = this.enemies.get(enemyId);
    this.enemies.delete(enemyId);

    if (enemy.type === "boss") {
      this.bossActive = false;
      this.broadcast({
        type: "enemy:killed",
        enemyId,
        killerPlayerId,
        isBoss: true,
      });
      // Boss killed triggers next stage after delay
      this.stageClearTimer = 2.0;
    } else {
      this.stageKills++;
      this.broadcast({
        type: "enemy:killed",
        enemyId,
        killerPlayerId,
        isBoss: false,
      });

      // Check stage clear
      if (this.stageKills >= this.targetKills && !this.stageClearTimer) {
        this.stageClearTimer = 2;
        // Kill remaining enemies
        for (const [id] of this.enemies) {
          this.broadcast({
            type: "enemy:killed",
            enemyId: id,
            killerPlayerId: 0,
            isBoss: false,
          });
        }
        this.enemies.clear();
        this.broadcast({ type: "stage:clear" });
      }
    }
  }

  nextStage() {
    this.stage++;
    this.stageKills = 0;
    this.targetKills = 12 + Math.floor(this.stage * 3.4);
    this.spawnTimer = 0.8;
    this.stageClearTimer = 0;
    this.bossActive = false;

    // Check if boss stage
    if (this.stage % 5 === 0) {
      this.bossActive = true;
      const bossId = nextEnemyId++;
      const kind = Math.floor(this.stage / 5) % 3;
      const bossData = {
        id: bossId,
        type: "boss",
        kind,
        x: 960,
        y: -110,
        scale: 1,
      };
      this.enemies.set(bossId, bossData);

      setTimeout(() => {
        if (this.running) {
          this.broadcast({
            type: "enemy:spawn",
            enemy: bossData,
            stage: this.stage,
            isBoss: true,
          });
        }
      }, 2400);
    }

    this.broadcast({
      type: "stage:next",
      stage: this.stage,
      targetKills: this.targetKills,
    });
  }

  checkGameOver() {
    const allDead = this.players.every((p) => !p.alive);
    if (allDead && !this.recorded) {
      const matchId = this.recordResult();
      this.broadcast({ type: "game:over", matchId });
      this.stop();
    }
  }

  recordResult() {
    if (this.recorded) return null;
    this.recorded = true;
    const endedAt = new Date();
    const stage = Math.max(this.stage, ...this.players.map((p) => p.stage));
    const matchId = recordMatch({
      roomId: this.id,
      mode: "multiplayer",
      startedAt: this.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      stage,
      durationSeconds: Math.max(0, Math.floor(this.time)),
      players: this.players.map((player) => ({
        playerId: player.id,
        name: player.name,
        shipId: player.shipId,
        score: player.score,
        kills: player.kills,
        stage: player.stage,
      })),
    });
    console.log(`[db] Partida multiplayer ${this.id} salva como #${matchId}`);
    return matchId;
  }
}

/* ======================== CONNECTION HANDLING ======================== */

wss.on("connection", (ws) => {
  const playerId = nextPlayerId++;
  const session = new PlayerSession(ws, playerId);
  sessions.set(ws, session);

  console.log(`[+] Player ${playerId} connected (total: ${sessions.size})`);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    handleMessage(session, msg);
  });

  ws.on("close", () => {
    console.log(`[-] Player ${playerId} disconnected`);
    if (session.room) {
      session.room.removePlayer(session);
      // If this was the waiting room, clear it
      if (waitingRoom && waitingRoom.players.length === 0) {
        waitingRoom = null;
      }
    }
    sessions.delete(ws);
  });

  ws.on("error", (err) => {
    console.error(`[!] Player ${playerId} error:`, err.message);
  });

  // Heartbeat
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });
});

// Heartbeat interval
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

wss.on("close", () => clearInterval(heartbeat));

/* ======================== MESSAGE HANDLING ======================== */

function handleMessage(session, msg) {
  switch (msg.type) {
    case "join": {
      // Player wants to join multiplayer
      session.shipId = cleanShipId(msg.shipId);
      session.name = cleanName(msg.name);

      if (waitingRoom && waitingRoom.players.length === 1) {
        // Join existing room
        const room = waitingRoom;
        waitingRoom = null;
        room.addPlayer(session);
        // Both players are ready — start the game
        room.broadcast({
          type: "room:full",
          playerCount: 2,
          players: room.playersPayload(),
        });
        setTimeout(() => room.start(), 1500);
      } else {
        // Create new room
        const room = new Room(nextRoomId++);
        rooms.set(room.id, room);
        room.addPlayer(session);
        waitingRoom = room;
        session.send({
          type: "room:waiting",
          roomId: room.id,
        });
      }
      break;
    }

    case "state": {
      // Player state update — relay to other player
      if (!session.room) return;
      session.lastState = msg.data;
      const result = normalizedResult(msg.data);
      session.score = result.score;
      session.kills = result.kills;
      session.stage = result.stage;
      session.room.broadcast(
        {
          type: "remote:state",
          playerId: session.id,
          data: msg.data,
        },
        session,
      );
      break;
    }

    case "fire": {
      // Player fired — relay
      if (!session.room) return;
      session.room.broadcast(
        {
          type: "remote:fire",
          playerId: session.id,
          data: msg.data,
        },
        session,
      );
      break;
    }

    case "special": {
      if (!session.room) return;
      session.room.broadcast(
        {
          type: "remote:special",
          playerId: session.id,
          data: msg.data,
        },
        session,
      );
      break;
    }

    case "enemy:damage": {
      // Client reports damage to an enemy
      if (!session.room) return;
      session.room.broadcast(
        {
          type: "enemy:damage",
          enemyId: msg.enemyId,
          amount: msg.amount,
          crit: msg.crit || false,
          playerId: session.id,
        },
        session,
      );
      break;
    }

    case "enemy:killed": {
      if (!session.room) return;
      session.room.onEnemyKilled(msg.enemyId, session.id);
      break;
    }

    case "player:died": {
      if (!session.room) return;
      Object.assign(session, normalizedResult(msg));
      session.alive = msg.livesLeft > 0;
      session.room.broadcast(
        {
          type: "remote:died",
          playerId: session.id,
          livesLeft: msg.livesLeft,
        },
        session,
      );
      if (!session.alive) {
        session.room.checkGameOver();
      }
      break;
    }

    case "player:gameover": {
      if (!session.room) return;
      Object.assign(session, normalizedResult(msg));
      session.alive = false;
      session.room.broadcast(
        {
          type: "remote:gameover",
          playerId: session.id,
        },
        session,
      );
      session.room.checkGameOver();
      break;
    }

    case "game:pause": {
      if (!session.room || !session.room.running) return;
      session.room.paused = Boolean(msg.paused);
      session.room.lastTick = Date.now();
      session.room.broadcast({
        type: "game:pause",
        paused: session.room.paused,
        by: session.name,
        playerId: session.id,
      });
      break;
    }

    case "leave": {
      if (session.room) {
        session.room.removePlayer(session);
        if (waitingRoom && waitingRoom.players.length === 0) {
          waitingRoom = null;
        }
      }
      break;
    }

    case "ship:selected": {
      session.shipId = cleanShipId(msg.shipId);
      if (session.room) {
        session.room.broadcast(
          {
            type: "remote:ship",
            playerId: session.id,
            shipId: session.shipId,
          },
          session,
        );
        session.room.broadcast({
          type: "room:players",
          players: session.room.playersPayload(),
        });
      }
      break;
    }
  }
}

/* ======================== START ======================== */

httpServer.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════════╗`);
  console.log(`  ║  STARFORGE: Eternal Assault — Server Online  ║`);
  console.log(`  ║  http://localhost:${PORT}                      ║`);
  console.log(`  ╚══════════════════════════════════════════════╝\n`);
  console.log(`  SQLite: ${databasePath}\n`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} recebido; encerrando conexões...`);

  for (const room of rooms.values()) room.stop();
  for (const client of wss.clients) client.close(1001, "Servidor reiniciando");

  httpServer.close(() => {
    closeDatabase();
    console.log("[server] Encerramento concluído.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("[server] Tempo limite de encerramento excedido.");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
