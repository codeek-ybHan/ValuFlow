// Tool 실행기. 이름으로 Tool 을 찾아 입력을 검증하고, 지원하지 않는 기업이면 호출을 제한한다.
// 실제 LLM Tool Calling(STEP 08-2)은 이 실행기를 그대로 호출하면 된다.
import type { AiValuationContext } from '../context.ts';
import { getToolDefinition, type JsonSchema, type ToolName } from './definitions.ts';
import { getCompanyOverview, getHistoricalAnalysis } from './historical.ts';
import { getHistoricalQuality, getMappingTrace } from './quality.ts';
import { getForecastAssumptions, getRelativeValuation, getScenarioAnalysis, getSensitivityAnalysis, getValuationResult } from './modelTools.ts';
import type { ToolResult } from './result.ts';

type Impl = (ctx: AiValuationContext, input?: never) => ToolResult<unknown>;
const IMPLS: Record<ToolName, Impl> = {
  getCompanyOverview: getCompanyOverview as Impl,
  getHistoricalAnalysis: getHistoricalAnalysis as Impl,
  getHistoricalQuality: getHistoricalQuality as Impl,
  getMappingTrace: getMappingTrace as Impl,
  getForecastAssumptions: getForecastAssumptions as Impl,
  getValuationResult: getValuationResult as Impl,
  getSensitivityAnalysis: getSensitivityAnalysis as Impl,
  getScenarioAnalysis: getScenarioAnalysis as Impl,
  getRelativeValuation: getRelativeValuation as Impl,
};

/** 입력을 Tool 의 inputSchema 로 검증한다 (필수 · 타입 · enum · 알 수 없는 속성). 문제가 없으면 null. */
export function validateToolInput(schema: JsonSchema, input: unknown): string | null {
  if (schema.type === 'object') {
    if (input === undefined || input === null) input = {};
    if (typeof input !== 'object' || Array.isArray(input)) return 'input must be an object';
    const o = input as Record<string, unknown>;
    for (const r of schema.required ?? []) if (o[r] === undefined) return `missing required property: ${r}`;
    for (const [k, v] of Object.entries(o)) {
      const prop = schema.properties?.[k];
      if (!prop) {
        if (schema.additionalProperties === false || schema.properties !== undefined) return `unknown property: ${k}`;
        continue;
      }
      const err = validateToolInput(prop, v);
      if (err) return `${k}: ${err}`;
    }
    return null;
  }
  if (schema.enum && !schema.enum.includes(input as string | number)) return `must be one of ${schema.enum.join(', ')}`;
  if (schema.type === 'string' && typeof input !== 'string') return 'must be a string';
  if (schema.type === 'number' && (typeof input !== 'number' || !Number.isFinite(input))) return 'must be a finite number';
  if (schema.type === 'integer' && !Number.isInteger(input)) return 'must be an integer';
  if (schema.type === 'array') {
    if (!Array.isArray(input)) return 'must be an array';
    for (const [i, item] of input.entries()) { const err = schema.items ? validateToolInput(schema.items, item) : null; if (err) return `[${i}]: ${err}`; }
  }
  return null;
}

/** Tool 을 실행한다. 알 수 없는 Tool · 잘못된 입력 · unsupported 기업은 값을 만들지 않고 상태로 돌려준다. */
export function executeTool(name: string, ctx: AiValuationContext, input?: unknown): ToolResult<unknown> {
  const def = getToolDefinition(name);
  if (!def) return { status: 'invalid-input', tool: name, reason: `Unknown tool: ${name}`, sources: [], warnings: [] };
  const err = validateToolInput(def.inputSchema, input);
  if (err) return { status: 'invalid-input', tool: name, reason: err, sources: [], warnings: [] };
  if (ctx.support.status === 'unsupported' && !def.allowedWhenUnsupported) {
    return {
      status: 'unsupported', tool: name, reason: ctx.support.reason, message: ctx.support.message, sources: [],
      warnings: [{ code: 'unsupported-company', text: ctx.support.message, level: 'review' }],
    };
  }
  return (IMPLS[def.name] as (c: AiValuationContext, i?: unknown) => ToolResult<unknown>)(ctx, input ?? {});
}
