import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useProject } from '../../store/project';
import { AssumptionCompleteness } from './AssumptionCompleteness';
import { useAssumptionForm } from './useAssumptionForm';
import {
  SOURCE_LABELS, WACC_FIELD_SOURCE, computeWaccPreview, mergeWaccDrafts, parseWaccForm, sameWaccInputs, waccContributions,
  waccDraftToForm, waccWarnings, type WaccField, type WaccFormValues, type WaccInputs,
} from '../../engine/waccForm';
import { fmtPct } from '../ui';
import { stages } from './workflow';

// 3. WACC — Rf / Beta / MRP / Kd / E / D 를 입력받는다. Tax Rate 는 Forecast 입력(valuationAssumptions.taxRate)을 재사용한다.
// 계산 결과(Cost of Equity, After-tax Cost of Debt, 가중치, WACC)는 입력칸이 아니라 읽기 전용 값이며,
// valuation 공개 API 로 미리 계산한 Preview 다. Preview 는 valuationResult 를 만들지 않는다.

const SECTION = stages[2];

interface FieldDef { field: WaccField; label: string; unit: '%' | '억원' | '배'; helper: string }
const COE: FieldDef[] = [
  { field: 'riskFreeRate', label: 'Risk-free Rate', unit: '%', helper: '무위험 수익률 (예: 국고채 금리 가정)' },
  { field: 'beta', label: 'Beta', unit: '배', helper: '시장 대비 주가 민감도 (0 이상)' },
  { field: 'marketRiskPremium', label: 'Market Risk Premium', unit: '%', helper: '시장 위험 프리미엄 (시장수익률 − 무위험수익률)' },
];
const COD: FieldDef[] = [
  { field: 'preTaxCostOfDebt', label: 'Pre-tax Cost of Debt', unit: '%', helper: '세전 타인자본 조달비용 (이자율)' },
];
const CAP: FieldDef[] = [
  { field: 'equityMarketValue', label: 'Equity Market Value', unit: '억원', helper: '자기자본의 시장가치 (시가총액)' },
  { field: 'debtMarketValue', label: 'Debt Market Value', unit: '억원', helper: '타인자본의 시장가치 (이자부부채)' },
];

export function WaccStage() {
  const { project, setWaccInputs, clearStaleResults } = useProject();
  const a = project.valuationAssumptions;
  const form = useAssumptionForm<WaccFormValues, WaccInputs>({
    assumptions: a,
    toForm: waccDraftToForm,
    merge: mergeWaccDrafts,
    parse: (v) => {
      const r = parseWaccForm(v);
      return r.ok ? r : { ok: false, errors: r.errors as Record<string, string> };
    },
    isOurs: sameWaccInputs,
    push: setWaccInputs, // 반영하면 이전 결과는 비워진다
    onInvalid: clearStaleResults,
  });
  const taxRate = a?.taxRate;
  const preview = useMemo(() => computeWaccPreview(form.values, taxRate), [form.values, taxRate]);
  const contributions = waccContributions(preview);
  const warnings = useMemo(() => waccWarnings(form.values), [form.values]);
  const capError = form.errors.capitalStructure && (form.touched.has('equityMarketValue') || form.touched.has('debtMarketValue')) ? form.errors.capitalStructure : undefined;

  const input = ({ field, label, unit, helper }: FieldDef) => {
    const err = form.shown(field);
    const warn = !err ? warnings[field] : undefined;
    return (
      <label key={field} className="field">
        <span className="field-label">
          {label} <em>({unit})</em>
          <span className="source-tag" title="입력값의 출처. 이후 Market data, Comparable 등으로 확장됩니다.">{SOURCE_LABELS[WACC_FIELD_SOURCE[field]]}</span>
        </span>
        <div className={`input-unit${err ? ' invalid' : ''}`}>
          <input
            inputMode="decimal"
            value={form.values[field]}
            aria-invalid={err ? true : undefined}
            onChange={(e) => form.edit(field, e.target.value)}
            onBlur={() => form.blur(field)}
          />
          <span aria-hidden>{unit}</span>
        </div>
        {err && <div className="field-error" role="alert">{err}</div>}
        {warn && <div className="field-warning">{warn}</div>}
        <small className="helper">{helper}</small>
      </label>
    );
  };

  const calc = (label: string, value: number | null, digits: number, hint?: string) => (
    <div className="calc-row">
      <dt>{label}</dt>
      <dd className="num">{value === null ? '—' : fmtPct(value, digits)}</dd>
      {hint && <small className="helper">{hint}</small>}
    </div>
  );

  return (
    <>
      <p className="muted">{SECTION.summary}</p>

      <div className="wacc-grid">
        {/* A. Cost of Equity */}
        <section className="panel wide" aria-label="Cost of Equity">
          <div className="panel-head"><h3>A. Cost of Equity</h3><span className="small muted">CAPM</span></div>
          <div className="field-row">{COE.map(input)}</div>
          <dl className="calc-box">{calc('Calculated Cost of Equity', preview.costOfEquity, 2, 'Re = Rf + β × MRP')}</dl>
        </section>

        {/* B. Cost of Debt */}
        <section className="panel" aria-label="Cost of Debt">
          <div className="panel-head"><h3>B. Cost of Debt</h3></div>
          {COD.map(input)}
          <div className="field">
            <span className="field-label">Tax Rate <span className="source-tag">Forecast 에서 재사용</span></span>
            {taxRate !== undefined ? (
              <div className="readonly-value num">{fmtPct(taxRate, 1)}</div>
            ) : (
              <div className="readonly-value muted">미입력</div>
            )}
            <small className="helper">{taxRate !== undefined ? '(from Forecast assumptions) 이 화면에서 수정하지 않습니다.' : <><Link to="/valuation/forecast">Forecast</Link> 에서 Tax Rate 를 입력하면 세후 타인자본비용이 계산됩니다.</>}</small>
          </div>
          <dl className="calc-box">{calc('Calculated After-tax Cost of Debt', preview.afterTaxCostOfDebt, 2, 'Rd × (1 − Tax Rate)')}</dl>
        </section>

        {/* C. Capital Structure */}
        <section className="panel" aria-label="Capital Structure">
          <div className="panel-head"><h3>C. Capital Structure</h3></div>
          {CAP.map(input)}
          {capError && <div className="field-error left" role="alert">{capError}</div>}
          <dl className="calc-box">
            {calc('Equity Weight', preview.equityWeight, 1, 'E / (D + E)')}
            {calc('Debt Weight', preview.debtWeight, 1, 'D / (D + E)')}
          </dl>
        </section>

        {/* D. WACC Result */}
        <section className="panel wide wacc-result" aria-label="WACC Result">
          <div className="panel-head"><h3>D. WACC Result</h3>{preview.wacc !== null && <span className="chip">Preview</span>}</div>
          <div className="wacc-value num" aria-live="polite">{preview.wacc === null ? '—' : fmtPct(preview.wacc, 4)}</div>
          <p className="small muted">Calculated WACC = Equity Weight × Cost of Equity + Debt Weight × After-tax Cost of Debt</p>
          {contributions ? (
            <dl className="stat-dl">
              <div><dt>자기자본 기여 ({fmtPct(preview.equityWeight, 1)} × {fmtPct(preview.costOfEquity, 2)})</dt><dd className="num">{fmtPct(contributions.equity, 2)}</dd></div>
              <div><dt>타인자본 기여 ({fmtPct(preview.debtWeight, 1)} × {fmtPct(preview.afterTaxCostOfDebt, 2)})</dt><dd className="num">{fmtPct(contributions.debt, 2)}</dd></div>
            </dl>
          ) : (
            <p className="hint">모든 WACC 입력과 Forecast 의 Tax Rate 가 유효하면 WACC 가 표시됩니다. 값을 임의로 채우지 않습니다.</p>
          )}
          <p className="hint">이 값은 입력으로 미리 계산한 Preview 입니다. Valuation 결과는 Run Valuation 을 실행할 때 생성됩니다.</p>
        </section>
      </div>

      <AssumptionCompleteness assumptions={a} />

      <div className="row between slot-nav">
        <Link className="btn" to={`/valuation/${stages[1].id}`}>← {stages[1].label}</Link>
        <Link className="btn primary" to={`/valuation/${stages[3].id}`}>{stages[3].label} →</Link>
      </div>
    </>
  );
}
