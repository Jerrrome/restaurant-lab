import { EQUIPMENT, INGREDIENTS, RECIPES } from '../../data/catalog';
import type { Actor, Ingredient, KitchenTask, RecipeStep } from '../types';
import { arrived } from '../navigation/movement';
import { same } from '../navigation/grid';
import type { RestaurantSimulation } from './engine';
import { ASSUMPTIONS } from './engine';
import { processIngredients, selectInputs, validateProcessing } from './processing';

/** Global equipment capacity locks and per-input reservations for the recipe DAG. */
export class KitchenController {
  private readonly reservedIngredients = new Map<string, string>();
  private readonly batches = new Map<string, Ingredient[]>();
  private readonly fetchReservations = new Map<string, Record<string, number>>();
  private riceServings: Ingredient[] = [];
  constructor(private sim: RestaurantSimulation) {}

  createOrder(partyId: string, tableId: string, recipeId: string) {
    const sim = this.sim,
      recipe = RECIPES.find((r) => r.id === recipeId)!;
    const order = {
      id: sim.id('order'),
      partyId,
      tableId,
      recipeId,
      status: 'queued' as const,
      createdAt: sim.time,
      tasks: [] as string[],
      ingredients: [] as Ingredient[],
      deliveryTime: 0,
    };
    for (const step of recipe.steps) {
      const task = this.makeTask(order.id, step);
      order.tasks.push(task.id);
      sim.tasks.push(task);
    }
    sim.orders.push(order);
    sim.log('order-created', recipe.name, { orderId: order.id });
    return order;
  }
  private makeTask(orderId: string, step: RecipeStep): KitchenTask {
    return {
      id: this.sim.id('task'),
      orderId,
      step,
      status: 'pending',
      remaining: step.activeTime,
      createdAt: this.sim.time,
      waitingEquipment: 0,
      waitingStaff: 0,
      walking: 0,
      active: 0,
      passive: 0,
    };
  }
  private materials(task: KitchenTask): Ingredient[] {
    return (
      this.sim.orders.find((o) => o.id === task.orderId)?.ingredients ??
      this.batches.get(task.orderId) ??
      []
    );
  }
  private ready(task: KitchenTask) {
    const order = this.sim.orders.find((o) => o.id === task.orderId);
    if (order?.status === 'cancelled') return false;
    return task.step.dependencies.every((id) =>
      this.sim.tasks.some(
        (t) => t.orderId === task.orderId && t.step.id === id && t.status === 'done',
      ),
    );
  }
  private isRiceServing(task: KitchenTask) {
    return task.step.method === 'CookRice' && !this.batches.has(task.orderId);
  }

  update(dt: number) {
    const sim = this.sim;
    this.ensureRiceBatch();
    for (const task of sim.tasks) {
      if (task.status === 'done' || task.status === 'pending') continue;
      const actor = sim.actors.find((a) => a.id === task.actorId);
      if (task.status === 'passive') {
        task.remaining -= dt;
        task.passive += dt;
        if (task.remaining <= 0) {
          task.status = 'finish';
          task.remaining = task.step.finishTime ?? 3;
          sim.log('passive-finished', task.step.label, {
            taskId: task.id,
            fixtureId: task.fixtureId,
            orderId: task.orderId,
          });
        }
      } else if (
        task.status === 'walking' ||
        (task.status === 'finish' && actor && !arrived(actor))
      ) {
        if (actor && !task.interaction) {
          const source = task.pickupFixtureIds?.[task.pickupIndex ?? 0];
          const destination = sim.getFixture(source ?? task.fixtureId!);
          const point = destination && sim.interaction(destination, actor, task.id);
          if (point) {
            task.interaction = point;
            sim.route(actor, point);
          } else {
            task.waitingEquipment += dt;
            actor.state = 'WaitingForEquipment';
          }
        } else if (
          actor &&
          arrived(actor) &&
          (task.pickupIndex ?? 0) < (task.pickupFixtureIds?.length ?? 0)
        ) {
          task.pickupRemaining = (task.pickupRemaining ?? 1) - dt;
          task.active += dt;
          actor.state = 'FetchingIngredient';
          if (task.pickupRemaining <= 0) {
            const source = task.pickupFixtureIds![task.pickupIndex ?? 0];
            this.materials(task)
              .filter(
                (i) =>
                  this.reservedIngredients.get(i.id) === task.id && i.locationFixtureId === source,
              )
              .forEach((i) => (i.heldBy = actor.id));
            sim.log('ingredient-pickup', '员工在原工作站领取中间食材', {
              taskId: task.id,
              actorId: actor.id,
              fixtureId: source,
              orderId: task.orderId,
              position: { ...actor.position },
            });
            task.pickupIndex = (task.pickupIndex ?? 0) + 1;
            task.pickupRemaining = 1;
            task.interaction = undefined;
          }
        } else if (actor && arrived(actor)) {
          task.status = task.status === 'finish' ? 'finish' : 'active';
          this.materials(task)
            .filter((i) => this.reservedIngredients.get(i.id) === task.id)
            .forEach((i) => {
              i.heldBy = undefined;
              i.locationFixtureId = task.fixtureId;
            });
          actor.state = this.actorState(task);
          sim.log('work-start', task.step.label, {
            taskId: task.id,
            actorId: actor.id,
            fixtureId: task.fixtureId,
            orderId: task.orderId,
            position: { ...actor.position },
          });
        } else if (actor && actor.blockedTime > 8 && task.fixtureId) {
          const fixture = sim.getFixture(
            task.pickupFixtureIds?.[task.pickupIndex ?? 0] ?? task.fixtureId,
          )!;
          const alternate = sim.interaction(fixture, actor, task.id);
          if (alternate && !same(alternate, task.interaction!)) {
            task.interaction = alternate;
            sim.route(actor, alternate);
          }
        }
      } else if (task.status === 'active' || task.status === 'finish') {
        if (!actor || !arrived(actor)) continue;
        task.remaining -= dt;
        task.active += dt;
        if (task.remaining <= 0) {
          if (task.status === 'active' && task.step.passiveTime > 0 && !this.isRiceServing(task)) {
            task.status = 'passive';
            task.remaining = task.step.passiveTime;
            task.actorId = undefined;
            task.interaction = undefined;
            sim.releaseActor(actor);
            sim.log('passive-start', task.step.label, {
              taskId: task.id,
              fixtureId: task.fixtureId,
              orderId: task.orderId,
            });
          } else this.finish(task, actor);
        }
      }
    }
    const idle = sim.actors.filter((a) => a.role === 'chef' && !a.taskId);
    for (const actor of idle) {
      const candidates = sim.tasks.filter(
        (t) => (t.status === 'pending' && this.ready(t)) || (t.status === 'finish' && !t.actorId),
      );
      candidates.sort(
        (a, b) =>
          (a.status === 'finish' ? 0 : 1) - (b.status === 'finish' ? 0 : 1) ||
          a.createdAt - b.createdAt ||
          a.id.localeCompare(b.id),
      );
      for (const task of candidates) if (this.assign(task, actor)) break;
      if (!actor.taskId && !actor.movingTo && (!actor.target || arrived(actor))) {
        actor.state = candidates.length ? 'WaitingForEquipment' : 'Idle';
        actor.nextTaskLabel = candidates[0]?.step.label;
        actor.waitReason = candidates.length
          ? this.isRiceServing(candidates[0]) && !sim.riceStock
            ? '等待熟米饭批次'
            : !sim.layout.fixtures.some((f) => f.kind === candidates[0].step.equipment)
              ? `缺少${EQUIPMENT[candidates[0].step.equipment].name}`
              : `等待${EQUIPMENT[candidates[0].step.equipment].name}或操作位置`
          : undefined;
        if (candidates.length) actor.waitingTime += dt;
      }
    }
    // Account only tasks that remained unassigned after all chef choices for this tick.
    for (const task of sim.tasks.filter((t) => t.status === 'pending' && this.ready(t))) {
      if (!this.resourceAvailable(task)) task.waitingEquipment += dt;
      else task.waitingStaff += dt;
    }
  }
  private actorState(task: KitchenTask): Actor['state'] {
    const method = task.step.method;
    return method === 'Fetch'
      ? 'FetchingIngredient'
      : method === 'Assemble'
        ? 'Assembling'
        : method === 'Pass'
          ? 'Delivering'
          : ['PanSear', 'StirFry', 'DeepFry', 'Boil', 'Heat', 'CookRice'].includes(method)
            ? 'Cooking'
            : 'Preparing';
  }
  private resourceAvailable(task: KitchenTask) {
    const sim = this.sim;
    if (this.isRiceServing(task) && !task.reservedRice && !this.riceServings.length) return false;
    if (task.step.method === 'Fetch' && !this.hasFetchStock(task)) return false;
    if (
      task.step.method !== 'Fetch' &&
      !this.isRiceServing(task) &&
      !selectInputs(task.step, this.materials(task), new Set(this.reservedIngredients.keys()))
    )
      return false;
    return sim.layout.fixtures.some(
      (f) =>
        f.kind === task.step.equipment &&
        sim.equipment.find((e) => e.fixtureId === f.id)?.slots.some((s) => s === null) &&
        !validateProcessing({ ...task.step, inputs: [] }, EQUIPMENT[f.kind], []),
    );
  }
  private assign(task: KitchenTask, actor: Actor): boolean {
    const sim = this.sim;
    const finishing = task.status === 'finish';
    if (!finishing && !this.resourceAvailable(task)) return false;
    const fixtures = sim.layout.fixtures.filter((f) =>
      finishing ? f.id === task.fixtureId : f.kind === task.step.equipment,
    );
    fixtures.sort(
      (a, b) =>
        Math.abs(a.x - actor.cell.x) +
        Math.abs(a.y - actor.cell.y) -
        Math.abs(b.x - actor.cell.x) -
        Math.abs(b.y - actor.cell.y),
    );
    for (const fixture of fixtures) {
      const eq = sim.equipment.find((e) => e.fixtureId === fixture.id)!;
      const slot = finishing ? task.slot! : eq.slots.indexOf(null);
      if (slot < 0) continue;
      const inputs =
        finishing || task.step.method === 'Fetch' || this.isRiceServing(task)
          ? []
          : selectInputs(task.step, this.materials(task), new Set(this.reservedIngredients.keys()));
      if (!inputs) continue;
      const sources = finishing
        ? []
        : [
            ...new Set(
              inputs
                .map((i) => i.locationFixtureId)
                .filter((id): id is string => !!id && id !== fixture.id),
            ),
          ];
      const initialStation = sim.getFixture(sources[0] ?? fixture.id)!;
      const interaction = sim.interaction(initialStation, actor, task.id);
      if (!interaction) continue;
      if (!finishing) {
        inputs.forEach((i) => this.reservedIngredients.set(i.id, task.id));
        task.pickupFixtureIds = sources;
        task.pickupIndex = 0;
        task.pickupRemaining = 1;
        if (task.step.method === 'Fetch')
          this.fetchReservations.set(task.id, this.fetchAmounts(task));
        if (this.isRiceServing(task)) {
          const portion = this.riceServings.shift()!;
          portion.consumed = true;
          task.reservedRice = true;
          sim.riceStock = this.riceServings.length;
        }
        eq.slots[slot] = task.id;
        eq.uses++;
        task.slot = slot;
        task.fixtureId = fixture.id;
        task.status = 'walking';
        task.startedAt = sim.time;
        const order = sim.orders.find((o) => o.id === task.orderId);
        if (order?.status === 'queued') order.status = 'cooking';
      }
      task.interaction = interaction;
      task.actorId = actor.id;
      actor.taskId = task.id;
      actor.waitReason = undefined;
      actor.nextTaskLabel = undefined;
      actor.state = this.actorState(task);
      sim.route(actor, interaction);
      sim.log('task-assigned', task.step.label, {
        taskId: task.id,
        actorId: actor.id,
        fixtureId: fixture.id,
        orderId: task.orderId,
      });
      return true;
    }
    return false;
  }
  private hasFetchStock(task: KitchenTask) {
    const amounts = this.fetchAmounts(task);
    return Object.entries(amounts).every(([name, count]) => {
      const reserved = [...this.fetchReservations]
        .filter(([id]) => id !== task.id)
        .reduce((sum, [, record]) => sum + (record[name] ?? 0), 0);
      return (this.sim.inventory[name] ?? 0) - reserved >= count;
    });
  }
  private fetchAmounts(task: KitchenTask): Record<string, number> {
    if (this.batches.has(task.orderId)) return { rice: ASSUMPTIONS.riceBatch };
    const order = this.sim.orders.find((o) => o.id === task.orderId)!;
    return Object.fromEntries(
      Object.entries(RECIPES.find((r) => r.id === order.recipeId)!.ingredients).filter(
        ([name]) => name !== 'rice',
      ),
    );
  }
  private finish(task: KitchenTask, actor: Actor) {
    const sim = this.sim,
      materials = this.materials(task);
    if (task.step.method === 'Fetch') {
      const amounts = this.fetchAmounts(task);
      // Fetches are atomic and debit actual stock exactly once.
      if (!this.hasFetchStock(task)) throw new Error('库存不足：已经分配的取料任务不能完成');
      for (const [name, count] of Object.entries(amounts)) {
        sim.inventory[name] -= count;
        sim.foodCost += INGREDIENTS[name].cost * count;
      }
      this.fetchReservations.delete(task.id);
      materials.push(
        ...task.step.outputs.flatMap((output) =>
          Array.from({ length: output.quantity ?? 1 }, () => ({
            id: sim.id('ingredient'),
            name: output.name,
            category: INGREDIENTS[output.name]?.category ?? 'raw',
            quantity: 1,
            unit: INGREDIENTS[output.name]?.unit ?? 'portion',
            processingState: [...output.tags],
            temperature: output.name === 'chicken' ? 4 : 20,
            freshness: 1,
            cost: INGREDIENTS[output.name]?.cost ?? 0,
            consumed: false,
            locationFixtureId: task.fixtureId,
          })),
        ),
      );
    } else {
      const selected = materials.filter((i) => this.reservedIngredients.get(i.id) === task.id);
      const output = processIngredients(task.step, this.isRiceServing(task) ? [] : selected, () =>
        sim.id('ingredient'),
      );
      output.forEach((i) => (i.locationFixtureId = task.fixtureId));
      if (this.isRiceServing(task)) output.forEach((i) => (i.cost = INGREDIENTS.rice.cost));
      materials.push(...output);
      selected.forEach((i) => this.reservedIngredients.delete(i.id));
      if (this.batches.has(task.orderId) && task.step.method === 'CookRice') {
        this.riceServings.push(...output);
        sim.riceStock = this.riceServings.length;
        sim.log('rice-batch', '一批6份米饭完成', { taskId: task.id, fixtureId: task.fixtureId });
      }
    }
    const equipment = sim.equipment.find((e) => e.fixtureId === task.fixtureId)!;
    if (equipment.slots[task.slot!] !== task.id) throw new Error('设备锁所有权错误');
    equipment.slots[task.slot!] = null;
    task.status = 'done';
    task.completedAt = sim.time;
    task.actorId = undefined;
    task.interaction = undefined;
    task.remaining = 0;
    sim.releaseActor(actor);
    sim.log('task-completed', task.step.label, {
      taskId: task.id,
      fixtureId: task.fixtureId,
      orderId: task.orderId,
    });
    const order = sim.orders.find((o) => o.id === task.orderId);
    if (
      order &&
      order.status !== 'cancelled' &&
      order.tasks.every((id) => sim.tasks.find((t) => t.id === id)?.status === 'done')
    ) {
      order.status = 'ready';
      order.readyAt = sim.time;
      order.servingFixtureId = task.fixtureId;
      sim.log('order-ready', '餐品已放至出餐口', { orderId: order.id });
      sim.service.enqueue('deliver', order.partyId, order.tableId, order.id);
    }
  }
  private ensureRiceBatch() {
    const sim = this.sim;
    const pending = sim.tasks.filter(
      (t) => this.isRiceServing(t) && t.status === 'pending' && this.ready(t),
    ).length;
    if (
      !pending ||
      this.riceServings.length >= Math.max(2, pending) ||
      sim.tasks.some((t) => this.batches.has(t.orderId) && t.status !== 'done')
    )
      return;
    if (
      !sim.layout.fixtures.some((f) => f.kind === 'rice') ||
      !sim.layout.fixtures.some((f) => f.kind === 'storage') ||
      sim.inventory.rice < ASSUMPTIONS.riceBatch
    )
      return;
    const batch = sim.id('rice-batch');
    this.batches.set(batch, []);
    const fetch: RecipeStep = {
      id: 'fetch-rice',
      label: '取一批生米',
      method: 'Fetch',
      equipment: 'storage',
      dependencies: [],
      activeTime: 5,
      passiveTime: 0,
      inputs: [],
      outputs: [{ name: 'rice', tags: ['raw'], quantity: ASSUMPTIONS.riceBatch }],
    };
    const cook: RecipeStep = {
      id: 'cook-rice',
      label: '批量煮米饭',
      method: 'CookRice',
      equipment: 'rice',
      dependencies: ['fetch-rice'],
      activeTime: 5,
      passiveTime: ASSUMPTIONS.riceCookingTime,
      finishTime: 5,
      inputs: [{ name: 'rice', tags: ['raw'], quantity: ASSUMPTIONS.riceBatch }],
      outputs: [{ name: 'rice', tags: ['cooked'], quantity: ASSUMPTIONS.riceBatch }],
    };
    sim.tasks.push(this.makeTask(batch, fetch), this.makeTask(batch, cook));
  }
}
