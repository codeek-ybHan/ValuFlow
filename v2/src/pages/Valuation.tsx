import { Navigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import { ValuationStepper } from '../components/valuation/ValuationStepper';
import { StageSlot } from '../components/valuation/StageSlot';
import { DEFAULT_STAGE, stageIndex, stages, type StageId } from '../valuation/workflow';

export function Valuation() {
  const { stage } = useParams();
  if (stage && stageIndex(stage) < 0) return <Navigate to="/valuation" replace />;
  const id = (stage ?? DEFAULT_STAGE) as StageId;
  const cur = stages[stageIndex(id)];
  return (
    <>
      <PageHeader eyebrow="Valuation" title={`${cur.no}. ${cur.label}`}>
        <p className="small muted">Unit: KRW · Billion (단위는 계산 화면 연결 시 입력 기준에 맞춰 표시)</p>
      </PageHeader>
      <ValuationStepper current={id} />
      <StageSlot stage={cur} />
    </>
  );
}
