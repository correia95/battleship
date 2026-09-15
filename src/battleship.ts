// Single-player Battleship: board setup, shot resolution, and a hunt/target AI. Pure,
// dependency-free (accepts an injectable RNG everywhere randomness is used, for testability).

export const BOARD_SIZE = 10;
export const SHIP_SIZES = [5, 4, 3, 3, 2] as const; // Carrier, Battleship, Cruiser, Submarine, Destroyer

export type Cell = [number, number];
export type Orientation = 'horizontal' | 'vertical';

export interface Ship {
  id: number;
  size: number;
  cells: Cell[];
}

export interface Board {
  ships: Ship[];
  shots: Map<string, 'hit' | 'miss'>;
}

export function cellKey(r: number, c: number): string {
  return `${r},${c}`;
}

export function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

function cellsFor(r: number, c: number, size: number, orientation: Orientation): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < size; i++) {
    cells.push(orientation === 'horizontal' ? [r, c + i] : [r + i, c]);
  }
  return cells;
}

function fits(cells: Cell[], occupied: Set<string>): boolean {
  return cells.every(([r, c]) => inBounds(r, c) && !occupied.has(cellKey(r, c)));
}

// Places every size in SHIP_SIZES at a random valid (in-bounds, non-overlapping) location.
// Adjacent ships may touch — that's standard Battleship, not a bug. Always succeeds on a 10x10
// board with the standard fleet, since there's ample room even with retries.
export function placeShipsRandomly(sizes: readonly number[], random: () => number = Math.random): Ship[] {
  const ships: Ship[] = [];
  const occupied = new Set<string>();

  sizes.forEach((size, id) => {
    let placed = false;
    while (!placed) {
      const orientation: Orientation = random() < 0.5 ? 'horizontal' : 'vertical';
      const r = Math.floor(random() * BOARD_SIZE);
      const c = Math.floor(random() * BOARD_SIZE);
      const cells = cellsFor(r, c, size, orientation);
      if (fits(cells, occupied)) {
        for (const [cr, cc] of cells) occupied.add(cellKey(cr, cc));
        ships.push({ id, size, cells });
        placed = true;
      }
    }
  });

  return ships;
}

export function createBoard(sizes: readonly number[] = SHIP_SIZES, random: () => number = Math.random): Board {
  return { ships: placeShipsRandomly(sizes, random), shots: new Map() };
}

function shipAt(board: Board, r: number, c: number): Ship | undefined {
  const key = cellKey(r, c);
  return board.ships.find((s) => s.cells.some(([sr, sc]) => cellKey(sr, sc) === key));
}

export function isShipSunk(board: Board, ship: Ship): boolean {
  return ship.cells.every(([r, c]) => board.shots.get(cellKey(r, c)) === 'hit');
}

export function allShipsSunk(board: Board): boolean {
  return board.ships.every((ship) => isShipSunk(board, ship));
}

export interface FireResult {
  outcome: 'hit' | 'miss' | 'already-shot';
  sunkShip: Ship | null;
  gameOver: boolean;
}

// Mutates board.shots (the board is the source of truth for what's been fired at). Returns a new
// board object (shallow copy) so callers using it in React state get a fresh reference.
export function fireAt(board: Board, r: number, c: number): { board: Board; result: FireResult } {
  const key = cellKey(r, c);
  if (board.shots.has(key)) {
    return { board, result: { outcome: 'already-shot', sunkShip: null, gameOver: allShipsSunk(board) } };
  }

  const ship = shipAt(board, r, c);
  const shots = new Map(board.shots);
  shots.set(key, ship ? 'hit' : 'miss');
  const nextBoard: Board = { ships: board.ships, shots };

  if (!ship) {
    return { board: nextBoard, result: { outcome: 'miss', sunkShip: null, gameOver: false } };
  }

  const sunk = isShipSunk(nextBoard, ship);
  return {
    board: nextBoard,
    result: { outcome: 'hit', sunkShip: sunk ? ship : null, gameOver: sunk && allShipsSunk(nextBoard) },
  };
}

// --- AI (hunt/target) -----------------------------------------------------

export interface AiState {
  shotsFired: Set<string>;
  targetQueue: Cell[]; // candidate cells to try next, pushed after a hit
}

export function createAiState(): AiState {
  return { shotsFired: new Set(), targetQueue: [] };
}

function neighborsOf([r, c]: Cell): Cell[] {
  const candidates: Cell[] = [
    [r - 1, c],
    [r + 1, c],
    [r, c - 1],
    [r, c + 1],
  ];
  return candidates.filter(([nr, nc]) => inBounds(nr, nc));
}

// Every ship is at least 2 cells long, so at least one of its cells always falls on a
// "checkerboard" parity square — hunting only those squares first (until something is hit) cuts
// the search space roughly in half without ever risking missing a ship entirely.
function isParityCell([r, c]: Cell): boolean {
  return (r + c) % 2 === 0;
}

// Picks the AI's next shot. Prefers the target queue (cells adjacent to a known hit) over blind
// hunting, and prefers checkerboard-parity cells while still in pure hunt mode.
export function pickAiShot(state: AiState, random: () => number = Math.random): Cell {
  while (state.targetQueue.length > 0) {
    const candidate = state.targetQueue.shift()!;
    if (!state.shotsFired.has(cellKey(...candidate))) return candidate;
  }

  const untried: Cell[] = [];
  const untriedParity: Cell[] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (!state.shotsFired.has(cellKey(r, c))) {
        untried.push([r, c]);
        if (isParityCell([r, c])) untriedParity.push([r, c]);
      }
    }
  }

  const pool = untriedParity.length > 0 ? untriedParity : untried;
  return pool[Math.floor(random() * pool.length)];
}

// Records the outcome of the AI's shot and updates its targeting state accordingly.
export function recordAiShot(state: AiState, cell: Cell, result: FireResult): AiState {
  const shotsFired = new Set(state.shotsFired);
  shotsFired.add(cellKey(...cell));

  let targetQueue = state.targetQueue;
  if (result.outcome === 'hit' && !result.sunkShip) {
    targetQueue = [...targetQueue, ...neighborsOf(cell)];
  } else if (result.sunkShip) {
    // Once a ship is sunk, clear queued guesses — they were speculative continuations of that
    // ship's line and no longer apply.
    targetQueue = [];
  }

  return { shotsFired, targetQueue };
}
