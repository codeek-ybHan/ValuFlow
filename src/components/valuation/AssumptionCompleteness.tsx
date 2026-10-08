import { assumptionCompleteness, type AssumptionsDraft } from '../../store/assumptions';
import { StatusBadge } from '../ui';

const LABEL = { forecast: 'Forecast', wacc: 'WACC', dcf: 'DCF/Equity' } as const;
const FIELD_LABEL: Record<string, string> = {
  currentRevenue: 'Current Revenue', revenueGrowth: 'Revenue Growth', operatingMargin: 'Operating Margin', taxRate: 'Tax Rate',
  depreciation: 'D&A', capex: 'CAPEX', deltaNwc: 'ΔNWC',
  riskFreeRate: 'Risk-free Rate', beta: 'Beta', marketRiskPremium: 'MRP', preTaxCostOfDebt: 'Pre-tax Cost of Debt', equityMarketValue: 'Equity Market Value', debtMarketValue: 'Debt Market Value',
  terminalGrowth: 'Terminal Growth', interestBearingDebt: '이자부부채', cash: '현금', sharesOutstanding: '주식 수',
};

/** 가정 완성도: 섹션별 READY / INCOMPLETE, 전체 Valuation READY / NOT READY, 그리고 Run Valuation 에 필요한 입력 안내. */
export function AssumptionCompleteness({ assumptions }: { assumptions: AssumptionsDraft | null }) {
  const c = assumptionCompleteness(assumptions);
  const sections = ['forecast', 'wacc', 'dcf'] as const;
  const open = sections.filter((s) => c[s] === 'INCOMPLETE');
  if (c.complete) {
    // 모두 준비되면 항목별 상태를 반복하지 않고 한 줄로 접는다.
    return (
      <div className="completeness" aria-label="가정 완성도">
        <span className="completeness-item"><StatusBadge label="READY" /><span className="small muted">Forecast · WACC · DCF/Equity 가정이 모두 준비되었습니다.</span></span>
      </div>
    );
  }
  return (
    <div className="completeness" aria-label="가정 완성도">
      <div className="completeness-row">
        {sections.map((s) => (
          <span key={s} className="completeness-item"><span className="small muted">{LABEL[s]}</span><StatusBadge label={c[s]} /></span>
        ))}
        <span className="completeness-item"><span className="small muted">Valuation</span><StatusBadge label={c.complete ? 'READY' : 'NOT READY'} /></span>
      </div>
      {!c.complete && (
        <p className="hint">
          Run Valuation 에 필요한 입력: {open.map((s) => `${LABEL[s]} (${c.missing[s].map((k) => FIELD_LABEL[k] ?? k).join(', ')})`).join(' · ')}
          {c.dcf === 'INCOMPLETE' && ''}
        </p>
      )}
    </div>
  );
}
