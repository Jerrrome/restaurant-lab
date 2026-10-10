import { describe, expect, it } from 'vitest';
import { ALTERNATIVE_LAYOUT, BASELINE_LAYOUT, cloneLayout } from '../data/scenarios';
import {
  findPath,
  footprint,
  interactionCells,
  isWalkable,
  key,
  same,
  validateLayout,
} from '../simulation/navigation/grid';
import type { Layout, Point } from '../simulation/types';

const emptyLayout = (): Layout => ({
  version: 1,
  name: 'test',
  width: 8,
  height: 7,
  walls: [],
  entrance: { x: 0, y: 3 },
  exit: { x: 7, y: 3 },
  fixtures: [],
  staffSpawns: [],
});
const checkSteps = (start: Point, path: Point[]) => {
  let previous = start;
  for (const p of path) {
    expect(Math.abs(p.x - previous.x) + Math.abs(p.y - previous.y)).toBe(1);
    previous = p;
  }
};

describe('A* navigation and static collisions', () => {
  it('finds the shortest four-neighbour detour around a wall without crossing it', () => {
    const layout = emptyLayout();
    layout.walls = [
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 3, y: 4 },
    ];
    const start = { x: 1, y: 3 };
    const goal = { x: 5, y: 3 };
    const path = findPath(layout, start, goal);
    expect(path).toHaveLength(8);
    expect(path.at(-1)).toEqual(goal);
    checkSteps(start, path);
    expect(path.every((p) => isWalkable(layout, p))).toBe(true);
  });

  it('routes around a temporary actor occupancy and fails for a blocked destination', () => {
    const layout = emptyLayout();
    const blocked = new Set(['2,3']);
    const path = findPath(layout, { x: 1, y: 3 }, { x: 5, y: 3 }, blocked);
    expect(path).toHaveLength(6);
    expect(path.some((p) => blocked.has(key(p)))).toBe(false);
    expect(findPath(layout, { x: 1, y: 3 }, { x: 2, y: 3 }, blocked)).toEqual([]);
  });

  it('cannot cross equipment, out-of-bounds cells, or a completely sealed wall', () => {
    const layout = emptyLayout();
    layout.fixtures.push({ id: 'stove', kind: 'stove', x: 2, y: 3, rotation: 90 });
    expect(footprint(layout.fixtures[0])).toEqual([
      { x: 2, y: 3 },
      { x: 2, y: 4 },
    ]);
    expect(isWalkable(layout, { x: 2, y: 3 })).toBe(false);
    expect(isWalkable(layout, { x: -1, y: 3 })).toBe(false);
    expect(findPath(layout, { x: 1, y: 3 }, { x: 2, y: 3 })).toEqual([]);
    layout.walls = Array.from({ length: layout.height }, (_, y) => ({ x: 4, y }));
    expect(findPath(layout, { x: 1, y: 3 }, { x: 6, y: 3 })).toEqual([]);
  });
});

describe('valid restaurant layouts', () => {
  it.each([BASELINE_LAYOUT, ALTERNATIVE_LAYOUT])(
    '%s is connected and every station can be operated from outside its collision body',
    (layout) => {
      expect(validateLayout(layout)).toEqual({ valid: true, reason: '布局有效' });
      for (const fixture of layout.fixtures) {
        const footprintKeys = new Set(footprint(fixture).map(key));
        const cells = interactionCells(layout, fixture);
        expect(cells.length).toBeGreaterThan(0);
        expect(cells.every((p) => !footprintKeys.has(key(p)) && isWalkable(layout, p))).toBe(true);
        expect(
          cells.some(
            (p) => same(p, layout.entrance) || findPath(layout, layout.entrance, p).length > 0,
          ),
        ).toBe(true);
      }
    },
  );

  it('rejects overlap, blocked entrance, and inaccessible workstations', () => {
    const overlap = cloneLayout(BASELINE_LAYOUT);
    overlap.fixtures[1].x = overlap.fixtures[0].x;
    overlap.fixtures[1].y = overlap.fixtures[0].y;
    expect(validateLayout(overlap).valid).toBe(false);
    const entrance = cloneLayout(BASELINE_LAYOUT);
    entrance.fixtures[0].x = entrance.entrance.x;
    entrance.fixtures[0].y = entrance.entrance.y;
    expect(validateLayout(entrance).valid).toBe(false);
    const sealed = emptyLayout();
    sealed.fixtures.push({ id: 'rice', kind: 'rice', x: 3, y: 3, rotation: 0 });
    sealed.walls.push({ x: 2, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 2 }, { x: 3, y: 4 });
    expect(validateLayout(sealed).reason).toContain('操作位置');
  });

  it('uses matching fixtures and computes different routes from actual coordinates', () => {
    expect(BASELINE_LAYOUT.fixtures.map(({ id, kind }) => ({ id, kind }))).toEqual(
      ALTERNATIVE_LAYOUT.fixtures.map(({ id, kind }) => ({ id, kind })),
    );
    const routeLength = (layout: Layout) => {
      const fridge = layout.fixtures.find((f) => f.kind === 'fridge')!;
      const prep = layout.fixtures.find((f) => f.kind === 'prep')!;
      return Math.min(
        ...interactionCells(layout, fridge).flatMap((start) =>
          interactionCells(layout, prep).map((end) =>
            same(start, end) ? 0 : findPath(layout, start, end).length || Infinity,
          ),
        ),
      );
    };
    expect(routeLength(BASELINE_LAYOUT)).not.toBe(routeLength(ALTERNATIVE_LAYOUT));
  });

  it('rejects unsupported versions, oversized maps, and excessive entity counts before pathfinding', () => {
    const version = cloneLayout(BASELINE_LAYOUT);
    version.version = 2 as 1;
    expect(validateLayout(version).reason).toContain('版本');
    const enormous = cloneLayout(BASELINE_LAYOUT);
    enormous.width = 1_000_000_000;
    expect(validateLayout(enormous).reason).toContain('尺寸');
    const tooManyFixtures = cloneLayout(BASELINE_LAYOUT);
    tooManyFixtures.fixtures = Array.from({ length: 101 }, () => ({
      ...BASELINE_LAYOUT.fixtures[0],
    }));
    expect(validateLayout(tooManyFixtures).reason).toContain('数量');
    const tooManyWalls = cloneLayout(BASELINE_LAYOUT);
    tooManyWalls.walls = Array.from({ length: 10001 }, () => ({ x: 0, y: 0 }));
    expect(validateLayout(tooManyWalls).reason).toContain('数量');
  });

  it.each([-1, 0, 1.5, 5, NaN, Infinity])(
    'rejects a table with invalid capacity %s',
    (seatCount) => {
      const layout = cloneLayout(BASELINE_LAYOUT);
      layout.fixtures.find((f) => f.kind === 'table')!.seatCount = seatCount;
      expect(validateLayout(layout).reason).toContain('座位数');
    },
  );

  it('accepts a smaller valid table and rejects corrupt coordinates and inherited equipment keys', () => {
    const smaller = cloneLayout(BASELINE_LAYOUT);
    smaller.fixtures.find((f) => f.kind === 'table')!.seatCount = 2;
    expect(validateLayout(smaller).valid).toBe(true);
    const corrupt = cloneLayout(BASELINE_LAYOUT);
    corrupt.staffSpawns[0].x = NaN;
    expect(validateLayout(corrupt).reason).toContain('员工位置');
    const corruptFixture = cloneLayout(BASELINE_LAYOUT);
    corruptFixture.fixtures[0].x = 2.5;
    expect(validateLayout(corruptFixture).reason).toContain('坐标');
    const inherited = cloneLayout(BASELINE_LAYOUT);
    inherited.fixtures[0].kind = 'toString' as (typeof inherited.fixtures)[0]['kind'];
    expect(validateLayout(inherited).reason).toContain('未知设备');
  });
});
