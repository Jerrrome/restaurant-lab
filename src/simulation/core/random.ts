import type { DemandEvent } from '../types';
import { RECIPES } from '../../data/catalog';

export function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let x = Math.imul(value ^ (value >>> 15), 1 | value);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate all customer preferences before running: layouts cannot change demand RNG calls. */
export function generateDemand(
  seed: number,
  closeTime: number,
  interval: number,
  menu = RECIPES.map((r) => r.id),
): DemandEvent[] {
  const random = seededRandom(seed);
  const result: DemandEvent[] = [];
  let arrival = 12;
  while (arrival < closeTime - 300) {
    const size = random() < 0.3 ? 2 : 1;
    result.push({
      id: `party-${result.length + 1}`,
      arrival,
      size,
      recipes: Array.from({ length: size }, () => menu[Math.floor(random() * menu.length)]),
      diningFactor: 0.75 + random() * 0.6,
      restroom: random() < 0.16,
      patience: 1100 + random() * 700,
    });
    arrival += interval * (0.6 + random() * 0.8);
  }
  return result;
}
