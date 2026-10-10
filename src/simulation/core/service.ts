import { RECIPES } from '../../data/catalog';
import type { Actor, Party, Point, ServiceTask } from '../types';
import { arrived, occupiedCells } from '../navigation/movement';
import { interactionCells, key, same } from '../navigation/grid';
import type { RestaurantSimulation } from './engine';

const priority = { deliver: 0, pay: 1, clean: 2, order: 3, greet: 4 };
const serviceDuration = { greet: 6, order: 8, deliver: 4, pay: 5, clean: 12 };

export class ServiceController {
  private restroomLocks = new Map<string, { fixtureId: string; slot: number }>();
  constructor(private sim: RestaurantSimulation) {}
  enqueue(kind: ServiceTask['kind'], partyId: string, tableId: string, orderId?: string) {
    if (
      this.sim.serviceTasks.some(
        (t) =>
          t.kind === kind && t.partyId === partyId && t.orderId === orderId && t.status !== 'done',
      )
    )
      return;
    this.sim.serviceTasks.push({
      id: this.sim.id('service'),
      kind,
      partyId,
      tableId,
      orderId,
      status: 'pending',
      phase: 0,
      remaining: serviceDuration[kind],
      createdAt: this.sim.time,
    });
  }
  private members(party: Party) {
    return this.sim.actors.filter((a) => party.memberIds.includes(a.id));
  }

  updateParties(dt: number) {
    const sim = this.sim;
    for (const party of sim.parties) {
      const members = this.members(party);
      if (party.state === 'Leaving') {
        for (const actor of members)
          if (arrived(actor) && same(actor.cell, sim.layout.exit)) {
            sim.actors.splice(sim.actors.indexOf(actor), 1);
            sim.log('departure', '顾客从出口离店', { actorId: actor.id });
          }
        continue;
      }
      if (
        party.state === 'Arriving' &&
        members.length === party.demand.size &&
        members.every(arrived)
      ) {
        party.state = 'WaitingForTable';
        members.forEach((a) => (a.state = 'WaitingForTable'));
      }
      if (party.state === 'Arriving' || party.state === 'WaitingForTable') {
        party.waits.table += dt;
        if (!party.tableId && party.state === 'WaitingForTable') {
          const table = sim.tables.find(
            (t) => t.status === 'Available' && t.seatCount >= party.demand.size,
          );
          if (table) {
            const fixture = sim.getFixture(table.fixtureId)!;
            const perimeter = interactionCells(sim.layout, fixture);
            const available = perimeter.filter(
              (p) => !occupiedCells(sim.actors).has(key(p)) && !sim.isReserved(p),
            );
            if (available.length >= party.demand.size + 1) {
              const seats = Array.from(
                { length: party.demand.size },
                (_, i) => available[Math.floor((i * available.length) / party.demand.size)],
              );
              party.tableId = table.fixtureId;
              party.seatTargets = seats;
              table.status = 'Occupied';
              table.occupiedSeats = party.demand.size;
              table.currentParty = party.id;
              this.enqueue('greet', party.id, table.fixtureId);
            }
          }
        }
      } else if (party.state === 'WalkingToTable') {
        if (members.length === party.demand.size && members.every(arrived)) {
          party.state = 'Ordering';
          party.seatedAt = sim.time;
          members.forEach((a) => (a.state = 'Seated'));
          this.enqueue('order', party.id, party.tableId!);
          sim.log('seated', `${party.demand.size}人入座`);
        }
      } else if (party.state === 'Ordering') party.waits.order += dt;
      else if (party.state === 'WaitingForFood') {
        const orders = sim.orders.filter((o) => party.orders.includes(o.id));
        if (orders.some((o) => o.status === 'queued' || o.status === 'cooking'))
          party.waits.kitchen += dt;
        else party.waits.delivery += dt;
        if (orders.length && orders.every((o) => o.status === 'served')) {
          party.state = 'Eating';
          party.foodAt = sim.time;
          party.diningRemaining =
            Math.max(...orders.map((o) => RECIPES.find((r) => r.id === o.recipeId)!.diningTime)) *
              party.demand.diningFactor +
            60 * (party.demand.size - 1) +
            20 * Math.max(0, orders.length - party.demand.size);
          members.forEach((a) => (a.state = 'Eating'));
          const table = sim.tables.find((t) => t.fixtureId === party.tableId)!;
          table.diningProgress = 0;
          sim.log('eating', '全桌餐品已送达，开始用餐');
        }
      } else if (party.state === 'Eating') {
        if (this.updateRestroom(party, dt)) continue;
        party.diningRemaining -= dt;
        const table = sim.tables.find((t) => t.fixtureId === party.tableId)!;
        table.diningProgress = Math.min(
          1,
          table.diningProgress +
            dt /
              (Math.max(
                ...party.orders.map(
                  (id) =>
                    RECIPES.find((r) => r.id === sim.orders.find((o) => o.id === id)!.recipeId)!
                      .diningTime,
                ),
              ) *
                party.demand.diningFactor +
                60 * (party.demand.size - 1)),
        );
        if (party.diningRemaining <= 0) {
          party.state = 'Paying';
          members.forEach((a) => (a.state = 'Paying'));
          this.enqueue('pay', party.id, party.tableId!);
        }
      } else if (party.state === 'Paying') party.waits.payment += dt;
      party.satisfied = Math.max(
        0,
        100 -
          party.waits.table * 0.018 -
          party.waits.order * 0.035 -
          party.waits.kitchen * 0.022 -
          party.waits.delivery * 0.05 -
          party.waits.payment * 0.04,
      );
      // Patrons only abandon before an order has entered production; food tasks retain ownership.
      if (!party.orders.length && sim.time - party.arrivalTime > party.demand.patience)
        this.abandon(party);
    }
  }

  private updateRestroom(party: Party, dt: number): boolean {
    if (!party.demand.restroom || party.restroomDone) return false;
    const actor = this.members(party)[0];
    if (!actor) return false;
    if (party.restroomRemaining === 0 && actor.state === 'Eating' && party.diningRemaining < 180) {
      const fixture = this.sim.layout.fixtures.find((f) => f.kind === 'restroom');
      const eq = fixture && this.sim.equipment.find((e) => e.fixtureId === fixture.id);
      const slot = eq?.slots.indexOf(null) ?? -1;
      if (slot < 0) return false;
      const destination = fixture && this.sim.interaction(fixture, actor);
      if (!destination) {
        party.restroomDone = true;
        return false;
      }
      eq!.slots[slot] = `restroom-${party.id}`;
      eq!.uses++;
      this.restroomLocks.set(party.id, { fixtureId: fixture!.id, slot });
      this.sim.route(actor, destination);
      actor.state = 'WalkingToRestroom';
      party.restroomRemaining = 35;
      this.sim.log('restroom', '顾客离座前往卫生间，座位继续保留', { actorId: actor.id });
    }
    if (party.restroomRemaining !== 0) {
      if (party.restroomRemaining < 0 && arrived(actor) && same(actor.cell, party.seatTargets[0])) {
        const lock = this.restroomLocks.get(party.id)!;
        this.sim.equipment.find((e) => e.fixtureId === lock.fixtureId)!.slots[lock.slot] = null;
        this.restroomLocks.delete(party.id);
        party.restroomDone = true;
        party.restroomRemaining = 0;
        actor.state = 'Eating';
        return false;
      }
      if (arrived(actor) && party.restroomRemaining > 0) {
        party.restroomRemaining -= dt;
        if (party.restroomRemaining <= 0) {
          party.restroomRemaining = -1;
          this.sim.route(actor, party.seatTargets[0]);
        }
      }
      return true;
    }
    return false;
  }
  private abandon(party: Party) {
    const sim = this.sim;
    sim.lostCustomers += party.demand.size;
    party.satisfied = 0;
    sim.cancelPendingArrival(party.id);
    for (const task of sim.serviceTasks.filter(
      (t) => t.partyId === party.id && t.status !== 'done',
    )) {
      this.unlock(task);
      task.status = 'done';
      task.target = undefined;
      const actor = sim.actors.find((a) => a.id === task.actorId);
      if (actor) sim.releaseActor(actor);
    }
    if (party.tableId) {
      const table = sim.tables.find((t) => t.fixtureId === party.tableId)!;
      table.status = 'NeedsCleaning';
      this.enqueue('clean', party.id, party.tableId);
    }
    party.state = 'Leaving';
    this.members(party).forEach((a) => {
      a.state = 'Leaving';
      sim.route(a, sim.layout.exit);
    });
    sim.log('abandoned', '顾客因等待超时离店');
  }

  updateTasks(dt: number) {
    const sim = this.sim;
    for (const task of sim.serviceTasks) {
      if (task.status === 'pending' || task.status === 'done') continue;
      const actor = sim.actors.find((a) => a.id === task.actorId)!;
      if (task.status === 'walking') {
        if (arrived(actor)) {
          task.status = 'active';
          actor.state =
            task.kind === 'deliver'
              ? 'Delivering'
              : task.kind === 'clean'
                ? 'Cleaning'
                : 'Preparing';
        } else if (actor.blockedTime > 8) {
          const alternative = this.destination(task, actor);
          if (alternative && !same(alternative, task.target!)) {
            task.target = alternative;
            sim.route(actor, alternative);
          }
        }
      } else if (arrived(actor)) {
        task.remaining -= dt;
        if (task.remaining <= 0) this.finishPhase(task, actor);
      }
    }
    const idle = sim.actors.filter((a) => a.role === 'waiter' && !a.taskId);
    for (const actor of idle) {
      const candidates = sim.serviceTasks.filter((t) => t.status === 'pending');
      // Aging ensures a steady supply of dishes cannot starve ordering and greeting.
      candidates.sort(
        (a, b) =>
          priority[a.kind] -
            Math.floor((sim.time - a.createdAt) / 90) -
            (priority[b.kind] - Math.floor((sim.time - b.createdAt) / 90)) ||
          a.createdAt - b.createdAt,
      );
      for (const task of candidates) {
        const destination = this.destination(task, actor);
        if (!destination) continue;
        this.lock(task);
        task.status = 'walking';
        task.actorId = actor.id;
        task.target = destination;
        actor.taskId = task.id;
        actor.state =
          task.kind === 'deliver' ? 'Delivering' : task.kind === 'clean' ? 'Cleaning' : 'Walking';
        sim.route(actor, destination);
        sim.log('service-assigned', task.kind, {
          actorId: actor.id,
          taskId: task.id,
          orderId: task.orderId,
        });
        break;
      }
    }
  }
  private destination(task: ServiceTask, actor: Actor): Point | undefined {
    const sim = this.sim;
    if (task.kind === 'greet') {
      const party = sim.parties.find((p) => p.id === task.partyId)!;
      const customer = this.members(party)[0];
      if (!customer) return;
      const candidates = [
        { x: customer.cell.x + 1, y: customer.cell.y },
        { x: customer.cell.x - 1, y: customer.cell.y },
        { x: customer.cell.x, y: customer.cell.y + 1 },
        { x: customer.cell.x, y: customer.cell.y - 1 },
      ];
      // A tiny virtual fixture reuses the same reachability/reservation selection.
      return candidates.find(
        (p) =>
          !occupiedCells(sim.actors, actor.id).has(key(p)) &&
          !sim.isReserved(p, task.id) &&
          this.canWalk(actor, p),
      );
    }
    let fixture = sim.getFixture(task.tableId);
    if (task.kind === 'deliver' && task.phase === 0)
      fixture =
        sim.getFixture(sim.orders.find((o) => o.id === task.orderId)?.servingFixtureId ?? '') ??
        sim.layout.fixtures.find((f) => f.kind === 'serving');
    if (task.kind === 'pay' && task.phase === 1)
      fixture = sim.layout.fixtures.find((f) => f.kind === 'checkout');
    if (task.kind === 'clean' && task.phase === 1)
      fixture = sim.layout.fixtures.find((f) => f.kind === 'sink');
    if (fixture && fixture.kind !== 'table') {
      const eq = sim.equipment.find((e) => e.fixtureId === fixture.id);
      if (!eq?.slots.some((s) => s === null || s === task.id)) return;
    }
    return fixture && sim.interaction(fixture, actor, task.id);
  }
  private canWalk(actor: Actor, p: Point) {
    // Use the navigation module without mutating the actor when testing a destination.
    return this.sim.canReach(actor.cell, p);
  }
  private finishPhase(task: ServiceTask, actor: Actor) {
    const sim = this.sim,
      party = sim.parties.find((p) => p.id === task.partyId)!;
    this.unlock(task);
    if (task.kind === 'deliver' && task.phase === 0) {
      const order = sim.orders.find((o) => o.id === task.orderId)!;
      if (order.status !== 'ready') throw new Error('服务员不能领取未完成餐品');
      sim.log('meal-picked-up', '服务员从餐品所在出餐台取餐', {
        actorId: actor.id,
        taskId: task.id,
        orderId: order.id,
        fixtureId: order.servingFixtureId,
        position: { ...actor.position },
      });
      order.status = 'delivering';
      task.phase = 1;
      task.remaining = 4;
      this.continueTask(task, actor);
      return;
    }
    if ((task.kind === 'pay' || task.kind === 'clean') && task.phase === 0) {
      task.phase = 1;
      task.remaining = task.kind === 'pay' ? 6 : 10;
      this.continueTask(task, actor);
      return;
    }
    if (task.kind === 'greet') {
      party.state = 'WalkingToTable';
      this.members(party).forEach((a, i) => {
        a.state = 'WalkingToTable';
        sim.route(a, party.seatTargets[i]);
      });
    } else if (task.kind === 'order') {
      if (party.orders.length) throw new Error('重复点单');
      party.orderedAt = sim.time;
      party.state = 'WaitingForFood';
      for (const recipe of party.demand.recipes)
        party.orders.push(sim.kitchen.createOrder(party.id, party.tableId!, recipe).id);
      const table = sim.tables.find((t) => t.fixtureId === party.tableId)!;
      table.currentOrders = [...party.orders];
      this.members(party).forEach((a) => (a.state = 'WaitingForFood'));
    } else if (task.kind === 'deliver') {
      const order = sim.orders.find((o) => o.id === task.orderId)!;
      if (order.status !== 'delivering') throw new Error('重复上菜');
      order.status = 'served';
      order.servedAt = sim.time;
      order.deliveryTime = sim.time - order.readyAt!;
      sim.log('order-served', '服务员在餐桌旁完成上菜', {
        actorId: actor.id,
        orderId: order.id,
        fixtureId: order.tableId,
        position: { ...actor.position },
      });
    } else if (task.kind === 'pay') {
      if (party.paidAt !== undefined) throw new Error('重复结账');
      for (const id of party.orders) {
        const order = sim.orders.find((o) => o.id === id)!;
        if (order.status !== 'served') throw new Error('不能为未上菜订单结账');
        order.status = 'paid';
        order.paidAt = sim.time;
        sim.revenue += RECIPES.find((r) => r.id === order.recipeId)!.price;
      }
      party.paidAt = sim.time;
      party.state = 'Leaving';
      this.members(party).forEach((a) => {
        a.state = 'Leaving';
        sim.route(a, sim.layout.exit);
      });
      const table = sim.tables.find((t) => t.fixtureId === party.tableId)!;
      table.status = 'NeedsCleaning';
      this.enqueue('clean', party.id, party.tableId!);
      sim.log('payment', '实际结账入账', { actorId: actor.id });
    } else if (task.kind === 'clean') {
      const table = sim.tables.find((t) => t.fixtureId === task.tableId)!;
      table.status = 'Available';
      table.occupiedSeats = 0;
      table.currentParty = undefined;
      table.currentOrders = [];
      table.diningProgress = 0;
      sim.log('table-cleaned', '餐桌清理和水槽清洗完成', { fixtureId: task.tableId });
    }
    task.status = 'done';
    task.target = undefined;
    sim.releaseActor(actor);
  }
  private continueTask(task: ServiceTask, actor: Actor) {
    const destination = this.destination(task, actor);
    if (!destination) {
      task.status = 'pending';
      task.actorId = undefined;
      task.target = undefined;
      this.sim.releaseActor(actor);
      return;
    }
    this.lock(task);
    task.status = 'walking';
    task.target = destination;
    this.sim.route(actor, destination);
  }
  private lock(task: ServiceTask) {
    const kind =
      task.kind === 'deliver' && task.phase === 0
        ? 'serving'
        : task.kind === 'pay' && task.phase === 1
          ? 'checkout'
          : task.kind === 'clean' && task.phase === 1
            ? 'sink'
            : undefined;
    if (!kind) return;
    const fixture =
      kind === 'serving'
        ? (this.sim.getFixture(
            this.sim.orders.find((o) => o.id === task.orderId)?.servingFixtureId ?? '',
          ) ?? this.sim.layout.fixtures.find((f) => f.kind === kind)!)
        : this.sim.layout.fixtures.find((f) => f.kind === kind)!;
    const eq = this.sim.equipment.find((e) => e.fixtureId === fixture.id)!;
    const slot = eq.slots.indexOf(null);
    if (slot < 0) throw new Error('服务设备超过容量');
    eq.slots[slot] = task.id;
    eq.uses++;
    task.fixtureId = fixture.id;
    task.slot = slot;
  }
  private unlock(task: ServiceTask) {
    if (!task.fixtureId) return;
    const eq = this.sim.equipment.find((e) => e.fixtureId === task.fixtureId)!;
    if (eq.slots[task.slot!] !== task.id) throw new Error('服务设备锁所有权错误');
    eq.slots[task.slot!] = null;
    task.fixtureId = undefined;
    task.slot = undefined;
  }
}
