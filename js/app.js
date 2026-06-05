// app.js — UI, game flow, persistence glue and multiplayer.
import { generatePuzzle, solve, DIFFICULTIES, UNITS, ROW, COL, BOX } from './sudoku.js';
import * as store from './storage.js';
import { Peer } from './multiplayer.js';
import { renderQR, startScanner } from './qr.js';
import { haptic, setHaptics } from './haptics.js';
import * as sound from './sound.js';

// ---------------------------------------------------------------------------
// Difficulty presentation
// ---------------------------------------------------------------------------
// Bump on every deploy so it's easy to tell when GitHub Pages has served the
// new build (shown on the home screen).
const APP_VERSION = 'v1.1.1';

const DIFF_META = {
  easy:    { label: 'Easy',    dots: 1, base: 5 },
  medium:  { label: 'Medium',  dots: 2, base: 8 },
  hard:    { label: 'Hard',    dots: 3, base: 12 },
  expert:  { label: 'Expert',  dots: 4, base: 18 },
  master:  { label: 'Master',  dots: 5, base: 26 },
  extreme: { label: 'Extreme', dots: 6, base: 36 },
};
const dotsFor = d => '●'.repeat(DIFF_META[d].dots) + '○'.repeat(6 - DIFF_META[d].dots);
const MAX_MISTAKES = 3;
const MAX_HINTS = 3;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const show = el => el.classList.remove('hidden');
const hide = el => el.classList.add('hidden');

const screens = { home: $('#home'), game: $('#game') };
function goto(name) {
  Object.values(screens).forEach(hide);
  show(screens[name]);
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; show(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(t), 2200);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let settings = store.loadSettings();
let stats = store.loadStats();
let game = null;          // active game state
let net = null;           // { peer, mode, role, oppDone, oppName, oppSel }
let resumeMp = null;      // { mode, oppName } when a saved/dropped co-op game can be re-paired
let cells = [];           // 81 cell DOM nodes
let tick = null;          // timer interval

function blankNotes() { return Array.from({ length: 81 }, () => []); }

// ---------------------------------------------------------------------------
// Theme (light / dark / auto)
// ---------------------------------------------------------------------------
function isDarkActive(theme) {
  return theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
}
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme; // auto → follow the OS preference via CSS
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDarkActive(theme) ? '#0e0f12' : '#ffffff');
}

// ---------------------------------------------------------------------------
// Region-complete celebration (a row / column / box filled correctly)
// ---------------------------------------------------------------------------
let doneUnits = new Set();
const unitsOf = i => [ROW(i), 9 + COL(i), 18 + BOX(i)];
const unitComplete = u => UNITS[u].every(c => game.grid[c] !== 0 && game.grid[c] === game.solution[c]);

// Record already-complete units without animating (e.g. on resume).
function seedDoneUnits() {
  doneUnits = new Set();
  for (let u = 0; u < 27; u++) if (unitComplete(u)) doneUnits.add(u);
}

// After a correct placement at `i`, flash any unit it just completed.
function celebrateUnits(i) {
  if (isSolved()) return; // the win wave covers the final move
  const newly = [];
  for (const u of unitsOf(i)) {
    if (unitComplete(u)) { if (!doneUnits.has(u)) { doneUnits.add(u); newly.push(u); } }
    else doneUnits.delete(u);
  }
  if (!newly.length) return;
  newly.forEach(u => flashCells(UNITS[u], 'unit-done', 650));
  haptic('region');
}

// Stagger an animation class across a list of cells, then clean up.
function flashCells(indices, cls, base) {
  indices.forEach((idx, k) => {
    const c = cells[idx];
    c.style.setProperty('--wave', (k * 45) + 'ms');
    c.classList.remove(cls); void c.offsetWidth; // restart if mid-animation
    c.classList.add(cls);
    setTimeout(() => c.classList.remove(cls), base + k * 60);
  });
}

// Victory wave: pop every cell outward from the top-left corner.
function winWave() {
  for (let i = 0; i < 81; i++) {
    const order = ROW(i) + COL(i);
    cells[i].style.setProperty('--wave', (order * 55) + 'ms');
    cells[i].classList.remove('win-pop'); void cells[i].offsetWidth;
    cells[i].classList.add('win-pop');
    setTimeout(() => cells[i].classList.remove('win-pop'), 1600);
  }
  haptic('win');
}

// ---------------------------------------------------------------------------
// Board construction (once)
// ---------------------------------------------------------------------------
function buildBoard() {
  const board = $('#board');
  board.innerHTML = '';
  cells = [];
  for (let i = 0; i < 81; i++) {
    const c = document.createElement('div');
    c.className = 'cell';
    const r = (i / 9) | 0, col = i % 9;
    if (col === 2 || col === 5) c.classList.add('thickR');
    if (r === 2 || r === 5) c.classList.add('thickB');
    if (col === 8) c.classList.add('noR');
    if (r === 8) c.classList.add('noB');
    c.dataset.i = i;
    board.appendChild(c);
    cells.push(c);
  }
  board.addEventListener('click', e => {
    const cell = e.target.closest('.cell');
    if (cell) selectCell(+cell.dataset.i);
  });
}

// ---------------------------------------------------------------------------
// New game
// ---------------------------------------------------------------------------
async function newGame(difficulty) {
  resumeMp = null;
  show($('#loading'));
  // Yield so the overlay paints before the (sometimes ~200ms) generation.
  await new Promise(r => setTimeout(r, 30));
  const p = generatePuzzle(difficulty);
  startGame({
    puzzle: p.puzzle,
    solution: p.solution,
    grid: p.puzzle.slice(),
    notes: blankNotes(),
    difficulty,
    seed: p.seed,
    mistakes: 0,
    hints: MAX_HINTS,
    score: 0,
    elapsed: 0,
    selected: null,
    status: 'playing',
  });
  hide($('#loading'));
}

function startGame(state, fromNet = false) {
  game = state;
  game.given = game.puzzle.map(v => v !== 0);
  seedDoneUnits();
  goto('game');
  $('#difficultyLabel').textContent = DIFF_META[game.difficulty].label;
  $('#monthScore').textContent = store.currentMonthScore(stats).toLocaleString();
  updateMistakes();
  $('#hintCount').textContent = game.hints;
  setNotesMode(false);
  renderAll();
  startTimer();
  persist();
  // multiplayer banner
  if (net) updateCoopBanner();
  else if (resumeMp) showReconnectBanner();
  else hide($('#coopBanner'));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderCell(i) {
  const c = cells[i];
  const v = game.grid[i];
  c.className = 'cell';
  const r = (i / 9) | 0, col = i % 9;
  if (col === 2 || col === 5) c.classList.add('thickR');
  if (r === 2 || r === 5) c.classList.add('thickB');
  if (col === 8) c.classList.add('noR');
  if (r === 8) c.classList.add('noB');
  if (game.given[i]) c.classList.add('given');

  c.innerHTML = '';
  if (v !== 0) {
    c.textContent = v;
    if (settings.mistakes && !game.given[i] && v !== game.solution[i]) c.classList.add('conflict');
  } else if (game.notes[i].length) {
    const nd = document.createElement('div');
    nd.className = 'notes';
    for (let n = 1; n <= 9; n++) {
      const s = document.createElement('span');
      s.textContent = game.notes[i].includes(n) ? n : '';
      nd.appendChild(s);
    }
    c.appendChild(nd);
  }
}

function applyHighlights() {
  const sel = game.selected;
  const selVal = sel != null ? game.grid[sel] : 0;
  for (let i = 0; i < 81; i++) {
    const c = cells[i];
    c.classList.remove('selected', 'peer', 'same', 'bad', 'oppsel');

    // Tint the matching pencil mark (just the digit, not the cell) when a
    // cell holding that value is selected.
    const notesEl = c.querySelector('.notes');
    if (notesEl) {
      for (const s of notesEl.children) s.classList.remove('note-hl');
      if (settings.highlight && selVal !== 0 && game.notes[i].includes(selVal)) {
        notesEl.children[selVal - 1].classList.add('note-hl');
      }
    }

    if (sel == null) continue;
    if (i === sel) { c.classList.add('selected'); continue; }
    const sr = (sel / 9) | 0, scol = sel % 9, sb = ((sr / 3 | 0) * 3 + (scol / 3 | 0));
    const r = (i / 9) | 0, col = i % 9, b = ((r / 3 | 0) * 3 + (col / 3 | 0));
    if (settings.peers && (r === sr || col === scol || b === sb)) c.classList.add('peer');
    if (settings.highlight && selVal !== 0 && game.grid[i] === selVal) c.classList.add('same');
  }
  // Overlay the partner's selected cell (co-op) on top of our own highlights.
  if (net && net.oppSel != null && cells[net.oppSel]) cells[net.oppSel].classList.add('oppsel');
}

function renderAll() {
  for (let i = 0; i < 81; i++) renderCell(i);
  applyHighlights();
  updateNumpad();
  $('#score').textContent = game.score.toLocaleString();
}

function updateNumpad() {
  // grey out a digit once all nine are correctly placed
  const counts = new Array(10).fill(0);
  for (let i = 0; i < 81; i++) {
    if (game.grid[i] !== 0 && game.grid[i] === game.solution[i]) counts[game.grid[i]]++;
  }
  $$('#numpad button').forEach(b => {
    b.classList.toggle('done', counts[+b.dataset.n] === 9);
  });
}

function updateMistakes() {
  $('#mistakes').textContent = `${game.mistakes}/${MAX_MISTAKES}`;
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------
function selectCell(i) {
  if (game.status !== 'playing') return;
  game.selected = i;
  applyHighlights();
  // Mirror our selection to a co-op partner so they see what we're looking at.
  if (net && net.mode === 'coop') net.peer.send({ t: 'sel', i });
}

let undoStack = [];
function pushUndo(i) {
  // Note: mistakes are intentionally NOT snapshotted — undo never refunds a
  // strike (otherwise you could play forever). Score is restored so undoing a
  // correct placement also removes the points it earned.
  undoStack.push({ i, value: game.grid[i], notes: game.notes[i].slice(), score: game.score });
  if (undoStack.length > 200) undoStack.shift();
}

let notesMode = false;
function setNotesMode(on) {
  notesMode = on;
  const badge = $('#notesState');
  badge.textContent = on ? 'ON' : 'OFF';
  badge.classList.toggle('badge-off', !on);
  badge.classList.toggle('badge-on', on);
  $('#notesBtn').classList.toggle('active', on);
}

function inputNumber(n) {
  if (game.status !== 'playing') return;
  const i = game.selected;
  if (i == null || game.given[i]) return;

  if (notesMode) {
    if (game.grid[i] !== 0) return; // can't note a filled cell
    pushUndo(i);
    const idx = game.notes[i].indexOf(n);
    if (idx >= 0) game.notes[i].splice(idx, 1);
    else { game.notes[i].push(n); game.notes[i].sort(); }
    renderCell(i);
    afterMove(i, { notesOnly: true });
    return;
  }

  if (game.grid[i] === n) return; // no-op
  pushUndo(i);
  game.grid[i] = n;
  game.notes[i] = [];
  const correct = n === game.solution[i];
  if (!correct) registerMistake(i);
  else if (settings.autoNotes) clearPeerNotes(i, n);
  if (correct) game.score += DIFF_META[game.difficulty].base;

  renderCell(i);
  applyHighlights();
  updateNumpad();
  $('#score').textContent = game.score.toLocaleString();
  if (correct) celebrateUnits(i);
  afterMove(i, { value: n, correct });
}

// Remove pencil-mark `n` from every cell sharing this cell's row, column or box.
function clearPeerNotes(i, n) {
  const units = [UNITS[ROW(i)], UNITS[9 + COL(i)], UNITS[18 + BOX(i)]];
  const seen = new Set();
  for (const unit of units) {
    for (const j of unit) {
      if (j === i || seen.has(j)) continue;
      seen.add(j);
      const idx = game.notes[j].indexOf(n);
      if (idx >= 0) { game.notes[j].splice(idx, 1); renderCell(j); }
    }
  }
}

function registerMistake(i) {
  game.mistakes++;
  updateMistakes();
  haptic('error');
  if (settings.limit && game.mistakes >= MAX_MISTAKES && (!net || net.mode === 'coop')) {
    setTimeout(() => endGame(false), 250);
  } else if (settings.limit && game.mistakes >= MAX_MISTAKES && net && net.mode === 'vs') {
    net.peer.send({ t: 'lost' });
    setTimeout(() => endGame(false), 250);
  }
}

function erase() {
  if (game.status !== 'playing') return;
  const i = game.selected;
  if (i == null || game.given[i]) return;
  if (game.grid[i] === 0 && game.notes[i].length === 0) return;
  pushUndo(i);
  game.grid[i] = 0;
  game.notes[i] = [];
  renderCell(i);
  applyHighlights();
  updateNumpad();
  afterMove(i, { value: 0 });
}

function undo() {
  if (game.status !== 'playing' || !undoStack.length) return;
  const last = undoStack.pop();
  game.grid[last.i] = last.value;
  game.notes[last.i] = last.notes;
  game.score = last.score; // mistakes are permanent — not restored
  renderCell(last.i);
  applyHighlights();
  updateNumpad();
  $('#score').textContent = game.score.toLocaleString();
  persist();
  if (net) net.peer.send(netMoveMsg(last.i));
}

function useHint() {
  if (game.status !== 'playing' || game.hints <= 0) return;
  // Reveal the selected empty cell, or the first empty cell.
  let i = game.selected;
  if (i == null || game.grid[i] !== 0 || game.given[i]) {
    i = game.grid.findIndex((v, k) => v === 0 || (!game.given[k] && v !== game.solution[k]));
  }
  if (i < 0) return;
  pushUndo(i);
  game.grid[i] = game.solution[i];
  game.notes[i] = [];
  game.hints--;
  $('#hintCount').textContent = game.hints;
  renderCell(i);
  cells[i].classList.add('hintflash');
  selectCell(i);
  updateNumpad();
  celebrateUnits(i);
  afterMove(i, { value: game.solution[i], correct: true, hint: true });
}

// Runs after any board mutation: sync, persist, check win.
function afterMove(i, info) {
  persist();
  if (net) net.peer.send(netMoveMsg(i));
  if (net && net.mode === 'vs') sendProgress();
  if (isSolved()) endGame(true);
}

function isSolved() {
  for (let i = 0; i < 81; i++) if (game.grid[i] !== game.solution[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------
function fmt(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function startTimer() {
  stopTimer();
  $('#timer').textContent = fmt(game.elapsed);
  tick = setInterval(() => {
    if (game.status !== 'playing') return;
    game.elapsed++;
    $('#timer').textContent = fmt(game.elapsed);
    if (game.elapsed % 5 === 0) persist();
  }, 1000);
}
function stopTimer() { if (tick) clearInterval(tick); tick = null; }

function pauseGame() {
  if (game.status !== 'playing') return;
  game.status = 'paused';
  show($('#pauseOverlay'));
}
function resumeGame() {
  if (game.status !== 'paused') return;
  game.status = 'playing';
  hide($('#pauseOverlay'));
}

// ---------------------------------------------------------------------------
// End of game
// ---------------------------------------------------------------------------
function endGame(won) {
  if (game.status === 'won' || game.status === 'lost') return;
  game.status = won ? 'won' : 'lost';
  stopTimer();
  store.clearGame();

  let bonus = 0;
  if (won) {
    bonus = Math.max(20, DIFF_META[game.difficulty].base * 10 - game.elapsed) + (game.mistakes === 0 ? 100 : 0);
    game.score += bonus;
    stats = store.recordWin(stats, { difficulty: game.difficulty, seconds: game.elapsed, score: game.score });
  }

  const sheet = $('#endSheet');
  const vs = net && net.mode === 'vs';
  $('#endIcon').textContent = won ? (vs ? '🏆' : '🎉') : '💥';
  $('#endTitle').textContent = won
    ? (vs ? (net.oppDone ? 'Too slow!' : 'You win!') : 'Solved!')
    : 'Out of moves';
  $('#endSubtitle').textContent = won
    ? (vs
        ? (net.oppDone ? `${oppName()} finished first.` : `You beat ${oppName()}!`)
        : `${DIFF_META[game.difficulty].label} · clean run${game.mistakes === 0 ? ' with no mistakes!' : ''}`)
    : 'You hit 3 mistakes. Try again?';
  $('#endStats').innerHTML = won
    ? `<div><span class="v">${fmt(game.elapsed)}</span><span class="k">Time</span></div>
       <div><span class="v">${game.score.toLocaleString()}</span><span class="k">Score</span></div>
       <div><span class="v">${game.mistakes}</span><span class="k">Mistakes</span></div>`
    : '';

  if (vs && won && !net.oppDone) net.peer.send({ t: 'win', seconds: game.elapsed });
  updateHome();
  if (won) { winWave(); setTimeout(() => show(sheet), 750); }
  else { haptic('error'); show(sheet); }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function persist() {
  if (!game) return;
  if (game.status === 'won' || game.status === 'lost') return;
  store.saveGame({
    puzzle: game.puzzle, solution: game.solution, grid: game.grid, notes: game.notes,
    difficulty: game.difficulty, seed: game.seed, mistakes: game.mistakes,
    hints: game.hints, score: game.score, elapsed: game.elapsed, status: 'playing',
    // Remember the partner so a closed tab / dropped link can re-pair and resume.
    mp: net ? { mode: net.mode, oppName: net.oppName } : (resumeMp || null),
  });
}

function updateHome() {
  $('#homeMonth').textContent = store.currentMonthScore(stats).toLocaleString();
  $('#homeWins').textContent = (stats.wins || 0).toLocaleString();
  const best = store.bestTimeOverall(stats);
  $('#homeBest').textContent = best == null ? '—' : fmt(best);
  const saved = store.loadGame();
  const btn = $('#continueBtn');
  if (saved && saved.status === 'playing') {
    show(btn);
    const meta = `${DIFF_META[saved.difficulty].label} · ${fmt(saved.elapsed)}`;
    $('#continueMeta').textContent = saved.mp
      ? `${meta} · with ${saved.mp.oppName || 'partner'}`
      : meta;
  } else hide(btn);
}

// ---------------------------------------------------------------------------
// Multiplayer protocol
// ---------------------------------------------------------------------------
function netMoveMsg(i) {
  return { t: 'move', i, v: game.grid[i], n: game.notes[i], m: game.mistakes };
}
function applyRemoteMove(msg) {
  const i = msg.i;
  if (net.mode === 'coop') {
    if (game.given[i]) return;
    game.grid[i] = msg.v;
    game.notes[i] = msg.n || [];
    if (typeof msg.m === 'number' && msg.m > game.mistakes) { game.mistakes = msg.m; updateMistakes(); }
    cells[i].classList.add('remote');
    setTimeout(() => cells[i].classList.remove('remote'), 600);
    renderCell(i);
    applyHighlights();
    updateNumpad();
    if (game.grid[i] === game.solution[i]) celebrateUnits(i);
    if (isSolved()) endGame(true);
  }
}
function sendProgress() {
  const filled = game.grid.filter((v, k) => v !== 0 && v === game.solution[k]).length;
  net.peer.send({ t: 'prog', filled, mistakes: game.mistakes });
}
function showOpp(text) {
  const b = $('#coopBanner');
  show(b); b.textContent = text; b.classList.remove('reconnect');
}
const oppName = () => (net && net.oppName) || (resumeMp && resumeMp.oppName) || 'your partner';

// Refresh the in-game banner from current mode + opponent name.
function updateCoopBanner() {
  if (!net) return hide($('#coopBanner'));
  showOpp(net.mode === 'coop' ? `Co-op with ${oppName()}` : `Versus ${oppName()} — race on!`);
}

// Offer to re-pair after a closed tab or dropped link (the live P2P link can't
// survive on its own, but the board is saved so both can resync the same game).
function showReconnectBanner() {
  if (!resumeMp) return hide($('#coopBanner'));
  const b = $('#coopBanner');
  show(b); b.classList.add('reconnect');
  b.textContent = `↻ Tap to reconnect with ${resumeMp.oppName || 'your partner'}`;
}

function openReconnect() {
  if (!resumeMp || net) return;
  $('#mpName').value = store.loadName();
  const radio = $(`input[name=mpmode][value="${resumeMp.mode}"]`);
  if (radio) radio.checked = true;
  mpView('mpStart');
  mpStatus(`Reconnect with ${resumeMp.oppName || 'your partner'} — one of you taps “Host a game”, the other “Join a game”.`);
  show($('#mpSheet'));
}

function wireNet(peer, mode, role) {
  net = { peer, mode, role, oppDone: false, oppName: '', oppSel: null };
  // Greet with our name as soon as the channel is up (both sides).
  peer.on('open', () => peer.send({ t: 'hello', name: myName }));
  peer.on('message', msg => {
    if (msg.t === 'hello') {
      net.oppName = (msg.name || '').trim() || 'Player';
      if (game) updateCoopBanner();
    } else if (msg.t === 'init') {
      // guest receives the puzzle (or a resync) from host
      net.mode = msg.mode;
      if (msg.name) net.oppName = msg.name;
      if (msg.keep && game) {
        // Versus resume: keep our own restored board, just re-link.
        resumeMp = null;
        updateCoopBanner();
      } else {
        // Fresh game, or co-op resume where we adopt the host's current board.
        startGame({
          puzzle: msg.puzzle, solution: msg.solution,
          grid: msg.grid ? msg.grid.slice() : msg.puzzle.slice(),
          notes: msg.notes ? msg.notes.map(a => a.slice()) : blankNotes(),
          difficulty: msg.difficulty, seed: msg.seed,
          mistakes: msg.mistakes || 0, hints: msg.hints != null ? msg.hints : MAX_HINTS,
          score: msg.score || 0, elapsed: msg.elapsed || 0, selected: null, status: 'playing',
        }, true);
      }
      closeMpSheet();
      toast(`Connected with ${oppName()}!`);
    } else if (msg.t === 'move') {
      applyRemoteMove(msg);
    } else if (msg.t === 'sel') {
      net.oppSel = (typeof msg.i === 'number') ? msg.i : null;
      if (game) applyHighlights();
    } else if (msg.t === 'prog') {
      const pct = Math.round((msg.filled / 81) * 100);
      showOpp(`${oppName()}: ${pct}%${msg.mistakes ? ` · ${msg.mistakes} mistake${msg.mistakes > 1 ? 's' : ''}` : ''}`);
    } else if (msg.t === 'win') {
      net.oppDone = true;
      if (game && game.status === 'playing') { showOpp(`${oppName()} finished first!`); endGame(false); }
    } else if (msg.t === 'lost') {
      net.oppDone = true;
      if (game && game.status === 'playing') { showOpp(`${oppName()} busted — keep going!`); }
    }
  });
  peer.on('close', () => {
    if (!net) return; // we tore it down deliberately (leaving / new game)
    toast('Connection lost');
    if (game && game.status === 'playing') {
      // Keep the partner around so the player can re-pair and resume in sync.
      resumeMp = { mode: net.mode, oppName: net.oppName };
      net = null;
      persist();
      showReconnectBanner();
    } else {
      showOpp('Disconnected');
    }
  });
}

// ---------------------------------------------------------------------------
// Multiplayer UI flow
// ---------------------------------------------------------------------------
let pendingPeer = null;
let myName = store.loadName();
// Read the name field, fall back to a default, and persist it.
function commitName() {
  myName = ($('#mpName').value || '').trim() || 'Player';
  store.saveName(myName);
  return myName;
}
function mpView(name) {
  ['mpStart', 'mpHost', 'mpJoin'].forEach(v => hide($('#' + v)));
  show($('#' + name));
}
function mpStatus(text, cls = '') { const s = $('#mpStatus'); s.textContent = text; s.className = 'mp-status ' + cls; }
function closeMpSheet() { closeScanner(); stopSoundPairing(); hide($('#mpSheet')); }
// During a resume the mode is fixed to the saved game; otherwise read the radios.
const currentMode = () => (resumeMp ? resumeMp.mode : $('input[name=mpmode]:checked').value);

// ---- sound pairing helpers ----
// Each over-the-air payload is the minified offer/answer prefixed with a 1-byte
// tag, so a device ignores the echo of its own chirp.
const TAG_OFFER = 0x4f /* 'O' */, TAG_ANSWER = 0x41 /* 'A' */;
function tagged(tag, bytes) { const out = new Uint8Array(bytes.length + 1); out[0] = tag; out.set(bytes, 1); return out; }

// Drop a half-finished pairing attempt (e.g. switching QR ↔ sound) without its
// teardown tripping the "connection lost" handling — null `net` first so the
// discarded peer's close event is ignored.
function discardPending() {
  if (!pendingPeer) return;
  const p = pendingPeer;
  pendingPeer = null; net = null;
  try { p.close(); } catch {}
}

let soundStopListen = null;  // releases the mic
let soundChirping = false;   // gates the transmit loop
async function startSoundListen(onBytes) {
  try { soundStopListen = await sound.listen(onBytes); }
  catch { mpStatus('Microphone needed for sound pairing. Allow mic access and try again.', 'err'); }
}
async function startSoundChirp(msg, isDone) {
  if (soundChirping) return;
  soundChirping = true;
  while (soundChirping && !isDone()) {
    try { await sound.send(msg); } catch { break; }
    await new Promise(r => setTimeout(r, 700)); // brief gap so the partner can reply
  }
  soundChirping = false;
}
function stopSoundPairing() {
  soundChirping = false;
  sound.stopPlayback();
  if (soundStopListen) { try { soundStopListen(); } catch {} soundStopListen = null; }
}

// Build the host peer and the "what to do once connected" logic, independent of
// the signalling transport (QR or sound). Returns the wired Peer.
function prepareHostPeer() {
  discardPending();
  const mode = currentMode();
  const difficulty = $('#mpDifficulty').value;
  const resuming = !!(resumeMp && game);
  commitName();
  const peer = new Peer();
  pendingPeer = peer;
  wireNet(peer, mode, 'host');
  if (resuming && resumeMp.oppName) net.oppName = resumeMp.oppName;
  peer.on('open', async () => {
    mpStatus('Connected!', 'ok');
    if (resuming) {
      // Resume: keep our restored board and ship it so the partner resyncs.
      const msg = { t: 'init', mode, name: myName, puzzle: game.puzzle, solution: game.solution,
        difficulty: game.difficulty, seed: game.seed };
      if (mode === 'coop') Object.assign(msg, { grid: game.grid, notes: game.notes,
        elapsed: game.elapsed, mistakes: game.mistakes, score: game.score, hints: game.hints });
      else msg.keep = true; // versus: each side keeps its own board
      peer.send(msg);
      resumeMp = null;
      updateCoopBanner();
      persist();
      closeMpSheet();
      toast(`Reconnected with ${oppName()}!`);
      return;
    }
    // Host generates the puzzle and ships it (plus its name) to the guest.
    show($('#loading'));
    await new Promise(r => setTimeout(r, 30));
    const p = generatePuzzle(difficulty);
    hide($('#loading'));
    peer.send({ t: 'init', mode, name: myName, puzzle: p.puzzle, solution: p.solution, difficulty, seed: p.seed });
    startGame({
      puzzle: p.puzzle, solution: p.solution, grid: p.puzzle.slice(), notes: blankNotes(),
      difficulty, seed: p.seed, mistakes: 0, hints: MAX_HINTS, score: 0, elapsed: 0,
      selected: null, status: 'playing',
    }, true);
    closeMpSheet();
  });
  return peer;
}

async function mpHost() {
  const peer = prepareHostPeer();
  mpView('mpHost');
  mpStatus('Creating invite…');
  try {
    const code = await peer.createOffer();
    renderQR($('#mpHostQR'), code);
    mpStatus('Waiting for your partner to scan…');
  } catch (e) { mpStatus('Could not create invite: ' + e.message, 'err'); }
}

// Host over sound: chirp our offer on a loop while listening for the reply.
async function mpHostSound() {
  if (!sound.available()) return mpStatus('Sound pairing needs the ggwave library — see js/vendor/README.', 'err');
  const peer = prepareHostPeer();
  mpView('mpHost');
  mpStatus('🔊 Starting…');
  let offer;
  try { offer = await peer.createOfferBytes(); }
  catch (e) { return mpStatus('Could not start sound pairing: ' + e.message, 'err'); }
  let answered = false;
  await startSoundListen(async bytes => {
    if (answered || bytes[0] !== TAG_ANSWER) return; // ignore our own offer echo
    answered = true;
    try { await peer.acceptAnswerBytes(bytes.slice(1)); mpStatus('🔊 Got the reply — connecting…', 'ok'); }
    catch { answered = false; mpStatus('Reply was garbled — keep holding still…'); }
  });
  mpStatus('🔊 Hold your phones together…');
  startSoundChirp(tagged(TAG_OFFER, offer), () => answered);
}

// Host scans the guest's reply QR to complete the handshake.
async function mpConnectHost(code) {
  code = (code || '').trim();
  if (!code) return mpStatus('Couldn’t read that reply code.', 'err');
  try { await pendingPeer.acceptAnswer(code); mpStatus('Connecting…'); }
  catch (e) { mpStatus('That reply code didn’t scan cleanly — try again.', 'err'); }
}

function prepareGuestPeer() {
  discardPending();
  const mode = currentMode();
  commitName();
  const peer = new Peer();
  pendingPeer = peer;
  wireNet(peer, mode, 'guest');
  peer.on('open', () => mpStatus('Connected! Waiting for puzzle…', 'ok'));
  return peer;
}

function mpJoinStart() {
  prepareGuestPeer();
  mpView('mpJoin');
  hide($('#mpJoinReply'));
  mpStatus('Scan the invite to continue.');
}

// Join over sound: listen for the host's offer, then chirp our reply back.
async function mpJoinSound() {
  if (!sound.available()) return mpStatus('Sound pairing needs the ggwave library — see js/vendor/README.', 'err');
  const peer = prepareGuestPeer();
  mpView('mpJoin');
  hide($('#mpJoinReply'));
  mpStatus('🔊 Listening for an invite — hold your phones together…');
  let handled = false;
  await startSoundListen(async bytes => {
    if (handled || bytes[0] !== TAG_OFFER) return;
    handled = true;
    let answer;
    try { answer = await peer.acceptOfferBytes(bytes.slice(1)); }
    catch { handled = false; mpStatus('Invite was garbled — keep holding still…'); return; }
    mpStatus('🔊 Heard it — replying…', 'ok');
    // Chirp the answer until the data channel opens (init message arrives).
    startSoundChirp(tagged(TAG_ANSWER, answer),
      () => !!(net && net.peer && net.peer.channel && net.peer.channel.readyState === 'open'));
  });
}

// Guest consumes a scanned invite and produces a reply QR to show back.
async function joinWithOffer(code) {
  code = (code || '').trim();
  if (!code) return mpStatus('Couldn’t read that invite code.', 'err');
  try {
    const answer = await pendingPeer.acceptOffer(code);
    renderQR($('#mpJoinQR'), answer);
    show($('#mpJoinReply'));
    mpStatus('Show the reply for them to scan.');
  } catch (e) { mpStatus('That invite code didn’t scan cleanly — try again.', 'err'); }
}

// ---- camera scanner ----
let stopScan = null;
async function openScanner(onCode) {
  show($('#scanner'));
  try {
    stopScan = await startScanner($('#scanVideo'), code => { closeScanner(); onCode(code); });
  } catch (e) {
    closeScanner();
    mpStatus('Camera needed to pair. Install the app or use HTTPS, then allow camera access.', 'err');
  }
}
function closeScanner() {
  if (stopScan) { stopScan(); stopScan = null; }
  hide($('#scanner'));
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------
function openDifficultySheet() {
  const list = $('#diffList');
  list.innerHTML = '';
  DIFFICULTIES.forEach(d => {
    const b = document.createElement('button');
    b.className = `diff-item d-${d}`;
    b.innerHTML = `<span>${DIFF_META[d].label}</span><span class="dots">${dotsFor(d)}</span>`;
    b.onclick = () => { hide($('#difficultySheet')); newGame(d); };
    list.appendChild(b);
  });
  show($('#difficultySheet'));
}

function fillMpDifficulty() {
  const sel = $('#mpDifficulty');
  sel.innerHTML = DIFFICULTIES.map(d => `<option value="${d}">${DIFF_META[d].label}</option>`).join('');
  sel.value = 'medium';
}

function loadSettingsUI() {
  $('#setHighlight').checked = settings.highlight;
  $('#setPeers').checked = settings.peers;
  $('#setMistakes').checked = settings.mistakes;
  $('#setAutoNotes').checked = settings.autoNotes;
  $('#setLimit').checked = settings.limit;
  $('#setHaptics').checked = settings.haptics;
  $('#setTheme').value = settings.theme;
}
function readSettingsUI() {
  settings = {
    highlight: $('#setHighlight').checked,
    peers: $('#setPeers').checked,
    mistakes: $('#setMistakes').checked,
    autoNotes: $('#setAutoNotes').checked,
    limit: $('#setLimit').checked,
    haptics: $('#setHaptics').checked,
    theme: $('#setTheme').value,
  };
  store.saveSettings(settings);
  setHaptics(settings.haptics);
  applyTheme(settings.theme);
  if (game) renderAll();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
function leaveGame() {
  stopTimer();
  if (net) { try { net.peer.close(); } catch {} net = null; }
  resumeMp = null;
  game = null;
  updateHome();
  goto('home');
}

function init() {
  applyTheme(settings.theme);
  setHaptics(settings.haptics);
  buildBoard();
  fillMpDifficulty();
  updateHome();
  $('#appVersion').textContent = APP_VERSION;

  // Keep the browser chrome colour in sync when the OS theme flips (auto mode).
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(settings.theme));

  // Light tap on any button / control press (Android vibrate; best-effort iOS).
  document.addEventListener('pointerdown', e => {
    if (e.target.closest('button, .diff-item, .mp-mode label, .toggle-row')) haptic('tap');
  }, { passive: true });

  // home
  $('#newGameBtn').onclick = openDifficultySheet;
  $('#continueBtn').onclick = () => {
    const saved = store.loadGame();
    if (saved) { net = null; resumeMp = saved.mp || null; startGame({ ...saved, selected: null }, true); }
  };
  $('#coopBanner').onclick = () => { if (resumeMp && !net) openReconnect(); };
  $('#multiplayerBtn').onclick = () => {
    resumeMp = null; // the Play Together button always starts a fresh session
    $('#mpName').value = store.loadName();
    mpView('mpStart'); mpStatus(''); show($('#mpSheet'));
  };

  // topbar
  $('#backBtn').onclick = leaveGame;
  $('#settingsBtn').onclick = () => { loadSettingsUI(); show($('#settingsSheet')); };
  $('#pauseBtn').onclick = pauseGame;
  $('#resumeBtn').onclick = resumeGame;

  // tools
  $('#undoBtn').onclick = undo;
  $('#eraseBtn').onclick = erase;
  $('#notesBtn').onclick = () => setNotesMode(!notesMode);
  $('#hintBtn').onclick = useHint;

  // numpad
  $('#numpad').addEventListener('click', e => {
    const b = e.target.closest('button'); if (b) inputNumber(+b.dataset.n);
  });

  // keyboard (desktop testing)
  window.addEventListener('keydown', e => {
    if (!game || game.status === 'won' || game.status === 'lost') return;
    if (e.key >= '1' && e.key <= '9') inputNumber(+e.key);
    else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') erase();
    else if (e.key === 'n' || e.key === 'N') setNotesMode(!notesMode);
    else if (e.key === 'h' || e.key === 'H') useHint();
    else if (e.key === 'u' || e.key === 'U') undo();
    else if (game.selected != null && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      let i = game.selected, r = (i / 9) | 0, c = i % 9;
      if (e.key === 'ArrowUp') r = (r + 8) % 9;
      if (e.key === 'ArrowDown') r = (r + 1) % 9;
      if (e.key === 'ArrowLeft') c = (c + 8) % 9;
      if (e.key === 'ArrowRight') c = (c + 1) % 9;
      selectCell(r * 9 + c);
    }
  });

  // sheets: generic close
  $$('.sheet-close').forEach(b => b.onclick = e => hide(e.target.closest('.sheet')));
  $$('.toggle-row input').forEach(i => i.onchange = readSettingsUI);
  $('#setTheme').onchange = readSettingsUI;
  $('#difficultySheet').addEventListener('click', e => { if (e.target.id === 'difficultySheet') hide(e.target); });
  $('#settingsSheet').addEventListener('click', e => { if (e.target.id === 'settingsSheet') hide(e.target); });

  // end sheet
  $('#endNewGame').onclick = () => { hide($('#endSheet')); if (net) { net.peer.close(); net = null; } openDifficultySheet(); };
  $('#endHome').onclick = () => { hide($('#endSheet')); leaveGame(); };

  // multiplayer sheet
  $('#mpClose').onclick = () => { if (pendingPeer && !net?.peer?.channel) { try { pendingPeer.close(); } catch {} } closeMpSheet(); };
  $('#mpHostBtn').onclick = mpHost;
  $('#mpJoinBtn').onclick = mpJoinStart;
  $('#mpHostSound').onclick = mpHostSound;
  $('#mpJoinSound').onclick = mpJoinSound;
  $('#mpScanReply').onclick = () => openScanner(code => mpConnectHost(code));
  $('#mpScanInvite').onclick = () => openScanner(code => joinWithOffer(code));
  $('#scanCancel').onclick = closeScanner;
  $$('.mp-back').forEach(b => b.onclick = () => { closeScanner(); stopSoundPairing(); mpView('mpStart'); mpStatus(''); });
  // Hide the "Pair by sound" controls unless the ggwave modem is present.
  if (!sound.available()) $$('[data-sound]').forEach(hide);

  // persist on hide/close
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  window.addEventListener('pagehide', persist);
}

init();

// Service worker for offline / installable PWA.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
