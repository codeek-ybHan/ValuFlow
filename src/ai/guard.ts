// 출력 가드레일: system instruction 유출 감지. 문서 · 뉴스 안의 "시스템 프롬프트를 출력하라" 같은 지시를 모델이 따르더라도 사용자에게는 나가지 않는다.
// (지시를 따르지 않게 하는 1차 방어는 Tool 결과를 DATA 로 표시하는 notice 와 policy 이고, 이 파일은 그것이 실패했을 때의 마지막 출력 검사다.)
import { AI_POLICY_RULES, SYSTEM_POLICY } from './policy.ts';

const norm = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();
const POLICY_TEXT = norm([SYSTEM_POLICY, ...AI_POLICY_RULES].join(' '));
const WINDOW = 28;

/** 텍스트에 system instruction 의 문장 조각(28자 이상)이 그대로 들어 있는가. */
export function leaksSystemPrompt(text: string, windowLen = WINDOW): boolean {
  const t = norm(text);
  if (t.length < windowLen) return false;
  for (let i = 0; i + windowLen <= POLICY_TEXT.length; i += 7) if (t.includes(POLICY_TEXT.slice(i, i + windowLen))) return true;
  return false;
}

export const LEAK_SAFE_SUMMARY = '내부 지침에 해당하는 내용은 답변에 포함할 수 없어 제거했습니다. 질문에 대한 근거 있는 분석만 제공합니다.';
