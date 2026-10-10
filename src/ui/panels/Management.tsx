import { EQUIPMENT, RECIPES } from '../../data/catalog';
import type { EquipmentKind, Metrics } from '../../simulation/types';
import type { RestaurantSimulation } from '../../simulation/core/engine';
import { Icon } from '../components/Icon';
import { duration, equipmentNames, money, percent, roleNames, stateNames } from '../format';

export type ManagementTab = 'build' | 'staff' | 'menu' | 'analytics';
interface Props {
  sim: RestaurantSimulation;
  metrics: Metrics;
  tab: ManagementTab;
  onTab: (tab: ManagementTab) => void;
  buildKind?: EquipmentKind;
  onBuild: (kind: EquipmentKind) => void;
  editing: boolean;
  onEdit: () => void;
  preset: string;
  onPreset: (value: string) => void;
  seed: number;
  onSeed: (seed: number) => void;
  arrivals: number;
  onArrivals: (value: number) => void;
  menu: string[];
  onMenu: (value: string[]) => void;
  chefs: number;
  waiters: number;
  onStaff: (role: 'chef' | 'waiter', count: number) => void;
  onSave: () => void;
  onLoad: () => void;
  onResetLayout: () => void;
  onExperiment: () => void;
  experimentBusy: boolean;
  onSelect: (id: string) => void;
}
const buildKinds: EquipmentKind[] = [
  'fridge',
  'prep',
  'stove',
  'fryer',
  'rice',
  'sink',
  'serving',
  'storage',
  'table',
];

export function Management(props: Props) {
  const { sim, metrics, tab, editing } = props;
  const locked = sim.started;
  return (
    <aside className="management panel">
      <div className="panel-heading">
        <span className="eyebrow">YOUR RESTAURANT</span>
        <h2>
          经营工作台 <span className="mini-dot" />
        </h2>
      </div>
      <nav className="management-tabs" aria-label="经营面板">
        {(
          [
            ['build', 'grid', '布局'],
            ['staff', 'people', '员工'],
            ['menu', 'menu', '菜单'],
            ['analytics', 'chart', '分析'],
          ] as const
        ).map(([id, icon, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => props.onTab(id)}>
            <Icon name={icon} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="management-content">
        {tab === 'build' && (
          <>
            <div className="section-title">
              <h3>空间实验</h3>
              <span className="text-muted">30 × 20</span>
            </div>
            <div className="preset-picker">
              <button
                className={props.preset === 'baseline' ? 'active' : ''}
                disabled={locked}
                onClick={() => props.onPreset('baseline')}
              >
                基准布局<span>Baseline</span>
              </button>
              <button
                className={props.preset === 'alternative' ? 'active' : ''}
                disabled={locked}
                onClick={() => props.onPreset('alternative')}
              >
                紧凑布局<span>Alternative</span>
              </button>
            </div>
            <p className="muted-copy">相同设备与需求，让动线决定产能。</p>
            <button className={`edit-button ${editing ? 'active' : ''}`} onClick={props.onEdit}>
              <Icon name="move" />
              {editing ? '结束布局编辑' : locked ? '重置营业并编辑布局' : '编辑餐厅布局'}
              <span className="keyboard">E</span>
            </button>
            {editing && (
              <div className="hint">
                选择下方设备，然后点击地图。移动、旋转和删除可在检查面板操作。
              </div>
            )}
            <div className="section-title equipment-title">
              <h3>厨房设备</h3>
              <span className="text-muted">
                {sim.layout.fixtures.filter((f) => f.kind !== 'table').length} 件
              </span>
            </div>
            <div className="equipment-list">
              {buildKinds.map((kind) => (
                <button
                  key={kind}
                  className={`equipment-choice ${props.buildKind === kind ? 'selected' : ''}`}
                  onClick={() => props.onBuild(kind)}
                  disabled={!editing}
                >
                  <span className={`equipment-icon ${kind}`}>
                    <Icon name={kind} size={22} />
                  </span>
                  <span>
                    <strong>{equipmentNames[kind]}</strong>
                    <small>
                      {kind === 'table' ? '4 个座位' : `${EQUIPMENT[kind].capacity} 个加工位`}
                    </small>
                  </span>
                  <span className="add-sign">+</span>
                </button>
              ))}
            </div>
            <div className="layout-storage">
              <button onClick={props.onSave}>
                <Icon name="save" />
                保存
              </button>
              <button onClick={props.onLoad} disabled={locked}>
                <Icon name="load" />
                载入
              </button>
              <button onClick={props.onResetLayout} disabled={locked} title="恢复默认布局">
                <Icon name="reset" />
              </button>
            </div>
            <div className="section-title settings-title">
              <h3>本次营业</h3>
              <span className="text-muted">11:00—14:00</span>
            </div>
            <label className="form-row">
              <span>随机种子</span>
              <input
                aria-label="随机种子"
                type="number"
                value={props.seed}
                disabled={locked}
                onChange={(e) => props.onSeed(Number(e.target.value))}
              />
            </label>
            <label className="form-row">
              <span>到店间隔</span>
              <select
                aria-label="到店间隔"
                value={props.arrivals}
                disabled={locked}
                onChange={(e) => props.onArrivals(Number(e.target.value))}
              >
                <option value={120}>繁忙 · 2 分钟</option>
                <option value={210}>标准 · 3.5 分钟</option>
                <option value={360}>悠闲 · 6 分钟</option>
              </select>
            </label>
          </>
        )}
        {tab === 'staff' && (
          <>
            <div className="section-title">
              <h3>值班团队</h3>
              <span className="text-muted">
                {sim.actors.filter((a) => a.role !== 'customer').length} 人
              </span>
            </div>
            <p className="muted-copy">员工自主认领任务。增加人数的效果取决于设备与通道。</p>
            {(['chef', 'waiter'] as const).map((role) => (
              <div className="staff-config" key={role}>
                <span className={`avatar ${role}`}>
                  <Icon name="people" />
                </span>
                <strong>{roleNames[role]}</strong>
                <div className="stepper">
                  <button
                    aria-label={`减少${roleNames[role]}`}
                    disabled={locked || (role === 'chef' ? props.chefs : props.waiters) <= 1}
                    onClick={() =>
                      props.onStaff(role, (role === 'chef' ? props.chefs : props.waiters) - 1)
                    }
                  >
                    −
                  </button>
                  <span>{role === 'chef' ? props.chefs : props.waiters}</span>
                  <button
                    aria-label={`增加${roleNames[role]}`}
                    disabled={
                      locked ||
                      (role === 'chef' ? props.chefs : props.waiters) >= (role === 'chef' ? 4 : 3)
                    }
                    onClick={() =>
                      props.onStaff(role, (role === 'chef' ? props.chefs : props.waiters) + 1)
                    }
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
            <div className="section-title equipment-title">
              <h3>实时任务</h3>
            </div>
            {sim.actors
              .filter((a) => a.role !== 'customer')
              .map((actor) => (
                <button
                  className="staff-card"
                  key={actor.id}
                  onClick={() => props.onSelect(actor.id)}
                >
                  <span className={`avatar ${actor.role}`}>
                    <Icon name="people" />
                  </span>
                  <div>
                    <strong>{actor.name}</strong>
                    <small>{stateNames[actor.state]}</small>
                    <div className="mini-bar">
                      <i style={{ width: percent(sim.time > 0 ? actor.busyTime / sim.time : 0) }} />
                    </div>
                  </div>
                  <Icon name="arrow" size={15} />
                </button>
              ))}
            <div className="hint">
              厨师会在设备被动加工时离开，处理其他订单。通道占用可能让员工暂时等待。
            </div>
          </>
        )}
        {tab === 'menu' && (
          <>
            <div className="section-title">
              <h3>午餐菜单</h3>
              <span className="text-muted">{props.menu.length} 道菜</span>
            </div>
            <p className="muted-copy">每一道菜都经过真实加工流程。营业前可调整菜单。</p>
            {Object.values(RECIPES).map((recipe, index) => (
              <label className="recipe-card" key={recipe.id}>
                <div className={`dish-illustration dish-${index}`}>
                  <span>◔</span>
                  <i />
                  <b />
                </div>
                <div className="recipe-card-content">
                  <div className="recipe-top">
                    <span className="recipe-index">0{index + 1}</span>
                    <input
                      type="checkbox"
                      checked={props.menu.includes(recipe.id)}
                      disabled={
                        locked || (props.menu.length === 1 && props.menu.includes(recipe.id))
                      }
                      onChange={(e) =>
                        props.onMenu(
                          e.target.checked
                            ? [...props.menu, recipe.id]
                            : props.menu.filter((id) => id !== recipe.id),
                        )
                      }
                    />
                  </div>
                  <strong>{recipe.shortName}</strong>
                  <small>{recipe.name}</small>
                  <div className="recipe-price">
                    <span>{money(recipe.price)}</span>
                    <small>食材 {money(recipe.ingredientCost)}</small>
                  </div>
                  <div className="recipe-steps">
                    {recipe.steps
                      .filter((s) => s.method !== 'Fetch')
                      .map((s) => s.label)
                      .join(' → ')}
                  </div>
                </div>
              </label>
            ))}
          </>
        )}
        {tab === 'analytics' && (
          <>
            <div className="section-title">
              <h3>运营观测</h3>
              <span className="live-label">LIVE</span>
            </div>
            <div className="analytics-summary">
              <span>预计利润</span>
              <strong className={metrics.profit < 0 ? 'negative' : ''}>
                {money(metrics.profit)}
              </strong>
              <small>收入 − 食材 − 人工 − 固定经营成本</small>
            </div>
            <div className="metric-pairs">
              <span>
                平均等待<strong>{duration(metrics.averageWaitTime)}</strong>
              </span>
              <span>
                厨房产出
                <strong>
                  {metrics.kitchenThroughput.toFixed(1)} <small>单/小时</small>
                </strong>
              </span>
              <span>
                平均客单价<strong>{money(metrics.averageOrderValue)}</strong>
              </span>
              <span>
                餐桌占用<strong>{percent(metrics.averageTableOccupancy)}</strong>
              </span>
            </div>
            <div className="section-title equipment-title">
              <h3>成本构成</h3>
            </div>
            <div className="ledger">
              <div>
                <span>食材成本</span>
                <strong>{money(metrics.foodCost)}</strong>
              </div>
              <div>
                <span>人工成本</span>
                <strong>{money(metrics.laborCost)}</strong>
              </div>
              <div>
                <span>经营成本</span>
                <strong>{money(metrics.operatingCost)}</strong>
              </div>
            </div>
            <div className="section-title equipment-title">
              <h3>设备利用率</h3>
            </div>
            {sim.equipment
              .filter((e) => sim.getFixture(e.fixtureId)?.kind !== 'table')
              .map((e) => (
                <div className="utilization-row" key={e.fixtureId}>
                  <div>
                    <span>{equipmentNames[sim.getFixture(e.fixtureId)!.kind]}</span>
                    <strong>{percent(sim.getEquipmentUtilization(e.fixtureId))}</strong>
                  </div>
                  <div className="progress-track">
                    <i style={{ width: percent(sim.getEquipmentUtilization(e.fixtureId)) }} />
                  </div>
                </div>
              ))}
            <div className="experiment-callout">
              <Icon name="flask" size={25} />
              <h3>让布局接受检验</h3>
              <p>使用同一组预生成顾客需求，实际运行两个午餐营业日。</p>
              <button onClick={props.onExperiment} disabled={props.experimentBusy}>
                {props.experimentBusy ? '模拟实验中…' : '比较两种布局'}
                <Icon name="arrow" size={16} />
              </button>
            </div>
          </>
        )}
      </div>
      <div className="sidebar-foot">
        <span className="status-light" />
        <span>本地模拟 · 无需联网</span>
        <small>PHASE 01</small>
      </div>
    </aside>
  );
}
