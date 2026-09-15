import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_SIZE,
  SHIP_SIZES,
  cellKey,
  inBounds,
  placeShipsRandomly,
  createBoard,
  isShipSunk,
  allShipsSunk,
  fireAt,
  createAiState,
  pickAiShot,
  recordAiShot,
} from './battleship.ts';

// Simple deterministic LCG so tests are reproducible without relying on Math.random.
function makeRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('inBounds correctly identifies valid board coordinates', () => {
  assert.equal(inBounds(0, 0), true);
  assert.equal(inBounds(BOARD_SIZE - 1, BOARD_SIZE - 1), true);
  assert.equal(inBounds(-1, 0), false);
  assert.equal(inBounds(0, BOARD_SIZE), false);
});

test('placeShipsRandomly places every ship fully in bounds with the correct size', () => {
  const random = makeRandom(42);
  const ships = placeShipsRandomly(SHIP_SIZES, random);
  assert.equal(ships.length, SHIP_SIZES.length);
  ships.forEach((ship, i) => {
    assert.equal(ship.size, SHIP_SIZES[i]);
    assert.equal(ship.cells.length, SHIP_SIZES[i]);
    for (const [r, c] of ship.cells) assert.ok(inBounds(r, c));
  });
});

test('placeShipsRandomly never overlaps two ships, across many random seeds', () => {
  for (let seed = 0; seed < 30; seed++) {
    const ships = placeShipsRandomly(SHIP_SIZES, makeRandom(seed * 7919 + 1));
    const occupied = new Set();
    for (const ship of ships) {
      for (const [r, c] of ship.cells) {
        const key = cellKey(r, c);
        assert.equal(occupied.has(key), false, `seed ${seed}: overlap at ${key}`);
        occupied.add(key);
      }
    }
  }
});

test('createBoard starts with no shots fired and no ships sunk', () => {
  const board = createBoard(SHIP_SIZES, makeRandom(1));
  assert.equal(board.shots.size, 0);
  assert.equal(allShipsSunk(board), false);
});

test('fireAt a ship cell registers a hit; firing at an empty cell registers a miss', () => {
  const board = createBoard([3], () => 0); // single 3-length ship, deterministic placement at (0,0) horizontal
  const [shipR, shipC] = board.ships[0].cells[0];
  const { board: afterHit, result: hitResult } = fireAt(board, shipR, shipC);
  assert.equal(hitResult.outcome, 'hit');
  assert.equal(afterHit.shots.get(cellKey(shipR, shipC)), 'hit');

  // Find a cell definitely not on the ship for a miss.
  const shipCells = new Set(board.ships[0].cells.map(([r, c]) => cellKey(r, c)));
  let missR = 0;
  let missC = 0;
  outer: for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (!shipCells.has(cellKey(r, c))) {
        missR = r;
        missC = c;
        break outer;
      }
    }
  }
  const { result: missResult } = fireAt(board, missR, missC);
  assert.equal(missResult.outcome, 'miss');
});

test('firing at an already-shot cell returns "already-shot" without changing the outcome', () => {
  const board = createBoard([2], () => 0);
  const [r, c] = board.ships[0].cells[0];
  const { board: afterFirst } = fireAt(board, r, c);
  const { result } = fireAt(afterFirst, r, c);
  assert.equal(result.outcome, 'already-shot');
});

test('a ship is reported sunk only once every one of its cells has been hit', () => {
  let board = createBoard([3], () => 0);
  const ship = board.ships[0];
  for (let i = 0; i < ship.cells.length - 1; i++) {
    const [r, c] = ship.cells[i];
    ({ board } = fireAt(board, r, c));
    assert.equal(isShipSunk(board, ship), false);
  }
  const [lastR, lastC] = ship.cells[ship.cells.length - 1];
  const { board: finalBoard, result } = fireAt(board, lastR, lastC);
  assert.equal(isShipSunk(finalBoard, ship), true);
  assert.ok(result.sunkShip);
  assert.equal(result.sunkShip.id, ship.id);
});

test('allShipsSunk and gameOver only become true once every ship on the board is sunk', () => {
  // Two ships need a varying RNG sequence (a constant function can otherwise land on the same
  // out-of-bounds placement forever, since retries would never explore a different cell).
  let board = createBoard([2, 2], makeRandom(7));
  let result;
  const allCells = board.ships.flatMap((s) => s.cells);
  for (const [r, c] of allCells) {
    ({ board, result } = fireAt(board, r, c));
  }
  assert.equal(allShipsSunk(board), true);
  assert.equal(result.gameOver, true);
});

test('pickAiShot never repeats a cell that has already been fired at', () => {
  let state = createAiState();
  const random = makeRandom(99);
  const fired = new Set();
  for (let i = 0; i < 100; i++) {
    const cell = pickAiShot(state, random);
    const key = cellKey(...cell);
    assert.equal(fired.has(key), false, `AI repeated cell ${key} on shot ${i}`);
    fired.add(key);
    state = recordAiShot(state, cell, { outcome: 'miss', sunkShip: null, gameOver: false });
  }
});

test('after a hit that does not sink the ship, the AI prioritizes an adjacent cell next', () => {
  let state = createAiState();
  const hitCell = [5, 5];
  state.shotsFired.add(cellKey(...hitCell));
  state = recordAiShot(state, hitCell, { outcome: 'hit', sunkShip: null, gameOver: false });

  const next = pickAiShot(state, makeRandom(1));
  const isAdjacent =
    (Math.abs(next[0] - hitCell[0]) === 1 && next[1] === hitCell[1]) ||
    (Math.abs(next[1] - hitCell[1]) === 1 && next[0] === hitCell[0]);
  assert.ok(isAdjacent, `expected a neighbor of ${hitCell}, got ${next}`);
});

test('pure hunt-mode shots (no pending hits) always land on a checkerboard-parity cell', () => {
  const state = createAiState();
  for (let seed = 0; seed < 20; seed++) {
    const [r, c] = pickAiShot(state, makeRandom(seed));
    assert.equal((r + c) % 2, 0, `hunt shot (${r},${c}) should be on a parity cell`);
  }
});

test('sinking a ship clears the AI target queue rather than carrying stale guesses forward', () => {
  let state = createAiState();
  state = recordAiShot(state, [3, 3], { outcome: 'hit', sunkShip: null, gameOver: false });
  assert.ok(state.targetQueue.length > 0);
  state = recordAiShot(state, [3, 4], { outcome: 'hit', sunkShip: { id: 0, size: 2, cells: [] }, gameOver: false });
  assert.equal(state.targetQueue.length, 0);
});

test('full simulation: the AI hunt/target loop eventually sinks every ship on a real board', () => {
  const board = createBoard(SHIP_SIZES, makeRandom(2024));
  let aiState = createAiState();
  let currentBoard = board;
  let shots = 0;
  const maxShots = BOARD_SIZE * BOARD_SIZE; // firing at every cell must be enough, at worst

  while (!allShipsSunk(currentBoard) && shots < maxShots) {
    const cell = pickAiShot(aiState, makeRandom(shots + 1));
    const { board: nextBoard, result } = fireAt(currentBoard, cell[0], cell[1]);
    currentBoard = nextBoard;
    aiState = recordAiShot(aiState, cell, result);
    shots++;
  }

  assert.equal(allShipsSunk(currentBoard), true, `AI failed to sink every ship within ${maxShots} shots`);
  assert.ok(shots <= maxShots);
});
