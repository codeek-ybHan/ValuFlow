import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useProject } from '../../store/project';
import { AssumptionCompleteness } from './AssumptionCompleteness';
import { useAssumptionForm } from './useAssumptionForm';
import {
  FORECAST_YEARS, buildForecastReference, fieldKey, forecastDraftToForm, forecastLabels,
  isBasedOnLatestActual, mergeDrafts, parseForecastForm, sameForecastInputs, amountText, type FieldKey, type ForecastArrayField, type ForecastFormValues, type ForecastInputs,
} from '../../engine/forecastForm';
import { fmtNum, fmtPct } from '../ui';
import { stages } from './workflow';

// 2. Forecast — 사용자가 미래 가정을 직접 입력한다. Historical 값은 참고용(reference-only)이며 자동 입력하지 않는다.
// 입력은 % / 억원 단위의 문자열로 받고, 유효한 완성 입력만 valuationAssumptions(소수 / 억원)에 반영한다.
// 계산은 상단 [Run Valuation] 과 DCF 단계의 실행 패널에서만 한다 (입력이 바뀌면 이전 결과는 비워진다).

const SECTION = stages[1];

export function ForecastStage() {
  const { project, setForecastInputs, clearStaleResults } = useProject();
  const a = project.valuationAssumptions;
  const h = project.historicalData;
  const ref = useMemo(() => buildForecastReference(h), [h]);
  const estimateLabels = useMemo(() => forecastLabels(ref?.periods ?? null, FORECAST_YEARS), [ref]);

  const { values, parsed, errors, touched, edit, blur, shown } = useAssumptionForm<ForecastFormValues, ForecastInputs>({
    assumptions: a,
    toForm: forecastDraftToForm,
    merge: mergeDrafts,
    parse: parseForecastForm,
    isOurs: sameForecastInputs,
    push: setForecastInputs, // 반영하면 이전 결과는 비워진다
    onInvalid: clearStaleResults, // 가정은 마지막 유효 값을 유지하고, 어긋난 결과만 비운다
  });

  const currentRevenueValue = parsed.ok ? parsed.value.currentRevenue : NaN;
  const basedOnLatest = ref !== null && isBasedOnLatestActual(currentRevenueValue, ref);
  const useLatestActual = () => ref && edit('currentRevenue', amountText(ref.latestRevenueEok));

  const shownErrors = Object.entries(errors).filter(([k]) => touched.has(k));

  const cellInput = (field: ForecastArrayField, i: number, unit: '%' | '억원') => {
    const key = fieldKey(field, i);
    const err = shown(key);
    return (
      <td key={key} className="fc-input-cell">
        <div className={`input-unit${err ? ' invalid' : ''}`}>
          <input
            inputMode="decimal"
            value={values[field][i]}
            aria-label={`${field} ${estimateLabels[i]}`}
            aria-invalid={err ? true : undefined}
            onChange={(e) => edit(key, e.target.value)}
            onBlur={() => blur(key)}
          />
          <span aria-hidden>{unit}</span>
        </div>
        {err && <div className="field-error" role="alert">{err}</div>}
      </td>
    );
  };

  return (
    <>
      <p className="muted">{SECTION.summary}</p>

      {/* Current Revenue / Tax Rate */}
      <section className="panel">
        <div className="panel-head"><h3>기준 입력</h3></div>
        <div className="form-grid fc-base-grid">
          <label className="field">
            <span>Current Revenue <em>(억원)</em></span>
            <div className={`input-unit${shown('currentRevenue') ? ' invalid' : ''}`}>
              <input inputMode="decimal" value={values.currentRevenue} aria-invalid={shown('currentRevenue') ? true : undefined} onChange={(e) => edit('currentRevenue', e.target.value)} onBlur={() => blur('currentRevenue')} />
              <span aria-hidden>억원</span>
            </div>
            {shown('currentRevenue') && <div className="field-error" role="alert">{errors.currentRevenue}</div>}
            <small className="helper">예측의 출발점이 되는 현재(Y0) 매출입니다.</small>
          </label>
          <label className="field">
            <span>Tax Rate <em>(공통)</em></span>
            <div className={`input-unit${shown('taxRate') ? ' invalid' : ''}`}>
              <input inputMode="decimal" value={values.taxRate} aria-invalid={shown('taxRate') ? true : undefined} onChange={(e) => edit('taxRate', e.target.value)} onBlur={() => blur('taxRate')} />
              <span aria-hidden>%</span>
            </div>
            {shown('taxRate') && <div className="field-error" role="alert">{errors.taxRate}</div>}
            <small className="helper">법인세율 가정. 모든 예측 연도에 같은 값을 씁니다.</small>
          </label>
          <div className="field">
            <span>Forecast Years</span>
            <div className="fc-years">{FORECAST_YEARS}년 <span className="muted small">({estimateLabels[0]} – {estimateLabels[estimateLabels.length - 1]})</span></div>
            <small className="helper">현재 엔진 입력 구조의 기본 기간입니다. 입력은 연도별 배열이라 이후 5년으로 확장할 수 있습니다.</small>
          </div>
        </div>
        {ref && (
          <div className="row fc-latest">
            <button className="btn small" onClick={useLatestActual}>최근 Actual 매출 사용</button>
            <span className="small muted">{ref.latestRevenuePeriod} Revenue → {fmtNum(ref.latestRevenueEok, 2)} 억원 (KRW million ÷ 100)</span>
            {basedOnLatest && <span className="chip">Based on latest actual revenue</span>}
          </div>
        )}
      </section>

      {/* Actual (참고) | Estimate (입력) */}
      <div className="table-wrap fc-wrap">
        <table className="fin-table fc-table">
          <thead>
            <tr className="fc-group">
              <th rowSpan={2}>Driver</th>
              {ref && <th colSpan={ref.periods.length} className="fc-group-actual">Actual · 참고용 (자동 입력 안 됨)</th>}
              <th colSpan={FORECAST_YEARS} className="fc-group-estimate">Estimate · 입력</th>
            </tr>
            <tr>
              {ref?.periods.map((p) => <th key={p} className="num fc-actual">{p}</th>)}
              {estimateLabels.map((l) => <th key={l} className="num fc-estimate">{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {(ref?.rows ?? ROWS_WITHOUT_REFERENCE).map((row) => (
              <tr key={row.key}>
                <th>
                  <div>{row.label} <span className="muted small">({row.unit})</span></div>
                  <small className="helper" title={row.helper}>{row.helper}</small>
                  {row.note && <small className="helper">{row.note}</small>}
                </th>
                {ref && row.values.map((v, i) => (
                  <td key={i} className="num fc-actual">{v === null ? '—' : row.unit === '%' ? fmtPct(v, 1) : fmtNum(v, 0)}</td>
                ))}
                {estimateLabels.map((_, i) => cellInput(row.key, i, row.unit))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!ref && <p className="hint">Historical Data 가 없어 과거 참고값을 표시하지 않습니다. 1단계 Historical 에서 [삼성전자 데이터 불러오기] 를 실행하면 참고값이 나타납니다.</p>}
      {ref && (
        <ul className="plain-list small fc-hints">
          {ref.hints.map((t) => <li key={t} className="num">{t}</li>)}
        </ul>
      )}
      {ref && <p className="hint">Actual 금액은 KRW million 을 억원으로 환산한 참고값이며(원본 데이터는 그대로), 과거 CAPEX 는 유형자산 취득액 기준입니다. 이 값들은 입력칸에 자동으로 채워지지 않습니다.</p>}

      {/* 검증 / 안내 */}
      {shownErrors.length > 0 && (
        <div className="callout neg" role="alert">
          <strong>입력을 확인하세요</strong>
          <ul className="plain-list small">{shownErrors.slice(0, 6).map(([k, m]) => <li key={k}>{fieldLabel(k, estimateLabels)}: {m}</li>)}</ul>
        </div>
      )}
      <AssumptionCompleteness assumptions={a} />

      <div className="row between slot-nav">
        <Link className="btn" to={`/valuation/${stages[0].id}`}>← {stages[0].label}</Link>
        <Link className="btn primary" to={`/valuation/${stages[2].id}`}>{stages[2].label} →</Link>
      </div>
    </>
  );
}

// Historical 이 없을 때의 행 정의 (참고값 없음)
const ROWS_WITHOUT_REFERENCE: { key: ForecastArrayField; label: string; unit: '%' | '억원'; helper: string; note?: string; values: (number | null)[] }[] = [
  { key: 'revenueGrowth', label: 'Revenue Growth', unit: '%', helper: '매출 성장률 가정', values: [] },
  { key: 'operatingMargin', label: 'Operating Margin', unit: '%', helper: '매출 대비 영업이익 비율', values: [] },
  { key: 'depreciation', label: 'D&A', unit: '억원', helper: '감가상각비', values: [] },
  { key: 'capex', label: 'CAPEX', unit: '억원', helper: '설비 등 장기자산 투자', values: [] },
  { key: 'deltaNwc', label: 'ΔNWC', unit: '억원', helper: '운전자본 증가분 (감소는 음수)', values: [] },
];

const FIELD_NAMES: Record<string, string> = { currentRevenue: 'Current Revenue', taxRate: 'Tax Rate', revenueGrowth: 'Revenue Growth', operatingMargin: 'Operating Margin', depreciation: 'D&A', capex: 'CAPEX', deltaNwc: 'ΔNWC' };
function fieldLabel(key: FieldKey, estimateLabels: string[]): string {
  const [field, idx] = key.split('.');
  return idx === undefined ? FIELD_NAMES[field] : `${FIELD_NAMES[field]} ${estimateLabels[Number(idx)] ?? ''}`.trim();
}

