import type { Actor, Layout, Point } from '../types';
import { findPath, isWalkable, key, same } from './grid';

const neighbors = (p: Point) => [
  { x: p.x + 1, y: p.y },
  { x: p.x - 1, y: p.y },
  { x: p.x, y: p.y + 1 },
  { x: p.x, y: p.y - 1 },
];
export function occupiedCells(actors: Actor[], except?: string): Set<string> {
  const cells = new Set<string>();
  for (const actor of actors)
    if (actor.id !== except) {
      cells.add(key(actor.cell));
      if (actor.movingTo) cells.add(key(actor.movingTo));
    }
  return cells;
}

export function setDestination(layout: Layout, actor: Actor, target: Point) {
  if (actor.target && same(actor.target, target)) return;
  actor.target = { ...target };
  actor.path = findPath(layout, actor.movingTo ?? actor.cell, target);
  actor.blockedTime = 0;
}

export function arrived(actor: Actor): boolean {
  return !!actor.target && !actor.movingTo && same(actor.cell, actor.target);
}

/** Exclusive cell reservations include both ends of a moving edge; no swaps or crossing. */
export function moveActors(
  layout: Layout,
  actors: Actor[],
  dt: number,
  tick: number,
  onMove: (a: Actor) => void,
) {
  // Fair rotating priority rather than permanent employee/customer ordering.
  const ordered = actors.length
    ? [...actors.slice(tick % actors.length), ...actors.slice(0, tick % actors.length)]
    : [];
  for (const actor of ordered) {
    if (!actor.target || (same(actor.cell, actor.target) && !actor.movingTo)) continue;
    if (!actor.movingTo) {
      const occupied = occupiedCells(actors, actor.id);
      let next = actor.path[0];
      if (!next || occupied.has(key(next))) {
        actor.blockedTime += dt;
        actor.waitingTime += dt;
        actor.state = 'Blocked';
        if (actor.blockedTime >= 1.5 && Math.floor(actor.blockedTime / dt) % 4 === 0) {
          actor.path = findPath(layout, actor.cell, actor.target, occupied);
          next = actor.path[0];
          // Ask an idle obstruction to yield into a free side cell. No teleportation.
          if (!next) {
            const staticPath = findPath(layout, actor.cell, actor.target);
            const blocker = actors.find(
              (a) =>
                !a.taskId &&
                a.role !== 'customer' &&
                !a.movingTo &&
                staticPath.some((p) => same(a.cell, p)),
            );
            if (blocker) {
              const choices = neighbors(blocker.cell).filter(
                (p) =>
                  isWalkable(layout, p) &&
                  !occupiedCells(actors, blocker.id).has(key(p)) &&
                  !same(p, actor.target!),
              );
              // Prefer leaving the route; moving farther along it is useful when the doorway has no side cell.
              choices.sort(
                (a, b) =>
                  Number(staticPath.some((p) => same(p, a))) -
                  Number(staticPath.some((p) => same(p, b))),
              );
              const free = choices[0];
              if (free) setDestination(layout, blocker, free);
            }
          }
        }
        if (!next || occupied.has(key(next))) continue;
      }
      if (!isWalkable(layout, next)) {
        actor.path = findPath(layout, actor.cell, actor.target);
        continue;
      }
      actor.movingTo = { ...next };
      actor.path.shift();
      actor.blockedTime = 0;
      onMove(actor);
    }
    const target = actor.movingTo;
    const dx = target.x - actor.position.x,
      dy = target.y - actor.position.y;
    const distance = Math.hypot(dx, dy);
    const travel = Math.min(distance, actor.speed * dt);
    if (distance > 0) {
      actor.position.x += (dx / distance) * travel;
      actor.position.y += (dy / distance) * travel;
      actor.facing = { x: dx / distance, y: dy / distance };
    }
    actor.totalWalking += travel / actor.speed;
    if (distance <= travel + 1e-8) {
      actor.cell = { ...target };
      actor.position = { ...target };
      actor.movingTo = undefined;
    }
    if (actor.role !== 'customer' && actor.state !== 'Delivering') actor.state = 'Walking';
  }
}
