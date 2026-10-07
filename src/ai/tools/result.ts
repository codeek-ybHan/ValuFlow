// Tool 결과의 공통 형태. AI 가 다시 계산할 필요가 없도록 구조화된 값 + 출처 / 기준 / 품질 / 경고를 함께 담는다.
// 값이 없으면 null / Missing 으로 명시한다 (AI 가 채워 넣지 않는다).

/** 값이 없음을 명시한다. value 는 항상 null 이다. */
export interface Missing {
  status: 'missing';
  value: null;
  reason: string;
}

export const missing = (reason: string): Missing => ({ status: 'missing', value: null, reason });

export type SourceKind = 'actual' | 'assumption' | 'calculated';

export interface SourceInfo {
  /** actual: 공시 기반 실적 · assumption: 사용자 / 학습용 가정 · calculated: 엔진 계산 결과 */
  kind: SourceKind;
  /** database | opendart | fixture | user-input | learning-fixture | valuation-engine | historical-analysis */
  origin: string;
  basis: string | null;
  fetchedAt: string | null;
  persisted: boolean | null;
  note: string | null;
}

export interface ToolWarning {
  code: string;
  text: string;
  /** review: 검토가 필요한 경고(답변에 반드시 언급) · note: 참고 */
  level: 'review' | 'note';
}

export type ToolResult<T> =
  | { status: 'ok'; tool: string; data: T; sources: SourceInfo[]; warnings: ToolWarning[] }
  | { status: 'unsupported'; tool: string; reason: string; message: string; sources: SourceInfo[]; warnings: ToolWarning[] }
  | { status: 'unavailable'; tool: string; reason: string; sources: SourceInfo[]; warnings: ToolWarning[] }
  | { status: 'invalid-input'; tool: string; reason: string; sources: SourceInfo[]; warnings: ToolWarning[] };

export const ok = <T,>(tool: string, data: T, sources: SourceInfo[], warnings: ToolWarning[] = []): ToolResult<T> => ({ status: 'ok', tool, data, sources, warnings });
export const unavailable = (tool: string, reason: string, sources: SourceInfo[] = []): ToolResult<never> => ({ status: 'unavailable', tool, reason, sources, warnings: [] });

/** 질문 범위에 해당하는 경고 모음. 중복 문구는 하나로 합친다. */
export function dedupeWarnings(list: ToolWarning[]): ToolWarning[] {
  const seen = new Set<string>();
  return list.filter((w) => (seen.has(`${w.code}|${w.text}`) ? false : (seen.add(`${w.code}|${w.text}`), true)));
}
