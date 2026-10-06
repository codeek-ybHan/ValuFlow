import { Link } from 'react-router-dom';
import { steps, BRAND } from '../content';
import { useApp } from '../store/state';
import { stepProgress } from '../store/progress';
import { PageHeader, StatusBadge } from '../components/ui';

const FLOW = ['Problem', 'Manual Workflow', 'Observed Inefficiency', 'Automation Idea', 'Implementation', 'Validation', 'Result'];
const PRACTICE_NAMES = ['Financial Statement Reading', '3-Year Financial Analysis', 'Manual DCF', 'Valuation & Sensitivity', 'Python Validation', 'DART Pipeline Validation', 'Agent Evaluation', 'Final Case Study'];

export function ProjectReport() {
  const { state, reset } = useApp();
  return (
    <>
      <PageHeader eyebrow="Project Report" title="업무를 이해한 뒤 자동화한다">
        <blockquote>가치평가 업무를 먼저 직접 학습·수행한 뒤, 반복적인 데이터 수집·계산·분석 과정을 단계적으로 자동화하고 AI Agent를 결합하여 업무지원 시스템으로 발전시켰다.</blockquote>
        <p className="muted">{BRAND.name} — {BRAND.tagline}</p>
      </PageHeader>

      <div className="flow">{FLOW.map((f, i) => <span key={f}>{f}{i < FLOW.length - 1 && <i aria-hidden> → </i>}</span>)}</div>
      <p className="small muted">아래 내용은 각 STEP 의 기록과 Practice 저장 결과에서 자동으로 모입니다. 아직 수행하지 않은 항목은 비어 있는 상태로 표시하며, 결과를 임의로 채우지 않습니다.</p>

      {steps.map((s, i) => {
        const prog = stepProgress(s, state);
        const pr = state.practice[s.id];
        const filled = pr ? Object.entries(pr.values).filter(([, v]) => v.trim()) : [];
        const answers = filled.filter(([k]) => k.startsWith('q:'));
        const hasBuild = state.build[s.id]?.completed;
        return (
          <section key={s.id} className="report-step">
            <div className="row between">
              <h2>{s.code} · {PRACTICE_NAMES[i]}</h2>
              <StatusBadge label={prog.status} />
            </div>
            <dl className="evo-dl">
              <dt>Manual — 직접 한 것</dt><dd>{s.evolution.manual}</dd>
              <dt>Observed Inefficiency — 발견한 문제</dt><dd>{s.evolution.problem}</dd>
              <dt>Automation — 자동화</dt><dd>{s.evolution.automated} {hasBuild ? <em>(Build 완료)</em> : <em className="muted">(Build 미완료)</em>}</dd>
            </dl>
            <h4>Practice 기록</h4>
            {filled.length === 0 ? (
              <p className="muted">아직 저장된 Practice 결과가 없습니다. <Link to={`/learn/step/${s.id}/practice`}>Practice 로 이동</Link></p>
            ) : (
              <>
                <p className="small muted">{filled.length}개 항목 입력{pr?.completed ? ' · 완료' : ' · 진행 중'}</p>
                {answers.slice(0, 3).map(([k, v]) => {
                  const q = s.practice.questions.find((x) => `q:${x.id}` === k);
                  return <div key={k} className="answer-excerpt"><strong>{q?.prompt}</strong><p>{v.length > 220 ? `${v.slice(0, 220)}…` : v}</p></div>;
                })}
              </>
            )}
            {state.reflection[s.id]?.completed && <p className="small">Reflection 작성 완료</p>}
          </section>
        );
      })}

      <section className="danger-zone">
        <h3>데이터 관리</h3>
        <p className="small muted">모든 학습 기록은 이 브라우저(localStorage)에만 저장됩니다. 초기화하면 메모·Practice·데이터셋이 삭제되고 초기 상태(STEP 01 진행 중)로 돌아갑니다.</p>
        <button className="btn" onClick={() => { if (window.confirm('모든 학습 기록을 초기화할까요? 되돌릴 수 없습니다.')) reset(); }}>학습 기록 초기화</button>
      </section>
    </>
  );
}
