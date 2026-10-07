import { NavLink, useLocation } from 'react-router-dom';
import type { Step } from '../types';
import { stepPath } from '../routes';

export function StepTabs({ step }: { step: Step }) {
  const b = stepPath(step.id);
  // Lessons 탭은 어떤 Lesson 을 보고 있어도 활성으로 표시한다.
  const inLessons = useLocation().pathname.startsWith(`${b}/lesson/`);
  return (
    <nav className="steptabs" aria-label={`${step.code} 구성`}>
      <NavLink to={b} end>Overview</NavLink>
      <NavLink to={`${b}/lesson/${step.lessons[0].id}`} className={inLessons ? 'active' : ''}>Lessons</NavLink>
      {step.quiz && <NavLink to={`${b}/quiz`}>Check Quiz</NavLink>}
      <NavLink to={`${b}/practice`}>Practice Mission</NavLink>
      <NavLink to={`${b}/build`}>Project Build</NavLink>
      <NavLink to={`${b}/reflection`}>Reflection</NavLink>
    </nav>
  );
}
