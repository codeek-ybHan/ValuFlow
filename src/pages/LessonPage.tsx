import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getStep } from '../content';
import { emptyNotes, useApp } from '../store/state';
import { lessonKey } from '../store/progress';
import { Rich } from '../components/Rich';
import { PageHeader, BackLink } from '../components/ui';
import { StepTabs } from '../components/StepTabs';
import { NotFound } from './NotFound';
import type { LessonNotes } from '../types';

const NOTE_FIELDS: { key: keyof LessonNotes; label: string }[] = [
  { key: 'understood', label: '내가 이해한 내용' },
  { key: 'confusing', label: '헷갈리는 내용' },
  { key: 'formula', label: '중요 공식' },
  { key: 'practice', label: '실무 연결' },
  { key: 'interview', label: '면접에서 설명한다면?' },
];

export function LessonPage() {
  const { stepId, lessonId } = useParams();
  const step = getStep(Number(stepId));
  const { state, update } = useApp();
  const [shown, setShown] = useState<Record<number, boolean>>({});
  if (!step) return <NotFound />;
  const idx = step.lessons.findIndex((l) => l.id === lessonId);
  if (idx < 0) return <NotFound />;
  const lesson = step.lessons[idx];
  const key = lessonKey(step.id, lesson.id);
  const done = !!state.lessons[key];
  const notes = state.notes[key] ?? emptyNotes;
  const prev = step.lessons[idx - 1];
  const next = step.lessons[idx + 1];
  const b = lesson.body;

  const setNote = (k: keyof LessonNotes, v: string) =>
    update((s) => ({ ...s, notes: { ...s.notes, [key]: { ...(s.notes[key] ?? emptyNotes), [k]: v } } }));
  const toggleDone = () => update((s) => ({ ...s, lessons: { ...s.lessons, [key]: !done } }));

  const sections: [string, React.ReactNode][] = b
    ? [
        ['1. 개념', <Rich blocks={b.concept} />],
        ['2. 직관적인 설명', <Rich blocks={b.intuition} />],
        ['3. 숫자 예시', <Rich blocks={b.example} />],
        ['4. 재무제표 · 가치평가와의 연결', <Rich blocks={b.link} />],
        ['5. 실무에서는 왜 중요한가?', <Rich blocks={b.why} />],
      ]
    : [];

  return (
    <>
      <BackLink to={`/step/${step.id}`}>{step.code} {step.title}</BackLink>
      <PageHeader eyebrow={`${step.code} · LESSON ${String(idx + 1).padStart(2, '0')}`} title={lesson.title}>
        <p className="muted">{lesson.summary}</p>
      </PageHeader>
      <StepTabs step={step} />
      <div className="lesson-layout">
        <aside className="lesson-nav" aria-label="Lesson 목록">
          {step.lessons.map((l, i) => (
            <Link key={l.id} to={`/step/${step.id}/lesson/${l.id}`} className={l.id === lesson.id ? 'active' : ''}>
              <span className="num">{String(i + 1).padStart(2, '0')}</span> {l.title}
              {state.lessons[lessonKey(step.id, l.id)] && <span className="tick" aria-label="완료"> ✓</span>}
            </Link>
          ))}
        </aside>
        <article className="lesson">
          {b ? (
            <>
              {sections.map(([title, node]) => (
                <section key={title}><h2>{title}</h2>{node}</section>
              ))}
              <section>
                <h2>6. Mini Check</h2>
                {b.miniCheck.map((m, i) => (
                  <div key={i} className="minicheck">
                    <p><strong>Q.</strong> {m.q}</p>
                    {shown[i] ? <p className="answer"><strong>A.</strong> {m.a}</p> : <button className="btn small" onClick={() => setShown((x) => ({ ...x, [i]: true }))}>답 확인 (먼저 생각해보세요)</button>}
                  </div>
                ))}
              </section>
            </>
          ) : (
            <>
              <section>
                <h2>학습 개요</h2>
                {lesson.outline && <Rich blocks={lesson.outline} />}
              </section>
              <div className="callout">이 Lesson 의 상세 해설(개념·직관·숫자 예시·가치평가 연결·실무 중요성·Mini Check)은 아직 작성되지 않았습니다. 위 개요는 기획서의 학습 범위이며, {step.code} 진행 시 콘텐츠가 추가됩니다.</div>
            </>
          )}

          <section className="notes">
            <h2>학습 기록</h2>
            {NOTE_FIELDS.map((f) => (
              <label key={f.key} className="field">
                <span>{f.label}</span>
                <textarea rows={3} value={notes[f.key]} onChange={(e) => setNote(f.key, e.target.value)} />
              </label>
            ))}
          </section>

          <div className="row between lesson-actions">
            <div>{prev && <Link className="btn" to={`/step/${step.id}/lesson/${prev.id}`}>← {prev.title}</Link>}</div>
            <button className={`btn ${done ? '' : 'primary'}`} onClick={toggleDone}>{done ? '완료 취소' : 'Lesson 완료'}</button>
            <div>
              {next ? <Link className="btn" to={`/step/${step.id}/lesson/${next.id}`}>{next.title} →</Link> : <Link className="btn" to={step.quiz ? `/step/${step.id}/quiz` : `/step/${step.id}/practice`}>{step.quiz ? 'Check Quiz →' : 'Practice →'}</Link>}
            </div>
          </div>
        </article>
      </div>
    </>
  );
}
