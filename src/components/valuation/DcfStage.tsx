import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useProject } from '../../store/project';
import { assumptionCompleteness } from '../../store/assumptions';
import { AssumptionCompleteness } from './AssumptionCompleteness';
import { useAssumptionForm } from './useAssumptionForm';
import {
  DCF_FIELD_SOURCE, dcfDraftToForm, dcfWarnings, mergeDcfDrafts, parseDcfForm, sameDcfInputs, terminalSpread, type DcfField, type DcfFormValues, type DcfInputs,
} from '../../engine/dcfForm';
import { bridgeAdjustment, buildDcfView, buildEquityBridge } from '../../engine/dcfView';
import { SOURCE_LABELS, computeWaccPreview, waccDraftToForm } from '../../engine/waccForm';
import { forecastLabels } from '../../engine/forecastForm';
import { StatusBadge, fmtNum, fmtPct } from '../ui';
import { stages } from './workflow';

// 4. DCF / Equity — Terminal Growth 와 Equity Bridge(이자부부채, 현금, 발행주식수)를 입력받고, 실행하면 DCF 와 Equity Value 결과를 보여 준다.
// 입력(4개)과 결과(EV, Net Debt, Equity Value, 주당가치 등)는 구분된다. 결과는 읽기 전용이며 입력칸이 아니다.
// 숨겨진 학습용 기본값은 없다: 모든 가정이 준비되어야 Run Valuation 이 가능하다.

const SECTION = stages[3];

interface FieldDef { field: Exclude<DcfField, 'terminalGrowth'>; label: string; unit: '억원' | '주'; helper: string }
const BRIDGE_FIELDS: FieldDef[] = [
  { field: 'interestBearingDebt', label: 'Interest-bearing Debt', unit: '억원', helper: '이자를 부담하는 부채 (차입금, 사채 등)' },
  { field: 'cash', label: 'Cash', unit: '억원', helper: '현금 및 현금성 자산' },
  { field: 'sharesOutstanding', label: 'Shares Outstanding', unit: '주', helper: '발행주식수 (실제 주식 수). 0 보다 커야 합니다' },
];

const pp = (d: number) => `${(d * 100).toFixed(4)}%p`;

export function DcfStage() {
  const { project, setDcfInputs, clearStaleResults, runCurrentValuation, runCurrentSensitivity } = useProject();
  const a = project.valuationAssumptions;
  const r = project.valuationResult;
  const wacc = useMemo(() => (a ? computeWaccPreview(waccDraftToForm(a), a.taxRate).wacc : null), [a]);

  const form = useAssumptionForm<DcfFormValues, DcfInputs>({
    assumptions: a,
    toForm: dcfDraftToForm,
    merge: mergeDcfDrafts,
    parse: (v) => {
      const res = parseDcfForm(v, { wacc });
      return res.ok ? res : { ok: false, errors: res.errors as Record<string, string> };
    },
    isOurs: sameDcfInputs,
    push: setDcfInputs, // 반영하면 이전 결과는 비워진다
    onInvalid: clearStaleResults,
  });
  const warnings = useMemo(() => dcfWarnings(form.values), [form.values]);
  // 값이 들어 있는데 유효하지 않은 칸(예: WACC 가 바뀌어 WACC ≤ g 가 된 경우)은 건드리지 않았어도 오류를 보여 준다. 빈 칸은 건드린 뒤에만.
  const err = (field: DcfField) => form.shown(field) ?? (form.values[field].trim() !== '' ? form.errors[field] : undefined);

  const g = form.parsed.ok ? form.parsed.value.terminalGrowth : null;
  const spread = terminalSpread(wacc, g);
  const yearLabels = forecastLabels(project.historicalData?.company.period ?? null, r?.fcff.length);
  const dcf = r ? buildDcfView(r, yearLabels) : null;
  const bridge = r && a?.sharesOutstanding !== undefined ? buildEquityBridge(r, a.sharesOutstanding) : null;
  const adj = bridge ? bridgeAdjustment(bridge.netDebt) : null;

  const completeness = assumptionCompleteness(a);
  const runnable = completeness.complete && form.parsed.ok;
  const calculated = !!r && !project.valuationError;
  const run = () => { runCurrentValuation(); runCurrentSensitivity(); }; // Result 단계가 바로 쓸 수 있게 Sensitivity 도 함께 실행

  const input = (field: DcfField, label: string, unit: '%' | '억원' | '주', helper: string) => {
    const e = err(field);
    const warn = !e ? warnings[field] : undefined;
    return (
      <label key={field} className="field">
        <span className="field-label">
          {label} <em>({unit})</em>
          <span className="source-tag" title="입력값의 출처. 이후 Source / Date / Note 로 확장됩니다.">{SOURCE_LABELS[DCF_FIELD_SOURCE[field]]}</span>
        </span>
        <div className={`input-unit${e ? ' invalid' : ''}`}>
          <input
            inputMode="decimal"
            value={form.values[field]}
            aria-invalid={e ? true : undefined}
            onChange={(ev) => form.edit(field, ev.target.value)}
            onBlur={() => form.blur(field)}
          />
          <span aria-hidden>{unit}</span>
        </div>
        {e && <div className="field-error" role="alert">{e}</div>}
        {warn && <div className="field-warning">{warn}</div>}
        <small className="helper">{helper}</small>
      </label>
    );
  };

  return (
    <>
      <p className="muted">{SECTION.summary}</p>

      <div className="dcf-inputs">
        {/* A. Terminal Value Assumption */}
        <section className="panel wide" aria-label="Terminal Value Assumption">
          <div className="panel-head"><h3>A. Terminal Value Assumption</h3></div>
          <div className="split">
          {input('terminalGrowth', 'Terminal Growth', '%', 'Forecast 기간 이후의 장기 성장률')}
          <dl className="spread-box">
            <div><dt>WACC</dt><dd className="num">{wacc === null ? '—' : fmtPct(wacc, 4)}</dd></div>
            <div><dt>Terminal Growth</dt><dd className="num">{g === null ? '—' : fmtPct(g, 2)}</dd></div>
            <div className={spread !== null && spread <= 0 ? 'bad' : undefined}><dt>Spread (WACC − g)</dt><dd className="num">{spread === null ? '—' : pp(spread)}</dd></div>
          </dl>
          </div>
          {wacc === null && <p className="hint">WACC 가 아직 계산되지 않았습니다. <Link to="/valuation/wacc">WACC</Link> 와 Forecast 의 Tax Rate 를 입력하면 Spread 가 표시됩니다.</p>}
        </section>

        {/* B. Equity Bridge Inputs */}
        <section className="panel wide" aria-label="Equity Bridge Inputs">
          <div className="panel-head"><h3>B. Equity Bridge Inputs</h3></div>
          <div className="field-row">{BRIDGE_FIELDS.map((f) => input(f.field, f.label, f.unit, f.helper))}</div>
          <p className="hint">Net Debt = 이자부부채 − 현금 입니다. 현금이 부채보다 많으면 Net Debt 가 음수(순현금)가 될 수 있고, 이때 Equity Value 는 EV 보다 커집니다.</p>
        </section>
      </div>

      {/* C. DCF Result */}
      <section className="panel" aria-label="DCF Result">
        <div className="panel-head"><h3>C. DCF Result</h3><StatusBadge label={calculated ? 'CALCULATED' : 'NOT RUN'} /></div>
        {dcf ? (
          <>
            <div className="table-wrap">
              <table className="fin-table">
                <thead><tr><th>Year</th><th className="num">FCFF (억원)</th><th className="num">Discount Factor</th><th className="num">PV of FCFF (억원)</th></tr></thead>
                <tbody>
                  {dcf.rows.map((row) => (
                    <tr key={row.label}><th>{row.label}</th><td className="num">{fmtNum(row.fcff, 2)}</td><td className="num">{fmtNum(row.discountFactor, 4)}</td><td className="num">{fmtNum(row.pvFcff, 2)}</td></tr>
                  ))}
                  <tr className="total"><th>Σ PV of FCFF</th><td /><td /><td className="num">{fmtNum(dcf.sumPvFcff, 2)}</td></tr>
                </tbody>
              </table>
            </div>
            <dl className="stat-dl">
              <div><dt>Terminal FCFF <span className="small muted">(마지막 해 FCFF × (1 + g))</span></dt><dd className="num">{fmtNum(dcf.terminalFcff, 2)} 억원</dd></div>
              <div><dt>Terminal Value <span className="small muted">(Terminal FCFF ÷ (WACC − g))</span></dt><dd className="num">{fmtNum(dcf.terminalValue, 2)} 억원</dd></div>
              <div><dt>PV of Terminal Value</dt><dd className="num">{fmtNum(dcf.pvTerminalValue, 2)} 억원</dd></div>
              <div><dt><strong>Enterprise Value</strong> <span className="small muted">(Σ PV of FCFF + PV(TV))</span></dt><dd className="num"><strong>{fmtNum(dcf.enterpriseValue, 2)} 억원</strong></dd></div>
              <div><dt>Terminal Value Contribution <span className="small muted">(PV(TV) ÷ EV, 참고지표)</span></dt><dd className="num">{dcf.tvContribution === null ? '—' : fmtPct(dcf.tvContribution, 1)}</dd></div>
            </dl>
            {dcf.tvNote && <p className="hint">{dcf.tvNote} 엔진 계산 결과는 바뀌지 않으며 검토용 참고입니다.</p>}
          </>
        ) : (
          <p className="muted">Run Valuation 을 실행하면 FCFF, Discount Factor, PV, Terminal Value, Enterprise Value 가 표시됩니다. 계산되지 않은 값은 임의로 채우지 않습니다.</p>
        )}
      </section>

      {/* D. Equity Value Bridge */}
      <section className="panel" aria-label="Equity Value Bridge">
        <div className="panel-head"><h3>D. Equity Value Bridge</h3>{bridge?.netCash && <span className="chip">순현금 (현금 &gt; 이자부부채)</span>}</div>
        {bridge ? (
          <ol className="bridge">
            <li><span className="op" aria-hidden /><span className="label">Enterprise Value</span><span className="value num">{fmtNum(bridge.enterpriseValue, 2)} 억원</span></li>
            {adj && <li><span className="op" aria-label={adj.operator === '+' ? '더하기' : '빼기'}>{adj.operator}</span><span className="label">{adj.label} <span className="small muted">({adj.label === 'Net Cash' ? '현금 − 이자부부채' : '이자부부채 − 현금'})</span></span><span className="value num">{fmtNum(adj.amount, 2)} 억원</span></li>}
            <li className="result"><span className="op" aria-label="같음">=</span><span className="label">Equity Value</span><span className="value num">{fmtNum(bridge.equityValue, 2)} 억원</span></li>
            <li><span className="op" aria-label="나누기">÷</span><span className="label">Shares Outstanding</span><span className="value num">{fmtNum(bridge.sharesOutstanding, 0)} 주</span></li>
            <li className="result final"><span className="op" aria-label="같음">=</span><span className="label">Per Share Value</span><span className="value num">{fmtNum(bridge.perShareValue, 0)} 원</span></li>
          </ol>
        ) : (
          <p className="muted">Run Valuation 을 실행하면 Enterprise Value → Equity Value → 주당가치 흐름이 표시됩니다.</p>
        )}
        <p className="hint">Equity Value(억원) × 100,000,000 ÷ 주식 수 = 주당가치(원). 금액은 억원, 주당가치는 원 단위입니다.</p>
      </section>

      <AssumptionCompleteness assumptions={a} />

      {/* 실행 */}
      <section className="panel fc-run">
        <div className="row between">
          <div>
            <h3>Run Valuation</h3>
            <p className="small muted">
              {!form.parsed.ok ? `DCF / Equity 입력을 확인하세요 (${Object.keys(form.errors).length}개 항목).`
                : runnable ? '모든 가정이 준비되었습니다. 실행하면 Valuation 과 Sensitivity 를 계산합니다.'
                : 'DCF / Equity 입력은 유효하지만 Forecast / WACC 가정이 아직 준비되지 않아 실행할 수 없습니다.'}
            </p>
          </div>
          <div className="row">
            {calculated && <StatusBadge label="CALCULATED" />}
            {calculated && <Link className="btn" to="/valuation/result">View Result →</Link>}
            <button className="btn primary" onClick={run} disabled={!runnable}>Run Valuation</button>
          </div>
        </div>
        {project.valuationError && <div className="callout neg" role="alert"><strong>Valuation 오류</strong> · {project.valuationError}</div>}
      </section>

      <div className="row between slot-nav">
        <Link className="btn" to={`/valuation/${stages[2].id}`}>← {stages[2].label}</Link>
        <Link className="btn primary" to={`/valuation/${stages[4].id}`}>{stages[4].label} →</Link>
      </div>
    </>
  );
}
