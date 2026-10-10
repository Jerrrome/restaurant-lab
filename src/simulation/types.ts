export type Point = { x: number; y: number };
export type EquipmentKind =
  | 'fridge'
  | 'prep'
  | 'stove'
  | 'fryer'
  | 'rice'
  | 'sink'
  | 'serving'
  | 'storage'
  | 'table'
  | 'checkout'
  | 'restroom';
export type Method =
  | 'Fetch'
  | 'Cut'
  | 'Coat'
  | 'Mix'
  | 'PanSear'
  | 'StirFry'
  | 'DeepFry'
  | 'Boil'
  | 'Heat'
  | 'CookRice'
  | 'Assemble'
  | 'Pass';
export type ToolKind = 'pan' | 'wok' | 'knife' | 'basket' | 'plate';
export interface EquipmentDefinition {
  kind: EquipmentKind;
  name: string;
  category: string;
  width: number;
  height: number;
  capacity: number;
  methods: Method[];
  tools: ToolKind[];
  purchaseCost: number;
  operatingCost: number;
  powerConsumption: number;
  processingDuration: number;
  interactionSlots: Point[];
  burners?: number;
  basketCount?: number;
  basketCapacity?: number;
  batchCapacity?: number;
}
export interface Fixture {
  id: string;
  kind: EquipmentKind;
  x: number;
  y: number;
  rotation: number;
  seatCount?: number;
}
export interface Layout {
  version: 1;
  name: string;
  width: number;
  height: number;
  walls: Point[];
  entrance: Point;
  exit: Point;
  fixtures: Fixture[];
  staffSpawns: Point[];
}
export interface Ingredient {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  processingState: string[];
  temperature: number;
  freshness: number;
  cost: number;
  consumed: boolean;
  locationFixtureId?: string;
  heldBy?: string;
}
export interface MaterialRequirement {
  name: string;
  tags: string[];
  quantity?: number;
}
export interface RecipeStep {
  id: string;
  label: string;
  method: Method;
  equipment: EquipmentKind;
  tool?: ToolKind;
  dependencies: string[];
  activeTime: number;
  passiveTime: number;
  finishTime?: number;
  inputs: MaterialRequirement[];
  outputs: { name: string; tags: string[]; quantity?: number }[];
}
export interface Recipe {
  id: string;
  name: string;
  shortName: string;
  price: number;
  ingredientCost: number;
  diningTime: number;
  ingredients: Record<string, number>;
  steps: RecipeStep[];
}
export type ActorState =
  | 'Idle'
  | 'Walking'
  | 'FetchingIngredient'
  | 'Preparing'
  | 'Cooking'
  | 'WaitingForEquipment'
  | 'Assembling'
  | 'Delivering'
  | 'Cleaning'
  | 'Blocked'
  | 'Arriving'
  | 'WaitingForTable'
  | 'WalkingToTable'
  | 'Seated'
  | 'Ordering'
  | 'WaitingForFood'
  | 'Eating'
  | 'WalkingToRestroom'
  | 'Paying'
  | 'Leaving';
export interface Actor {
  id: string;
  name: string;
  role: 'chef' | 'waiter' | 'customer';
  position: Point;
  cell: Point;
  home: Point;
  radius: number;
  facing: Point;
  state: ActorState;
  path: Point[];
  target?: Point;
  movingTo?: Point;
  blockedTime: number;
  totalWalking: number;
  busyTime: number;
  waitingTime: number;
  taskId?: string;
  partyId?: string;
  speed: number;
  waitReason?: string;
  nextTaskLabel?: string;
}
export type TaskStatus = 'pending' | 'walking' | 'active' | 'passive' | 'finish' | 'done';
export interface KitchenTask {
  id: string;
  orderId: string;
  step: RecipeStep;
  status: TaskStatus;
  actorId?: string;
  fixtureId?: string;
  slot?: number;
  interaction?: Point;
  remaining: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  waitingEquipment: number;
  waitingStaff: number;
  walking: number;
  active: number;
  passive: number;
  reservedRice?: boolean;
  pickupFixtureIds?: string[];
  pickupIndex?: number;
  pickupRemaining?: number;
}
export interface ServiceTask {
  id: string;
  kind: 'greet' | 'order' | 'deliver' | 'pay' | 'clean';
  partyId: string;
  tableId: string;
  orderId?: string;
  status: 'pending' | 'walking' | 'active' | 'done';
  phase: number;
  remaining: number;
  actorId?: string;
  createdAt: number;
  target?: Point;
  fixtureId?: string;
  slot?: number;
}
export interface Order {
  id: string;
  partyId: string;
  tableId: string;
  recipeId: string;
  status: 'queued' | 'cooking' | 'ready' | 'delivering' | 'served' | 'paid' | 'cancelled';
  createdAt: number;
  readyAt?: number;
  servedAt?: number;
  paidAt?: number;
  tasks: string[];
  ingredients: Ingredient[];
  deliveryTime: number;
  servingFixtureId?: string;
}
export interface DemandEvent {
  id: string;
  arrival: number;
  size: number;
  recipes: string[];
  diningFactor: number;
  restroom: boolean;
  patience: number;
}
export interface Party {
  id: string;
  memberIds: string[];
  demand: DemandEvent;
  state: ActorState;
  tableId?: string;
  seatTargets: Point[];
  orders: string[];
  arrivalTime: number;
  seatedAt?: number;
  orderedAt?: number;
  foodAt?: number;
  paidAt?: number;
  diningRemaining: number;
  restroomDone: boolean;
  restroomRemaining: number;
  satisfied: number;
  waits: { table: number; order: number; kitchen: number; delivery: number; payment: number };
}
export interface TableState {
  fixtureId: string;
  seatCount: number;
  occupiedSeats: number;
  currentParty?: string;
  currentOrders: string[];
  diningProgress: number;
  status: 'Available' | 'Occupied' | 'NeedsCleaning';
}
export interface EquipmentState {
  fixtureId: string;
  slots: (string | null)[];
  busyTime: number;
  uses: number;
}
export interface Metrics {
  customersServed: number;
  ordersCompleted: number;
  revenue: number;
  foodCost: number;
  laborCost: number;
  operatingCost: number;
  profit: number;
  averageOrderValue: number;
  averageWaitTime: number;
  averageCookingTime: number;
  averageWalkingTime: number;
  equipmentWaitingTime: number;
  staffUtilization: number;
  averageTableOccupancy: number;
  kitchenThroughput: number;
  lostCustomers: number;
}
export interface SimEvent {
  time: number;
  type: string;
  actorId?: string;
  orderId?: string;
  taskId?: string;
  fixtureId?: string;
  detail: string;
  position?: Point;
}
export interface SimulationOptions {
  seed?: number;
  layout?: Layout;
  arrivalInterval?: number;
  closeTime?: number;
  menu?: string[];
  chefs?: number;
  waiters?: number;
}
