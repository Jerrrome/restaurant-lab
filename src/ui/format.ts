import type { ActorState, EquipmentKind } from '../simulation/types';

export const money = (value: number) => `¥${value.toFixed(0)}`;
export const duration = (value: number) =>
  value >= 60 ? `${(value / 60).toFixed(1)} 分` : `${Math.round(value)} 秒`;
export const percent = (value: number) => `${Math.round(value * 100)}%`;
export const clock = (time: number) => {
  const minutes = 11 * 60 + Math.floor(time / 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};
export const equipmentNames: Record<EquipmentKind, string> = {
  fridge: '冷藏冰箱',
  prep: '备料工作台',
  stove: '双眼燃气灶',
  fryer: '单篮炸炉',
  rice: '电饭煲',
  sink: '清洗水槽',
  serving: '出餐台',
  storage: '常温储物架',
  table: '四人餐桌',
  checkout: '收银台',
  restroom: '卫生间',
};
export const stateNames: Record<ActorState, string> = {
  Idle: '空闲待命',
  Walking: '前往工作位置',
  FetchingIngredient: '领取食材',
  Preparing: '准备食材',
  Cooking: '烹饪中',
  WaitingForEquipment: '等待设备',
  Assembling: '装盘',
  Delivering: '配送餐品',
  Cleaning: '清洁餐桌',
  Blocked: '等待通道',
  Arriving: '进入餐厅',
  WaitingForTable: '等待座位',
  WalkingToTable: '前往餐桌',
  Seated: '已入座',
  Ordering: '正在点单',
  WaitingForFood: '等待餐品',
  Eating: '用餐中',
  WalkingToRestroom: '前往卫生间',
  Paying: '等待结账',
  Leaving: '离店',
};
export const roleNames = { chef: '厨师', waiter: '服务员', customer: '顾客' };
export const orderNames = {
  queued: '等待分配',
  cooking: '制作中',
  ready: '等待上菜',
  delivering: '配送中',
  served: '已上菜',
  paid: '已结账',
  cancelled: '已取消',
};
export const taskNames = {
  pending: '等待资源',
  walking: '前往设备',
  active: '主动操作',
  passive: '设备加工',
  finish: '取出成品',
  done: '已完成',
};
