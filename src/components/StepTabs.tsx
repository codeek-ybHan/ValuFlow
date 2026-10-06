import { NavLink } from 'react-router-dom';
import { stepPath } from '../routes';
import type { Step } from '../types';

export function StepTabs({ step }: { step: Step }) {
  const b = `${stepPath(step.id)}`;
  return (
    <nav className="steptabs" aria-label={`${step.code} 구성`}>
      <NavLink to={b} end>Overview</NavLink>
      <NavLink to={`${b}/lesson/${step.lessons[0].id}`} className={({ isActive }) => (isActive ? 'active' : '')}>Lessons</NavLink>
      {step.quiz && <NavLink to={`${b}/quiz`}>Check Quiz</NavLink>}
      <NavLink to={`${b}/practice`}>Practice Mission</NavLink>
      <NavLink to={`${b}/build`}>Project Build</NavLink>
      <NavLink to={`${b}/reflection`}>Reflection</NavLink>
    </nav>
  );
}
