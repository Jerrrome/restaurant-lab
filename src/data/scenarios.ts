import type { Fixture, Layout, Point } from '../simulation/types';

const width = 30;
const height = 20;
const entrance: Point = { x: 28, y: 10 };
const exit: Point = { x: 28, y: 11 };
const walls: Point[] = [];
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (
      x === 0 ||
      y === 0 ||
      x === width - 1 ||
      y === height - 1 ||
      (x === 14 && (y < 8 || y > 12))
    ) {
      // The perimeter doors are x=29, adjacent to the in-room arrival/exit cells.
      if (x === width - 1 && (y === 10 || y === 11)) continue;
      walls.push({ x, y });
    }
  }
}

const fixture = (id: string, kind: Fixture['kind'], x: number, y: number): Fixture => ({
  id,
  kind,
  x,
  y,
  rotation: 0,
});
const dining: Fixture[] = [
  { ...fixture('table-1', 'table', 19, 3), seatCount: 4 },
  { ...fixture('table-2', 'table', 24, 8), seatCount: 4 },
  { ...fixture('table-3', 'table', 19, 13), seatCount: 4 },
  fixture('checkout-1', 'checkout', 25, 3),
  fixture('restroom-1', 'restroom', 25, 16),
];

const makeLayout = (name: string, kitchen: Fixture[]): Layout => ({
  version: 1,
  name,
  width,
  height,
  walls: walls.map((p) => ({ ...p })),
  entrance: { ...entrance },
  exit: { ...exit },
  fixtures: [...kitchen, ...dining.map((f) => ({ ...f }))],
  staffSpawns: [
    { x: 5, y: 9 },
    { x: 9, y: 9 },
    { x: 18, y: 10 },
  ],
});

/** Deliberately long routes: same equipment, stock, people, and recipe definitions. */
export const BASELINE_LAYOUT: Layout = makeLayout('Baseline · 分散布局', [
  fixture('fridge-1', 'fridge', 2, 2),
  fixture('storage-1', 'storage', 10, 2),
  fixture('prep-1', 'prep', 2, 6),
  fixture('stove-1', 'stove', 10, 6),
  fixture('fryer-1', 'fryer', 2, 13),
  fixture('rice-1', 'rice', 10, 16),
  fixture('sink-1', 'sink', 6, 16),
  fixture('serving-1', 'serving', 11, 11),
]);

/** Compact workflow, with two-cell corridors; no hidden multiplier or bonus. */
export const ALTERNATIVE_LAYOUT: Layout = makeLayout('Alternative · 紧凑布局', [
  fixture('fridge-1', 'fridge', 3, 5),
  fixture('storage-1', 'storage', 3, 11),
  fixture('prep-1', 'prep', 6, 5),
  fixture('stove-1', 'stove', 9, 5),
  fixture('fryer-1', 'fryer', 9, 12),
  fixture('rice-1', 'rice', 7, 12),
  fixture('sink-1', 'sink', 6, 15),
  fixture('serving-1', 'serving', 11, 11),
]);

export const cloneLayout = (layout: Layout): Layout => structuredClone(layout);
