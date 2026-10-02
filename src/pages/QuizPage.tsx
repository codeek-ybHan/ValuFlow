import { useParams } from 'react-router-dom';
import { getStep } from '../content';
import { useApp, type QuizState } from '../store/state';
import { PageHeader, BackLink, StatusBadge } from '../components/ui';
import { StepTabs } from '../components/StepTabs';
import { NotFound } from './NotFound';
import type { QuizQuestion } from '../types';

const blank: QuizState = { answers: {}, submitted: false, completed: false };

/** 객관식·숫자형은 자동 채점, 서술형(reflect)은 직접 작성 후 모범답안과 비교(자기평가). */
function grade(q: QuizQuestion, a: string | undefined): boolean | null {
  if (q.type === 'choice') return a === undefined || a === '' ? false : Number(a) === q.answer;
  if (q.type === 'numeric') {
    const n = Number((a ?? '').replace(/,/g, ''));
    return a !== undefined && a.trim() !== '' && Number.isFinite(n) && Math.abs(n - q.answer) <= Math.max(q.tolerance, Math.abs(q.answer) * 0.0001);
  }
  return null;
}

export function QuizPage() {
  const { stepId } = useParams();
  const step = getStep(Number(stepId));
  const { state, update } = useApp();
  if (!step) return <NotFound />;
  if (!step.quiz) return <NotFound />;
  const quiz = step.quiz;
  const qs = state.quiz[step.id] ?? blank;
  const set = (patch: Partial<QuizState>) => update((s) => ({ ...s, quiz: { ...s.quiz, [step.id]: { ...(s.quiz[step.id] ?? blank), ...patch } } }));
  const setAnswer = (id: string, v: string) => set({ answers: { ...qs.answers, [id]: v }, submitted: false });

  // 초기(seeded) 완료 상태에서는 채점·모범답안을 보여주지 않는다.
  const shown = qs.submitted && !qs.seeded;
  const gradable = quiz.filter((q) => q.type !== 'reflect');
  const submit = () => {
    const correct = gradable.filter((q) => grade(q, qs.answers[q.id])).length;
    set({ submitted: true, correct, total: gradable.length, seeded: false });
  };
  const reflectsFilled = quiz.filter((q) => q.type === 'reflect').every((q) => (qs.answers[q.id] ?? '').trim());

  return (
    <>
      <BackLink to={`/step/${step.id}`}>{step.code} {step.title}</BackLink>
      <PageHeader eyebrow={step.code} title="Check Quiz">
        <p className="muted">숫자 해석과 이유 설명 중심입니다. 서술형은 먼저 직접 답을 쓰고 제출한 뒤 모범답안과 비교하세요.</p>
      </PageHeader>
      <StepTabs step={step} />
      {qs.seeded && <div className="callout">초기 상태: 기획서 기준으로 이 퀴즈는 이미 완료된 것으로 표시되어 있습니다(답안 기록 없음). 다시 풀어 기록을 남길 수 있습니다.</div>}

      {quiz.map((q, i) => {
        const a = qs.answers[q.id] ?? '';
        const g = shown ? grade(q, a) : null;
        return (
          <section key={q.id} className="quiz-card">
            <div className="row between">
              <h3><span className="num">Q{i + 1}.</span> {q.prompt}</h3>
              {shown && g !== null && <StatusBadge label={g ? 'COMPLETE' : 'NOT STARTED'} />}
            </div>
            {q.type === 'choice' && (
              <div className="options">
                {q.options.map((o, oi) => (
                  <label key={oi} className={`option ${shown && oi === q.answer ? 'right' : ''}`}>
                    <input type="radio" name={q.id} checked={a === String(oi)} onChange={() => setAnswer(q.id, String(oi))} /> {o}
                  </label>
                ))}
              </div>
            )}
            {q.type === 'numeric' && (
              <label className="inline-field">
                <input inputMode="decimal" value={a} onChange={(e) => setAnswer(q.id, e.target.value)} placeholder="숫자" /> {q.unit}
              </label>
            )}
            {q.type === 'reflect' && <textarea rows={4} value={a} onChange={(e) => setAnswer(q.id, e.target.value)} placeholder="자신의 말로 설명해보세요" />}

            {shown && (q.type === 'reflect' ? (
              <div className="answer"><strong>모범답안</strong><p>{q.modelAnswer}</p></div>
            ) : (
              <div className={`answer ${g ? 'ok' : 'bad'}`}><strong>{g ? '정답' : '오답'}</strong><p>{q.explain}</p></div>
            ))}
          </section>
        );
      })}

      <div className="row between sticky-actions">
        <div className="small">
          {shown && qs.total != null && <span className="num">자동채점 {qs.correct} / {qs.total}</span>}
        </div>
        <div className="row">
          <button className="btn" onClick={submit}>제출 / 채점</button>
          <button className={`btn ${qs.completed ? '' : 'primary'}`} disabled={!qs.completed && !(qs.submitted && reflectsFilled)} onClick={() => set({ completed: !qs.completed, seeded: false })}>
            {qs.completed ? '완료 취소' : 'Quiz 완료'}
          </button>
        </div>
      </div>
      {!qs.completed && <p className="small muted">완료 처리하려면 모든 서술형에 답을 쓰고 제출해야 합니다.</p>}
    </>
  );
}
