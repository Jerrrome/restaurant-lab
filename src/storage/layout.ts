import type { Layout } from '../simulation/types';
import { validateLayout } from '../simulation/navigation/grid';

const key = 'restaurant-lab:layout:v1';
const kinds = new Set([
  'fridge',
  'prep',
  'stove',
  'fryer',
  'rice',
  'sink',
  'serving',
  'storage',
  'table',
  'checkout',
  'restroom',
]);
const point = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  'x' in value &&
  'y' in value &&
  Number.isInteger(value.x) &&
  Number.isInteger(value.y);

export function saveLayout(layout: Layout): { ok: boolean; message: string } {
  try {
    localStorage.setItem(key, JSON.stringify(layout));
    return { ok: true, message: '布局已保存到此浏览器。' };
  } catch {
    return { ok: false, message: '浏览器存储不可用，布局没有保存。' };
  }
}

export function loadLayout(): { layout?: Layout; message: string } {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { message: '此浏览器还没有保存的布局。' };
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) throw new Error('格式无效');
    const value = data as Partial<Layout>;
    if (
      value.version !== 1 ||
      typeof value.name !== 'string' ||
      !Number.isInteger(value.width) ||
      !Number.isInteger(value.height) ||
      value.width !== 30 ||
      value.height !== 20 ||
      !Array.isArray(value.walls) ||
      !value.walls.every(point) ||
      !point(value.entrance) ||
      !point(value.exit) ||
      !Array.isArray(value.staffSpawns) ||
      !value.staffSpawns.every(point) ||
      !Array.isArray(value.fixtures)
    )
      throw new Error('布局版本或地图数据无效');
    const ids = new Set<string>();
    for (const fixture of value.fixtures) {
      if (
        !fixture ||
        typeof fixture.id !== 'string' ||
        ids.has(fixture.id) ||
        !kinds.has(fixture.kind) ||
        !point(fixture) ||
        ![0, 90, 180, 270].includes(fixture.rotation)
      )
        throw new Error('设备数据无效');
      ids.add(fixture.id);
    }
    const layout = value as Layout;
    const result = validateLayout(layout);
    if (!result.valid) throw new Error(result.reason ?? '不可访问的布局');
    return { layout, message: '已载入保存的布局，营业状态已重置。' };
  } catch (error) {
    return { message: `无法载入布局：${error instanceof Error ? error.message : '存档损坏'}` };
  }
}
