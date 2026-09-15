# Battleship

Single-player Battleship against a hunt-and-target computer opponent.

- Standard fleet: Carrier (5), Battleship (4), Cruiser & Submarine (3 each),
  Destroyer (2), randomly placed on a 10x10 board
- Computer AI: checkerboard-parity hunting (every ship is at least 2 cells
  long, so at least one cell always falls on a parity square), switching to
  adjacent-cell targeting once it lands a hit
- W/L record tracked in `localStorage`, with a spoiler-free "share your
  record" (never board state)

## Develop

```
npm install
npm run dev
npm run build      # tsc --noEmit && vite build
node --experimental-strip-types --test src/battleship.test.mjs
```

The engine (`fireAt`, `pickAiShot`, `recordAiShot`) is in
`src/battleship.ts`. 13 Node tests in `src/battleship.test.mjs`, including a
full simulation that runs the AI's hunt/target loop against a real board
until every ship is sunk, proving the algorithm actually converges rather
than just checking isolated pieces of it.

## Deploy

Static assets on Cloudflare Workers (`wrangler.jsonc`). Live at
<https://battleship.correia95.workers.dev/>.
