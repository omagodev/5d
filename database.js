"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, "data", "starforge.sqlite");
const dataDirectory = path.dirname(databasePath);
fs.mkdirSync(dataDirectory, { recursive: true });

const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER,
    mode TEXT NOT NULL CHECK (mode IN ('solo', 'multiplayer')),
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    stage INTEGER NOT NULL DEFAULT 1,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    total_score INTEGER NOT NULL DEFAULT 0,
    player_count INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS match_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id TEXT,
    player_name TEXT NOT NULL,
    ship_id TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    stage INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_match_players_ranking
    ON match_players(score DESC, stage DESC);
  CREATE INDEX IF NOT EXISTS idx_matches_ended_at
    ON matches(ended_at DESC);
`);

const insertMatch = db.prepare(`
  INSERT INTO matches (
    room_id, mode, started_at, ended_at, stage,
    duration_seconds, total_score, player_count
  ) VALUES (
    @roomId, @mode, @startedAt, @endedAt, @stage,
    @durationSeconds, @totalScore, @playerCount
  )
`);

const insertPlayer = db.prepare(`
  INSERT INTO match_players (
    match_id, player_id, player_name, ship_id, score, kills, stage
  ) VALUES (
    @matchId, @playerId, @playerName, @shipId, @score, @kills, @stage
  )
`);

const insertCompleteMatch = db.transaction((match) => {
  const players = match.players;
  const totalScore = players.reduce((sum, player) => sum + player.score, 0);
  const matchResult = insertMatch.run({
    roomId: match.roomId ?? null,
    mode: match.mode,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    stage: match.stage,
    durationSeconds: match.durationSeconds,
    totalScore,
    playerCount: players.length,
  });
  const matchId = Number(matchResult.lastInsertRowid);

  for (const player of players) {
    insertPlayer.run({
      matchId,
      playerId: player.playerId == null ? null : String(player.playerId),
      playerName: player.name,
      shipId: player.shipId,
      score: player.score,
      kills: player.kills,
      stage: player.stage,
    });
  }
  return matchId;
});

function recordMatch(match) {
  if (!match.players?.length) throw new Error("Partida sem participantes");
  return insertCompleteMatch(match);
}

function getRanking(limit = 20) {
  return db.prepare(`
    SELECT
      mp.player_name AS n,
      mp.score AS s,
      mp.stage AS st,
      mp.ship_id AS sh,
      mp.kills AS kills,
      m.id AS matchId,
      m.mode AS mode,
      m.ended_at AS playedAt
    FROM match_players mp
    JOIN matches m ON m.id = mp.match_id
    ORDER BY mp.score DESC, mp.stage DESC, m.ended_at ASC
    LIMIT ?
  `).all(limit);
}

function getRecentMatches(limit = 10) {
  const matches = db.prepare(`
    SELECT
      id, room_id AS roomId, mode, started_at AS startedAt,
      ended_at AS endedAt, stage, duration_seconds AS durationSeconds,
      total_score AS totalScore, player_count AS playerCount
    FROM matches
    ORDER BY ended_at DESC
    LIMIT ?
  `).all(limit);
  const playersForMatch = db.prepare(`
    SELECT player_name AS name, ship_id AS shipId, score, kills, stage
    FROM match_players
    WHERE match_id = ?
    ORDER BY score DESC
  `);
  return matches.map((match) => ({
    ...match,
    players: playersForMatch.all(match.id),
  }));
}

function closeDatabase() {
  db.close();
}

module.exports = {
  databasePath,
  recordMatch,
  getRanking,
  getRecentMatches,
  closeDatabase,
};
