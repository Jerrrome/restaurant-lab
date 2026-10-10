import { describe, expect, it } from 'vitest';
import { BASELINE_LAYOUT, cloneLayout } from '../data/scenarios';
import { footprint, key, same, validateLayout } from '../simulation/navigation/grid';
import {
  arrived,
  moveActors,
  occupiedCells,
  setDestination,
} from '../simulation/navigation/movement';
import type { Actor, Layout, Point } from '../simulation/types';

const DT = 0.25;
const actor = (id: string, position: Point, role: Actor['role'] = 'chef'): Actor => ({
  id,
  name: id,
  role,
  position: { ...position },
  cell: { ...position },
  home: { ...position },
  radius: role === 'customer' ? 0.24 : 0.27,
  facing: { x: 0, y: 1 },
  state: 'Idle',
  path: [],
  blockedTime: 0,
  totalWalking: 0,
  busyTime: 0,
  waitingTime: 0,
  speed: role === 'customer' ? 1.35 : 1.65,
});

/** Assert circles against tile AABBs, not only the actors' rounded grid cells. */
const assertPhysicalSafety = (layout: Layout, actors: Actor[]) => {
  const obstacles = [...layout.walls, ...layout.fixtures.flatMap(footprint)];
  const reserved = new Map<string, string>();
  for (const person of actors) {
    for (const cell of [person.cell, ...(person.movingTo ? [person.movingTo] : [])]) {
      const owner = reserved.get(key(cell));
      if (owner && owner !== person.id)
        throw new Error(`Shared reserved cell: ${key(cell)} by ${owner}/${person.id}`);
      reserved.set(key(cell), person.id);
    }
    for (const obstacle of obstacles) {
      const nearestX = Math.max(obstacle.x - 0.5, Math.min(person.position.x, obstacle.x + 0.5));
      const nearestY = Math.max(obstacle.y - 0.5, Math.min(person.position.y, obstacle.y + 0.5));
      const separation = Math.hypot(person.position.x - nearestX, person.position.y - nearestY);
      if (separation + 1e-9 < person.radius)
        throw new Error(`${person.id} penetrated static obstacle ${key(obstacle)}`);
    }
  }
  for (let i = 0; i < actors.length; i++) {
    for (let j = i + 1; j < actors.length; j++) {
      const first = actors[i];
      const second = actors[j];
      const separation = Math.hypot(
        first.position.x - second.position.x,
        first.position.y - second.position.y,
      );
      if (separation + 1e-9 < first.radius + second.radius)
        throw new Error(`Overlapping circles: ${first.id}/${second.id}`);
    }
  }
};

const runMovement = (layout: Layout, actors: Actor[], seconds = 100) => {
  const moves: { id: string; from: Point; to: Point }[] = [];
  let blockedTicks = 0;
  assertPhysicalSafety(layout, actors);
  for (let tick = 0; tick < seconds / DT; tick++) {
    const positions = new Map(actors.map((a) => [a.id, { ...a.position }]));
    moveActors(layout, actors, DT, tick, (a) =>
      moves.push({ id: a.id, from: { ...a.cell }, to: { ...a.movingTo! } }),
    );
    if (actors.some((a) => a.state === 'Blocked')) blockedTicks++;
    assertPhysicalSafety(layout, actors);
    for (const person of actors) {
      const before = positions.get(person.id)!;
      const displacement = Math.hypot(person.position.x - before.x, person.position.y - before.y);
      if (displacement > person.speed * DT + 1e-9)
        throw new Error(`${person.id} moved faster than its simulated speed`);
    }
  }
  return { moves, blockedTicks };
};

describe('dynamic movement recovery', () => {
  it('reserves both ends of an in-flight edge, so another actor cannot swap through it', () => {
    const first = actor('first', { x: 5, y: 9 });
    const second = actor('second', { x: 9, y: 9 });
    setDestination(BASELINE_LAYOUT, first, { x: 9, y: 9 });
    moveActors(BASELINE_LAYOUT, [first, second], DT, 0, () => {});
    expect(first.position.x).toBeCloseTo(5 + first.speed * DT);
    expect(first.cell).toEqual({ x: 5, y: 9 });
    expect(first.movingTo).toEqual({ x: 6, y: 9 });
    const occupied = occupiedCells([first, second], second.id);
    expect(occupied.has('5,9')).toBe(true);
    expect(occupied.has('6,9')).toBe(true);
    assertPhysicalSafety(BASELINE_LAYOUT, [first, second]);
  });

  it('opposing working chefs wait and replan around one another, then both arrive', () => {
    const first = actor('left-chef', { x: 5, y: 9 });
    const second = actor('right-chef', { x: 9, y: 9 });
    // Active tasks prevent idle-yield shortcuts: this specifically exercises replanning.
    first.taskId = 'task-left';
    second.taskId = 'task-right';
    setDestination(BASELINE_LAYOUT, first, { x: 9, y: 9 });
    setDestination(BASELINE_LAYOUT, second, { x: 5, y: 9 });
    const result = runMovement(BASELINE_LAYOUT, [first, second]);
    expect(result.blockedTicks).toBeGreaterThan(0);
    expect(first.waitingTime + second.waitingTime).toBeGreaterThan(0);
    expect(result.moves.some((move) => move.to.y !== 9)).toBe(true);
    expect(arrived(first)).toBe(true);
    expect(arrived(second)).toBe(true);
    expect(first.position).toEqual({ x: 9, y: 9 });
    expect(second.position).toEqual({ x: 5, y: 9 });
  });

  it('asks idle staff blocking a one-cell doorway to physically yield without teleporting', () => {
    const layout = cloneLayout(BASELINE_LAYOUT);
    for (let y = 1; y < layout.height - 1; y++) if (y !== 10) layout.walls.push({ x: 16, y });
    expect(validateLayout(layout).valid).toBe(true);
    const working = actor('working-chef', { x: 15, y: 10 });
    const idle = actor('idle-waiter', { x: 16, y: 10 }, 'waiter');
    working.taskId = 'real-task';
    setDestination(layout, working, { x: 18, y: 10 });
    const result = runMovement(layout, [working, idle]);
    expect(result.blockedTicks).toBeGreaterThan(0);
    expect(result.moves.some((move) => move.id === idle.id)).toBe(true);
    expect(idle.totalWalking).toBeGreaterThan(0);
    expect(same(idle.cell, { x: 16, y: 10 })).toBe(false);
    expect(arrived(working)).toBe(true);
    expect(working.position).toEqual({ x: 18, y: 10 });
  });

  it('keeps intersecting chef and customer routes clear of circles, walls, and equipment for 100 seconds', () => {
    const people = [
      actor('chef-a', { x: 12, y: 9 }),
      actor('chef-b', { x: 16, y: 9 }),
      actor('customer-a', { x: 16, y: 12 }, 'customer'),
      actor('customer-b', { x: 12, y: 12 }, 'customer'),
    ];
    const goals = [
      { x: 16, y: 12 },
      { x: 12, y: 12 },
      { x: 12, y: 9 },
      { x: 16, y: 9 },
    ];
    people.forEach((person, i) => {
      person.taskId = `task-${i}`;
      setDestination(BASELINE_LAYOUT, person, goals[i]);
    });
    const result = runMovement(BASELINE_LAYOUT, people);
    expect(result.moves.length).toBeGreaterThan(20);
    expect(people.every(arrived)).toBe(true);
    expect(people.every((a) => a.totalWalking > 0)).toBe(true);
  });
});
