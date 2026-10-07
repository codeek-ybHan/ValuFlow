// STEP 08-5 Agent Workflow 의 타입. Agent 는 autonomous agent 가 아니라 분석 업무를 계획 · 실행 · 관찰하고 사람의 판단이 필요하면 멈추는 Analyst-support Agent 다.
import type { CapabilityId } from '../capabilities.ts';
import type { ToolName } from '../tools/definitions.ts';
import type { AiAnalystAnswer, AnswerViolation } from '../answer.ts';
import type { ToolResult } from '../tools/result.ts';

export type WorkflowType =
  | 'historical-review' | 'forecast-review' | 'wacc-review' | 'dcf-review' | 'sensitivity-scenario-review'
  | 'comparable-review' | 'event-review' | 'full-valuation-review';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface WorkflowStep {
  id: string;
  capability: CapabilityId;
  tool: ToolName;
  /** 이 단계가 무엇을 확인하는가 (사용자에게 보여 줄 수 있는 설명) */
  purpose: string;
  /** true 이면 질문 · 관찰에 따라 생략할 수 있다 (예: 공시 검색은 변화의 원인이 필요할 때만) */
  optional: boolean;
  status: StepStatus;
  /** skipped / failed 사유 */
  reason?: string;
  /** 계획에 없던 단계(관찰에 따라 모델이 추가로 호출한 Tool) */
  dynamic?: boolean;
}

export type WorkflowStatus = 'planned' | 'running' | 'waiting-for-user' | 'completed' | 'failed' | 'tool-limit';

export interface WorkflowPlan {
  workflowType: WorkflowType;
  label: string;
  steps: WorkflowStep[];
  /** 이 workflow 의 Tool 호출 한도 (일반 질문 5회보다 크다) */
  maxToolCalls: number;
  /** 실행할 수 없는 이유 (unsupported 기업 · 필요한 데이터 없음) */
  blocked: null | { code: 'unsupported' | 'no-data'; reason: string };
  /** classifyQuestion 의 capability (routing hint, 기록용) */
  routingHints: CapabilityId[];
}

/** Tool 결과를 다음 단계 판단에 쓰기 위해 요약한 구조. 원문 · 문서 chunk · Raw 행은 담지 않는다. */
export interface Observation {
  tool: string;
  status: string;
  findings: string[];
  missing: string[];
  warnings: string[];
  sourceTypes: string[];
  /** 관찰에 따라 다음에 필요할 수 있는 Tool (예: 품질 경고 → getMappingTrace) */
  nextHints: { tool: ToolName; reason: string }[];
}

export type CheckpointKind = 'change-wacc' | 'change-forecast-assumption' | 'apply-peer-multiple' | 'save-scenario';

/** 사람의 판단이 필요한 변경 제안. 승인 전에는 아무것도 바뀌지 않으며, 이 단계에는 실제 write Tool 이 없다. */
export interface HumanCheckpoint {
  id: string;
  kind: CheckpointKind;
  target: string;
  currentValue: string | null;
  proposedValue: string | null;
  rationale: string;
  status: 'pending' | 'approved' | 'rejected';
  /** 항상 false: Agent 는 변경을 적용하지 않는다 (승인되어도 분석가가 ValuFlow 에서 직접 입력한다). */
  applied: false;
}

export interface EvidenceClaim {
  claim: string;
  /** 이 주장을 뒷받침하는, 실제로 성공 실행된 Tool */
  tools: string[];
}

export interface WorkflowState {
  workflowId: string;
  workflowType: WorkflowType;
  question: string;
  company: { name: string; corpCode: string | null } | null;
  /** 이 workflow 가 시작할 때의 context snapshot 식별자 (같은 snapshot 을 끝까지 쓴다) */
  contextSnapshotId: string;
  steps: WorkflowStep[];
  currentStep: string | null;
  toolsExecuted: { tool: string; status: string }[];
  observations: Observation[];
  warnings: string[];
  sources: string[];
  checkpoints: HumanCheckpoint[];
  status: WorkflowStatus;
  message: string | null;
}

/** workflow 최종 답변: 기본 AiAnalystAnswer + 검토 범위 · 한계 · 판단 대상 · claim → Tool 증거 연결 · 변경 제안. 내부 추론(chain-of-thought)은 담지 않는다. */
export interface WorkflowAnswer extends AiAnalystAnswer {
  reviewedAreas: string[];
  limitations: string[];
  judgmentItems: string[];
  claims: EvidenceClaim[];
  proposedActions: { type: CheckpointKind; target: string; currentValue: string | null; proposedValue: string | null; rationale: string }[];
}

/** 저장하지 않는 것: API Key · Tool 결과 본문 · 문서 chunk · Raw 재무. 이름 · 개수 · 상태 · 출처 종류만 남긴다. */
export interface WorkflowAuditEvent {
  timestamp: string;
  workflowId: string;
  workflowType: WorkflowType;
  question: string;
  conversationId: string | null;
  contextSnapshotId: string;
  stepsPlanned: string[];
  stepsExecuted: string[];
  toolsExecuted: { tool: string; status: string }[];
  sourcesUsed: string[];
  warnings: string[];
  humanCheckpoint: { count: number; kinds: CheckpointKind[]; pending: number };
  status: WorkflowStatus;
  durationMs: number;
  violations: AnswerViolation['code'][];
  corrections: string[];
}

export interface WorkflowOutcome {
  state: WorkflowState;
  plan: WorkflowPlan;
  answer: WorkflowAnswer | null;
  results: ToolResult<unknown>[];
  violations: AnswerViolation[];
  corrections: string[];
  audit: WorkflowAuditEvent;
  error: { code: string; message: string } | null;
}
