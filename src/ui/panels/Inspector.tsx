import type { RestaurantSimulation } from '../../simulation/core/engine';
import { EQUIPMENT, RECIPES } from '../../data/catalog';
import { Icon } from '../components/Icon';
import {
  clock,
  duration,
  equipmentNames,
  orderNames,
  percent,
  roleNames,
  stateNames,
  taskNames,
} from '../format';

const recipeById = Object.fromEntries(RECIPES.map((recipe) => [recipe.id, recipe]));

interface Props {
  sim: RestaurantSimulation;
  selectedId?: string;
  onSelect: (id: string) => void;
  onClear: () => void;
  editing: boolean;
  moving: boolean;
  onMove: () => void;
  onDelete: () => void;
  onRotate: () => void;
}
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="inspector-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
export function Inspector({
  sim,
  selectedId,
  onSelect,
  onClear,
  editing,
  moving,
  onMove,
  onDelete,
  onRotate,
}: Props) {
  const actor = sim.actors.find((a) => a.id === selectedId);
  const fixture = sim.layout.fixtures.find((f) => f.id === selectedId);
  const order = sim.orders.find((o) => o.id === selectedId);
  const equipment = sim.equipment.find((e) => e.fixtureId === selectedId);
  const table = sim.tables.find((t) => t.fixtureId === selectedId);
  const activeTask = actor ? sim.tasks.find((t) => t.id === actor.taskId) : undefined;
  const pickupId = activeTask?.pickupFixtureIds?.[activeTask.pickupIndex ?? 0];
  const pickupFixture = pickupId ? sim.getFixture(pickupId) : undefined;
  const serviceTask = actor ? sim.serviceTasks.find((t) => t.id === actor.taskId) : undefined;
  const party = actor
    ? sim.parties.find((p) => p.id === actor.partyId)
    : table
      ? sim.parties.find((p) => p.id === table.currentParty)
      : undefined;
  const pendingOrders = sim.orders
    .filter((o) => !['paid', 'cancelled'].includes(o.status))
    .slice(-12)
    .reverse();
  const visibleEvents = sim.events
    .filter((event) => !['move', 'task-assigned', 'service-assigned'].includes(event.type))
    .slice(-5)
    .reverse();
  return (
    <aside className="inspector panel">
      <div className="panel-heading">
        <span className="eyebrow">LIVE OBSERVATIONS</span>
        <h2>
          现场检查<span className="inspect-count">{sim.actors.length}</span>
        </h2>
      </div>
      <div className="inspector-content">
        {!actor && !fixture && !order && (
          <div className="empty-inspector">
            <div className="inspect-illustration">
              <Icon name="info" size={36} />
              <span />
              <i />
            </div>
            <h3>每一步，都有原因。</h3>
            <p>点击人物、设备或餐桌，观察正在发生的任务与等待。</p>
            <div className="legend">
              <span>
                <i className="chef" />
                厨师
              </span>
              <span>
                <i className="waiter" />
                服务员
              </span>
              <span>
                <i className="customer" />
                顾客
              </span>
            </div>
          </div>
        )}
        {(actor || fixture || order) && (
          <div className="selection-card">
            <div className="selected-title">
              <span className={`avatar ${actor?.role ?? 'fixture'}`}>
                <Icon name={fixture?.kind ?? (order ? 'menu' : 'people')} size={22} />
              </span>
              <div>
                <span className="eyebrow">
                  {actor
                    ? roleNames[actor.role]
                    : fixture
                      ? EQUIPMENT[fixture.kind].category
                      : '厨房订单'}
                </span>
                <h3>
                  {actor?.name ??
                    (fixture
                      ? equipmentNames[fixture.kind]
                      : order
                        ? `订单 #${order.id.split('-').pop()}`
                        : '')}
                </h3>
              </div>
              <button className="icon-button" onClick={onClear} title="取消选择">
                <Icon name="close" size={16} />
              </button>
            </div>
            {actor && (
              <>
                <div className={`status-pill ${actor.state === 'Blocked' ? 'warning' : ''}`}>
                  <span />
                  {stateNames[actor.state]}
                </div>
                <Field
                  label="当前位置"
                  value={`${actor.position.x.toFixed(1)}, ${actor.position.y.toFixed(1)}`}
                />
                <Field label="累计移动" value={duration(actor.totalWalking)} />
                <Field label="等待时间" value={duration(actor.waitingTime)} />
                {actor.waitReason && (
                  <div className="current-task">
                    <span className="eyebrow">WAITING FOR</span>
                    <h4>{actor.waitReason}</h4>
                    {actor.nextTaskLabel && <p>下一项任务：{actor.nextTaskLabel}</p>}
                  </div>
                )}
                {actor.role !== 'customer' && (
                  <Field
                    label="工作利用率"
                    value={percent(sim.time > 0 ? actor.busyTime / sim.time : 0)}
                  />
                )}
                {(activeTask || serviceTask) && (
                  <div className="current-task">
                    <span className="eyebrow">CURRENT TASK</span>
                    <h4>
                      {pickupFixture
                        ? `领取${equipmentNames[pickupFixture.kind]}的中间食材`
                        : (activeTask?.step.label ??
                          {
                            greet: '引导顾客入座',
                            order: '接收顾客点单',
                            deliver: '从出餐台配送餐品',
                            pay: '处理结账',
                            clean: '清理餐桌',
                          }[serviceTask!.kind])}
                    </h4>
                    <p>
                      {pickupFixture
                        ? `下一步：${activeTask!.step.label}`
                        : activeTask
                          ? taskNames[activeTask.status]
                          : serviceTask?.status === 'walking'
                            ? '正在前往目标'
                            : '正在执行任务'}{' '}
                      · 剩余 {duration(activeTask?.remaining ?? serviceTask?.remaining ?? 0)}
                    </p>
                    {activeTask && (
                      <button className="text-button" onClick={() => onSelect(activeTask.orderId)}>
                        查看所属订单 <Icon name="arrow" size={14} />
                      </button>
                    )}
                  </div>
                )}
                {party && (
                  <>
                    <Field label="顾客组人数" value={`${party.memberIds.length} 人`} />
                    <Field label="满意度" value={`${Math.round(party.satisfied)} / 100`} />
                    <div className="wait-breakdown">
                      <h4>真实等待分解</h4>
                      {Object.entries(party.waits).map(([key, value]) => (
                        <Field
                          key={key}
                          label={
                            (
                              {
                                table: '等座',
                                order: '等点单',
                                kitchen: '等厨房',
                                delivery: '等上菜',
                                payment: '等结账',
                              } as Record<string, string>
                            )[key]
                          }
                          value={duration(value)}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
            {fixture && (
              <>
                <div className="status-pill">
                  <span />
                  {table
                    ? { Available: '可以入座', Occupied: '顾客占用', NeedsCleaning: '等待清洁' }[
                        table.status
                      ]
                    : equipment?.slots.some(Boolean)
                      ? '正在加工'
                      : '设备空闲'}
                </div>
                <Field label="网格位置" value={`${fixture.x}, ${fixture.y}`} />
                <Field label="设备朝向" value={`${fixture.rotation}°`} />
                {table ? (
                  <>
                    <Field label="座位占用" value={`${table.occupiedSeats} / ${table.seatCount}`} />
                    <Field label="当前订单" value={`${table.currentOrders.length} 份`} />
                    <div className="progress-label">
                      <span>用餐进度</span>
                      <strong>{percent(table.diningProgress)}</strong>
                    </div>
                    <div className="progress-track">
                      <i style={{ width: percent(table.diningProgress) }} />
                    </div>
                    {table.currentOrders.map((id) => (
                      <button className="text-button" key={id} onClick={() => onSelect(id)}>
                        查看订单 #{id.split('-').pop()}
                        <Icon name="arrow" size={14} />
                      </button>
                    ))}
                  </>
                ) : (
                  <>
                    <Field
                      label="加工位占用"
                      value={`${equipment?.slots.filter(Boolean).length ?? 0} / ${EQUIPMENT[fixture.kind].capacity}`}
                    />
                    <Field label="累计使用" value={`${equipment?.uses ?? 0} 次`} />
                    <Field
                      label="实际利用率"
                      value={percent(sim.getEquipmentUtilization(fixture.id))}
                    />
                    {equipment?.slots.map((taskId, index) => {
                      const task = sim.tasks.find((t) => t.id === taskId);
                      const service = sim.serviceTasks.find((t) => t.id === taskId);
                      return (
                        <div className="slot-card" key={index}>
                          <span>加工位 {index + 1}</span>
                          <strong>
                            {task?.step.label ??
                              (service
                                ? {
                                    greet: '接待顾客',
                                    order: '接收订单',
                                    deliver: '领取餐品',
                                    pay: '处理结账',
                                    clean: '清洗餐具',
                                  }[service.kind]
                                : fixture.kind === 'restroom' && taskId
                                  ? '顾客使用中'
                                  : '空闲')}
                          </strong>
                          {(task || service) && (
                            <small>
                              {task
                                ? taskNames[task.status]
                                : service?.status === 'active'
                                  ? '主动操作'
                                  : '正在前往'}{' '}
                              · {duration(task?.remaining ?? service?.remaining ?? 0)}
                            </small>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
                {editing && (
                  <div className="fixture-actions">
                    <button className={moving ? 'active' : ''} onClick={onMove}>
                      <Icon name="move" />
                      移动
                    </button>
                    <button onClick={onRotate}>
                      <Icon name="rotate" />
                      旋转
                    </button>
                    <button onClick={onDelete} className="delete-action">
                      <Icon name="trash" />
                      删除
                    </button>
                  </div>
                )}
              </>
            )}
            {order && (
              <>
                <div className="status-pill">
                  <span />
                  {orderNames[order.status]}
                </div>
                <h4 className="order-dish">{recipeById[order.recipeId].shortName}</h4>
                <Field label="下单时间" value={clock(order.createdAt)} />
                <Field
                  label="经过时间"
                  value={duration((order.paidAt ?? sim.time) - order.createdAt)}
                />
                <Field label="配送时间" value={duration(order.deliveryTime)} />
                <div className="order-timeline">
                  {sim.tasks
                    .filter((t) => t.orderId === order.id)
                    .map((task) => (
                      <div
                        className={`timeline-step ${task.status === 'done' ? 'done' : task.status !== 'pending' ? 'running' : ''}`}
                        key={task.id}
                      >
                        <span className="timeline-dot">
                          {task.status === 'done' ? <Icon name="check" size={10} /> : ''}
                        </span>
                        <div>
                          <strong>{task.step.label}</strong>
                          <small>
                            {taskNames[task.status]}
                            {task.status !== 'done' && task.status !== 'pending'
                              ? ` · ${duration(task.remaining)}`
                              : ''}
                          </small>
                        </div>
                      </div>
                    ))}
                </div>
                <div className="wait-breakdown">
                  <h4>实际工序记录</h4>
                  <Field
                    label="主动工作"
                    value={duration(
                      sim.tasks
                        .filter((t) => t.orderId === order.id)
                        .reduce((s, t) => s + t.active, 0),
                    )}
                  />
                  <Field
                    label="被动加工"
                    value={duration(
                      sim.tasks
                        .filter((t) => t.orderId === order.id)
                        .reduce((s, t) => s + t.passive, 0),
                    )}
                  />
                  <Field
                    label="员工走动"
                    value={duration(
                      sim.tasks
                        .filter((t) => t.orderId === order.id)
                        .reduce((s, t) => s + t.walking, 0),
                    )}
                  />
                  <Field
                    label="等待设备"
                    value={duration(
                      sim.tasks
                        .filter((t) => t.orderId === order.id)
                        .reduce((s, t) => s + t.waitingEquipment, 0),
                    )}
                  />
                  <Field
                    label="等待员工"
                    value={duration(
                      sim.tasks
                        .filter((t) => t.orderId === order.id)
                        .reduce((s, t) => s + t.waitingStaff, 0),
                    )}
                  />
                </div>
              </>
            )}
          </div>
        )}
        <div className="section-title orders-heading">
          <h3>订单看板</h3>
          <span className="count-badge">{pendingOrders.length}</span>
        </div>
        {!pendingOrders.length ? (
          <div className="orders-empty">
            <Icon name="serving" size={24} />
            <span>等待第一份订单</span>
            <small>开门营业后，顾客将自主到店。</small>
          </div>
        ) : (
          <div className="order-list">
            {pendingOrders.map((item) => (
              <button
                key={item.id}
                className={`order-row ${selectedId === item.id ? 'selected' : ''}`}
                onClick={() => onSelect(item.id)}
              >
                <span className="order-number">#{item.id.split('-').pop()}</span>
                <div>
                  <strong>{recipeById[item.recipeId].shortName}</strong>
                  <span>{orderNames[item.status]}</span>
                </div>
                <small>{duration(sim.time - item.createdAt)}</small>
              </button>
            ))}
          </div>
        )}
        <div className="section-title events-heading">
          <h3>现场动态</h3>
          <span className="live-label">LIVE</span>
        </div>
        <div className="event-list">
          {visibleEvents.map((event, index) => (
            <div className="event-row" key={`${event.time}-${index}`}>
              <span>{clock(event.time)}</span>
              <p>{event.detail}</p>
            </div>
          ))}
          {!visibleEvents.length && <p className="muted-copy">员工已就位，餐厅即将开门。</p>}
        </div>
      </div>
    </aside>
  );
}
