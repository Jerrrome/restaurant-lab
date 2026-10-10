/** Real Chromium UI smoke test. Run against `npm run dev -- --port 5173`.
 * `node scripts/browser-smoke.mjs` writes a screenshot and observed metrics.
 * All player actions use actual UI; only the remainder day drain directly steps
 * the DEV engine hook. Assertions also read the hook to verify observed state.
 * RESTAURANT_LAB_SMOKE_MODE=layout skips live business and full-day experiments.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseUrl = process.env.RESTAURANT_LAB_URL ?? 'http://127.0.0.1:5173';
const layoutOnly = process.env.RESTAURANT_LAB_SMOKE_MODE === 'layout';
const executablePath = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium';
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage({
  viewport: { width: 1680, height: 1050 },
  deviceScaleFactor: 1,
});
const errors = [];
const observations = { uiActions: [], errors };
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('requestfailed', (request) =>
  errors.push(`${request.url()}: ${request.failure()?.errorText}`),
);
const simValue = (callback) => page.evaluate(callback);
const action = (label) => {
  observations.uiActions.push(label);
  console.log(`PASS ${label}`);
};
const waitForWorld = async () => {
  await page.waitForFunction(() => Boolean(window.__restaurantLab));
  await page.locator('.game-canvas canvas').waitFor();
  await page.waitForFunction(
    () => document.querySelector('.game-canvas canvas')?.getBoundingClientRect().height > 300,
  );
};
// Phaser fits the centered 900 x 600 world using a 30 px viewport inset.
// Resetting a world restores this camera fit before these coordinate actions.
const clickCell = async (x, y) => {
  const box = await page.locator('.game-canvas canvas').boundingBox();
  assert(box, 'Phaser canvas must have a screen rectangle');
  const zoom = Math.min((box.width - 30) / 900, (box.height - 30) / 600);
  await page.mouse.click(
    box.x + box.width / 2 + (x * 30 - 450) * zoom,
    box.y + box.height / 2 + (y * 30 - 300) * zoom,
  );
};

try {
  await mkdir('artifacts', { recursive: true });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await waitForWorld();
  assert.equal(await simValue(() => window.__restaurantLab.layout.fixtures.length), 13);
  assert.equal(await simValue(() => window.__restaurantLab.actors.length), 3);
  action('loaded React management UI and an actual Phaser canvas with the default restaurant');

  await clickCell(3, 3);
  await page.locator('.selected-title h3').filter({ hasText: '冷藏冰箱' }).waitFor();
  assert.match(await page.locator('.selection-card').innerText(), /加工位占用/);
  action('clicked a canvas fixture and inspected its actual capacity');

  await page.getByRole('button', { name: '员工', exact: true }).click();
  const chefStepper = page.locator('.staff-config').filter({ hasText: '厨师' });
  await chefStepper.getByRole('button', { name: '增加厨师', exact: true }).click();
  await page.waitForFunction(
    () => window.__restaurantLab.actors.filter((a) => a.role === 'chef').length === 3,
  );
  await chefStepper.getByRole('button', { name: '减少厨师', exact: true }).click();
  await page.waitForFunction(
    () => window.__restaurantLab.actors.filter((a) => a.role === 'chef').length === 2,
  );
  action('staff controls recreate the world with the requested chef count');

  await page.getByRole('button', { name: '菜单', exact: true }).click();
  const recipeToggle = page.locator('.recipe-card input').first();
  await recipeToggle.uncheck();
  assert.equal(await page.locator('.recipe-card input:checked').count(), 2);
  await recipeToggle.check();
  assert.equal(await page.locator('.recipe-card input:checked').count(), 3);
  action('menu switches accept real changes and restore all three dishes');

  await page.getByRole('button', { name: '布局', exact: true }).click();
  await page.getByRole('spinbutton', { name: '随机种子' }).fill('54321');
  await page.waitForFunction(() => window.__restaurantLab.seed === 54321);
  await page.getByRole('spinbutton', { name: '随机种子' }).fill('12345');
  await page.waitForFunction(() => window.__restaurantLab.seed === 12345);
  action('seed setting is applied to the simulation');

  if (!layoutOnly) {
    await page.getByRole('button', { name: /开门营业/ }).click();
    await page.getByRole('button', { name: '60×', exact: true }).click();
    await page.waitForFunction(
      () =>
        window.__restaurantLab.revenue > 0 &&
        window.__restaurantLab.actors.some((a) => a.role === 'customer') &&
        window.__restaurantLab.tasks.some((t) => !['pending', 'done'].includes(t.status)),
      undefined,
      { timeout: 60_000 },
    );
    await page.getByRole('button', { name: '暂停模拟', exact: true }).click();
    const pausedTime = await simValue(() => window.__restaurantLab.time);
    await page.waitForTimeout(1300);
    assert.equal(
      await simValue(() => window.__restaurantLab.time),
      pausedTime,
      'paused clock must stop',
    );
    observations.live = await simValue(() => ({
      time: window.__restaurantLab.time,
      metrics: window.__restaurantLab.getMetrics(),
      customersPresent: window.__restaurantLab.actors.filter((a) => a.role === 'customer').length,
      cookingTasks: window.__restaurantLab.tasks.filter(
        (t) => !['pending', 'done'].includes(t.status),
      ).length,
      usedEquipment: window.__restaurantLab.equipment
        .filter((e) => e.uses > 0)
        .map((e) => e.fixtureId),
      staffWalking: window.__restaurantLab.actors
        .filter((a) => a.role !== 'customer')
        .reduce((n, a) => n + a.totalWalking, 0),
    }));
    assert(observations.live.metrics.customersServed > 0);
    assert(observations.live.metrics.ordersCompleted > 0);
    assert(observations.live.staffWalking > 0);
    assert(observations.live.usedEquipment.includes('stove-1'));
    action(
      'actual UI start and 60× rendered simulation complete a paying customer and real kitchen tasks',
    );
    action('pause freezes simulation time across 1.3 seconds of browser rendering');
    for (const speed of [1, 5, 20, 60]) {
      await page.getByRole('button', { name: `${speed}×`, exact: true }).click();
      assert.equal(await simValue(() => window.__restaurantLab.speed), speed);
      assert.equal(await simValue(() => window.__restaurantLab.time), pausedTime);
    }
    action('all four speed controls update the rate while preserving the paused state');
    await page.getByRole('button', { name: '继续模拟', exact: true }).click();
    await page.waitForFunction((time) => window.__restaurantLab.time > time, pausedTime);
    await page.getByRole('button', { name: '暂停模拟', exact: true }).click();
    action('resume continues real simulation time and can be paused again');

    await page.getByRole('button', { name: '员工', exact: true }).click();
    await page.locator('.staff-card').first().click();
    assert.match(await page.locator('.selection-card').innerText(), /累计移动/);
    await page.screenshot({ path: 'artifacts/restaurant-lab.png', fullPage: true });
    action('inspected a real chef and captured the active world with earned revenue');

    const canvas = page.locator('.game-canvas canvas');
    const viewport = await canvas.boundingBox();
    await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
    await page.waitForTimeout(150);
    const beforeZoom = await canvas.screenshot();
    await page.mouse.wheel(0, -250);
    await page.waitForTimeout(150);
    const afterZoom = await canvas.screenshot();
    assert.notDeepEqual(afterZoom, beforeZoom, 'mouse wheel must visibly zoom the paused world');
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(
      viewport.x + viewport.width / 2 + 60,
      viewport.y + viewport.height / 2 + 35,
      { steps: 5 },
    );
    await page.mouse.up({ button: 'right' });
    await page.waitForTimeout(150);
    assert.notDeepEqual(
      await canvas.screenshot(),
      afterZoom,
      'right-drag must visibly pan the paused world',
    );
    action('mouse-wheel zoom and right-drag pan change the actual Phaser viewport');

    // The ordinary rendered path above has already tested the full customer cycle.
    // Explicitly drain the remainder through fixed steps to avoid a 3-minute wall wait.
    observations.fullDay = await page.evaluate(async () => {
      const sim = window.__restaurantLab;
      let steps = 0;
      while (!sim.ended && steps < 100_000) {
        for (let i = 0; i < 1200 && !sim.ended; i++) {
          sim.step();
          steps++;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return {
        method: 'DEV fixed-step fast-forward after real UI run',
        steps,
        ended: sim.ended,
        time: sim.time,
        metrics: sim.getMetrics(),
        diagnostics: sim.events.filter((e) => e.type === 'warning').map((e) => e.detail),
      };
    });
    assert(observations.fullDay.ended, 'full lunch must finish without timeout');
    assert.equal(observations.fullDay.diagnostics.length, 0);
    await page.getByRole('dialog', { name: '午餐营业报告', exact: true }).waitFor();
    assert.match(await page.getByRole('dialog').innerText(), /营业收入/);
    await page.getByRole('button', { name: '关闭报告', exact: true }).click();
    action('fixed-step drain ended the full lunch and triggered the actual daily report');

    await page.getByRole('button', { name: '重置营业', exact: true }).click();
  }
  await page.getByRole('button', { name: '布局', exact: true }).click();
  await page.getByRole('button', { name: /编辑餐厅布局/ }).click();
  assert.equal(await simValue(() => window.__restaurantLab.started), false);
  await page.locator('.equipment-choice').filter({ hasText: '清洗水槽' }).click();
  const fixtureCount = await simValue(() => window.__restaurantLab.layout.fixtures.length);
  await clickCell(0.5, 0.5);
  await page
    .getByRole('status')
    .filter({ hasText: /无法放置/ })
    .waitFor();
  assert.equal(await simValue(() => window.__restaurantLab.layout.fixtures.length), fixtureCount);
  action('build mode rejects wall-overlapping placement without changing the layout');

  await page.getByRole('button', { name: '取消操作', exact: true }).click();
  await clickCell(3, 3);
  await page.locator('.fixture-actions').getByRole('button', { name: '移动', exact: true }).click();
  await clickCell(4.5, 2.5);
  await page.waitForFunction(() => window.__restaurantLab.getFixture('fridge-1').x === 4);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('restaurant-lab:layout:v1')).fixtures.find(
          (f) => f.id === 'fridge-1',
        ).x,
    ),
    4,
  );
  await page.getByRole('button', { name: /紧凑布局/ }).click();
  await page.waitForFunction(() => window.__restaurantLab.getFixture('fridge-1').x === 3);
  await page.getByRole('button', { name: '载入', exact: true }).click();
  await page.waitForFunction(() => window.__restaurantLab.getFixture('fridge-1').x === 4);
  action(
    'moved equipment through the canvas, saved to LocalStorage, and reloaded the actual coordinates',
  );

  await page.locator('.equipment-choice').filter({ hasText: '清洗水槽' }).click();
  await clickCell(2.5, 17.5);
  await page.waitForFunction(() =>
    window.__restaurantLab.layout.fixtures.some((f) => f.id === 'sink-custom-1'),
  );
  await page.getByRole('button', { name: '取消操作', exact: true }).click();
  await clickCell(2.5, 17.5);
  await page.locator('.fixture-actions').getByRole('button', { name: '旋转', exact: true }).click();
  await page.waitForFunction(
    () => window.__restaurantLab.getFixture('sink-custom-1').rotation === 90,
  );
  await clickCell(2.5, 17.5);
  await page.locator('.fixture-actions').getByRole('button', { name: '删除', exact: true }).click();
  await page.waitForFunction(() => !window.__restaurantLab.getFixture('sink-custom-1'));
  action('placed, rotated, and deleted a custom sink using real build controls');

  await page.getByRole('button', { name: /基准布局/ }).click();
  await page.getByRole('button', { name: '结束布局编辑', exact: false }).click();
  if (!layoutOnly) {
    await page.getByRole('button', { name: '运行布局实验', exact: true }).click();
    await page
      .getByRole('dialog', { name: '空间，如何改变结果？', exact: true })
      .waitFor({ timeout: 60_000 });
    observations.experimentRows = await page
      .locator('.comparison-table tbody tr')
      .evaluateAll((rows) =>
        rows.map((row) => Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent)),
      );
    const walking = observations.experimentRows.find((row) => row[0] === '平均员工走动');
    const served = observations.experimentRows.find((row) => row[0] === '服务顾客');
    assert(
      walking && walking[1] !== walking[2],
      'real layouts must produce different measured walking time',
    );
    assert(served && parseInt(served[1]) > 0 && parseInt(served[2]) > 0);
    action(
      'UI layout experiment completes two real seeded days and displays differing measured travel',
    );
  }

  assert.deepEqual(errors, [], 'browser must have no console or page errors');
  if (!layoutOnly) observations.screenshot = 'artifacts/restaurant-lab.png';
  const output = layoutOnly
    ? 'artifacts/browser-layout-smoke.json'
    : 'artifacts/browser-smoke.json';
  await writeFile(output, `${JSON.stringify(observations, null, 2)}\n`);
  console.log(
    JSON.stringify({
      status: 'passed',
      actions: observations.uiActions.length,
      liveTime: observations.live?.time,
      finalTime: observations.fullDay?.time,
      revenue: observations.fullDay?.metrics.revenue,
      screenshot: observations.screenshot,
    }),
  );
} catch (error) {
  observations.failure = error.message;
  await page.screenshot({ path: 'artifacts/browser-failure.png', fullPage: true }).catch(() => {});
  await writeFile('artifacts/browser-smoke.json', `${JSON.stringify(observations, null, 2)}\n`);
  throw error;
} finally {
  await browser.close();
}
