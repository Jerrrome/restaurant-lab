import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RestaurantSimulation } from '../simulation/core/engine';
import type { EquipmentKind, Fixture, Layout, Point } from '../simulation/types';
import { RECIPES } from '../data/catalog';
import { ALTERNATIVE_LAYOUT, BASELINE_LAYOUT, cloneLayout } from '../data/scenarios';
import { validateLayout } from '../simulation/navigation/grid';
import { GameCanvas } from '../game/GameCanvas';
import { Management, type ManagementTab } from '../ui/panels/Management';
import { Inspector } from '../ui/panels/Inspector';
import { DayReport, ExperimentReport, type ExperimentResult } from '../ui/components/Reports';
import { Icon } from '../ui/components/Icon';
import { clock, equipmentNames, money } from '../ui/format';
import { loadLayout, saveLayout } from '../storage/layout';

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
async function runHeadless(sim: RestaurantSimulation) {
  sim.start();
  let steps = 0;
  while (!sim.ended && steps < 100_000) {
    for (let i = 0; i < 1200 && !sim.ended; i++) {
      sim.step();
      steps++;
    }
    await yieldToBrowser();
  }
  if (!sim.ended) throw new Error('实验超过安全运行上限，未产生完整结果。');
  return sim.getMetrics();
}

export function App() {
  const [layout, setLayout] = useState<Layout>(() => cloneLayout(BASELINE_LAYOUT));
  const [preset, setPreset] = useState('baseline');
  const [seed, setSeed] = useState(12345);
  const [arrivals, setArrivals] = useState(210);
  const [chefs, setChefs] = useState(2);
  const [waiters, setWaiters] = useState(1);
  const [menu, setMenu] = useState(() => RECIPES.map((r) => r.id));
  const sim = useMemo(
    () =>
      new RestaurantSimulation({
        layout: cloneLayout(layout),
        seed,
        arrivalInterval: arrivals,
        chefs,
        waiters,
        menu,
      }),
    [layout, seed, arrivals, chefs, waiters, menu],
  );
  const [, refresh] = useState(0);
  const [tab, setTab] = useState<ManagementTab>('build');
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [buildKind, setBuildKind] = useState<EquipmentKind>();
  const [moving, setMoving] = useState(false);
  const [debugPaths, setDebugPaths] = useState(true);
  const [debugUtilization, setDebugUtilization] = useState(false);
  const [toast, setToast] = useState('');
  const [dayReport, setDayReport] = useState(false);
  const [experiment, setExperiment] = useState<ExperimentResult>();
  const [experimentBusy, setExperimentBusy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 5500);
  }, []);
  const metrics = sim.getMetrics();

  useEffect(() => {
    const timer = setInterval(() => refresh((t) => t + 1), 200);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setDayReport(false);
    setSelectedId(undefined);
    setMoving(false);
  }, [sim]);
  useEffect(() => {
    if (sim.ended) setDayReport(true);
  }, [sim, sim.ended]);
  useEffect(() => {
    if (import.meta.env.DEV)
      (window as Window & { __restaurantLab?: RestaurantSimulation }).__restaurantLab = sim;
  }, [sim]);

  const reset = useCallback(() => {
    setLayout((current) => cloneLayout(current));
    setDayReport(false);
    setBuildKind(undefined);
    setMoving(false);
  }, []);
  const start = useCallback(() => {
    setEditing(false);
    setBuildKind(undefined);
    setMoving(false);
    sim.start();
    refresh((t) => t + 1);
  }, [sim]);
  const togglePause = useCallback(() => {
    if (!sim.started) return;
    sim.setPaused(!sim.paused);
    refresh((t) => t + 1);
  }, [sim]);
  const edit = () => {
    if (editing) {
      setEditing(false);
      setBuildKind(undefined);
      setMoving(false);
      return;
    }
    if (sim.started) {
      reset();
      notify('营业已重置。编辑布局后，可重新开门，重放同一需求序列。');
    }
    sim.setPaused(true);
    setEditing(true);
    setTab('build');
  };
  const applyLayout = (candidate: Layout) => {
    const result = validateLayout(candidate);
    if (!result.valid) {
      notify(`无法放置：${result.reason}`);
      return false;
    }
    candidate.name = 'Custom · 自定义布局';
    setLayout(candidate);
    setPreset('custom');
    return true;
  };
  const cellClick = (point: Point) => {
    if (!editing) return;
    const candidate = cloneLayout(layout);
    if (moving && selectedId) {
      const fixture = candidate.fixtures.find((f) => f.id === selectedId);
      if (!fixture) return;
      fixture.x = point.x;
      fixture.y = point.y;
      if (applyLayout(candidate)) {
        setMoving(false);
        notify('设备已移动。路径将在下一次营业中重新计算。');
      }
    } else if (buildKind) {
      let number = 1;
      while (candidate.fixtures.some((f) => f.id === `${buildKind}-custom-${number}`)) number++;
      const fixture: Fixture = {
        id: `${buildKind}-custom-${number}`,
        kind: buildKind,
        x: point.x,
        y: point.y,
        rotation: 0,
        ...(buildKind === 'table' ? { seatCount: 4 } : {}),
      };
      candidate.fixtures.push(fixture);
      if (applyLayout(candidate)) notify(`${equipmentNames[buildKind]}已放置。`);
    }
  };
  const removeFixture = () => {
    if (!editing || !selectedId) return;
    const candidate = cloneLayout(layout);
    candidate.fixtures = candidate.fixtures.filter((f) => f.id !== selectedId);
    if (applyLayout(candidate)) {
      setSelectedId(undefined);
      notify('设备已移除。缺少设备的工序会等待，不会凭空完成。');
    }
  };
  const rotateFixture = () => {
    if (!editing || !selectedId) return;
    const candidate = cloneLayout(layout);
    const fixture = candidate.fixtures.find((f) => f.id === selectedId);
    if (fixture) {
      fixture.rotation = (fixture.rotation + 90) % 360;
      applyLayout(candidate);
    }
  };
  const choosePreset = (name: string) => {
    setPreset(name);
    setLayout(cloneLayout(name === 'alternative' ? ALTERNATIVE_LAYOUT : BASELINE_LAYOUT));
    setBuildKind(undefined);
  };
  const runExperiment = async () => {
    setExperimentBusy(true);
    notify('正在计算两种布局的完整营业日…');
    try {
      const options = { seed, arrivalInterval: arrivals, chefs, waiters, menu };
      const baseline = await runHeadless(
        new RestaurantSimulation({ ...options, layout: cloneLayout(BASELINE_LAYOUT) }),
      );
      const alternative = await runHeadless(
        new RestaurantSimulation({ ...options, layout: cloneLayout(ALTERNATIVE_LAYOUT) }),
      );
      setExperiment({ baseline, alternative, seed });
      setToast('');
    } catch (error) {
      notify(error instanceof Error ? error.message : '实验失败，请查看控制台。');
    } finally {
      setExperimentBusy(false);
    }
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).matches('input,select,textarea')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (!sim.started) start();
        else togglePause();
      }
      if (event.key === 'Escape') {
        setBuildKind(undefined);
        setMoving(false);
        setSelectedId(undefined);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [sim, start, togglePause]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="./" aria-label="Restaurant Lab">
          <span className="brand-mark">
            <Icon name="flask" size={27} />
          </span>
          <span>
            <strong>
              RESTAURANT<span>LAB</span>
            </strong>
            <small>空间 · 人员 · 真实运营</small>
          </span>
        </a>
        <div className="header-location">
          <span className="eyebrow">THE LUNCH EXPERIMENT</span>
          <span>
            小餐厅，大系统。<i>01</i>
          </span>
        </div>
        <div className="header-metrics">
          <div>
            <span>已服务顾客</span>
            <strong>
              {metrics.customersServed}
              <small> 人</small>
            </strong>
          </div>
          <div>
            <span>营业收入</span>
            <strong>{money(metrics.revenue)}</strong>
          </div>
          <div>
            <span>预计利润</span>
            <strong className={metrics.profit < 0 ? 'negative' : ''}>
              {money(metrics.profit)}
            </strong>
          </div>
        </div>
        <button
          className="header-experiment"
          onClick={() => {
            setTab('analytics');
            runExperiment();
          }}
          disabled={experimentBusy}
        >
          <Icon name="flask" />
          <span>{experimentBusy ? '计算中…' : '运行布局实验'}</span>
        </button>
      </header>
      <main className="workspace">
        <Management
          sim={sim}
          metrics={metrics}
          tab={tab}
          onTab={setTab}
          buildKind={buildKind}
          onBuild={(kind) => {
            setBuildKind(kind);
            setMoving(false);
          }}
          editing={editing}
          onEdit={edit}
          preset={preset}
          onPreset={choosePreset}
          seed={seed}
          onSeed={setSeed}
          arrivals={arrivals}
          onArrivals={setArrivals}
          menu={menu}
          onMenu={setMenu}
          chefs={chefs}
          waiters={waiters}
          onStaff={(role, count) => (role === 'chef' ? setChefs(count) : setWaiters(count))}
          onSave={() => notify(saveLayout(layout).message)}
          onLoad={() => {
            const result = loadLayout();
            if (result.layout) {
              setLayout(result.layout);
              setPreset('custom');
            }
            notify(result.message);
          }}
          onResetLayout={() => choosePreset('baseline')}
          onExperiment={runExperiment}
          experimentBusy={experimentBusy}
          onSelect={setSelectedId}
        />
        <section className="world-panel">
          <div className="world-toolbar">
            <div>
              <span
                className={`day-status ${sim.started && !sim.paused && !sim.ended ? 'open' : ''}`}
              >
                <i />
                {editing
                  ? '布局编辑'
                  : sim.ended
                    ? '营业结束'
                    : !sim.started
                      ? '准备开门'
                      : sim.paused
                        ? '模拟已暂停'
                        : '正在营业'}
              </span>
              <span className="world-name">{layout.name}</span>
            </div>
            <div className="debug-toggles">
              <button
                className={debugPaths ? 'active' : ''}
                onClick={() => setDebugPaths(!debugPaths)}
                title="显示员工真实路径"
              >
                <Icon name="move" size={15} />
                动线
              </button>
              <button
                className={debugUtilization ? 'active' : ''}
                onClick={() => setDebugUtilization(!debugUtilization)}
                title="显示设备利用率"
              >
                <Icon name="chart" size={15} />
                利用率
              </button>
            </div>
          </div>
          <div className="canvas-wrapper">
            <GameCanvas
              sim={sim}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onCellClick={cellClick}
              debugPaths={debugPaths}
              debugUtilization={debugUtilization}
              editing={editing}
            />
            {!sim.started && !editing && (
              <div className="opening-note">
                <span className="note-line" />
                <div>
                  <span className="eyebrow">READY WHEN YOU ARE</span>
                  <strong>午餐实验，即将开始。</strong>
                  <p>
                    两位厨师，一位服务员，三道菜。
                    <br />
                    点击下方开门，观察餐厅如何运转。
                  </p>
                </div>
              </div>
            )}
            {editing && (
              <div className="editing-banner">
                <Icon name="grid" />
                {moving
                  ? '点击空地，移动选中的设备'
                  : buildKind
                    ? `点击网格放置：${equipmentNames[buildKind]}`
                    : '选择设备，或点击现有设备进行修改'}
                <button
                  onClick={() => {
                    setBuildKind(undefined);
                    setMoving(false);
                  }}
                >
                  取消操作
                </button>
              </div>
            )}
            {toast && (
              <div className="toast" role="status">
                <Icon name="info" size={17} />
                {toast}
              </div>
            )}
          </div>
          <div className="world-caption">
            <span>
              <span className="status-light" />
              固定步长模拟 · 0.25 s
            </span>
            <span>
              滚轮缩放<span className="caption-dot">·</span>右键拖动
              <span className="caption-dot">·</span>点击检查
            </span>
          </div>
          <div className="simulation-controls">
            <div className="sim-clock">
              <Icon name="clock" size={24} />
              <div>
                <strong>{clock(sim.time)}</strong>
                <span>午餐营业 · 11:00—14:00</span>
              </div>
            </div>
            <div className="playback">
              <button
                className="pause-control"
                onClick={togglePause}
                disabled={!sim.started || sim.ended}
                aria-label={sim.paused ? '继续模拟' : '暂停模拟'}
              >
                <Icon name={sim.paused ? 'play' : 'pause'} size={18} />
              </button>
              <div className="speed-options">
                {[1, 5, 20, 60].map((speed) => (
                  <button
                    key={speed}
                    className={sim.speed === speed ? 'active' : ''}
                    onClick={() => {
                      sim.speed = speed;
                      refresh((t) => t + 1);
                    }}
                  >
                    {speed}×
                  </button>
                ))}
              </div>
              <button
                className="reset-control icon-button"
                onClick={reset}
                title="重置营业"
                aria-label="重置营业"
              >
                <Icon name="reset" />
              </button>
            </div>
            <button
              className="primary-button start-button"
              onClick={sim.ended ? () => setDayReport(true) : start}
              disabled={sim.started && !sim.ended}
            >
              <Icon name={sim.ended ? 'chart' : 'play'} size={18} />
              {sim.ended ? '查看营业报告' : sim.started ? '营业进行中' : '开门营业'}
              <small>{sim.ended ? 'DAILY REPORT' : 'START BUSINESS DAY'}</small>
            </button>
          </div>
        </section>
        <Inspector
          sim={sim}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onClear={() => setSelectedId(undefined)}
          editing={editing}
          moving={moving}
          onMove={() => {
            setMoving(!moving);
            setBuildKind(undefined);
          }}
          onDelete={removeFixture}
          onRotate={rotateFixture}
        />
      </main>
      {dayReport && (
        <DayReport
          metrics={metrics}
          onClose={() => setDayReport(false)}
          onReset={() => {
            reset();
            setEditing(true);
            setTab('build');
          }}
        />
      )}
      {experiment && (
        <ExperimentReport result={experiment} onClose={() => setExperiment(undefined)} />
      )}
    </div>
  );
}
