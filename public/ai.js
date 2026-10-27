// Game rules + AI search, shared by the page (game.js) and the AI worker (ai-worker.js).
// Kept free of DOM access so it can run inside a Web Worker via importScripts().

// ==================== GAME RULES ====================
// A die is { v: 1..6, im: immune(무적, cannot be removed by 알까기) }.
// Column score: for each group of n same-value dice → v × (2n − 1).

// Hot path of the AI search, so no per-call allocation: the first die of a value
// adds v, every further die of that value adds 2v (total v × (2n − 1)).
function columnScore(col) {
  let s = 0;
  for (let i = 0; i < col.length; i++) {
    const v = col[i].v;
    let seen = false;
    for (let j = 0; j < i; j++) if (col[j].v === v) { seen = true; break; }
    s += seen ? 2 * v : v;
  }
  return s;
}

function playerScore(grid) {
  return grid.reduce((sum, col) => sum + columnScore(col), 0);
}

function fieldFull(grid) {
  return grid.every(col => col.length >= 3);
}

function validColumns(grid) {
  const cols = [];
  for (let c = 0; c < 3; c++) if (grid[c].length < 3) cols.push(c);
  return cols;
}

function maxBy(arr, fn) {
  let best = arr[0], bestVal = -Infinity;
  for (const x of arr) { const v = fn(x); if (v > bestVal) { bestVal = v; best = x; } }
  return best;
}

// does opponent column `col` contain a removable (non-immune) die of value v?
function hasKill(grid, col, v) {
  return grid[col].some(d => !d.im && d.v === v);
}

// Copy-on-write board update: only the changed column gets a new array; the
// other columns and the die objects are shared. Nothing ever mutates a board
// in place, so sharing is safe and saves cloning all 18 dice per simulated move.
function withColumn(grids, owner, col, newCol) {
  const g = [grids[0].slice(), grids[1].slice()];
  g[owner][col] = newCol;
  return g;
}

// how many points the opponent can destroy by 알까기-ing player `p`'s board
// weight by V² so exposing high numbers (5,6) is disproportionately costly
const riskCounts = new Int8Array(7);   // scratch buffer: non-immune dice per value

function exposureRisk(grids, p) {
  const opp = 1 - p;
  let r = 0;
  for (let c = 0; c < 3; c++) {
    if (grids[opp][c].length >= 3) continue;           // opponent can't place here
    riskCounts.fill(0);
    const col = grids[p][c];
    for (let i = 0; i < col.length; i++) if (!col[i].im) riskCounts[col[i].v]++;
    // ascending value order keeps the floating-point sum identical to before
    for (let V = 1; V <= 6; V++) {
      const k = riskCounts[V];
      if (k === 0) continue;
      // a pair (k≥2) is a juicy 알까기 target; lone die is mildly exposed
      r += V * V * (k >= 2 ? k * 1.2 : 0.15);
    }
  }
  return r;
}

// count immune dice (safe — can never be removed)
function immuneCount(grid) {
  let n = 0;
  for (const col of grid) for (const d of col) if (d.im) n++;
  return n;
}

// board evaluation from `me`'s view
// winning 2 of 3 lines is the ONLY victory condition → line wins dominate everything
function evalBoard(grids, me) {
  const opp = 1 - me;
  let lineAdv = 0, lockedAdv = 0;
  let myMargin = 0, oppMargin = 0;
  let myTotal = 0, oppTotal = 0;
  for (let c = 0; c < 3; c++) {
    const a = columnScore(grids[me][c]), b = columnScore(grids[opp][c]);
    myTotal += a; oppTotal += b;
    const locked = grids[me][c].length >= 3 && grids[opp][c].length >= 3;
    if (a > b)      { lineAdv++;  myMargin  += a - b; if (locked) lockedAdv++; }
    else if (b > a) { lineAdv--;  oppMargin += b - a; if (locked) lockedAdv--; }
  }
  // decisive game-over detection: if already winning/losing 2 lines, strongly push
  const lineVal = lineAdv * 80 + lockedAdv * 30
                + (lineAdv >= 2 ? 120 : lineAdv <= -2 ? -120 : 0);
  const pointVal = myTotal - oppTotal;
  // margin matters for tiebreaking: prefer large winning margins
  const marginVal = (myMargin - oppMargin) * 0.3;
  // exposure: my crackable stacks are bad, opponent's are opportunities
  const myRisk = exposureRisk(grids, me);
  const oppRisk = exposureRisk(grids, opp);
  // immune dice are inherently valuable (safe points + block opponent slots)
  const immuneVal = (immuneCount(grids[me]) - immuneCount(grids[opp])) * 5;
  return lineVal + pointVal + marginVal - myRisk * 1.2 + oppRisk * 0.6 + immuneVal;
}

// ---- simulation + minimax lookahead for the hard AI ----
const HARD_DEPTH = 6;   // plies of search (6-ply expectiminimax)
const KILL_BONUS = 12;  // approx value of a 알까기's free immune reroll (deep nodes)
const SHALLOW  = 5;     // depth ≤ SHALLOW → reduced sampling for speed
const DEEP     = 3;     // depth ≤ DEEP → ultra-reduced sampling (2 dice)
const DICE_SAMPLES = [1, 4, 6];  // representative low/mid/high for mid-depth
const DICE_DEEP    = [2, 5];     // representative lo/hi for deepest nodes
const TOP_COLS     = 2;          // at depth ≤ SHALLOW only the best TOP_COLS columns are searched
const WIN_VALUE    = 600;        // finished game: decided by lines, not by the heuristic
const HOLD_MARGIN   = 5;         // hold only when clearly better than placing
const REROLL_MARGIN = 3;         // the reroll is single-use, so keep it unless it clearly pays

// place a normal die of value X into `placer`'s column; resolve 알까기
function simMove(grids, placer, col, X) {
  const opp = 1 - placer;
  const oppCol = grids[opp][col];
  let killed = false;
  for (let i = 0; i < oppCol.length; i++) { if (!oppCol[i].im && oppCol[i].v === X) { killed = true; break; } }
  let g;
  if (killed) {
    const filtered = [];
    for (let i = 0; i < oppCol.length; i++) { if (oppCol[i].im || oppCol[i].v !== X) filtered.push(oppCol[i]); }
    g = withColumn(grids, opp, col, filtered);
  } else {
    g = withColumn(grids, placer, col, grids[placer][col].concat({ v: X, im: false, by: placer }));
  }
  return { g, killed };
}

function simImmune(grids, owner, col, Y) {
  return withColumn(grids, owner, col, grids[owner][col].concat({ v: Y, im: true, by: owner }));
}

// place an immune die of value Y to `owner`'s greatest benefit (own or opp field)
function bestImmuneFor(grids, owner, Y) {
  const opp = 1 - owner;
  let best = grids, bestV = -Infinity;
  for (const c of validColumns(grids[owner])) { const g = simImmune(grids, owner, c, Y); const v = evalBoard(g, owner); if (v > bestV) { bestV = v; best = g; } }
  for (const c of validColumns(grids[opp])) { const g = simImmune(grids, opp, c, Y); const v = evalBoard(g, owner); if (v > bestV) { bestV = v; best = g; } }
  return best;
}

// ---- transposition cache ----
// Different move orders often reach the same board, so searchRoll results are
// cached per (board, mover, ai, depth). Dice order inside a column never affects
// scoring or 알까기, so each column is keyed as a sorted multiset of dice.
// The cache is cleared at the start of every top-level AI decision.
const searchCache = new Map();

function columnKey(col) {
  const n = col.length;
  if (n === 0) return 0;
  // die code 1..12: value, +6 when immune
  let a = col[0].v + (col[0].im ? 6 : 0);
  if (n === 1) return a;
  let b = col[1].v + (col[1].im ? 6 : 0);
  if (a > b) { const t = a; a = b; b = t; }
  if (n === 2) return a * 13 + b;
  let c = col[2].v + (col[2].im ? 6 : 0);
  if (b > c) { const t = b; b = c; c = t; if (a > b) { const u = a; a = b; b = u; } }
  return (a * 13 + b) * 13 + c;
}

function boardKey(grids, mover, ai, depth) {
  const p0 = grids[0], p1 = grids[1];
  return ((columnKey(p0[0]) * 2197 + columnKey(p0[1])) * 2197 + columnKey(p0[2])) + ',' +
         ((columnKey(p1[0]) * 2197 + columnKey(p1[1])) * 2197 + columnKey(p1[2])) + ',' +
         (mover * 2 + ai) + ',' + depth;
}

// `held` is a bitmask of players who held (bit p set → player p places no more dice).
function isDone(grids, p, held) {
  return ((held >> p) & 1) === 1 || fieldFull(grids[p]);
}

// exact value of a finished game for `ai`, using the same rule as App.lineResult()
function finalValue(grids, ai) {
  let w = 0, m = 0;
  for (let c = 0; c < 3; c++) {
    const a = columnScore(grids[ai][c]), b = columnScore(grids[1 - ai][c]);
    if (a > b) { w++; m += a - b; } else if (b > a) { w--; m -= a - b; }
  }
  if (w === 0) w = Math.sign(m);   // 1:1 lines → bigger winning margin decides
  return w * WIN_VALUE;
}

// minimax over chance (dice) nodes; value always from `ai`'s perspective.
// `mover` is about to roll and play; `depth` = remaining plies.
// Sampling strategy: root=all 6 dice, mid-depth=3, deep=2.
function searchRoll(grids, mover, ai, depth, held) {
  if (isDone(grids, mover, held)) {
    if (isDone(grids, 1 - mover, held)) return finalValue(grids, ai);
    mover = 1 - mover;   // this player is done; other keeps going
  }
  if (depth <= 0) return evalBoard(grids, ai);
  const key = boardKey(grids, mover, ai, depth) + ',' + held;
  const hit = searchCache.get(key);
  if (hit !== undefined) return hit;
  const v = searchRollUncached(grids, mover, ai, depth, held);
  searchCache.set(key, v);
  return v;
}

function searchRollUncached(grids, mover, ai, depth, held) {
  const dice = depth <= DEEP ? DICE_DEEP : depth <= SHALLOW ? DICE_SAMPLES : null;
  let s = 0;
  if (dice) {
    for (const X of dice) s += searchBestMove(grids, mover, ai, X, depth, held);
    return s / dice.length;
  }
  for (let X = 1; X <= 6; X++) s += searchBestMove(grids, mover, ai, X, depth, held);
  return s / 6;
}

// At shallow depths, narrow columns to the top TOP_COLS by quick evaluation.
function searchBestMove(grids, mover, ai, X, depth, held) {
  let cols = validColumns(grids[mover]);
  const maximizing = mover === ai;
  if (depth <= SHALLOW && cols.length > TOP_COLS) {
    const ranked = cols.map(c => {
      const { g, killed } = simMove(grids, mover, c, X);
      return { c, v: evalBoard(g, ai) + (killed ? (maximizing ? KILL_BONUS : -KILL_BONUS) : 0) };
    });
    ranked.sort((a, b) => maximizing ? b.v - a.v : a.v - b.v);
    cols = ranked.slice(0, TOP_COLS).map(r => r.c);
  }
  let best = maximizing ? -Infinity : Infinity;
  for (const c of cols) {
    const v = searchAfterMove(grids, mover, ai, c, X, depth, held);
    best = maximizing ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

function searchAfterMove(grids, mover, ai, col, X, depth, held) {
  const { g, killed } = simMove(grids, mover, col, X);
  if (killed) {
    if (depth >= HARD_DEPTH) {
      // root reroll: average over all reroll values placed optimally (accurate)
      let s = 0;
      for (let Y = 1; Y <= 6; Y++) s += searchRoll(bestImmuneFor(g, mover, Y), 1 - mover, ai, depth - 1, held);
      return s / 6;
    }
    // deeper: approximate the reroll with a flat bonus to keep the search fast
    return searchRoll(g, 1 - mover, ai, depth - 1, held) + (mover === ai ? KILL_BONUS : -KILL_BONUS);
  }
  return searchRoll(g, 1 - mover, ai, depth - 1, held);
}

// best value for `ai` placing die X now, searched `depth` plies deep
function bestPlacement(grids, ai, X, depth, held) {
  let bestV = -Infinity, bestC = -1;
  for (const c of validColumns(grids[ai])) {
    const v = searchAfterMove(grids, ai, ai, c, X, depth, held);
    if (v > bestV) { bestV = v; bestC = c; }
  }
  return { v: bestV, col: bestC };
}

// ---- hard AI decisions (pure: board in, decision out) ----
// `held` is the bitmask described at isDone(); the AI itself is never held here.

// AI rolled X. Returns { action: 'hold' } | { action: 'reroll' } | { action: 'place', col }.
function hardDecide(grids, ai, X, canReroll, held = 0) {
  searchCache.clear();
  const opp = 1 - ai;
  if (validColumns(grids[ai]).length === 0) return null;
  const place = bestPlacement(grids, ai, X, HARD_DEPTH, held);

  // === Hold: the AI stops for the rest of the game; the opponent plays on alone ===
  const aiDice = grids[ai].reduce((s, c) => s + c.length, 0);
  if (aiDice >= 7) {
    const holdV = searchRoll(grids, opp, ai, HARD_DEPTH - 1, held | (1 << ai));
    if (holdV > place.v + HOLD_MARGIN) return { action: 'hold' };
  }

  // === Reroll: like a human, the AI then keeps whichever of the two dice is better ===
  if (canReroll) {
    const D = HARD_DEPTH - 2;   // both sides of the comparison use the same depth
    const val = [0];
    for (let e = 1; e <= 6; e++) val.push(bestPlacement(grids, ai, e, D, held).v);
    let exp = 0;
    for (let e = 1; e <= 6; e++) exp += Math.max(val[X], val[e]);
    exp /= 6;
    if (exp > val[X] + REROLL_MARGIN) return { action: 'reroll' };
  }

  return { action: 'place', col: place.col };
}

// After rerolling X into Y: keep the better die. Returns { die, col }.
function hardAfterReroll(grids, ai, X, Y, held = 0) {
  searchCache.clear();
  const a = bestPlacement(grids, ai, X, HARD_DEPTH, held);
  if (X === Y) return { die: X, col: a.col };
  const b = bestPlacement(grids, ai, Y, HARD_DEPTH, held);
  return b.v > a.v ? { die: Y, col: b.col } : { die: X, col: a.col };
}

// AI must place the immune reroll die Y on either field. Returns { owner, col }.
function hardPlaceImmune(grids, ai, Y, held = 0) {
  searchCache.clear();
  const opp = 1 - ai;
  const options = [];
  for (const c of validColumns(grids[ai])) options.push({ owner: ai, col: c });
  for (const c of validColumns(grids[opp])) options.push({ owner: opp, col: c });
  if (!options.length) return null;
  let best = options[0], bestV = -Infinity;
  for (const o of options) {
    const g = simImmune(grids, o.owner, o.col, Y);
    const val = searchRoll(g, opp, ai, HARD_DEPTH - 1, held);   // opponent to move next
    if (val > bestV) { bestV = val; best = o; }
  }
  return { owner: best.owner, col: best.col };
}

// entry point shared by ai-worker.js and the inline fallback in game.js
function runAIJob(kind, args) {
  const held = args.held || 0;
  if (kind === 'act') return hardDecide(args.grids, args.ai, args.die, args.canReroll, held);
  if (kind === 'afterReroll') return hardAfterReroll(args.grids, args.ai, args.die, args.newDie, held);
  if (kind === 'placeImmune') return hardPlaceImmune(args.grids, args.ai, args.die, held);
  return null;
}
