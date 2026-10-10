import { EQUIPMENT } from '../../data/catalog';
import type { Fixture, Layout, Point } from '../types';

export const key = (p: Point): string => `${p.x},${p.y}`;
export const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;
const adjacent: Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

const dimensions = (fixture: Fixture): { width: number; height: number } => {
  const definition = EQUIPMENT[fixture.kind];
  const quarterTurns = Math.abs(fixture.rotation) <= 3 ? fixture.rotation : fixture.rotation / 90;
  return Math.abs(quarterTurns % 2) === 1
    ? { width: definition.height, height: definition.width }
    : { width: definition.width, height: definition.height };
};

export function footprint(fixture: Fixture): Point[] {
  const { width, height } = dimensions(fixture);
  const points: Point[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) points.push({ x: fixture.x + x, y: fixture.y + y });
  }
  return points;
}

const inBounds = (layout: Layout, p: Point) =>
  Number.isInteger(p.x) &&
  Number.isInteger(p.y) &&
  p.x >= 0 &&
  p.x < layout.width &&
  p.y >= 0 &&
  p.y < layout.height;

/** Layouts are mutable only while paused. Path calls build their own occupancy snapshot. */
const blockedCells = (layout: Layout): Set<string> =>
  new Set([...layout.walls.map(key), ...layout.fixtures.flatMap((f) => footprint(f).map(key))]);

export function isWalkable(layout: Layout, p: Point): boolean {
  if (!inBounds(layout, p)) return false;
  return !blockedCells(layout).has(key(p));
}

/** Edge-adjacent cells only: an actor never operates diagonally through a corner. */
export function interactionCells(layout: Layout, fixture: Fixture): Point[] {
  const blocked = blockedCells(layout);
  const found = new Map<string, Point>();
  for (const cell of footprint(fixture)) {
    for (const direction of adjacent) {
      const p = { x: cell.x + direction.x, y: cell.y + direction.y };
      if (inBounds(layout, p) && !blocked.has(key(p))) found.set(key(p), p);
    }
  }
  return [...found.values()];
}

interface PathNode {
  point: Point;
  g: number;
  f: number;
  sequence: number;
}
class MinHeap {
  private nodes: PathNode[] = [];
  private less(a: PathNode, b: PathNode): boolean {
    return a.f < b.f || (a.f === b.f && a.sequence < b.sequence);
  }
  get length(): number {
    return this.nodes.length;
  }
  push(node: PathNode): void {
    this.nodes.push(node);
    let i = this.nodes.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(this.nodes[i], this.nodes[parent])) break;
      [this.nodes[i], this.nodes[parent]] = [this.nodes[parent], this.nodes[i]];
      i = parent;
    }
  }
  pop(): PathNode {
    const result = this.nodes[0];
    const last = this.nodes.pop()!;
    if (this.nodes.length > 0) {
      this.nodes[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let next = i;
        if (left < this.nodes.length && this.less(this.nodes[left], this.nodes[next])) next = left;
        if (right < this.nodes.length && this.less(this.nodes[right], this.nodes[next]))
          next = right;
        if (next === i) break;
        [this.nodes[i], this.nodes[next]] = [this.nodes[next], this.nodes[i]];
        i = next;
      }
    }
    return result;
  }
}

/** Deterministic four-neighbour A*. The result excludes start and includes goal. */
export function findPath(
  layout: Layout,
  start: Point,
  goal: Point,
  dynamicBlocked = new Set<string>(),
): Point[] {
  const blocked = blockedCells(layout);
  const startKey = key(start);
  const goalKey = key(goal);
  if (
    !inBounds(layout, start) ||
    !inBounds(layout, goal) ||
    blocked.has(startKey) ||
    blocked.has(goalKey)
  )
    return [];
  if (same(start, goal)) return [];
  if (dynamicBlocked.has(goalKey)) return [];
  const heuristic = (point: Point) => Math.abs(point.x - goal.x) + Math.abs(point.y - goal.y);
  const open = new MinHeap();
  const scores = new Map<string, number>([[startKey, 0]]);
  const previous = new Map<string, Point>();
  let sequence = 0;
  open.push({ point: start, g: 0, f: heuristic(start), sequence: sequence++ });
  while (open.length) {
    const current = open.pop();
    const currentKey = key(current.point);
    if (current.g !== scores.get(currentKey)) continue;
    if (currentKey === goalKey) {
      const path: Point[] = [];
      let point = goal;
      while (!same(point, start)) {
        path.push({ ...point });
        point = previous.get(key(point))!;
      }
      return path.reverse();
    }
    for (const offset of adjacent) {
      const point = { x: current.point.x + offset.x, y: current.point.y + offset.y };
      const pointKey = key(point);
      if (
        !inBounds(layout, point) ||
        blocked.has(pointKey) ||
        (dynamicBlocked.has(pointKey) && pointKey !== startKey)
      )
        continue;
      const g = current.g + 1;
      if (g >= (scores.get(pointKey) ?? Infinity)) continue;
      scores.set(pointKey, g);
      previous.set(pointKey, current.point);
      open.push({ point, g, f: g + heuristic(point), sequence: sequence++ });
    }
  }
  return [];
}

export function validateLayout(layout: Layout): { valid: boolean; reason: string } {
  const fail = (reason: string) => ({ valid: false, reason });
  const isPoint = (p: unknown): p is Point =>
    typeof p === 'object' &&
    p !== null &&
    'x' in p &&
    'y' in p &&
    Number.isInteger(p.x) &&
    Number.isInteger(p.y);
  if (!layout || layout.version !== 1) return fail('布局版本无效');
  if (
    !Number.isInteger(layout.width) ||
    !Number.isInteger(layout.height) ||
    layout.width < 3 ||
    layout.height < 3 ||
    layout.width > 100 ||
    layout.height > 100
  )
    return fail('地图尺寸无效（支持 3–100 格）');
  if (
    !Array.isArray(layout.walls) ||
    layout.walls.length > 10000 ||
    !Array.isArray(layout.fixtures) ||
    layout.fixtures.length > 100 ||
    !Array.isArray(layout.staffSpawns)
  )
    return fail('布局实体数量或格式无效');
  if (!isPoint(layout.entrance) || !isPoint(layout.exit) || !layout.staffSpawns.every(isPoint))
    return fail('入口、出口或员工位置无效');
  const occupied = new Set<string>();
  for (const wall of layout.walls) {
    if (!isPoint(wall) || !inBounds(layout, wall)) return fail('墙壁超出地图或坐标无效');
    occupied.add(key(wall));
  }
  const ids = new Set<string>();
  for (const fixture of layout.fixtures) {
    if (!fixture || !Object.hasOwn(EQUIPMENT, fixture.kind)) return fail('未知设备类型');
    if (!isPoint(fixture) || typeof fixture.id !== 'string' || !fixture.id.length)
      return fail('设备坐标或 ID 无效');
    if (ids.has(fixture.id)) return fail('设备 ID 重复');
    ids.add(fixture.id);
    if (
      !Number.isInteger(fixture.rotation) ||
      !(Math.abs(fixture.rotation) <= 3 || fixture.rotation % 90 === 0)
    )
      return fail('设备旋转必须与网格对齐');
    if (
      fixture.kind === 'table' &&
      fixture.seatCount !== undefined &&
      (!Number.isInteger(fixture.seatCount) ||
        fixture.seatCount < 1 ||
        fixture.seatCount > EQUIPMENT.table.capacity)
    )
      return fail('餐桌座位数必须是 1–4 的整数');
    for (const p of footprint(fixture)) {
      if (!inBounds(layout, p)) return fail('设备不能超出地图');
      if (occupied.has(key(p))) return fail('设备与墙壁或其他设备重叠');
      occupied.add(key(p));
    }
  }
  const walkable = (p: Point) => inBounds(layout, p) && !occupied.has(key(p));
  if (!walkable(layout.entrance) || !walkable(layout.exit)) return fail('入口或出口被阻挡');
  const reachable = new Set<string>([key(layout.entrance)]);
  const queue: Point[] = [layout.entrance];
  for (let i = 0; i < queue.length; i++) {
    for (const offset of adjacent) {
      const p = { x: queue[i].x + offset.x, y: queue[i].y + offset.y };
      if (walkable(p) && !reachable.has(key(p))) {
        reachable.add(key(p));
        queue.push(p);
      }
    }
  }
  if (!reachable.has(key(layout.exit))) return fail('出口无法从入口到达');
  if (layout.staffSpawns.some((p) => !walkable(p) || !reachable.has(key(p))))
    return fail('员工初始位置被阻挡或无法到达');
  for (const fixture of layout.fixtures) {
    const accessible = interactionCells(layout, fixture).filter((p) => reachable.has(key(p)));
    if (!accessible.length) return fail(`${EQUIPMENT[fixture.kind].name} 没有可到达的操作位置`);
    if (fixture.kind === 'table' && accessible.length < (fixture.seatCount ?? 4))
      return fail('餐桌周围没有足够可到达的座位');
  }
  return { valid: true, reason: '布局有效' };
}
