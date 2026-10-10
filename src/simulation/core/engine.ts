import { EQUIPMENT, INGREDIENTS, RECIPES } from '../../data/catalog';
import { BASELINE_LAYOUT, cloneLayout } from '../../data/scenarios';
import type {
  Actor,
  DemandEvent,
  EquipmentState,
  Fixture,
  KitchenTask,
  Layout,
  Metrics,
  Order,
  Party,
  Point,
  ServiceTask,
  SimEvent,
  SimulationOptions,
  TableState,
} from '../types';
import {
  findPath,
  interactionCells,
  isWalkable,
  key,
  same,
  validateLayout,
} from '../navigation/grid';
import { moveActors, occupiedCells, setDestination } from '../navigation/movement';
import { generateDemand } from './random';
import { KitchenController } from './kitchen';
import { ServiceController } from './service';
import { validateRecipe } from './recipe-validation';

export const FIXED_STEP = 0.25;
export const ASSUMPTIONS = {
  lunchSeconds: 10800,
  arrivalInterval: 150,
  chefHourlyWage: 24,
  waiterHourlyWage: 18,
  dailyRent: 45,
  operatingHourly: 8,
  riceBatch: 6,
  riceCookingTime: 90,
};

/** Pure TypeScript world. No browser, React or Phaser dependency. */
export class RestaurantSimulation {
  readonly layout: Layout;
  readonly seed: number;
  readonly demand: DemandEvent[];
  readonly closeTime: number;
  readonly actors: Actor[] = [];
  readonly parties: Party[] = [];
  readonly orders: Order[] = [];
  readonly tasks: KitchenTask[] = [];
  readonly serviceTasks: ServiceTask[] = [];
  readonly tables: TableState[] = [];
  readonly equipment: EquipmentState[] = [];
  readonly events: SimEvent[] = [];
  readonly inventory: Record<string, number> = {};
  readonly kitchen: KitchenController;
  readonly service: ServiceController;
  time = 0;
  started = false;
  ended = false;
  paused = true;
  speed = 1;
  riceStock = 0;
  foodCost = 0;
  revenue = 0;
  lostCustomers = 0;
  tableOccupiedSeconds = 0;
  private sequence = 0;
  private tick = 0;
  private accumulator = 0;
  private demandIndex = 0;
  private spawnQueue: { party: Party; member: number }[] = [];

  constructor(options: SimulationOptions = {}) {
    RECIPES.forEach(validateRecipe);
    this.layout = cloneLayout(options.layout ?? BASELINE_LAYOUT);
    const validation = validateLayout(this.layout);
    if (!validation.valid) throw new Error(validation.reason);
    this.seed = options.seed ?? 12345;
    this.closeTime = options.closeTime ?? ASSUMPTIONS.lunchSeconds;
    const menu = options.menu ?? RECIPES.map((r) => r.id);
    if (!menu.length || menu.some((id) => !RECIPES.some((r) => r.id === id)))
      throw new Error('菜单必须包含有效菜品');
    const interval = options.arrivalInterval ?? ASSUMPTIONS.arrivalInterval;
    if (
      !Number.isFinite(interval) ||
      interval < 30 ||
      !Number.isFinite(this.closeTime) ||
      this.closeTime < 600 ||
      !Number.isFinite(this.seed)
    )
      throw new Error('无效模拟参数');
    this.demand = generateDemand(this.seed, this.closeTime, interval, menu);
    for (const name of Object.keys(INGREDIENTS)) this.inventory[name] = 400;
    for (const fixture of this.layout.fixtures) {
      if (fixture.kind === 'table')
        this.tables.push({
          fixtureId: fixture.id,
          seatCount: fixture.seatCount ?? 4,
          occupiedSeats: 0,
          currentOrders: [],
          diningProgress: 0,
          status: 'Available',
        });
      else
        this.equipment.push({
          fixtureId: fixture.id,
          slots: Array(EQUIPMENT[fixture.kind].capacity).fill(null),
          busyTime: 0,
          uses: 0,
        });
    }
    const chefs = Math.min(4, Math.max(1, options.chefs ?? 2));
    const waiters = Math.min(3, Math.max(1, options.waiters ?? 1));
    for (let i = 0; i < chefs + waiters; i++) {
      const role = i < chefs ? 'chef' : 'waiter';
      const preferred = this.layout.staffSpawns[role === 'chef' ? i : 2 + (i - chefs)] ?? {
        x: 18 + (i - chefs),
        y: 13,
      };
      const home = this.freeCellNear(preferred);
      this.actors.push(
        this.createActor(
          `${role}-${role === 'chef' ? i + 1 : i - chefs + 1}`,
          role === 'chef' ? `厨师 ${i + 1}` : `服务员 ${i - chefs + 1}`,
          role,
          home,
        ),
      );
    }
    this.kitchen = new KitchenController(this);
    this.service = new ServiceController(this);
  }

  id(prefix: string) {
    return `${prefix}-${++this.sequence}`;
  }
  log(type: string, detail: string, extra: Partial<SimEvent> = {}) {
    this.events.push({ time: this.time, type, detail, ...extra });
    if (this.events.length > 16000) this.events.splice(0, 1000);
  }
  getFixture(id: string) {
    return this.layout.fixtures.find((f) => f.id === id);
  }
  getEquipmentUtilization(id: string) {
    const eq = this.equipment.find((e) => e.fixtureId === id);
    return eq && this.time > 0 ? eq.busyTime / (this.time * Math.max(1, eq.slots.length)) : 0;
  }
  start() {
    if (this.ended) return;
    this.started = true;
    this.paused = false;
  }
  setPaused(value: boolean) {
    this.paused = value;
  }
  /** Rendering FPS only supplies elapsed time. Work is never skipped at high speed. */
  advance(realSeconds: number) {
    if (
      !this.started ||
      this.ended ||
      this.paused ||
      !Number.isFinite(realSeconds) ||
      realSeconds < 0
    )
      return;
    this.accumulator += realSeconds * this.speed;
    let budget = 800;
    while (this.accumulator + 1e-9 >= FIXED_STEP && budget-- > 0 && !this.ended) {
      this.step();
      this.accumulator -= FIXED_STEP;
    }
  }
  /** Headless deterministic tick; intentionally independent of the UI pause/speed. */
  step() {
    if (!this.started || this.ended) return;
    this.time += FIXED_STEP;
    this.tick++;
    this.admitDemand();
    this.service.updateParties(FIXED_STEP);
    this.kitchen.update(FIXED_STEP);
    this.service.updateTasks(FIXED_STEP);
    const walkingBefore = new Map(this.actors.map((a) => [a.id, a.totalWalking]));
    moveActors(this.layout, this.actors, FIXED_STEP, this.tick, (a) =>
      this.log('move', `${a.name} 移动`, { actorId: a.id, taskId: a.taskId }),
    );
    for (const actor of this.actors) {
      const walking = actor.totalWalking - (walkingBefore.get(actor.id) ?? 0);
      const task = this.tasks.find((t) => t.id === actor.taskId);
      if (task) task.walking += walking;
      if (actor.taskId) actor.busyTime += FIXED_STEP;
    }
    for (const equipment of this.equipment)
      equipment.busyTime += equipment.slots.filter(Boolean).length * FIXED_STEP;
    this.tableOccupiedSeconds +=
      this.tables.filter((t) => t.status === 'Occupied').length * FIXED_STEP;
    if (
      this.time >= this.closeTime &&
      this.demandIndex >= this.demand.length &&
      !this.spawnQueue.length &&
      this.parties.every(
        (p) =>
          p.state === 'Leaving' && !p.memberIds.some((id) => this.actors.some((a) => a.id === id)),
      ) &&
      this.serviceTasks.every((t) => t.status === 'done') &&
      this.tasks.every(
        (t) =>
          t.status === 'done' ||
          this.orders.find((o) => o.id === t.orderId)?.status === 'cancelled',
      )
    ) {
      this.ended = true;
      this.paused = true;
      this.log('day-ended', '午餐营业及清洁结束');
    }
    // No silent success on a deadlock. Diagnostics remain visible and tests fail.
    if (
      this.time > this.closeTime + 7200 &&
      Math.floor(this.time) % 60 === 0 &&
      this.tick % 240 === 0
    )
      this.log('warning', '营业超时：检查不可达工位、缺失设备和拥堵');
  }

  createActor(id: string, name: string, role: Actor['role'], point: Point): Actor {
    return {
      id,
      name,
      role,
      position: { ...point },
      cell: { ...point },
      home: { ...point },
      radius: role === 'customer' ? 0.24 : 0.27,
      facing: { x: 0, y: 1 },
      state: role === 'customer' ? 'Arriving' : 'Idle',
      path: [],
      blockedTime: 0,
      totalWalking: 0,
      busyTime: 0,
      waitingTime: 0,
      speed: role === 'customer' ? 1.35 : 1.65,
    };
  }
  route(actor: Actor, point: Point) {
    setDestination(this.layout, actor, point);
  }
  canReach(from: Point, to: Point) {
    return (
      isWalkable(this.layout, to) && (same(from, to) || findPath(this.layout, from, to).length > 0)
    );
  }
  cancelPendingArrival(partyId: string) {
    this.spawnQueue = this.spawnQueue.filter((entry) => entry.party.id !== partyId);
  }
  releaseActor(actor: Actor) {
    actor.taskId = undefined;
    actor.state = 'Idle';
    this.route(actor, actor.home);
  }
  freeCellNear(point: Point): Point {
    const occupied = occupiedCells(this.actors);
    for (let radius = 0; radius < 30; radius++)
      for (let y = point.y - radius; y <= point.y + radius; y++)
        for (let x = point.x - radius; x <= point.x + radius; x++) {
          const p = { x, y };
          if (
            isWalkable(this.layout, p) &&
            !occupied.has(key(p)) &&
            !this.isReserved(p) &&
            this.canReach(this.layout.entrance, p)
          )
            return p;
        }
    throw new Error('地图没有可用站位');
  }
  isReserved(p: Point, exceptTask?: string): boolean {
    return (
      this.tasks.some(
        (t) =>
          t.id !== exceptTask &&
          t.status !== 'done' &&
          t.status !== 'passive' &&
          t.interaction &&
          same(t.interaction, p),
      ) ||
      this.serviceTasks.some(
        (t) => t.id !== exceptTask && t.status !== 'done' && t.target && same(t.target, p),
      ) ||
      this.parties.some(
        (party) =>
          party.tableId && party.state !== 'Leaving' && party.seatTargets.some((s) => same(s, p)),
      )
    );
  }
  interaction(fixture: Fixture, actor: Actor, exceptTask?: string): Point | undefined {
    const occupied = occupiedCells(this.actors, actor.id);
    const options = interactionCells(this.layout, fixture).filter(
      (p) => !this.isReserved(p, exceptTask) && !occupied.has(key(p)),
    );
    const scored = options
      .map((p) => ({ p, path: findPath(this.layout, actor.movingTo ?? actor.cell, p) }))
      .filter((v) => v.path.length || same(actor.cell, v.p));
    scored.sort((a, b) => a.path.length - b.path.length || a.p.y - b.p.y || a.p.x - b.p.x);
    return scored[0]?.p;
  }

  private admitDemand() {
    while (
      this.demandIndex < this.demand.length &&
      this.demand[this.demandIndex].arrival <= this.time
    ) {
      const demand = this.demand[this.demandIndex++];
      if (
        this.actors.filter((a) => a.role === 'customer').length +
          this.spawnQueue.length +
          demand.size >
        20
      ) {
        this.lostCustomers += demand.size;
        this.log('turned-away', '餐厅达到20人安全容量');
        continue;
      }
      const party: Party = {
        id: demand.id,
        memberIds: [],
        demand,
        state: 'Arriving',
        seatTargets: [],
        orders: [],
        arrivalTime: this.time,
        diningRemaining: 0,
        restroomDone: false,
        restroomRemaining: 0,
        satisfied: 100,
        waits: { table: 0, order: 0, kitchen: 0, delivery: 0, payment: 0 },
      };
      this.parties.push(party);
      for (let member = 0; member < demand.size; member++) this.spawnQueue.push({ party, member });
    }
    if (!this.spawnQueue.length || occupiedCells(this.actors).has(key(this.layout.entrance)))
      return;
    const { party, member } = this.spawnQueue.shift()!;
    const actor = this.createActor(
      `${party.id}-guest-${member + 1}`,
      `顾客 ${party.id.split('-')[1]}.${member + 1}`,
      'customer',
      this.layout.entrance,
    );
    actor.partyId = party.id;
    this.actors.push(actor);
    party.memberIds.push(actor.id);
    const queuePoint = this.freeCellNear({
      x: 26,
      y: 3 + (this.parties.indexOf(party) % 6) * 2 + member,
    });
    this.route(actor, queuePoint);
    actor.state = 'WaitingForTable';
    this.log('arrival', '顾客从入口入店', { actorId: actor.id });
  }

  getMetrics(): Metrics {
    const paid = this.orders.filter((o) => o.status === 'paid');
    const served = this.orders.filter((o) => o.servedAt !== undefined);
    const completed = this.orders.filter((o) => o.readyAt !== undefined);
    const paidParties = this.parties.filter((p) => p.paidAt !== undefined);
    const staff = this.actors.filter((a) => a.role !== 'customer');
    const laborCost = staff.reduce(
      (sum, a) =>
        sum +
        ((a.role === 'chef' ? ASSUMPTIONS.chefHourlyWage : ASSUMPTIONS.waiterHourlyWage) *
          this.time) /
          3600,
      0,
    );
    const operatingCost = this.started
      ? ASSUMPTIONS.dailyRent +
        (ASSUMPTIONS.operatingHourly * this.time) / 3600 +
        this.layout.fixtures.reduce(
          (sum, f) => sum + (EQUIPMENT[f.kind].operatingCost * this.time) / 3600,
          0,
        )
      : 0;
    const avg = (list: number[]) =>
      list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
    return {
      customersServed: paidParties.reduce((sum, p) => sum + p.demand.size, 0),
      ordersCompleted: completed.length,
      revenue: this.revenue,
      foodCost: this.foodCost,
      laborCost,
      operatingCost,
      profit: this.revenue - this.foodCost - laborCost - operatingCost,
      averageOrderValue: paid.length ? this.revenue / paid.length : 0,
      averageWaitTime: avg(
        paidParties.map((p) => Object.values(p.waits).reduce((a, b) => a + b, 0)),
      ),
      averageCookingTime: avg(completed.map((o) => o.readyAt! - o.createdAt)),
      averageWalkingTime: avg(
        completed.map((o) =>
          this.tasks.filter((t) => t.orderId === o.id).reduce((sum, t) => sum + t.walking, 0),
        ),
      ),
      equipmentWaitingTime: this.tasks.reduce((sum, t) => sum + t.waitingEquipment, 0),
      staffUtilization: this.time
        ? staff.reduce((sum, a) => sum + a.busyTime, 0) / (staff.length * this.time)
        : 0,
      averageTableOccupancy:
        this.time && this.tables.length
          ? this.tableOccupiedSeconds / (this.tables.length * this.time)
          : 0,
      kitchenThroughput: this.time ? served.length / (this.time / 3600) : 0,
      lostCustomers: this.lostCustomers,
    };
  }
}
