import { EQUIPMENT, INGREDIENTS } from '../../data/catalog';
import type { Recipe } from '../types';

/** Validate content at the data boundary, before any runtime reservations are created. */
export function validateRecipe(recipe: Recipe): void {
  const byId = new Map(recipe.steps.map((s) => [s.id, s]));
  if (!recipe.id || !recipe.steps.length || byId.size !== recipe.steps.length)
    throw new Error(`菜谱 ${recipe.id} 工序ID无效或重复`);
  if (!Number.isFinite(recipe.price) || recipe.price < 0) throw new Error('菜品售价无效');
  for (const [name, quantity] of Object.entries(recipe.ingredients))
    if (!INGREDIENTS[name] || !Number.isInteger(quantity) || quantity <= 0)
      throw new Error('菜谱食材要求无效');
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`菜谱 ${recipe.id} 存在循环依赖`);
    if (visited.has(id)) return;
    const step = byId.get(id);
    if (!step) throw new Error(`菜谱依赖 ${id} 不存在`);
    if (!EQUIPMENT[step.equipment].methods.includes(step.method))
      throw new Error('工序与设备不兼容');
    if (step.tool && !EQUIPMENT[step.equipment].tools.includes(step.tool))
      throw new Error('工序缺少必要工具');
    if (
      !Number.isFinite(step.activeTime) ||
      step.activeTime <= 0 ||
      !Number.isFinite(step.passiveTime) ||
      step.passiveTime < 0 ||
      (step.finishTime !== undefined && (!Number.isFinite(step.finishTime) || step.finishTime < 0))
    )
      throw new Error('工序时长无效');
    for (const material of [...step.inputs, ...step.outputs])
      if (
        !material.name ||
        !material.tags.length ||
        !Number.isInteger(material.quantity ?? 1) ||
        (material.quantity ?? 1) <= 0
      )
        throw new Error('工序食材无效');
    visiting.add(id);
    step.dependencies.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  recipe.steps.forEach((s) => visit(s.id));
}
