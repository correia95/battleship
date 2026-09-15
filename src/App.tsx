import { useEffect, useMemo, useState } from 'react';
import {
  BOARD_SIZE,
  SHIP_SIZES,
  cellKey,
  createAiState,
  createBoard,
  fireAt,
  pickAiShot,
  recordAiShot,
  type Board,
} from './battleship';

type GameStatus = 'playing' | 'won' | 'lost';

interface Record {
  wins: number;
  losses: number;
}

function loadRecord(): Record {
  try {
    const raw = localStorage.getItem('battleship-record');
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.wins === 'number' && typeof parsed.losses === 'number' ? parsed : { wins: 0, losses: 0 };
  } catch {
    return { wins: 0, losses: 0 };
  }
}

function saveRecord(record: Record) {
  try {
    localStorage.setItem('battleship-record', JSON.stringify(record));
  } catch {
    /* ignore */
  }
}

function newGame() {
  return {
    playerBoard: createBoard(SHIP_SIZES),
    enemyBoard: createBoard(SHIP_SIZES),
    aiState: createAiState(),
    status: 'playing' as GameStatus,
    message: 'Your move — fire at the enemy waters.',
  };
}

export default function App() {
  const [game, setGame] = useState(newGame);
  const [record, setRecord] = useState<Record>(loadRecord);
  const [copied, setCopied] = useState(false);

  const enemyShipsRemaining = useMemo(
    () => game.enemyBoard.ships.filter((s) => !s.cells.every(([r, c]) => game.enemyBoard.shots.get(cellKey(r, c)) === 'hit')).length,
    [game.enemyBoard],
  );
  const playerShipsRemaining = useMemo(
    () => game.playerBoard.ships.filter((s) => !s.cells.every(([r, c]) => game.playerBoard.shots.get(cellKey(r, c)) === 'hit')).length,
    [game.playerBoard],
  );

  const fireAtEnemy = (r: number, c: number) => {
    if (game.status !== 'playing') return;
    const key = cellKey(r, c);
    if (game.enemyBoard.shots.has(key)) return;

    const { board: enemyAfterPlayer, result: playerResult } = fireAt(game.enemyBoard, r, c);

    if (playerResult.gameOver) {
      setGame((g) => ({ ...g, enemyBoard: enemyAfterPlayer, status: 'won', message: 'You sank the entire enemy fleet!' }));
      return;
    }

    // AI's turn immediately after (single-threaded turn resolution keeps this simple and
    // deterministic to test; a short visual delay isn't needed since each shot is a discrete click).
    const aiCell = pickAiShot(game.aiState);
    const { board: playerAfterAi, result: aiResult } = fireAt(game.playerBoard, aiCell[0], aiCell[1]);
    const nextAiState = recordAiShot(game.aiState, aiCell, aiResult);

    if (aiResult.gameOver) {
      setGame((g) => ({
        ...g,
        enemyBoard: enemyAfterPlayer,
        playerBoard: playerAfterAi,
        aiState: nextAiState,
        status: 'lost',
        message: 'The enemy sank your entire fleet.',
      }));
      return;
    }

    const playerMsg = playerResult.sunkShip
      ? `You sank their ${shipLabel(playerResult.sunkShip.size)}!`
      : playerResult.outcome === 'hit'
        ? 'Hit!'
        : 'Miss.';
    const aiMsg = aiResult.sunkShip
      ? `They sank your ${shipLabel(aiResult.sunkShip.size)}!`
      : aiResult.outcome === 'hit'
        ? 'They hit one of your ships.'
        : 'They missed.';

    setGame((g) => ({
      ...g,
      enemyBoard: enemyAfterPlayer,
      playerBoard: playerAfterAi,
      aiState: nextAiState,
      message: `${playerMsg} ${aiMsg}`,
    }));
  };

  useEffect(() => {
    if (game.status === 'won') {
      const next = { ...record, wins: record.wins + 1 };
      setRecord(next);
      saveRecord(next);
    } else if (game.status === 'lost') {
      const next = { ...record, losses: record.losses + 1 };
      setRecord(next);
      saveRecord(next);
    }
  }, [game.status]);

  const shareRecord = async () => {
    const text = `Battleship record: ${record.wins}W-${record.losses}L`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Battleship</h1>
        <p className="tag">
          Single-player Battleship against a hunt-and-target computer opponent. Click a cell on the
          enemy board to fire.
        </p>
      </header>

      <div className="scoreboard">
        <span>Record: {record.wins}W-{record.losses}L</span>
        <button className="link-btn" onClick={shareRecord}>
          {copied ? 'Copied' : 'Share record'}
        </button>
      </div>

      <p className={`message ${game.status}`}>{game.message}</p>

      <div className="boards">
        <div className="board-panel">
          <h2>Enemy waters ({enemyShipsRemaining} ship{enemyShipsRemaining === 1 ? '' : 's'} left)</h2>
          <BoardGrid board={game.enemyBoard} hideShips onCellClick={fireAtEnemy} disabled={game.status !== 'playing'} />
        </div>
        <div className="board-panel">
          <h2>Your fleet ({playerShipsRemaining} ship{playerShipsRemaining === 1 ? '' : 's'} left)</h2>
          <BoardGrid board={game.playerBoard} hideShips={false} onCellClick={() => {}} disabled />
        </div>
      </div>

      {game.status !== 'playing' && (
        <button className="primary" onClick={() => setGame(newGame())}>
          New game
        </button>
      )}

      <section className="explainer">
        <h2>How the computer plays</h2>
        <p>
          The computer hunts using a checkerboard pattern at first — since every ship is at least 2
          cells long, this covers every possible ship position while trying only half the board.
          Once it lands a hit, it switches to targeting the cells right next to it until that ship
          is sunk, then goes back to hunting.
        </p>
        <h3>Is anything sent to a server?</h3>
        <p>No. Both fleets and every shot are generated and resolved entirely in your browser.</p>
        <footer>Battleship · no sign-up · works offline once loaded</footer>
      </section>
    </div>
  );
}

function shipLabel(size: number): string {
  switch (size) {
    case 5:
      return 'Carrier';
    case 4:
      return 'Battleship';
    case 3:
      return 'Cruiser/Submarine';
    case 2:
      return 'Destroyer';
    default:
      return 'ship';
  }
}

function BoardGrid({
  board,
  hideShips,
  onCellClick,
  disabled,
}: {
  board: Board;
  hideShips: boolean;
  onCellClick: (r: number, c: number) => void;
  disabled: boolean;
}) {
  const shipCells = useMemo(() => {
    const set = new Set<string>();
    for (const ship of board.ships) for (const [r, c] of ship.cells) set.add(cellKey(r, c));
    return set;
  }, [board.ships]);

  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)` }}>
      {Array.from({ length: BOARD_SIZE }, (_, r) =>
        Array.from({ length: BOARD_SIZE }, (_, c) => {
          const key = cellKey(r, c);
          const shot = board.shots.get(key);
          const hasShip = shipCells.has(key);
          let cls = 'cell';
          if (shot === 'hit') cls += hasShip ? ' hit' : '';
          if (shot === 'miss') cls += ' miss';
          if (hasShip && !hideShips && !shot) cls += ' ship';
          if (hasShip && shot === 'hit') cls += ' ship-hit';
          return (
            <button
              key={key}
              className={cls}
              disabled={disabled || !!shot}
              onClick={() => onCellClick(r, c)}
              aria-label={`Cell ${r + 1},${c + 1}`}
            >
              {shot === 'hit' ? '✸' : shot === 'miss' ? '·' : ''}
            </button>
          );
        }),
      )}
    </div>
  );
}
