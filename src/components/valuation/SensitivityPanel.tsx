import { useState } from 'react';
import { DIRECTION_NOTES, type SensitivityCellView, type SensitivityView } from '../../engine/validationView';
import { fmtNum, fmtPct, fmtPctTrim } from '../ui';

// A. Sensitivity Analysis — WACC × Terminal Growth 격자.
// Base(입력에서 나온 값)와 분석 범위(격자가 훑는 구간)는 서로 다른 개념이라 따로 표시한다.

type Metric = 'enterpriseValue' | 'equityValue' | 'perShareValue';
const METRICS: { id: Metric; label: string; digits: number; unit: string }[] = [
  { id: 'enterpriseValue', label: 'Enterprise Value', digits: 1, unit: '억원' },
  { id: 'equityValue', label: 'Equity Value', digits: 1, unit: '억원' },
  { id: 'perShareValue', label: 'Per Share Value', digits: 0, unit: '원' },
];

const tip = (c: SensitivityCellView) => `EV ${fmtNum(c.enterpriseValue, 2)}억원 · Equity ${fmtNum(c.equityValue, 2)}억원 · 주당 ${fmtNum(c.perShareValue, 0)}원`;

export function SensitivityPanel({ view }: { view: SensitivityView }) {
  const [metric, setMetric] = useState<Metric>('enterpriseValue');
  const m = METRICS.find((x) => x.id === metric)!;
  const { base, range } = view;

  return (
    <section className="panel" aria-label="Sensitivity Analysis">
      <div className="panel-head"><h3>A. Sensitivity Analysis</h3><span className="small muted">WACC × Terminal Growth</span></div>

      {/* Base 와 분석 범위는 같은 개념이 아니므로 분리해서 표시한다 */}
      <div className="base-range">
        <div className="base-box">
          <div className="small muted">Base Case · 현재 가정에서 나온 값</div>
          <dl className="stat-dl">
            <div><dt>Base WACC</dt><dd className="num">{fmtPctTrim(base.wacc)}</dd></div>
            <div><dt>Base Terminal Growth</dt><dd className="num">{fmtPctTrim(base.terminalGrowth)}</dd></div>
          </dl>
        </div>
        <div className="range-box">
          <div className="small muted">분석 범위 · 격자가 훑는 구간 (Base 와 다름)</div>
          <dl className="stat-dl">
            <div><dt>WACC 분석 범위</dt><dd className="num">{fmtPctTrim(range.waccMin)} ~ {fmtPctTrim(range.waccMax)} <span className="muted small">({view.waccValues.length}개)</span></dd></div>
            <div><dt>Terminal Growth 분석 범위</dt><dd className="num">{fmtPctTrim(range.terminalGrowthMin)} ~ {fmtPctTrim(range.terminalGrowthMax)} <span className="muted small">({view.terminalGrowthValues.length}개)</span></dd></div>
          </dl>
        </div>
      </div>
      {!base.inGrid && <p className="hint">Base 값이 분석 범위의 격자 값에 포함되어 있지 않아 Base 칸이 표시되지 않습니다.</p>}

      <div className="row between matrix-toolbar">
        <div className="seg" role="group" aria-label="표시할 값">
          {METRICS.map((x) => (
            <button key={x.id} type="button" className={x.id === metric ? 'active' : ''} aria-pressed={x.id === metric} onClick={() => setMetric(x.id)}>{x.label}</button>
          ))}
        </div>
        <div className="direction-notes" aria-label="방향성">
          {DIRECTION_NOTES.map((t) => <span key={t} className="note-chip">{t}</span>)}
        </div>
      </div>

      <div className="table-wrap">
        <table className="fin-table matrix-table">
          <thead>
            <tr>
              <th>g \ WACC <span className="muted small">({m.unit})</span></th>
              {view.waccValues.map((w) => <th key={w} className={`num${Math.abs(w - base.wacc) < 1e-9 ? ' base-col' : ''}`}>{fmtPctTrim(w)}</th>)}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.terminalGrowth}>
                <th className={Math.abs(row.terminalGrowth - base.terminalGrowth) < 1e-9 ? 'base-row' : undefined}>{fmtPctTrim(row.terminalGrowth, 2)}</th>
                {row.cells.map((c) => (
                  <td key={c.wacc} className={`num${c.isBaseCase ? ' base' : ''}`} title={tip(c)}>
                    {fmtNum(c[metric], m.digits)}{c.isBaseCase && <span className="base-mark" aria-label="Base Case"> ●</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        ● = Base Case. 칸에 마우스를 올리면 Enterprise Value · Equity Value · 주당가치를 함께 볼 수 있습니다. FCFF 는 고정하고 WACC 와 Terminal Growth 만 바꿔 다시 할인한 값입니다.
      </p>
      <p className="small num">
        Enterprise Value 범위: {fmtNum(view.enterpriseValueRange.min, 2)} ~ {fmtNum(view.enterpriseValueRange.max, 2)} 억원
        {view.enterpriseValueRange.widthRatio !== null && <span className="muted"> (Base EV 대비 폭 {fmtPct(view.enterpriseValueRange.widthRatio, 0)})</span>}
      </p>
    </section>
  );
}
