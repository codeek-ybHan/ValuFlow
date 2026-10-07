import { useMemo } from 'react';
import { useProject } from '../../store/project';
import { isPracticeAssumptions } from '../../store/projectModel';
import { useAssumptionForm } from './useAssumptionForm';
import {
  RELATIVE_FIELD_SOURCE, RELATIVE_GROUPS, buildRelativeReference, mergeRelativeDrafts, parseRelativeForm, relativeDraftToForm, sameRelativeInputs,
  type RelativeField, type RelativeFormValues,
} from '../../engine/relativeForm';
import { SOURCE_LABELS } from '../../engine/waccForm';
import type { RelativeInput } from '../../valuation';
import type { RelativeView } from '../../engine/validationView';
import { amountText } from '../../engine/forecastForm';
import { fmtNum, StatusBadge } from '../ui';

// C. Relative Valuation — PER / PBR / EV·EBITDA. 멀티플은 사용자가 직접 입력한다 (Peer 자동 수집 없음).
// 세 방법은 독립적이다. 비어 있는 방법은 계산하지 않을 뿐 오류가 아니다.

export function RelativePanel({ view }: { view: RelativeView }) {
  const { project, setRelativeInputs } = useProject();
  const ref = useMemo(() => buildRelativeReference(project.historicalData), [project.historicalData]);
  const form = useAssumptionForm<RelativeFormValues, RelativeInput, RelativeInput>({
    assumptions: project.relativeInputs,
    toForm: relativeDraftToForm,
    merge: mergeRelativeDrafts,
    parse: (v) => {
      const r = parseRelativeForm(v);
      return r.ok ? r : { ok: false, errors: r.errors as Record<string, string> };
    },
    isOurs: sameRelativeInputs,
    push: setRelativeInputs,
    onInvalid: () => undefined, // 상대가치 결과는 입력에서 매번 계산되는 파생값이라 stale 처리가 필요 없다
  });
  const scaleMismatch = ref !== null && isPracticeAssumptions(project.valuationAssumptions);

  const err = (f: RelativeField) => form.shown(f) ?? (form.values[f].trim() !== '' ? form.errors[f] : undefined);
  const input = (f: RelativeField, label: string, unit: string, helper?: string) => {
    const e = err(f);
    return (
      <label key={f} className="field">
        <span className="field-label">
          {label} <em>({unit})</em>
          <span className="source-tag" title="입력값의 출처. 이후 Peer Company / Source / Date 로 확장됩니다.">{SOURCE_LABELS[RELATIVE_FIELD_SOURCE[f]]}</span>
        </span>
        <div className={`input-unit${e ? ' invalid' : ''}`}>
          <input inputMode="decimal" value={form.values[f]} aria-invalid={e ? true : undefined} onChange={(ev) => form.edit(f, ev.target.value)} onBlur={() => form.blur(f)} />
          <span aria-hidden>{unit}</span>
        </div>
        {e && <div className="field-error" role="alert">{e}</div>}
        {helper && <small className="helper">{helper}</small>}
      </label>
    );
  };
  const useActual = (f: 'netIncome' | 'bookEquity') => ref && form.edit(f, amountText(f === 'netIncome' ? ref.netIncomeEok : ref.bookEquityEok));

  return (
    <section className="panel" aria-label="Relative Valuation">
      <div className="panel-head"><h3>C. Relative Valuation</h3><span className="small muted">PER · PBR · EV / EBITDA</span></div>
      <p className="hint">멀티플과 이익 지표는 직접 입력합니다(Peer 자동 선정 없음). 세 방법은 각각 독립적이며 입력한 방법만 계산됩니다. Net Debt 와 주식 수는 DCF 단계의 입력을 그대로 씁니다.</p>

      <div className="relative-groups">
        {RELATIVE_GROUPS.map((g) => (
          <div key={g.method} className="relative-group">
            <h4>{g.method}</h4>
            {input(g.metric, g.metricLabel, '억원', g.metricHelper)}
            {input(g.multiple, g.multipleLabel, '배')}
            <p className="small muted formula">{g.formula}</p>
            {ref && (g.metric === 'netIncome' || g.metric === 'bookEquity') && (
              <button className="btn small" type="button" onClick={() => useActual(g.metric as 'netIncome' | 'bookEquity')}>최근 Actual 사용 ({ref.period})</button>
            )}
            {g.metric === 'ebitda' && <p className="small muted">Historical 데이터에 감가상각비가 없어 EBITDA 참고값은 제공하지 않습니다. 직접 입력하세요.</p>}
          </div>
        ))}
      </div>
      {scaleMismatch && <p className="hint">참고: 최근 Actual 값은 삼성전자 기준이고, 현재 가정은 STEP 04 학습용 가정(가상 기업, 매출 1,500억원 규모)이라 규모가 크게 다릅니다. 같은 기업 기준의 값으로 입력하세요.</p>}

      <h4 className="results-title">방법별 결과</h4>
      <div className="table-wrap">
        <table className="fin-table relative-table">
          <thead>
            <tr><th>방법</th><th className="num">Enterprise Value (억원)</th><th className="num">Equity Value (억원)</th><th className="num">Per Share Value (원)</th><th>상태</th></tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.method} className={r.method === 'DCF' ? 'total' : undefined}>
                <th>{r.method}</th>
                <td className="num">{fmtNum(r.enterpriseValue, 2)}{r.evDerived && r.enterpriseValue !== null && <span className="muted" title="Equity Value 에 Net Debt 를 더해 환산한 참고값"> ※</span>}</td>
                <td className="num">{fmtNum(r.equityValue, 2)}</td>
                <td className="num">{fmtNum(r.perShareValue, 0)}</td>
                <td className="small">{r.method === 'DCF' ? <StatusBadge label="CALCULATED" /> : r.status === 'ok' ? <StatusBadge label="CALCULATED" /> : r.status === 'incomplete' ? <span className="muted">입력 필요</span> : <span className="neg">{r.message}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">※ PER / PBR 은 Equity Value 가 직접 나오고, Enterprise Value 는 Net Debt 를 더해 환산한 참고값입니다. EV / EBITDA 는 Enterprise Value 가 직접 나오고 Net Debt 를 빼 Equity Value 로 환산합니다.</p>
      {view.rows.filter((r) => r.method !== 'DCF' && r.status === 'ok' && r.message).map((r) => <p key={r.method} className="hint">{r.method}: {r.message}</p>)}
    </section>
  );
}
