import type { Metrics } from '../../simulation/types';
import { duration, money, percent } from '../format';
import { Icon } from './Icon';

export interface ExperimentResult {
  baseline: Metrics;
  alternative: Metrics;
  seed: number;
}
function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="report-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close icon-button" onClick={onClose} aria-label="关闭报告">
          <Icon name="close" />
        </button>
        <span className="eyebrow">RESTAURANT LAB / FIELD NOTES</span>
        <h2>{title}</h2>
        <p className="report-subtitle">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
export function DayReport({
  metrics,
  onClose,
  onReset,
}: {
  metrics: Metrics;
  onClose: () => void;
  onReset: () => void;
}) {
  return (
    <Modal title="午餐营业报告" subtitle="11:00 — 14:00 · 以下结果均来自实际模拟" onClose={onClose}>
      <div className="report-headline">
        <div>
          <span>营业收入</span>
          <strong>{money(metrics.revenue)}</strong>
        </div>
        <div>
          <span>预计利润</span>
          <strong className={metrics.profit < 0 ? 'negative' : ''}>{money(metrics.profit)}</strong>
        </div>
      </div>
      <div className="report-grid">
        <div>
          <span>服务顾客</span>
          <strong>
            {metrics.customersServed} <small>人</small>
          </strong>
        </div>
        <div>
          <span>完成订单</span>
          <strong>
            {metrics.ordersCompleted} <small>份</small>
          </strong>
        </div>
        <div>
          <span>平均等待</span>
          <strong>{duration(metrics.averageWaitTime)}</strong>
        </div>
        <div>
          <span>平均制作</span>
          <strong>{duration(metrics.averageCookingTime)}</strong>
        </div>
        <div>
          <span>员工利用率</span>
          <strong>{percent(metrics.staffUtilization)}</strong>
        </div>
        <div>
          <span>未接待顾客</span>
          <strong>
            {metrics.lostCustomers} <small>人</small>
          </strong>
        </div>
      </div>
      <div className="report-costs">
        <span>食材 {money(metrics.foodCost)}</span>
        <span>人工 {money(metrics.laborCost)}</span>
        <span>经营 {money(metrics.operatingCost)}</span>
      </div>
      <p className="report-note">
        用餐时间、薪资、租金和顾客耐心属于可调整的模拟假设，不代表现实统计数据。
      </p>
      <button className="primary-button report-cta" onClick={onReset}>
        调整布局，开始下一次实验
        <Icon name="arrow" />
      </button>
    </Modal>
  );
}
export function ExperimentReport({
  result,
  onClose,
}: {
  result: ExperimentResult;
  onClose: () => void;
}) {
  const rows: [string, keyof Metrics, (n: number) => string][] = [
    ['服务顾客', 'customersServed', (n) => `${n} 人`],
    ['完成订单', 'ordersCompleted', (n) => `${n} 份`],
    ['营业收入', 'revenue', money],
    ['平均员工走动', 'averageWalkingTime', duration],
    ['平均制作时间', 'averageCookingTime', duration],
    ['等待设备总时间', 'equipmentWaitingTime', duration],
    ['员工利用率', 'staffUtilization', percent],
    ['预计利润', 'profit', money],
  ];
  return (
    <Modal
      title="空间，如何改变结果？"
      subtitle={`同一需求序列 · 随机种子 ${result.seed} · 两次完整无渲染模拟`}
      onClose={onClose}
    >
      <table className="comparison-table">
        <thead>
          <tr>
            <th>实际测量指标</th>
            <th>基准布局</th>
            <th>紧凑布局</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, key, format]) => (
            <tr key={key}>
              <td>{label}</td>
              <td>{format(result.baseline[key])}</td>
              <td>{format(result.alternative[key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="experiment-explanation">
        <Icon name="flask" size={28} />
        <p>
          两次实验使用相同设备数量、团队、菜单、库存和顾客需求。差异来自员工行走、设备占用与实际任务等待，没有隐藏效率加成。
        </p>
      </div>
      <p className="report-note">
        相近或较差的结果同样会如实显示。先看走动与等待，再判断生产瓶颈。
      </p>
    </Modal>
  );
}
