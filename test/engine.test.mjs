// Quick sanity checks for the generator/solver/grader. Run: npm test
import { generatePuzzle, hasUniqueSolution, solve, DIFFICULTIES } from '../js/sudoku.js';

let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error('  ✗', msg); } };

for (const d of DIFFICULTIES) {
  const t0 = Date.now();
  let worst = 0;
  for (let k = 0; k < 6; k++) {
    const p = generatePuzzle(d);
    const grid = Int8Array.from(p.puzzle);
    assert(hasUniqueSolution(grid), `${d}: puzzle has a unique solution`);
    const solved = solve(grid);
    assert(solved && Array.from(solved).every((v, i) => v === p.solution[i]),
      `${d}: solver reproduces the intended solution`);
    const clues = p.puzzle.filter(Boolean).length;
    assert(clues >= 17, `${d}: at least 17 clues (got ${clues})`);
    worst = Math.max(worst, Date.now() - t0);
  }
  console.log(`${d.padEnd(8)} ok  (~${((Date.now() - t0) / 6).toFixed(0)}ms/puzzle)`);
}

console.log(failures ? `\n${failures} assertion(s) failed` : '\nAll checks passed ✓');
process.exit(failures ? 1 : 0);
