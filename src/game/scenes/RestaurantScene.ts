import Phaser from 'phaser';
import { EQUIPMENT } from '../../data/catalog';
import type { RestaurantSimulation } from '../../simulation/core/engine';
import type { Actor, EquipmentKind, Fixture, Point } from '../../simulation/types';

export interface SceneBindings {
  sim: RestaurantSimulation;
  selectedId?: string;
  onSelect: (id: string) => void;
  onCellClick: (point: Point) => void;
  debugPaths: boolean;
  debugUtilization: boolean;
  editing?: boolean;
}

const TILE = 30;
const C = {
  paper: 0xf5f3ec,
  kitchen: 0xe5eee7,
  dining: 0xf4eadd,
  kitchenGrid: 0xd6e0d9,
  diningGrid: 0xe8dccb,
  ink: 0x344947,
  slate: 0x68817d,
  jade: 0x235e4e,
  mint: 0x61a08a,
  brass: 0xd7a965,
  coral: 0xc97953,
  white: 0xfffdf8,
  red: 0xcd6955,
};

const KIND_SHORT: Record<EquipmentKind, string> = {
  fridge: 'COLD STORAGE',
  prep: 'PREPARATION',
  stove: 'DOUBLE BURNER',
  fryer: 'DEEP FRYER',
  rice: 'RICE COOKER',
  sink: 'WASH STATION',
  serving: 'SERVICE PASS',
  storage: 'DRY STORAGE',
  table: 'TABLE',
  checkout: 'CHECKOUT',
  restroom: 'RESTROOM',
};
const STATE_SHORT: Record<string, string> = {
  Idle: 'READY',
  Walking: 'ON THE MOVE',
  FetchingIngredient: 'INGREDIENTS',
  Preparing: 'PREPARING',
  Cooking: 'COOKING',
  WaitingForEquipment: 'WAITING',
  Assembling: 'PLATING',
  Delivering: 'SERVING',
  Cleaning: 'CLEANING',
  Blocked: 'YIELDING',
  Arriving: 'ARRIVING',
  WaitingForTable: 'WAITING',
  WalkingToTable: 'SEATING',
  Seated: 'SEATED',
  Ordering: 'ORDERING',
  WaitingForFood: 'WAITING',
  Eating: 'DINING',
  WalkingToRestroom: 'RESTROOM',
  Paying: 'PAYING',
  Leaving: 'LEAVING',
};

function dimensions(fixture: Fixture): { width: number; height: number } {
  const def = EQUIPMENT[fixture.kind];
  const quarterTurns = Math.abs(fixture.rotation) <= 3 ? fixture.rotation : fixture.rotation / 90;
  return Math.abs(quarterTurns % 2) === 1
    ? { width: def.height, height: def.width }
    : { width: def.width, height: def.height };
}

/** A viewport over the headless simulation. It only reads positions and resources. */
export class RestaurantScene extends Phaser.Scene {
  private readonly readBindings: () => SceneBindings;
  private floor!: Phaser.GameObjects.Graphics;
  private objects!: Phaser.GameObjects.Graphics;
  private overlays!: Phaser.GameObjects.Graphics;
  private people!: Phaser.GameObjects.Graphics;
  private tooltip!: Phaser.GameObjects.Text;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private layoutSignature = '';
  private initialized = false;
  private userZoom = 1;
  private baseZoom = 1;
  private panOrigin?: { x: number; y: number; scrollX: number; scrollY: number };
  private hoverId?: string;
  private hoverCell?: Point;
  private lastSim?: RestaurantSimulation;
  private renderPositions = new Map<
    string,
    { position: Point; from: Point; target: Point; elapsed: number }
  >();

  constructor(readBindings: () => SceneBindings) {
    super({ key: 'restaurant' });
    this.readBindings = readBindings;
  }

  create() {
    this.floor = this.add.graphics().setDepth(0);
    this.objects = this.add.graphics().setDepth(1);
    this.overlays = this.add.graphics().setDepth(2);
    this.people = this.add.graphics().setDepth(4);
    this.tooltip = this.add
      .text(0, 0, '', {
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '12px',
        color: '#fffdf8',
        backgroundColor: '#294e45',
        padding: { x: 11, y: 8 },
      })
      .setDepth(20)
      .setResolution(Math.min(window.devicePixelRatio || 1, 2))
      .setVisible(false);
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.pointerDown(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.pointerMove(pointer));
    this.input.on('pointerup', () => {
      this.panOrigin = undefined;
    });
    this.input.on('gameout', () => {
      this.panOrigin = undefined;
      this.tooltip.setVisible(false);
    });
    this.input.on(
      'wheel',
      (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
        const camera = this.cameras.main;
        const before = camera.getWorldPoint(pointer.x, pointer.y);
        this.userZoom = Phaser.Math.Clamp(this.userZoom * (dy > 0 ? 0.9 : 1.1), 0.65, 2.5);
        camera.setZoom(this.baseZoom * this.userZoom);
        const after = camera.getWorldPoint(pointer.x, pointer.y);
        camera.scrollX += before.x - after.x;
        camera.scrollY += before.y - after.y;
      },
    );
    this.scale.on('resize', () => this.fitCamera());
    this.initialized = true;
    this.fitCamera();
  }

  update(_time: number, delta: number) {
    if (!this.initialized) return;
    const binding = this.readBindings();
    if (binding.sim !== this.lastSim) {
      this.lastSim = binding.sim;
      this.layoutSignature = '';
      this.renderPositions.clear();
      this.userZoom = 1;
      this.fitCamera();
    }
    binding.sim.advance(delta / 1000);
    this.interpolatePeople(delta / 1000);
    this.drawFloor();
    this.drawObjects();
    this.drawOverlays();
    this.drawPeople();
    this.updateTooltip();
  }

  private fitCamera() {
    const layout = this.readBindings().sim.layout;
    const width = layout.width * TILE;
    const height = layout.height * TILE;
    this.baseZoom = Math.min((this.scale.width - 30) / width, (this.scale.height - 30) / height);
    this.baseZoom = Math.max(0.1, this.baseZoom);
    this.cameras.main.setZoom(this.baseZoom * this.userZoom).centerOn(width / 2, height / 2);
  }

  /** Smooth presentation between 250 ms logical ticks; positions never feed back into AI. */
  private interpolatePeople(dt: number) {
    const { sim } = this.readBindings();
    const duration = 0.25 / sim.speed;
    const ids = new Set(sim.actors.map((actor) => actor.id));
    for (const id of this.renderPositions.keys()) if (!ids.has(id)) this.renderPositions.delete(id);
    for (const actor of sim.actors) {
      let display = this.renderPositions.get(actor.id);
      if (!display) {
        display = {
          position: { ...actor.position },
          from: { ...actor.position },
          target: { ...actor.position },
          elapsed: duration,
        };
        this.renderPositions.set(actor.id, display);
      }
      if (display.target.x !== actor.position.x || display.target.y !== actor.position.y) {
        display.from = { ...display.position };
        display.target = { ...actor.position };
        display.elapsed = 0;
      }
      display.elapsed += dt;
      const blend = sim.paused || sim.speed >= 20 ? 1 : Math.min(1, display.elapsed / duration);
      display.position.x = Phaser.Math.Linear(display.from.x, display.target.x, blend);
      display.position.y = Phaser.Math.Linear(display.from.y, display.target.y, blend);
    }
  }

  private label(
    key: string,
    text: string,
    x: number,
    y: number,
    options: { color?: string; size?: number; background?: string; depth?: number } = {},
  ) {
    let label = this.labels.get(key);
    if (!label) {
      label = this.add
        .text(x, y, text, {
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: `${options.size ?? 8}px`,
          fontStyle: 'bold',
          color: options.color ?? '#526f65',
          align: 'center',
        })
        .setOrigin(0.5)
        .setDepth(options.depth ?? 3)
        .setResolution(Math.min(window.devicePixelRatio || 1, 2));
      this.labels.set(key, label);
    }
    label.setText(text).setPosition(x, y).setVisible(true);
    if (options.background) label.setBackgroundColor(options.background).setPadding(4, 2, 4, 2);
    return label;
  }

  private drawFloor() {
    const { layout } = this.readBindings().sim;
    const signature = JSON.stringify(layout);
    if (signature === this.layoutSignature) return;
    this.layoutSignature = signature;
    const graphics = this.floor;
    graphics.clear();
    const kitchenFixtures = layout.fixtures.filter(
      (f) => !['table', 'restroom', 'checkout'].includes(f.kind),
    );
    const kitchenMax = Math.max(12, ...kitchenFixtures.map((f) => f.x + dimensions(f).width));
    const divide = Math.min(layout.width - 8, kitchenMax + 1);
    const worldWidth = layout.width * TILE;
    const worldHeight = layout.height * TILE;
    graphics.fillStyle(C.dining).fillRoundedRect(0, 0, worldWidth, worldHeight, 12);
    graphics.fillStyle(C.kitchen).fillRect(0, 0, divide * TILE, worldHeight);
    for (let x = 0; x <= layout.width; x++) {
      graphics.lineStyle(1, x <= divide ? C.kitchenGrid : C.diningGrid, 0.62);
      graphics.lineBetween(x * TILE, 0, x * TILE, worldHeight);
    }
    for (let y = 0; y <= layout.height; y++) {
      graphics.lineStyle(1, C.kitchenGrid, 0.62).lineBetween(0, y * TILE, divide * TILE, y * TILE);
      graphics
        .lineStyle(1, C.diningGrid, 0.62)
        .lineBetween(divide * TILE, y * TILE, worldWidth, y * TILE);
    }
    for (const wall of layout.walls) {
      graphics.fillStyle(0x344b43).fillRect(wall.x * TILE, wall.y * TILE, TILE, TILE);
      graphics.fillStyle(0x476357).fillRect(wall.x * TILE + 2, wall.y * TILE + 2, TILE - 4, 5);
    }
    for (const [point, name] of [
      [layout.entrance, 'ENTRANCE'],
      [layout.exit, 'EXIT'],
    ] as const) {
      graphics.fillStyle(0x81ae92, 0.5).fillRect(point.x * TILE, point.y * TILE, TILE, TILE);
      graphics
        .lineStyle(2, 0x507b5c)
        .lineBetween(
          point.x * TILE + 5,
          point.y * TILE + 15,
          point.x * TILE + 25,
          point.y * TILE + 15,
        );
      graphics.lineBetween(
        point.x * TILE + 15,
        point.y * TILE + 6,
        point.x * TILE + 15,
        point.y * TILE + 24,
      );
      this.label(`door-${name}`, name, point.x * TILE + 15, point.y * TILE - 7, {
        size: 8,
        color: '#326348',
      });
    }
    this.label('zone-kitchen', 'K I T C H E N', (divide * TILE) / 2, TILE * 1.45, {
      size: 10,
      color: '#728c79',
    });
    this.label(
      'zone-dining',
      'D I N I N G  R O O M',
      (divide + (layout.width - divide) / 2) * TILE,
      TILE * 1.45,
      { size: 10, color: '#a18a6c' },
    );
    for (const [key, label] of this.labels) if (key.startsWith('fixture-')) label.destroy();
    for (const key of [...this.labels.keys()])
      if (key.startsWith('fixture-')) this.labels.delete(key);
  }

  private drawObjects() {
    const { sim, selectedId } = this.readBindings();
    const graphics = this.objects;
    graphics.clear();
    for (const fixture of sim.layout.fixtures) {
      const { width, height } = dimensions(fixture);
      const x = fixture.x * TILE + 3;
      const y = fixture.y * TILE + 3;
      const w = width * TILE - 6;
      const h = height * TILE - 6;
      const cx = x + w / 2;
      const cy = y + h / 2;
      const table = sim.tables.find((t) => t.fixtureId === fixture.id);
      graphics.fillStyle(0x233c31, 0.14).fillRoundedRect(x + 2, y + 4, w, h, 5);
      const face =
        fixture.kind === 'table'
          ? 0xdac2a2
          : fixture.kind === 'prep' || fixture.kind === 'serving'
            ? 0xd0b490
            : 0xc4d3c8;
      graphics.fillStyle(face).fillRoundedRect(x, y, w, h, 5);
      graphics
        .lineStyle(1.2, fixture.kind === 'table' ? 0xb89877 : 0x8caaa0)
        .strokeRoundedRect(x, y, w, h, 5);
      graphics.fillStyle(0xffffff, 0.26).fillRoundedRect(x + 3, y + 3, w - 6, 4, 2);
      this.drawIcon(graphics, fixture, x, y, w, h);
      if (table) {
        const color =
          table.status === 'NeedsCleaning' ? C.red : table.status === 'Occupied' ? C.jade : C.mint;
        graphics.fillStyle(color).fillCircle(x + w - 6, y + 6, 3);
        if (table.diningProgress > 0 && table.status === 'Occupied') {
          graphics.fillStyle(0xac906d, 0.4).fillRoundedRect(x + 6, y + h - 6, w - 12, 3, 1);
          graphics
            .fillStyle(C.jade)
            .fillRoundedRect(x + 6, y + h - 6, (w - 12) * table.diningProgress, 3, 1);
        }
        const served = table.currentOrders.filter((id) =>
          ['served', 'paid'].includes(sim.orders.find((o) => o.id === id)?.status ?? ''),
        ).length;
        if (served) {
          graphics.fillStyle(C.coral).fillCircle(cx - 15, cy, 2.5);
          graphics.fillStyle(C.mint).fillCircle(cx - 19, cy + 2, 2);
        }
        if (table.status === 'NeedsCleaning')
          this.label(`fixture-${fixture.id}-notice`, 'CLEAN', cx, y + h + 9, {
            color: '#a9503e',
            size: 8,
          });
        else this.labels.get(`fixture-${fixture.id}-notice`)?.setVisible(false);
      }
      if (fixture.kind === 'serving') {
        const ready = sim.orders.filter(
          (o) => o.status === 'ready' && o.servingFixtureId === fixture.id,
        ).length;
        const readyLabel = this.label(`fixture-${fixture.id}-ready`, `${ready} READY`, cx, y - 8, {
          color: '#a36b33',
          size: 8,
        });
        readyLabel.setVisible(ready > 0);
      }
      const isSelected = selectedId === fixture.id;
      if (isSelected || this.hoverId === fixture.id) {
        graphics
          .lineStyle(isSelected ? 2.5 : 1.5, C.jade, isSelected ? 1 : 0.55)
          .strokeRoundedRect(x - 3, y - 3, w + 6, h + 6, 7);
      }
      this.label(
        `fixture-${fixture.id}`,
        fixture.kind === 'table'
          ? `${fixture.id.replace(/[^0-9]/g, '') || 'TABLE'} · ${table?.occupiedSeats ?? 0}/${fixture.seatCount ?? 4}`
          : KIND_SHORT[fixture.kind],
        cx,
        cy + h / 2 + 9,
        { size: 7, color: '#647b68' },
      );
    }
  }

  private drawIcon(
    g: Phaser.GameObjects.Graphics,
    f: Fixture,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    g.lineStyle(1.6, C.slate, 1);
    switch (f.kind) {
      case 'fridge':
        g.fillStyle(0xecf3ed).fillRoundedRect(x + 5, y + 6, w - 10, h - 12, 3);
        g.strokeRoundedRect(x + 5, y + 6, w - 10, h - 12, 3);
        g.lineBetween(x + 5, cy - 4, x + w - 5, cy - 4);
        g.lineStyle(2.6, C.jade).lineBetween(x + w - 11, cy + 2, x + w - 11, cy + 11);
        break;
      case 'prep':
        g.fillStyle(0xf2dfbc).fillRoundedRect(x + 7, y + 7, w - 14, h - 14, 3);
        g.lineStyle(1.2, 0xba9770).strokeRoundedRect(x + 7, y + 7, w - 14, h - 14, 3);
        g.fillStyle(0x71a276)
          .fillCircle(cx - 7, cy, 4)
          .fillCircle(cx - 3, cy - 3, 3);
        g.lineStyle(3, 0xe5e9da).lineBetween(cx + 4, cy - 7, cx + 4, cy + 3);
        g.lineStyle(3, C.jade).lineBetween(cx + 4, cy + 3, cx + 4, cy + 8);
        break;
      case 'stove': {
        g.fillStyle(0x536c61).fillRoundedRect(x + 5, y + 5, w - 10, h - 10, 3);
        const count = EQUIPMENT.stove.burners ?? 2;
        const horizontal = w >= h;
        for (let i = 0; i < count; i++) {
          const bx = horizontal ? x + (w / (count + 1)) * (i + 1) : cx;
          const by = horizontal ? cy : y + (h / (count + 1)) * (i + 1);
          g.fillStyle(0x293c33).fillCircle(bx, by, 7);
          g.lineStyle(1.8, 0x92bda4).strokeCircle(bx, by, 4);
          g.lineStyle(1.3, 0xc4d5c3)
            .lineBetween(bx - 8, by, bx + 8, by)
            .lineBetween(bx, by - 8, bx, by + 8);
        }
        break;
      }
      case 'fryer':
        g.fillStyle(0x496455).fillRoundedRect(x + 5, y + 6, w - 10, h - 12, 3);
        g.fillStyle(0xcba755).fillRoundedRect(x + 9, y + 10, w - 18, h - 20, 2);
        g.lineStyle(1, 0xeedcaa).strokeRect(x + 12, y + 12, w - 24, h - 24);
        g.lineStyle(2.5, 0xecf0dd).lineBetween(cx, y + 10, cx, y + 3);
        break;
      case 'rice':
        g.fillStyle(0xfaf8e9).fillCircle(cx, cy + 2, Math.min(w, h) * 0.32);
        g.lineStyle(1.6, 0x748d7d).strokeCircle(cx, cy + 2, Math.min(w, h) * 0.32);
        g.lineBetween(cx - 7, cy - 4, cx + 7, cy - 4);
        g.fillStyle(C.jade).fillRoundedRect(cx - 4, cy - 9, 8, 3, 1);
        g.fillStyle(C.mint).fillCircle(cx, cy + 9, 2);
        break;
      case 'sink':
        g.fillStyle(0x8db4ad).fillRoundedRect(x + 7, y + 8, w - 14, h - 14, 3);
        g.fillStyle(0xb2d0c8).fillRoundedRect(x + 11, y + 12, w - 22, h - 22, 2);
        g.lineStyle(2.6, 0xf8fbef)
          .lineBetween(cx, y + 5, cx, cy - 1)
          .lineBetween(cx, cy - 1, cx + 5, cy - 1);
        g.fillStyle(C.slate).fillCircle(cx, cy + 6, 2);
        break;
      case 'serving':
        g.fillStyle(0x688a70).fillRoundedRect(x + 6, y + 7, w - 12, h - 14, 3);
        g.fillStyle(0xfffbea).fillCircle(cx - (w > 40 ? 10 : 0), cy, 7);
        g.lineStyle(1, 0xd6caaa).strokeCircle(cx - (w > 40 ? 10 : 0), cy, 5);
        if (w > 40) g.fillStyle(0xfffbea).fillCircle(cx + 10, cy, 7);
        break;
      case 'storage':
        for (let row = 0; row < 2; row++) {
          g.fillStyle(0x9d9270).fillRect(x + 5, y + 9 + row * 11, w - 10, 2);
          for (let column = 0; column < Math.max(1, Math.floor(w / 15)); column++) {
            g.fillStyle(column % 2 ? 0xe5ce91 : 0xb4c4a1).fillRoundedRect(
              x + 7 + column * 14,
              y + 3 + row * 11,
              9,
              6,
              1,
            );
          }
        }
        break;
      case 'table':
        g.fillStyle(0xf1dfc8).fillRoundedRect(x + 5, y + 5, w - 10, h - 10, 3);
        g.lineStyle(1, 0xc8ad8b).lineBetween(x + 8, cy, x + w - 8, cy);
        for (const offset of [-1, 1]) {
          const px = cx + offset * Math.min(w * 0.27, 17);
          g.fillStyle(0xfffbea).fillCircle(px, cy, 6);
          g.lineStyle(1, 0xe1d1b3).strokeCircle(px, cy, 4);
        }
        for (const seat of [-1, 1]) {
          g.fillStyle(0xb59173).fillRoundedRect(cx - 8, seat === -1 ? y - 7 : y + h + 2, 16, 6, 2);
          g.fillRoundedRect(seat === -1 ? x - 7 : x + w + 2, cy - 8, 6, 16, 2);
        }
        break;
      case 'checkout':
        g.fillStyle(0x587a68).fillRoundedRect(cx - 11, cy - 8, 22, 17, 3);
        g.fillStyle(0xd3e7d4).fillRoundedRect(cx - 7, cy - 5, 14, 8, 1);
        g.lineStyle(1.5, 0xcfe0c4).lineBetween(cx - 6, cy + 6, cx + 6, cy + 6);
        break;
      case 'restroom':
        g.fillStyle(0xeff4ea).fillRoundedRect(cx - 7, cy - 10, 14, 18, 5);
        g.fillStyle(0xc1d2c7).fillEllipse(cx, cy + 1, 9, 11);
        g.fillStyle(0xeff4ea).fillRoundedRect(cx - 9, cy - 14, 18, 6, 2);
        break;
    }
  }

  private drawOverlays() {
    const { sim, selectedId, debugPaths, debugUtilization, editing } = this.readBindings();
    const graphics = this.overlays;
    graphics.clear();
    for (const label of this.labels.values())
      if (label.name === 'utilization') label.setVisible(false);
    if (debugPaths) {
      for (const actor of sim.actors.filter((a) => a.role !== 'customer')) {
        if (!actor.path.length) continue;
        graphics.lineStyle(1.5, actor.role === 'chef' ? C.jade : C.coral, 0.55);
        const display = this.renderPositions.get(actor.id)?.position ?? actor.position;
        let prev = { x: (display.x + 0.5) * TILE, y: (display.y + 0.5) * TILE };
        for (const cell of actor.path) {
          const next = { x: (cell.x + 0.5) * TILE, y: (cell.y + 0.5) * TILE };
          graphics.lineBetween(prev.x, prev.y, next.x, next.y);
          graphics
            .fillStyle(actor.role === 'chef' ? C.jade : C.coral, 0.35)
            .fillCircle(next.x, next.y, 2);
          prev = next;
        }
      }
    }
    for (const fixture of sim.layout.fixtures) {
      const equipment = sim.equipment.find((e) => e.fixtureId === fixture.id);
      if (!equipment) continue;
      const active = equipment.slots.filter(Boolean);
      const { width, height } = dimensions(fixture);
      const x = fixture.x * TILE + 6;
      const y = fixture.y * TILE + height * TILE - 8;
      const w = width * TILE - 12;
      if (active.length) {
        const task = sim.tasks.find((t) => t.id === active[0]);
        const service = sim.serviceTasks.find((t) => t.id === active[0]);
        const duration =
          task?.status === 'passive'
            ? task.step.passiveTime
            : task?.status === 'finish'
              ? (task.step.finishTime ?? 0)
              : (task?.step.activeTime ?? 1);
        const processing = task && ['active', 'passive', 'finish'].includes(task.status);
        const serviceDuration = service?.kind === 'deliver' ? 4 : service?.kind === 'pay' ? 6 : 10;
        const progress = processing
          ? Phaser.Math.Clamp(1 - task.remaining / Math.max(1, duration), 0.04, 1)
          : service?.status === 'active'
            ? Phaser.Math.Clamp(1 - service.remaining / serviceDuration, 0.04, 1)
            : 0.04;
        graphics.fillStyle(0x284b3c, 0.35).fillRoundedRect(x, y, w, 3, 1);
        graphics
          .fillStyle(task?.status === 'passive' ? C.brass : C.mint)
          .fillRoundedRect(x, y, w * progress, 3, 1);
        graphics
          .fillStyle(C.brass)
          .fillCircle(fixture.x * TILE + width * TILE - 7, fixture.y * TILE + 7, 3);
      }
      if (debugUtilization || selectedId === fixture.id) {
        const utilization = sim.getEquipmentUtilization(fixture.id);
        this.label(
          `util-${fixture.id}`,
          `${active.length}/${equipment.slots.length} · ${Math.round(utilization * 100)}%`,
          x + w / 2,
          fixture.y * TILE - 6,
          {
            size: 8,
            color: '#fffdf3',
            background: active.length ? '#386b55' : '#6e8375',
            depth: 6,
          },
        ).setName('utilization');
      }
    }
    if (editing && this.hoverCell) {
      graphics
        .fillStyle(C.jade, 0.17)
        .fillRect(this.hoverCell.x * TILE, this.hoverCell.y * TILE, TILE, TILE);
      graphics
        .lineStyle(1.5, C.jade, 0.6)
        .strokeRect(this.hoverCell.x * TILE, this.hoverCell.y * TILE, TILE, TILE);
    }
  }

  private drawPeople() {
    const { sim, selectedId } = this.readBindings();
    const graphics = this.people;
    graphics.clear();
    const ids = new Set(sim.actors.map((a) => a.id));
    for (const [id, label] of this.labels) {
      if (id.startsWith('actor-') && !ids.has(id.slice(6))) {
        label.destroy();
        this.labels.delete(id);
      }
    }
    for (const actor of sim.actors) {
      const display = this.renderPositions.get(actor.id)?.position ?? actor.position;
      const x = (display.x + 0.5) * TILE;
      const y = (display.y + 0.5) * TILE;
      const r = actor.radius * TILE;
      const roleColor =
        actor.role === 'chef' ? C.jade : actor.role === 'waiter' ? C.coral : C.brass;
      const busy = actor.state !== 'Idle' && actor.state !== 'Seated' && actor.state !== 'Eating';
      graphics.fillStyle(0x294738, 0.15).fillEllipse(x + 1, y + r - 1, r * 2.1, r);
      if (selectedId === actor.id || this.hoverId === actor.id) {
        graphics
          .lineStyle(2, roleColor, selectedId === actor.id ? 0.95 : 0.6)
          .strokeCircle(x, y, r + 4);
      }
      graphics.fillStyle(roleColor).fillCircle(x, y, r);
      graphics.lineStyle(1.3, C.white, 0.9).strokeCircle(x, y, r);
      const fx = actor.facing.x;
      const fy = actor.facing.y;
      const length = Math.sqrt(fx * fx + fy * fy) || 1;
      graphics
        .fillStyle(C.white, 0.9)
        .fillCircle(x + (fx / length) * r * 0.55, y + (fy / length) * r * 0.55, 2.1);
      if (actor.role === 'chef') {
        graphics.fillStyle(C.white).fillRoundedRect(x - 5, y - r - 2, 10, 5, 2);
        graphics.fillCircle(x - 3, y - r - 2, 3).fillCircle(x + 3, y - r - 2, 3);
      } else if (actor.role === 'waiter') {
        graphics.fillStyle(C.white).fillRoundedRect(x - 3, y + 1, 6, 5, 1);
        const serviceTask = sim.serviceTasks.find((t) => t.id === actor.taskId);
        if (serviceTask?.kind === 'deliver' && serviceTask.phase === 1) {
          graphics.fillStyle(C.white).fillCircle(x + r + 3, y + 2, 5);
          graphics.lineStyle(1, 0xc9b58f).strokeCircle(x + r + 3, y + 2, 5);
          graphics.fillStyle(C.coral).fillCircle(x + r + 3, y + 2, 2.5);
          graphics.fillStyle(C.mint).fillCircle(x + r + 5, y, 1.7);
        }
      }
      if (actor.state === 'Blocked' || actor.state === 'WaitingForEquipment') {
        graphics.fillStyle(C.red).fillCircle(x + r, y - r, 3);
      } else if (busy && actor.role !== 'customer') {
        graphics.fillStyle(C.mint).fillCircle(x + r, y - r, 2.5);
      }
      const stateVisible = actor.role !== 'customer' || selectedId === actor.id;
      const label = this.label(
        `actor-${actor.id}`,
        STATE_SHORT[actor.state] ?? actor.state.toUpperCase(),
        x,
        y + r + 9,
        { size: 7, color: '#435f4c', depth: 5 },
      );
      label.setVisible(stateVisible);
    }
  }

  private hitTest(point: Point): string | undefined {
    const { sim } = this.readBindings();
    const actor = [...sim.actors].reverse().find((a) => {
      const display = this.renderPositions.get(a.id)?.position ?? a.position;
      return (
        Math.hypot(point.x - (display.x + 0.5), point.y - (display.y + 0.5)) <= a.radius + 0.16
      );
    });
    if (actor) return actor.id;
    return [...sim.layout.fixtures].reverse().find((f) => {
      const dim = dimensions(f);
      return (
        point.x >= f.x && point.x < f.x + dim.width && point.y >= f.y && point.y < f.y + dim.height
      );
    })?.id;
  }

  private pointerDown(pointer: Phaser.Input.Pointer) {
    if (pointer.rightButtonDown() || pointer.middleButtonDown()) {
      this.panOrigin = {
        x: pointer.x,
        y: pointer.y,
        scrollX: this.cameras.main.scrollX,
        scrollY: this.cameras.main.scrollY,
      };
      return;
    }
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const point = { x: world.x / TILE, y: world.y / TILE };
    const binding = this.readBindings();
    const id = this.hitTest(point);
    if (id) binding.onSelect(id);
    else if (
      point.x >= 0 &&
      point.y >= 0 &&
      point.x < binding.sim.layout.width &&
      point.y < binding.sim.layout.height
    ) {
      binding.onCellClick({ x: Math.floor(point.x), y: Math.floor(point.y) });
    }
  }

  private pointerMove(pointer: Phaser.Input.Pointer) {
    if (this.panOrigin) {
      const camera = this.cameras.main;
      camera.scrollX = this.panOrigin.scrollX - (pointer.x - this.panOrigin.x) / camera.zoom;
      camera.scrollY = this.panOrigin.scrollY - (pointer.y - this.panOrigin.y) / camera.zoom;
      this.tooltip.setVisible(false);
      return;
    }
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const point = { x: world.x / TILE, y: world.y / TILE };
    this.hoverId = this.hitTest(point);
    this.hoverCell = { x: Math.floor(point.x), y: Math.floor(point.y) };
  }

  private updateTooltip() {
    if (!this.hoverId || this.panOrigin) {
      this.tooltip.setVisible(false);
      return;
    }
    const sim = this.readBindings().sim;
    const actor: Actor | undefined = sim.actors.find((a) => a.id === this.hoverId);
    const fixture = sim.getFixture(this.hoverId);
    const text = actor
      ? `${actor.name}  ·  ${STATE_SHORT[actor.state] ?? actor.state}\nClick to inspect`
      : fixture
        ? `${EQUIPMENT[fixture.kind].name}\nClick to inspect`
        : '';
    if (!text) {
      this.tooltip.setVisible(false);
      return;
    }
    const pointer = this.input.activePointer;
    this.tooltip.setText(text).setVisible(true);
    const position = this.cameras.main.getWorldPoint(
      Math.min(pointer.x + 14, this.scale.width - this.tooltip.width - 10),
      Math.max(8, Math.min(pointer.y + 14, this.scale.height - this.tooltip.height - 10)),
    );
    this.tooltip.setScale(1 / this.cameras.main.zoom).setPosition(position.x, position.y);
  }
}
