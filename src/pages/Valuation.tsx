import { Navigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import { ValuationStepper } from '../components/valuation/ValuationStepper';
import { ValuationControls } from '../components/valuation/ValuationControls';
import { HistoricalStage } from '../components/valuation/HistoricalStage';
import { ForecastStage } from '../components/valuation/ForecastStage';
import { WaccStage } from '../components/valuation/WaccStage';
import { DcfStage } from '../components/valuation/DcfStage';
import { ResultStage } from '../components/valuation/ResultStage';
import { ValidationStage } from '../components/valuation/ValidationStage';
import { DEFAULT_STAGE, STAGE_BASIS, stageIndex, stages, type StageId } from '../components/valuation/workflow';

export function Valuation() {
  const { stage } = useParams();
  if (stage && stageIndex(stage) < 0) return <Navigate to="/valuation" replace />;
  const id = (stage ?? DEFAULT_STAGE) as StageId;
  const cur = stages[stageIndex(id)];
  return (
    <>
      <PageHeader eyebrow="Valuation" title="Valuation Workspace">
        <p className="lead">금액 단위는 억원, 비율은 소수로 계산하며 화면에서만 반올림해 표시합니다.</p>
      </PageHeader>
      <ValuationControls />
      <ValuationStepper current={id} />
      <h2 className="stage-title">{cur.no}. {cur.label}<span className="source-tag stage-basis" title="이 단계 입력의 출처">{STAGE_BASIS[id]}</span></h2>
      {id === 'historical' ? <HistoricalStage /> : id === 'forecast' ? <ForecastStage /> : id === 'wacc' ? <WaccStage /> : id === 'dcf' ? <DcfStage /> : id === 'result' ? <ResultStage /> : <ValidationStage />}
    </>
  );
}
