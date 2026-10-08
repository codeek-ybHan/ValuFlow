import { Navigate, useParams } from 'react-router-dom';
import { NoCompanyState, PageHeader } from '../components/ui';
import { ValuationStepper } from '../components/valuation/ValuationStepper';
import { ValuationControls } from '../components/valuation/ValuationControls';
import { HistoricalStage } from '../components/valuation/HistoricalStage';
import { ForecastStage } from '../components/valuation/ForecastStage';
import { WaccStage } from '../components/valuation/WaccStage';
import { DcfStage } from '../components/valuation/DcfStage';
import { ResultStage } from '../components/valuation/ResultStage';
import { ValidationStage } from '../components/valuation/ValidationStage';
import { DEFAULT_STAGE, STAGE_BASIS, historicalStageBasis, stageIndex, stages, type StageId } from '../components/valuation/workflow';
import { useProject } from '../store/project';

export function Valuation() {
  const { project } = useProject();
  const { stage } = useParams();
  if (stage && stageIndex(stage) < 0) return <Navigate to="/valuation" replace />;
  if (!project.selectedCompany) return <><PageHeader title="Valuation" /><NoCompanyState /></>;   // 기업 선택 전에는 Historical · 가정 · 결과 · Sensitivity 가 보이지 않는다
  const id = (stage ?? DEFAULT_STAGE) as StageId;
  const cur = stages[stageIndex(id)];
  return (
    <>
      <PageHeader title="Valuation" />
      <ValuationControls />
      <ValuationStepper current={id} />
      <h2 className="stage-title">{cur.no}. {cur.label}<span className="source-tag stage-basis" title="이 단계 입력의 출처">{id === 'historical' ? historicalStageBasis(project.historicalProvenance) : STAGE_BASIS[id]}</span></h2>
      {id === 'historical' ? <HistoricalStage /> : id === 'forecast' ? <ForecastStage /> : id === 'wacc' ? <WaccStage /> : id === 'dcf' ? <DcfStage /> : id === 'result' ? <ResultStage /> : <ValidationStage />}
    </>
  );
}
