import { beforeAll, describe, expect, it } from 'vitest';
import { EQUIPMENT, INGREDIENTS, RECIPES } from '../data/catalog';
import { ALTERNATIVE_LAYOUT, BASELINE_LAYOUT, cloneLayout } from '../data/scenarios';
import { ASSUMPTIONS, FIXED_STEP, RestaurantSimulation } from '../simulation/core/engine';
import {
  processIngredients,
  selectInputs,
  validateProcessing,
} from '../simulation/core/processing';
import { generateDemand } from '../simulation/core/random';
import { validateRecipe } from '../simulation/core/recipe-validation';
import { interactionCells, isWalkable, key, same } from '../simulation/navigation/grid';
import { arrived, moveActors, setDestination } from '../simulation/navigation/movement';
import type { Ingredient, RecipeStep, SimulationOptions } from '../simulation/types';

/** No rendering imports: these checks exercise the same world used by the game. */
function runDay(options: SimulationOptions = {}, sample?: (sim: RestaurantSimulation) => void) {
  const sim = new RestaurantSimulation(options);
  sim.start();
  while (!sim.ended && sim.time <= sim.closeTime + 7200) {
    sim.step();
    if (Math.round(sim.time / FIXED_STEP) % 40 === 0) sample?.(sim);
  }
  return sim;
}

function stateDigest(sim: RestaurantSimulation) {
  return {
    time: sim.time,
    actors: sim.actors,
    parties: sim.parties,
    orders: sim.orders,
    tasks: sim.tasks,
    serviceTasks: sim.serviceTasks,
    equipment: sim.equipment,
    inventory: sim.inventory,
    riceStock: sim.riceStock,
    metrics: sim.getMetrics(),
    events: sim.events,
  };
}

const raw = (id: string, name: string, tags = INGREDIENTS[name].tags): Ingredient => ({
  id,
  name,
  category: INGREDIENTS[name].category,
  quantity: 1,
  unit: 'portion',
  processingState: [...tags],
  temperature: 20,
  freshness: 1,
  cost: INGREDIENTS[name].cost,
  consumed: false,
});

const pan = RECIPES.find((r) => r.id === 'pan-chicken')!;
const sear = pan.steps.find((s) => s.id === 'sear')!;
const assemble = pan.steps.find((s) => s.id === 'assemble')!;

function invariantErrors(sim: RestaurantSimulation): string[] {
  const errors: string[] = [];
  const cells = new Set<string>();
  for (const actor of sim.actors) {
    for (const cell of [actor.cell, ...(actor.movingTo ? [actor.movingTo] : [])]) {
      if (!isWalkable(sim.layout, cell))
        errors.push(`static collision ${actor.id} at ${key(cell)}`);
      if (cells.has(key(cell))) errors.push(`shared collision cell ${key(cell)}`);
      cells.add(key(cell));
    }
  }
  for (let i = 0; i < sim.actors.length; i++)
    for (let j = i + 1; j < sim.actors.length; j++) {
      const a = sim.actors[i],
        b = sim.actors[j];
      if (
        Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) <
        a.radius + b.radius - 1e-6
      )
        errors.push(`actor penetration ${a.id}/${b.id}`);
    }
  const locks = new Set<string>();
  for (const equipment of sim.equipment) {
    const fixture = sim.getFixture(equipment.fixtureId)!;
    if (equipment.slots.length !== EQUIPMENT[fixture.kind].capacity)
      errors.push(`wrong capacity ${fixture.id}`);
    for (const taskId of equipment.slots.filter((id): id is string => !!id)) {
      if (locks.has(taskId)) errors.push(`task holds duplicate equipment lock ${taskId}`);
      locks.add(taskId);
    }
  }
  const activeActors = new Set<string>(),
    workCells = new Set<string>();
  for (const task of sim.tasks.filter((t) => ['walking', 'active', 'finish'].includes(t.status))) {
    if (task.actorId) {
      if (activeActors.has(task.actorId)) errors.push(`chef assigned twice ${task.actorId}`);
      activeActors.add(task.actorId);
    }
    if (task.interaction) {
      if (workCells.has(key(task.interaction)))
        errors.push(`duplicate exclusive work position ${key(task.interaction)}`);
      workCells.add(key(task.interaction));
    }
  }
  for (const task of sim.serviceTasks.filter(
    (t) => t.status === 'walking' || t.status === 'active',
  )) {
    if (task.actorId) {
      if (activeActors.has(task.actorId)) errors.push(`staff assigned twice ${task.actorId}`);
      activeActors.add(task.actorId);
    }
    if (task.target) {
      if (workCells.has(key(task.target)))
        errors.push(`kitchen/service share exclusive work position ${key(task.target)}`);
      workCells.add(key(task.target));
    }
  }
  for (const table of sim.tables) {
    if (table.occupiedSeats > table.seatCount || table.occupiedSeats < 0)
      errors.push(`table capacity ${table.fixtureId}`);
    if (table.status === 'Available' && table.currentParty)
      errors.push(`available but occupied ${table.fixtureId}`);
  }
  if (Object.values(sim.inventory).some((q) => q < 0)) errors.push('negative inventory');
  if (sim.riceStock < 0) errors.push('negative cooked rice inventory');
  const booked = sim.orders
    .filter((o) => o.status === 'paid')
    .reduce((sum, o) => sum + RECIPES.find((r) => r.id === o.recipeId)!.price, 0);
  if (Math.abs(sim.revenue - booked) > 1e-8) errors.push('revenue differs from paid orders');
  const seats = sim.parties
    .filter((p) => p.tableId && p.state !== 'Leaving')
    .flatMap((p) => p.seatTargets.map(key));
  if (new Set(seats).size !== seats.length) errors.push('multiple parties share reserved seats');

  return errors;
}

describe('ingredient states and legal processing', () => {
  it('rejects incorrect state, unsupported equipment, and absent tools', () => {
    const ingredients = [raw('chicken', 'chicken'), raw('seasoning', 'seasoning')];
    expect(validateProcessing(sear, EQUIPMENT.stove, ingredients)).toBeUndefined();
    expect(validateProcessing(sear, { ...EQUIPMENT.stove, tools: [] }, ingredients)).toContain(
      '工具',
    );
    expect(validateProcessing(sear, EQUIPMENT.fryer, ingredients)).toContain('不支持');
    expect(
      validateProcessing(assemble, EQUIPMENT.prep, [
        raw('chicken', 'chicken'),
        raw('rice', 'rice', ['cooked']),
      ]),
    ).toContain('状态');
  });

  it('consumes concrete input tokens once and refuses reuse or assembling raw chicken', () => {
    const ingredients = [raw('chicken', 'chicken'), raw('seasoning', 'seasoning')];
    let sequence = 0;
    const cooked = processIngredients(sear, ingredients, () => `processed-${++sequence}`);
    expect(ingredients.every((i) => i.consumed)).toBe(true);
    expect(cooked[0].processingState).toEqual(expect.arrayContaining(['cooked', 'seared']));
    expect(cooked[0].cost).toBeCloseTo(ingredients.reduce((sum, i) => sum + i.cost, 0));
    expect(() => processIngredients(sear, ingredients, () => 'duplicate')).toThrow('缺少');
    const cookedRice = raw('cooked-rice', 'rice', ['cooked']);
    const plate = processIngredients(
      assemble,
      [...cooked, cookedRice],
      () => `processed-${++sequence}`,
    );
    expect(plate[0].name).toBe('pan-chicken');
    expect(cooked[0].consumed).toBe(true);
    expect(cookedRice.consumed).toBe(true);
    expect(new Set([...cooked, ...plate].map((i) => i.id)).size).toBe(2);
    const invalidChicken = raw('raw', 'chicken');
    expect(() =>
      processIngredients(assemble, [invalidChicken, raw('rice', 'rice')], () => 'bad'),
    ).toThrow();
    expect(invalidChicken.consumed).toBe(false);
  });

  it('conserves batch ingredient costs across multiple output portions', () => {
    const step: RecipeStep = {
      id: 'batch',
      label: 'batch',
      method: 'CookRice',
      equipment: 'rice',
      dependencies: [],
      activeTime: 5,
      passiveTime: 90,
      inputs: [{ name: 'rice', tags: ['raw'], quantity: 6 }],
      outputs: [{ name: 'rice', tags: ['cooked'], quantity: 6 }],
    };
    const ingredients = Array.from({ length: 6 }, (_, i) => raw(`rice-${i}`, 'rice'));
    let id = 0;
    const result = processIngredients(step, ingredients, () => `cooked-${++id}`);
    expect(result).toHaveLength(6);
    expect(result.reduce((sum, i) => sum + i.cost, 0)).toBeCloseTo(
      ingredients.reduce((sum, i) => sum + i.cost, 0),
    );
    expect(result.every((i) => Math.abs(i.cost - INGREDIENTS.rice.cost) < 1e-8)).toBe(true);
    expect(ingredients.every((i) => i.consumed)).toBe(true);
  });

  it('excludes reserved tokens and cannot use one token for duplicate requirements', () => {
    const ingredients = [raw('chicken', 'chicken'), raw('seasoning', 'seasoning')];
    expect(selectInputs(sear, ingredients, new Set(['chicken']))).toBeUndefined();
    const doubleInput: RecipeStep = { ...sear, inputs: [sear.inputs[0], sear.inputs[0]] };
    expect(selectInputs(doubleInput, ingredients)).toBeUndefined();
  });
});

describe('dynamic actor collision and recovery', () => {
  it('opposing actors detour rather than swap through or overlap each other', () => {
    const sim = new RestaurantSimulation({ closeTime: 600 });
    const a = sim.createActor('test-a', 'A', 'chef', { x: 3, y: 9 });
    const b = sim.createActor('test-b', 'B', 'customer', { x: 8, y: 9 });
    const actors = [a, b];
    setDestination(sim.layout, a, { x: 8, y: 9 });
    setDestination(sim.layout, b, { x: 3, y: 9 });
    let moveEvents = 0,
      blocked = false;
    for (let tick = 0; tick < 400 && (!arrived(a) || !arrived(b)); tick++) {
      const before = actors.map((actor) => ({ ...actor.position }));
      moveActors(sim.layout, actors, FIXED_STEP, tick, () => moveEvents++);
      expect(
        Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y),
      ).toBeGreaterThanOrEqual(a.radius + b.radius);
      blocked ||= actors.some((actor) => actor.state === 'Blocked' || actor.waitingTime > 0);
      for (let i = 0; i < actors.length; i++) {
        expect(
          Math.hypot(actors[i].position.x - before[i].x, actors[i].position.y - before[i].y),
        ).toBeLessThanOrEqual(actors[i].speed * FIXED_STEP + 1e-8);
        expect(isWalkable(sim.layout, actors[i].cell)).toBe(true);
      }
    }
    expect(blocked).toBe(true);
    expect(moveEvents).toBeGreaterThan(0);
    expect(arrived(a) && arrived(b)).toBe(true);
  });
});

describe('data-driven recipe DAG validation', () => {
  it('accepts all shipped recipes', () => {
    for (const recipe of RECIPES) expect(() => validateRecipe(recipe)).not.toThrow();
  });

  it('rejects duplicate step IDs, missing dependencies, and cycles before simulation', () => {
    const duplicate = structuredClone(pan);
    duplicate.steps[1].id = duplicate.steps[0].id;
    expect(() => validateRecipe(duplicate)).toThrow('重复');
    const missing = structuredClone(pan);
    missing.steps[0].dependencies = ['nonexistent'];
    expect(() => validateRecipe(missing)).toThrow('不存在');
    const cyclic = structuredClone(pan);
    cyclic.steps[0].dependencies = ['assemble'];
    expect(() => validateRecipe(cyclic)).toThrow('循环');
  });

  it('rejects impossible tools, invalid durations, and nonpositive material counts', () => {
    const tool = structuredClone(pan);
    tool.steps.find((s) => s.id === 'assemble')!.tool = 'wok';
    expect(() => validateRecipe(tool)).toThrow('工具');
    const time = structuredClone(pan);
    time.steps[0].activeTime = -1;
    expect(() => validateRecipe(time)).toThrow('时长');
    const material = structuredClone(pan);
    material.steps[0].outputs[0].quantity = 0;
    expect(() => validateRecipe(material)).toThrow('食材');
  });
});

describe('fixed timestep, pause, and reproducibility', () => {
  it('pause stops the rendered simulation clock and all task progress', () => {
    const sim = new RestaurantSimulation({ closeTime: 600 });
    sim.start();
    sim.advance(25);
    sim.setPaused(true);
    const before = structuredClone(stateDigest(sim));
    sim.advance(120);
    expect(stateDigest(sim)).toEqual(before);
  });

  it('the same simulated duration gives identical state at 1× and 60×', () => {
    const normal = new RestaurantSimulation({ seed: 6789, closeTime: 900 });
    const fast = new RestaurantSimulation({ seed: 6789, closeTime: 900 });
    normal.start();
    fast.start();
    fast.speed = 60;
    for (let i = 0; i < 2400; i++) normal.advance(0.25);
    for (let i = 0; i < 40; i++) fast.advance(0.25);
    expect(normal.time).toBe(600);
    expect(stateDigest(fast)).toEqual(stateDigest(normal));
  });

  it('same seed yields an identical complete day, independently of rendering', () => {
    const options = { seed: 972, closeTime: 900, arrivalInterval: 220 };
    const a = runDay(options),
      b = runDay(options);
    expect(a.ended && b.ended).toBe(true);
    expect(stateDigest(a)).toEqual(stateDigest(b));
    expect(generateDemand(972, 900, 220)).not.toEqual(generateDemand(973, 900, 220));
  });
});

describe('complete 11:00–14:00 lunch with live invariants', () => {
  let day: RestaurantSimulation;
  const violations: string[] = [];
  beforeAll(() => {
    day = runDay({}, (sim) => {
      for (const error of invariantErrors(sim))
        if (!violations.includes(error)) violations.push(error);
    });
  }, 60000);

  it('finishes a real full lunch, serves customers, uses equipment, and moves staff', () => {
    expect(day.closeTime).toBe(10800);
    expect(day.ended, JSON.stringify(day.events.slice(-15))).toBe(true);
    expect(day.getMetrics().customersServed).toBeGreaterThan(0);
    expect(day.getMetrics().ordersCompleted).toBeGreaterThan(0);
    expect(day.revenue).toBeGreaterThan(0);
    expect(day.equipment.filter((e) => e.uses > 0).length).toBeGreaterThanOrEqual(6);
    expect(day.actors.filter((a) => a.role !== 'customer').every((a) => a.totalWalking > 0)).toBe(
      true,
    );
    expect(day.events.some((e) => e.type === 'move')).toBe(true);
    expect(day.events.some((e) => e.type === 'day-ended')).toBe(true);
  });

  it('never violates physical collisions, station locks, capacity, or stock limits', () => {
    expect(violations).toEqual([]);
    expect(day.equipment.every((e) => e.slots.every((slot) => slot === null))).toBe(true);
    expect(day.getMetrics().staffUtilization).toBeGreaterThan(0);
    expect(day.getMetrics().staffUtilization).toBeLessThanOrEqual(1);
    for (const fixture of day.layout.fixtures)
      expect(day.getEquipmentUtilization(fixture.id)).toBeLessThanOrEqual(1);
  });

  it('respects the recipe DAG and actually spends the defined active and passive time', () => {
    const completed = day.tasks.filter((t) => t.status === 'done');
    expect(completed.some((t) => t.step.method === 'DeepFry')).toBe(true);
    for (const task of completed) {
      for (const dependency of task.step.dependencies) {
        const previous = day.tasks.find(
          (t) => t.orderId === task.orderId && t.step.id === dependency,
        )!;
        expect(previous.status).toBe('done');
        expect(previous.completedAt!).toBeLessThanOrEqual(task.startedAt!);
      }
      expect(task.active + FIXED_STEP).toBeGreaterThanOrEqual(
        task.step.activeTime + (task.step.finishTime ?? 0),
      );
      expect(task.passive + FIXED_STEP).toBeGreaterThanOrEqual(task.step.passiveTime);
    }
  });

  it('charges only actually debited stock and pays wages/overhead over simulated time', () => {
    const stockCost = Object.entries(day.inventory).reduce(
      (sum, [name, remaining]) => sum + (400 - remaining) * INGREDIENTS[name].cost,
      0,
    );
    const metrics = day.getMetrics();
    expect(metrics.foodCost).toBeCloseTo(stockCost, 7);
    expect(metrics.laborCost).toBeCloseTo(
      ((2 * ASSUMPTIONS.chefHourlyWage + ASSUMPTIONS.waiterHourlyWage) * day.time) / 3600,
    );
    expect(metrics.operatingCost).toBeGreaterThanOrEqual(ASSUMPTIONS.dailyRent);
    expect(metrics.profit).toBeCloseTo(
      metrics.revenue - metrics.foodCost - metrics.laborCost - metrics.operatingCost,
    );
  });

  it('counts each payment once and leaves cleaned tables and no customer actors', () => {
    const paid = day.orders.filter((o) => o.status === 'paid');
    expect(day.revenue).toBeCloseTo(
      paid.reduce((sum, o) => sum + RECIPES.find((r) => r.id === o.recipeId)!.price, 0),
    );
    expect(new Set(day.orders.map((o) => o.id)).size).toBe(day.orders.length);
    expect(new Set(day.tasks.map((t) => t.id)).size).toBe(day.tasks.length);
    expect(day.getMetrics().customersServed).toBe(
      day.parties.filter((p) => p.paidAt !== undefined).reduce((sum, p) => sum + p.demand.size, 0),
    );
    for (const order of paid) {
      expect(order.readyAt!).toBeGreaterThan(order.createdAt);
      expect(order.servedAt!).toBeGreaterThan(order.readyAt!);
      expect(order.paidAt!).toBeGreaterThan(order.servedAt!);
      expect(order.deliveryTime).toBeGreaterThan(0);
      expect(
        day.tasks.filter((t) => t.orderId === order.id).every((t) => t.status === 'done'),
      ).toBe(true);
    }
    expect(day.actors.some((a) => a.role === 'customer')).toBe(false);
    expect(day.tables.every((t) => t.status === 'Available' && t.occupiedSeats === 0)).toBe(true);
    expect(day.serviceTasks.some((t) => t.kind === 'clean' && t.status === 'done')).toBe(true);
    expect(
      day.orders.filter((o) => o.status === 'cancelled').every((o) => o.paidAt === undefined),
    ).toBe(true);
  });
});

describe('physical intermediate ingredients, pickup points, and reachable queues', () => {
  it('removes queued arrivals when an unspawned party loses patience at a blocked entrance', () => {
    const sim = new RestaurantSimulation({
      closeTime: 600,
      arrivalInterval: 900,
      menu: ['pan-chicken'],
    });
    sim.demand[0].patience = 40;
    const blocker = sim.createActor(
      'entrance-blocker',
      'Temporary obstruction',
      'customer',
      sim.layout.entrance,
    );
    sim.actors.push(blocker);
    sim.start();
    while (sim.time < 64) sim.step();
    expect(sim.parties).toHaveLength(1);
    expect(sim.parties[0].state).toBe('Leaving');
    expect(sim.parties[0].memberIds).toHaveLength(0);
    sim.actors.splice(sim.actors.indexOf(blocker), 1);
    while (!sim.ended && sim.time < 1000) sim.step();
    expect(sim.ended).toBe(true);
    expect(sim.events.some((e) => e.type === 'arrival')).toBe(false);
    expect(sim.actors.some((a) => a.role === 'customer')).toBe(false);
    expect(sim.lostCustomers).toBe(sim.demand[0].size);
  });

  it('chooses a reachable waiting position when a nearby empty cell is isolated', () => {
    const layout = cloneLayout(BASELINE_LAYOUT);
    // The checkout below (25,2) and these three walls form an isolated pocket.
    layout.walls.push({ x: 24, y: 2 }, { x: 26, y: 2 }, { x: 25, y: 1 });
    const sim = new RestaurantSimulation({
      layout,
      closeTime: 600,
      arrivalInterval: 900,
      menu: ['pan-chicken'],
    });
    expect(isWalkable(layout, { x: 25, y: 2 })).toBe(true);
    expect(sim.canReach(layout.entrance, { x: 25, y: 2 })).toBe(false);
    const queue = sim.freeCellNear({ x: 26, y: 3 });
    expect(queue).not.toEqual({ x: 25, y: 2 });
    expect(sim.canReach(layout.entrance, queue)).toBe(true);
    sim.start();
    while (!sim.ended && sim.time < 2400) sim.step();
    expect(sim.ended).toBe(true);
    expect(sim.getMetrics().customersServed).toBeGreaterThan(0);
    expect(sim.actors.some((a) => a.role === 'customer')).toBe(false);
  });

  it('physically collects each intermediate ingredient at its source before processing elsewhere', () => {
    const sim = new RestaurantSimulation({
      menu: ['katsu-curry'],
      closeTime: 600,
      arrivalInterval: 900,
    });
    sim.demand[0].restroom = false;
    sim.start();
    const pickups = new Map<string, Set<string>>();
    let observedWork = 0,
      observedHeldIngredient = false;
    while (!sim.ended && sim.time < 2400) {
      sim.step();
      for (const event of sim.events.filter(
        (e) => e.time === sim.time && e.type === 'ingredient-pickup',
      )) {
        const actor = sim.actors.find((a) => a.id === event.actorId)!;
        const station = sim.getFixture(event.fixtureId!)!;
        const task = sim.tasks.find((t) => t.id === event.taskId)!;
        expect(interactionCells(sim.layout, station).some((p) => same(p, actor.cell))).toBe(true);
        expect(event.position).toBeDefined();
        expect(interactionCells(sim.layout, station).some((p) => same(p, event.position!))).toBe(
          true,
        );
        const sources = pickups.get(task.id) ?? new Set<string>();
        sources.add(station.id);
        pickups.set(task.id, sources);
        const order = sim.orders.find((o) => o.id === task.orderId);
        if (
          order?.ingredients.some(
            (i) => i.heldBy === actor.id && i.locationFixtureId === station.id,
          )
        )
          observedHeldIngredient = true;
      }
      for (const event of sim.events.filter(
        (e) => e.time === sim.time && e.type === 'work-start',
      )) {
        const task = sim.tasks.find((t) => t.id === event.taskId)!;
        const actor = sim.actors.find((a) => a.id === event.actorId)!;
        const destination = sim.getFixture(task.fixtureId!)!;
        expect(interactionCells(sim.layout, destination).some((p) => same(p, actor.cell))).toBe(
          true,
        );
        expect(event.position).toBeDefined();
        expect(
          interactionCells(sim.layout, destination).some((p) => same(p, event.position!)),
        ).toBe(true);
        for (const source of task.pickupFixtureIds ?? [])
          expect(pickups.get(task.id)?.has(source)).toBe(true);
        observedWork++;
      }
    }
    expect(sim.ended).toBe(true);
    expect(observedWork).toBeGreaterThan(8);
    expect(observedHeldIngredient).toBe(true);
    const assembly = sim.tasks.find((t) => t.step.id === 'assemble')!;
    expect(assembly.pickupFixtureIds).toEqual(
      expect.arrayContaining(['fryer-1', 'rice-1', 'stove-1']),
    );
    const batch = sim.tasks.find((t) => t.step.id === 'cook-rice')!;
    expect(batch.pickupFixtureIds).toEqual(['storage-1']);
    const cut = sim.tasks.find((t) => t.step.id === 'cut-chicken')!;
    expect(cut.pickupFixtureIds).toEqual(['fridge-1']);
  });

  it('takes the finished dish from its actual serving counter when a second counter exists', () => {
    const layout = cloneLayout(BASELINE_LAYOUT);
    layout.fixtures.push({ id: 'serving-extra', kind: 'serving', x: 5, y: 6, rotation: 0 });
    const sim = new RestaurantSimulation({
      layout,
      menu: ['pan-chicken'],
      closeTime: 600,
      arrivalInterval: 900,
    });
    sim.start();
    let pickups = 0;
    const counters = new Set<string>();
    while (!sim.ended && sim.time < 2400) {
      const previous = new Map(
        sim.serviceTasks
          .filter((t) => t.kind === 'deliver')
          .map((t) => [t.id, { phase: t.phase, source: t.fixtureId }]),
      );
      sim.step();
      for (const task of sim.serviceTasks.filter(
        (t) => t.kind === 'deliver' && t.phase === 1 && previous.get(t.id)?.phase === 0,
      )) {
        const order = sim.orders.find((o) => o.id === task.orderId)!;
        const source = previous.get(task.id)!.source!;
        const event = sim.events.find(
          (e) => e.time === sim.time && e.type === 'meal-picked-up' && e.orderId === order.id,
        )!;
        expect(event.fixtureId).toBe(order.servingFixtureId);
        expect(
          interactionCells(sim.layout, sim.getFixture(source)!).some((p) =>
            same(p, event.position!),
          ),
        ).toBe(true);
        const waiter = sim.actors.find((a) => a.id === task.actorId)!;
        expect(source).toBe(order.servingFixtureId);
        expect(
          interactionCells(sim.layout, sim.getFixture(source)!).some((p) => same(p, waiter.cell)),
        ).toBe(true);
        expect(order.status).toBe('delivering');
        counters.add(source);
        pickups++;
      }
    }
    expect(sim.ended).toBe(true);
    expect(pickups).toBeGreaterThan(0);
    expect(counters.has('serving-extra')).toBe(true);
    expect(
      sim.orders.every(
        (o) =>
          o.servingFixtureId ===
          sim.tasks.find((t) => t.orderId === o.id && t.step.method === 'Pass')!.fixtureId,
      ),
    ).toBe(true);
  });

  it('reserves a single restroom slot, retains seats, and returns before payment', () => {
    const sim = new RestaurantSimulation({
      menu: ['pan-chicken'],
      closeTime: 600,
      arrivalInterval: 900,
    });
    sim.demand[0].size = 1;
    sim.demand[0].recipes = ['pan-chicken'];
    sim.demand[0].restroom = true;
    sim.demand[0].diningFactor = 1;
    sim.demand.push({
      ...sim.demand[0],
      id: 'party-restroom-2',
      arrival: 30,
      diningFactor: 0.6,
      recipes: ['pan-chicken'],
    });
    const restroom = sim.equipment.find((e) => e.fixtureId === 'restroom-1')!;
    sim.start();
    let occupiedTicks = 0,
      returned = 0;
    while (!sim.ended && sim.time < 3000) {
      const before = new Map(
        sim.parties.map((p) => [p.id, { done: p.restroomDone, remaining: p.restroomRemaining }]),
      );
      sim.step();
      expect(restroom.slots.filter(Boolean).length).toBeLessThanOrEqual(1);
      for (const party of sim.parties.filter((p) => p.restroomRemaining !== 0)) {
        const table = sim.tables.find((t) => t.fixtureId === party.tableId)!;
        expect(table.currentParty).toBe(party.id);
        expect(table.occupiedSeats).toBe(party.demand.size);
        expect(table.status).toBe('Occupied');
        expect(party.paidAt).toBeUndefined();
        expect(restroom.slots).toContain(`restroom-${party.id}`);
        occupiedTicks++;
      }
      for (const party of sim.parties.filter((p) => p.restroomDone && !before.get(p.id)?.done)) {
        const guest = sim.actors.find((a) => a.id === party.memberIds[0])!;
        expect(guest.cell).toEqual(party.seatTargets[0]);
        expect(before.get(party.id)!.remaining).toBeLessThan(0);
        returned++;
      }
    }
    expect(sim.ended).toBe(true);
    expect(occupiedTicks).toBeGreaterThan(0);
    expect(returned).toBe(2);
    expect(restroom.uses).toBe(2);
    expect(restroom.slots.every((slot) => slot === null)).toBe(true);
    expect(sim.getMetrics().customersServed).toBe(2);
  });
});

describe('equipment prerequisites and unbiased layout experiments', () => {
  it('reserves scarce raw stock atomically when two chefs fetch in parallel', () => {
    const sim = new RestaurantSimulation({
      menu: ['pan-chicken'],
      closeTime: 600,
      arrivalInterval: 900,
    });
    sim.demand[0].size = 2;
    sim.demand[0].recipes = ['pan-chicken', 'pan-chicken'];
    sim.inventory.chicken = 1;
    sim.start();
    expect(() => {
      while (sim.time < 500) sim.step();
    }).not.toThrow();
    expect(sim.orders).toHaveLength(2);
    const fetches = sim.tasks.filter((t) => t.step.id === 'fetch');
    expect(fetches.filter((t) => t.status === 'done')).toHaveLength(1);
    expect(fetches.filter((t) => t.status === 'pending')).toHaveLength(1);
    expect(sim.inventory.chicken).toBe(0);
    expect(Object.values(sim.inventory).every((q) => q >= 0)).toBe(true);
  });

  it('only delivers at the real table and books no revenue until payment', () => {
    const sim = new RestaurantSimulation({
      menu: ['pan-chicken'],
      closeTime: 600,
      arrivalInterval: 900,
    });
    sim.start();
    let deliveries = 0,
      wasFoodServedBeforePayment = false;
    while (!sim.ended && sim.time < 2400) {
      sim.step();
      for (const order of sim.orders.filter((o) => o.servedAt === sim.time)) {
        const event = sim.events.find((e) => e.type === 'order-served' && e.orderId === order.id)!;
        const waiter = sim.actors.find((a) => a.id === event.actorId)!;
        const table = sim.getFixture(order.tableId)!;
        expect(interactionCells(sim.layout, table).some((p) => same(p, waiter.cell))).toBe(true);
        expect(order.readyAt!).toBeLessThan(order.servedAt!);
        deliveries++;
      }
      if (sim.orders.some((o) => o.status === 'served') && sim.revenue === 0)
        wasFoodServedBeforePayment = true;
      const booked = sim.orders
        .filter((o) => o.status === 'paid')
        .reduce((sum, o) => sum + RECIPES.find((r) => r.id === o.recipeId)!.price, 0);
      if (Math.abs(sim.revenue - booked) > 1e-8)
        throw new Error('revenue was booked before payment');
    }
    expect(sim.ended).toBe(true);
    expect(deliveries).toBeGreaterThan(0);
    expect(wasFoodServedBeforePayment).toBe(true);
  });

  it('cannot cook a fryer recipe when its required machine is absent', () => {
    const layout = cloneLayout(BASELINE_LAYOUT);
    layout.fixtures = layout.fixtures.filter((f) => f.kind !== 'fryer');
    const sim = new RestaurantSimulation({
      layout,
      menu: ['katsu-curry'],
      closeTime: 600,
      arrivalInterval: 900,
    });
    sim.start();
    while (sim.time < 1800) sim.step();
    expect(sim.orders.length).toBeGreaterThan(0);
    expect(sim.orders.every((o) => o.readyAt === undefined && o.paidAt === undefined)).toBe(true);
    expect(sim.revenue).toBe(0);
    expect(
      sim.tasks.filter((t) => t.step.method === 'DeepFry').every((t) => t.status !== 'done'),
    ).toBe(true);
  });

  it('compares actual movement and waiting with identical customer demand and resources', () => {
    const options = { seed: 12345, closeTime: 1800, arrivalInterval: 140 };
    const baseline = runDay({ ...options, layout: BASELINE_LAYOUT });
    const alternative = runDay({ ...options, layout: ALTERNATIVE_LAYOUT });
    expect(baseline.ended && alternative.ended).toBe(true);
    expect(baseline.demand).toEqual(alternative.demand);
    expect(baseline.equipment.map((e) => e.slots.length)).toEqual(
      alternative.equipment.map((e) => e.slots.length),
    );
    const sumWalking = (sim: RestaurantSimulation) =>
      sim.actors.reduce((sum, a) => sum + a.totalWalking, 0);
    expect(sumWalking(baseline)).toBeGreaterThan(0);
    expect(sumWalking(alternative)).toBeGreaterThan(0);
    expect(sumWalking(baseline)).not.toBeCloseTo(sumWalking(alternative), 4);
    for (const sim of [baseline, alternative]) {
      const completed = sim.orders.filter((o) => o.readyAt !== undefined);
      const actualMean =
        completed.reduce(
          (sum, o) =>
            sum +
            sim.tasks.filter((t) => t.orderId === o.id).reduce((walk, t) => walk + t.walking, 0),
          0,
        ) / completed.length;
      expect(sim.getMetrics().averageWalkingTime).toBeCloseTo(actualMean);
      expect(sim.getMetrics().equipmentWaitingTime).toBeCloseTo(
        sim.tasks.reduce((sum, t) => sum + t.waitingEquipment, 0),
      );
    }
  });
});
