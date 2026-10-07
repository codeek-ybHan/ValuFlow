// AI Valuation Analyst 공개 진입점 (STEP 08-1: 아키텍처). LLM 호출은 없다.
// 이 폴더는 valuation 내부 파일을 import 하지 않는다: 공개 API(valuation/index.ts)와 engine / store 의 모델만 사용한다.
export { buildAiContext } from './context.ts';
export type { AiValuationContext, AiContextOptions, CompanySupport, AiCompany } from './context.ts';
export { CAPABILITIES, classifyQuestion } from './capabilities.ts';
export type { Capability, CapabilityId, AnswerMode, QuestionClassification } from './capabilities.ts';
export { TOOL_CATALOG, TOOL_NAMES, TOOL_RESULT_ENVELOPE, getToolDefinition } from './tools/definitions.ts';
export type { AiToolDefinition, ToolName, JsonSchema } from './tools/definitions.ts';
export { executeTool, validateToolInput } from './tools/registry.ts';
export { getCompanyOverview, getHistoricalAnalysis } from './tools/historical.ts';
export { getHistoricalQuality, getMappingTrace } from './tools/quality.ts';
export { getForecastAssumptions, getValuationResult, getSensitivityAnalysis, getScenarioAnalysis, getRelativeValuation } from './tools/modelTools.ts';
export { missing } from './tools/result.ts';
export type { Missing, ToolResult, ToolWarning, SourceInfo } from './tools/result.ts';
export { auditAnswer, enforceGrounding } from './answer.ts';
export type { GroundingOutcome } from './answer.ts';
export type { AiAnalystAnswer, AnswerEvidence, AnswerViolation } from './answer.ts';
export { SYSTEM_POLICY, AI_POLICY_RULES, UNSUPPORTED_DISCLOSURE, buildSystemInstruction } from './policy.ts';
export { createAuditEvent } from './audit.ts';
export type { AiAuditEvent, AiQueryAuditEvent, AiFinalStatus } from './audit.ts';
export { BackendAiClient, AiClientError } from './client.ts';
export type { AiGatewayClient, AiQueryRequest, AiToolResultRequest, GatewayResponse, ToolCallResponse, FinalResponse, ToolLimitResponse } from './client.ts';
export { runAiQuery, MAX_CLIENT_ROUNDS } from './query.ts';
export type { AiQueryOutcome, RunAiQueryOptions } from './query.ts';
export { buildMinimalContext } from './minimalContext.ts';
export { TOOL_CALLING_INSTRUCTIONS } from './policy.ts';
