// sudoku.js — generation, solving and difficulty grading.
// Pure, dependency-free ES module so it runs in the browser and under Node.

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert', 'master', 'extreme'];

// Per-difficulty target clue count (number of givens) and the hardest logical
// technique the puzzle is allowed / expected to require. Lower clues + harder
// techniques => harder puzzle.
const PROFILE = {
  easy:    { clues: [40, 50], min: 1, max: 1 }, // singles only
  medium:  { clues: [33, 38], min: 2, max: 2 }, // hidden singles
  hard:    { clues: [29, 33], min: 3, max: 3 }, // locked candidates
  expert:  { clues: [26, 30], min: 3, max: 4 }, // pairs
  master:  { clues: [24, 28], min: 4, max: 5 }, // triples / x-wing
  extreme: { clues: [22, 27], min: 5, max: 6 }, // hardest / guessing
};

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

// Mulberry32 — tiny seedable PRNG so games can be reproduced/shared by seed.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return (Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const ROW = i => (i / 9) | 0;
const COL = i => i % 9;
const BOX = i => (((i / 9) | 0) / 3 | 0) * 3 + ((i % 9) / 3 | 0);

// Precompute, for every cell, the list of peer cells (same row/col/box).
const PEERS = (() => {
  const peers = [];
  for (let i = 0; i < 81; i++) {
    const set = new Set();
    for (let j = 0; j < 81; j++) {
      if (j === i) continue;
      if (ROW(j) === ROW(i) || COL(j) === COL(i) || BOX(j) === BOX(i)) set.add(j);
    }
    peers.push([...set]);
  }
  return peers;
})();

// Units: 9 rows, 9 cols, 9 boxes — each an array of 9 cell indices.
const UNITS = (() => {
  const rows = Array.from({ length: 9 }, () => []);
  const cols = Array.from({ length: 9 }, () => []);
  const boxes = Array.from({ length: 9 }, () => []);
  for (let i = 0; i < 81; i++) {
    rows[ROW(i)].push(i);
    cols[COL(i)].push(i);
    boxes[BOX(i)].push(i);
  }
  return [...rows, ...cols, ...boxes];
})();

function canPlace(grid, idx, val) {
  for (const p of PEERS[idx]) if (grid[p] === val) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Full-solution generation (randomized backtracking)
// ---------------------------------------------------------------------------

export function generateSolution(rng) {
  const grid = new Int8Array(81);
  fillFrom(grid, 0, rng);
  return grid;
}

function fillFrom(grid, pos, rng) {
  if (pos === 81) return true;
  if (grid[pos] !== 0) return fillFrom(grid, pos + 1, rng);
  const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
  for (const n of nums) {
    if (canPlace(grid, pos, n)) {
      grid[pos] = n;
      if (fillFrom(grid, pos + 1, rng)) return true;
      grid[pos] = 0;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Solution counting (for uniqueness) — backtracking, bails out at `limit`.
// ---------------------------------------------------------------------------

export function countSolutions(grid, limit = 2) {
  const work = Int8Array.from(grid);
  let count = 0;
  const recurse = () => {
    // Find the empty cell with fewest candidates (MRV) to prune fast.
    let best = -1, bestCands = null;
    for (let i = 0; i < 81; i++) {
      if (work[i] !== 0) continue;
      const cands = [];
      for (let v = 1; v <= 9; v++) if (canPlace(work, i, v)) cands.push(v);
      if (cands.length === 0) return; // dead end
      if (bestCands === null || cands.length < bestCands.length) {
        best = i; bestCands = cands;
        if (cands.length === 1) break;
      }
    }
    if (best === -1) { count++; return; } // filled => a solution
    for (const v of bestCands) {
      work[best] = v;
      recurse();
      if (count >= limit) { work[best] = 0; return; }
      work[best] = 0;
    }
  };
  recurse();
  return count;
}

export function hasUniqueSolution(grid) {
  return countSolutions(grid, 2) === 1;
}

// Solve completely (returns a solved copy or null). Used for hints/checking.
export function solve(grid) {
  const work = Int8Array.from(grid);
  const recurse = () => {
    let best = -1, bestCands = null;
    for (let i = 0; i < 81; i++) {
      if (work[i] !== 0) continue;
      const cands = [];
      for (let v = 1; v <= 9; v++) if (canPlace(work, i, v)) cands.push(v);
      if (cands.length === 0) return false;
      if (bestCands === null || cands.length < bestCands.length) {
        best = i; bestCands = cands;
      }
    }
    if (best === -1) return true;
    for (const v of bestCands) {
      work[best] = v;
      if (recurse()) return true;
      work[best] = 0;
    }
    return false;
  };
  return recurse() ? work : null;
}

// ---------------------------------------------------------------------------
// Human-style logical grader.
// Returns the hardest technique level needed (1..6); 6 == requires guessing.
//   1 naked single, 2 hidden single, 3 locked candidates,
//   4 naked/hidden pair, 5 naked triple / x-wing, 6 unsolved by these.
// ---------------------------------------------------------------------------

function fullCandidates(grid) {
  const cands = new Array(81).fill(0);
  for (let i = 0; i < 81; i++) {
    if (grid[i] !== 0) { cands[i] = 0; continue; }
    let mask = 0;
    for (let v = 1; v <= 9; v++) if (canPlace(grid, i, v)) mask |= 1 << v;
    cands[i] = mask;
  }
  return cands;
}

const bitCount = m => { let c = 0; while (m) { m &= m - 1; c++; } return c; };
const bitsOf = m => { const a = []; for (let v = 1; v <= 9; v++) if (m & (1 << v)) a.push(v); return a; };

export function grade(grid) {
  const g = Int8Array.from(grid);
  let cands = fullCandidates(g);
  let hardest = 0;

  const place = (i, v) => {
    g[i] = v; cands[i] = 0;
    for (const p of PEERS[i]) cands[p] &= ~(1 << v);
  };

  for (;;) {
    if (g.every(v => v !== 0)) return hardest || 1;
    let progressed = false;

    // L1 naked single
    for (let i = 0; i < 81 && !progressed; i++) {
      if (g[i] === 0 && bitCount(cands[i]) === 1) {
        place(i, bitsOf(cands[i])[0]); hardest = Math.max(hardest, 1); progressed = true;
      }
    }
    if (progressed) continue;

    // L2 hidden single (a value with only one home in a unit)
    for (const unit of UNITS) {
      for (let v = 1; v <= 9 && !progressed; v++) {
        let home = -1, n = 0;
        for (const i of unit) if (g[i] === 0 && (cands[i] & (1 << v))) { home = i; n++; }
        if (n === 1) { place(home, v); hardest = Math.max(hardest, 2); progressed = true; }
      }
      if (progressed) break;
    }
    if (progressed) continue;

    // L3 locked candidates. UNITS layout is [rows 0-8, cols 9-17, boxes 18-26].
    //  Pointing: in a box, all homes for v lie on one row/col -> clear that line.
    //  Claiming: in a row/col, all homes for v lie in one box -> clear that box.
    const eliminate = (targets, v) => {
      let changed = false;
      for (const i of targets) if (g[i] === 0 && (cands[i] & (1 << v))) { cands[i] &= ~(1 << v); changed = true; }
      return changed;
    };
    for (let bx = 0; bx < 9 && !progressed; bx++) {
      const box = UNITS[18 + bx];
      for (let v = 1; v <= 9 && !progressed; v++) {
        const homes = box.filter(i => g[i] === 0 && (cands[i] & (1 << v)));
        if (homes.length < 2) continue;
        if (homes.every(i => ROW(i) === ROW(homes[0]))) {
          const line = UNITS[ROW(homes[0])].filter(i => BOX(i) !== bx);
          if (eliminate(line, v)) { hardest = Math.max(hardest, 3); progressed = true; }
        } else if (homes.every(i => COL(i) === COL(homes[0]))) {
          const line = UNITS[9 + COL(homes[0])].filter(i => BOX(i) !== bx);
          if (eliminate(line, v)) { hardest = Math.max(hardest, 3); progressed = true; }
        }
      }
    }
    if (progressed) continue;
    for (let ln = 0; ln < 18 && !progressed; ln++) { // rows then cols
      const line = UNITS[ln];
      for (let v = 1; v <= 9 && !progressed; v++) {
        const homes = line.filter(i => g[i] === 0 && (cands[i] & (1 << v)));
        if (homes.length < 2) continue;
        if (homes.every(i => BOX(i) === BOX(homes[0]))) {
          const rest = UNITS[18 + BOX(homes[0])].filter(i => !homes.includes(i));
          if (eliminate(rest, v)) { hardest = Math.max(hardest, 3); progressed = true; }
        }
      }
    }
    if (progressed) continue;

    // L4 naked pair
    for (const unit of UNITS) {
      const open = unit.filter(i => g[i] === 0);
      for (let a = 0; a < open.length && !progressed; a++) {
        for (let b = a + 1; b < open.length && !progressed; b++) {
          if (cands[open[a]] === cands[open[b]] && bitCount(cands[open[a]]) === 2) {
            const mask = cands[open[a]];
            let changed = false;
            for (const i of open) {
              if (i !== open[a] && i !== open[b] && (cands[i] & mask)) { cands[i] &= ~mask; changed = true; }
            }
            if (changed) { hardest = Math.max(hardest, 4); progressed = true; }
          }
        }
      }
      if (progressed) break;
    }
    if (progressed) continue;

    // L4b hidden pair
    for (const unit of UNITS) {
      const open = unit.filter(i => g[i] === 0);
      for (let v1 = 1; v1 <= 9 && !progressed; v1++) {
        for (let v2 = v1 + 1; v2 <= 9 && !progressed; v2++) {
          const h1 = open.filter(i => cands[i] & (1 << v1));
          const h2 = open.filter(i => cands[i] & (1 << v2));
          if (h1.length === 2 && h2.length === 2 && h1[0] === h2[0] && h1[1] === h2[1]) {
            const keep = (1 << v1) | (1 << v2);
            let changed = false;
            for (const i of h1) if (cands[i] & ~keep) { cands[i] &= keep; changed = true; }
            if (changed) { hardest = Math.max(hardest, 4); progressed = true; }
          }
        }
      }
      if (progressed) break;
    }
    if (progressed) continue;

    // L5 naked triple
    for (const unit of UNITS) {
      const open = unit.filter(i => g[i] === 0 && bitCount(cands[i]) >= 2 && bitCount(cands[i]) <= 3);
      for (let a = 0; a < open.length && !progressed; a++)
        for (let b = a + 1; b < open.length && !progressed; b++)
          for (let c = b + 1; c < open.length && !progressed; c++) {
            const mask = cands[open[a]] | cands[open[b]] | cands[open[c]];
            if (bitCount(mask) === 3) {
              let changed = false;
              for (const i of unit) {
                if (i !== open[a] && i !== open[b] && i !== open[c] && g[i] === 0 && (cands[i] & mask)) { cands[i] &= ~mask; changed = true; }
              }
              if (changed) { hardest = Math.max(hardest, 5); progressed = true; }
            }
          }
      if (progressed) break;
    }
    if (progressed) continue;

    // L5b X-Wing
    for (let v = 1; v <= 9 && !progressed; v++) {
      // rows
      const rowsWith = [];
      for (let r = 0; r < 9; r++) {
        const homes = UNITS[r].filter(i => g[i] === 0 && (cands[i] & (1 << v)));
        if (homes.length === 2) rowsWith.push([r, homes.map(COL)]);
      }
      for (let a = 0; a < rowsWith.length && !progressed; a++)
        for (let b = a + 1; b < rowsWith.length && !progressed; b++) {
          if (rowsWith[a][1][0] === rowsWith[b][1][0] && rowsWith[a][1][1] === rowsWith[b][1][1]) {
            const [c1, c2] = rowsWith[a][1];
            let changed = false;
            for (const r of [...Array(9).keys()]) {
              if (r === rowsWith[a][0] || r === rowsWith[b][0]) continue;
              for (const c of [c1, c2]) {
                const i = r * 9 + c;
                if (g[i] === 0 && (cands[i] & (1 << v))) { cands[i] &= ~(1 << v); changed = true; }
              }
            }
            if (changed) { hardest = Math.max(hardest, 5); progressed = true; }
          }
        }
    }
    if (progressed) continue;

    // Nothing logical applied — needs guessing.
    return 6;
  }
}

// ---------------------------------------------------------------------------
// Puzzle creation: carve a unique-solution puzzle from a full solution and
// match it to a difficulty by clue count + grade.
// ---------------------------------------------------------------------------

function carve(solution, targetClues, rng) {
  const puzzle = Int8Array.from(solution);
  const order = shuffle([...Array(81).keys()], rng);
  let clues = 81;
  for (const i of order) {
    if (clues <= targetClues) break;
    const saved = puzzle[i];
    puzzle[i] = 0;
    if (hasUniqueSolution(puzzle)) {
      clues--;
    } else {
      puzzle[i] = saved; // removing it breaks uniqueness — keep it
    }
  }
  return puzzle;
}

export function generatePuzzle(difficulty, seed = randomSeed(), maxAttempts = 120) {
  const profile = PROFILE[difficulty] || PROFILE.medium;
  const rng = makeRng(seed);
  const mid = (profile.min + profile.max) / 2;
  let fallback = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const solution = generateSolution(rng);
    const target = profile.clues[0] + Math.floor(rng() * (profile.clues[1] - profile.clues[0] + 1));
    const puzzle = carve(solution, target, rng);
    const level = grade(puzzle);
    const clues = puzzle.reduce((n, v) => n + (v ? 1 : 0), 0);

    const candidate = { puzzle: Array.from(puzzle), solution: Array.from(solution), difficulty, seed, level, clues };
    if (level >= profile.min && level <= profile.max) return candidate;
    // Keep the closest-by-level attempt as a fallback.
    if (!fallback || Math.abs(level - mid) < Math.abs(fallback.level - mid)) {
      fallback = candidate;
    }
  }
  return fallback;
}

export { UNITS, PEERS, ROW, COL, BOX };
