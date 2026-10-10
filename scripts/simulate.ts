import { ALTERNATIVE_LAYOUT, BASELINE_LAYOUT } from '../src/data/scenarios';
import { RestaurantSimulation } from '../src/simulation/core/engine';

// Same seed and precomputed demand, two real complete lunch runs, zero browser APIs.
const seed = 12345;
for (const layout of [BASELINE_LAYOUT, ALTERNATIVE_LAYOUT]) {
  const sim = new RestaurantSimulation({ seed, layout });
  sim.start();
  while (!sim.ended && sim.time <= sim.closeTime + 7200) sim.step();
  if (!sim.ended)
    throw new Error(
      `${layout.name}: lunch did not finish; ${JSON.stringify(sim.events.slice(-10))}`,
    );
  console.log(
    JSON.stringify(
      {
        layout: layout.name,
        seed,
        simulatedSeconds: sim.time,
        demandParties: sim.demand.length,
        metrics: sim.getMetrics(),
        equipment: sim.equipment.map((e) => ({
          id: e.fixtureId,
          uses: e.uses,
          utilization: sim.getEquipmentUtilization(e.fixtureId),
        })),
      },
      null,
      2,
    ),
  );
}
