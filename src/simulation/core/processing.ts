import type { Ingredient, RecipeStep, EquipmentDefinition, Method, ToolKind } from '../types';
import { INGREDIENTS } from '../../data/catalog';

const METHOD_TOOLS: Partial<Record<Method, ToolKind>> = {
  Cut: 'knife',
  PanSear: 'pan',
  StirFry: 'wok',
  DeepFry: 'basket',
  Heat: 'pan',
  Assemble: 'plate',
  Pass: 'plate',
};
const unsafeAssembly = (step: RecipeStep, input: Ingredient[]) =>
  step.method === 'Assemble' &&
  input.some(
    (i) => INGREDIENTS[i.name]?.category === 'protein' && !i.processingState.includes('cooked'),
  );

export function selectInputs(
  step: RecipeStep,
  ingredients: Ingredient[],
  reserved = new Set<string>(),
): Ingredient[] | undefined {
  const selected: Ingredient[] = [];
  for (const requirement of step.inputs) {
    const matches = ingredients.filter(
      (item) =>
        !item.consumed &&
        !reserved.has(item.id) &&
        !selected.includes(item) &&
        item.name === requirement.name &&
        requirement.tags.every((tag) => item.processingState.includes(tag)),
    );
    const needed = requirement.quantity ?? 1;
    if (matches.length < needed) return;
    selected.push(...matches.slice(0, needed));
  }
  return selected;
}

export function validateProcessing(
  step: RecipeStep,
  equipment: EquipmentDefinition,
  ingredients: Ingredient[],
): string | undefined {
  if (!equipment.methods.includes(step.method)) return `设备不支持 ${step.method}`;
  const tool = step.tool ?? METHOD_TOOLS[step.method];
  if (tool && !equipment.tools.includes(tool)) return `缺少工具 ${tool}`;
  const inputs = selectInputs(step, ingredients);
  if (!inputs || unsafeAssembly(step, inputs)) return '食材或加工状态不符合要求';
}

export function processIngredients(
  step: RecipeStep,
  input: Ingredient[],
  createId: () => string,
): Ingredient[] {
  const selected = selectInputs(step, input);
  if (!selected) throw new Error(`非法加工：${step.id} 缺少正确状态的食材`);
  if (unsafeAssembly(step, selected)) throw new Error('非法加工：不能把生肉装盘当成成品');
  for (const ingredient of selected) ingredient.consumed = true;
  return step.outputs.flatMap((output) =>
    Array.from({ length: output.quantity ?? 1 }, () => ({
      id: createId(),
      name: output.name,
      category: 'processed',
      quantity: 1,
      unit: 'portion',
      processingState: [...output.tags],
      temperature: output.tags.includes('cooked') || output.tags.includes('heated') ? 75 : 20,
      freshness: Math.min(1, ...selected.map((item) => item.freshness)),
      cost:
        selected.reduce((sum, item) => sum + item.cost, 0) /
        Math.max(
          1,
          step.outputs.reduce((sum, o) => sum + (o.quantity ?? 1), 0),
        ),
      consumed: false,
    })),
  );
}
