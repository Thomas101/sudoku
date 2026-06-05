// storage.js — localStorage persistence for the active game and lifetime stats.

const GAME_KEY = 'sudoku.game.v1';
const STATS_KEY = 'sudoku.stats.v1';
const SETTINGS_KEY = 'sudoku.settings.v1';

const DEFAULT_SETTINGS = {
  highlight: true,   // highlight matching numbers
  peers: true,       // highlight row/col/box of selection
  mistakes: true,    // mark wrong entries red
  autoNotes: true,   // auto-remove pencil marks when a number is placed
  limit: true,       // 3-strikes game over
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota / private mode */ }
}

// ---- active game ----
export function saveGame(state) { write(GAME_KEY, state); }
export function loadGame() { return read(GAME_KEY, null); }
export function clearGame() { try { localStorage.removeItem(GAME_KEY); } catch {} }

// ---- settings ----
export function loadSettings() { return { ...DEFAULT_SETTINGS, ...read(SETTINGS_KEY, {}) }; }
export function saveSettings(s) { write(SETTINGS_KEY, s); }

// ---- lifetime stats ----
function monthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function loadStats() {
  return read(STATS_KEY, { wins: 0, bestTimes: {}, monthScore: {}, totalScore: 0 });
}

export function recordWin(stats, { difficulty, seconds, score }) {
  const s = { ...stats, bestTimes: { ...stats.bestTimes }, monthScore: { ...stats.monthScore } };
  s.wins = (s.wins || 0) + 1;
  s.totalScore = (s.totalScore || 0) + score;
  const mk = monthKey();
  s.monthScore[mk] = (s.monthScore[mk] || 0) + score;
  const prev = s.bestTimes[difficulty];
  if (prev == null || seconds < prev) s.bestTimes[difficulty] = seconds;
  saveStats(s);
  return s;
}

export function addScore(stats, points) {
  const s = { ...stats, monthScore: { ...stats.monthScore } };
  const mk = monthKey();
  s.monthScore[mk] = (s.monthScore[mk] || 0) + points;
  s.totalScore = (s.totalScore || 0) + points;
  saveStats(s);
  return s;
}

export function currentMonthScore(stats) {
  return (stats.monthScore && stats.monthScore[monthKey()]) || 0;
}

export function bestTimeOverall(stats) {
  const vals = Object.values(stats.bestTimes || {});
  return vals.length ? Math.min(...vals) : null;
}

export function saveStats(s) { write(STATS_KEY, s); }
