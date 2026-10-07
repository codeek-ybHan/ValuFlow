// STEP 08-8: eval-live.ts 결과(JSON)를 지표 표(markdown)로 집계한다.   node scripts/eval-report.ts <live.json> [<rep.json> <prod.json> ...]
import { readFileSync } from 'node:fs';
import { aggregateTools, mean, pct, percentile, type ToolSelection } from '../src/ai/eval/metrics.ts';
import { CATEGORY_LABEL, type EvalCategory } from '../src/ai/eval/dataset.ts';

type R = Record<string, any>;
const load = (p: string): R[] => JSON.parse(readFileSync(p, 'utf8')).results;
const files = process.argv.slice(2);
const rs = files.flatMap(load);
const sum = (xs: R[], f: (r: R) => number) => xs.reduce((s, r) => s + f(r), 0);
const fin = (r: R, k: string): number => Number(r.final?.[k] ?? 0);
const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
const out: string[] = [];
const emit = (s = '') => out.push(s);

const answered = rs.filter((r) => r.final);
emit(`records: ${rs.length} (답변 ${answered.length})`);
emit('\n### Tool selection (카테고리별)\n');
emit(row(['category', 'cases', 'Required Tool Hit Rate', 'Tool Recall', 'Tool Precision', '불필요 호출', '반복 호출']));
emit(row(['---', '---', '---', '---', '---', '---', '---']));
for (const cat of Object.keys(CATEGORY_LABEL) as EvalCategory[]) {
  const xs = rs.filter((r) => r.category === cat && r.toolSel);
  const a = aggregateTools(xs.map((r) => r.toolSel as ToolSelection));
  emit(row([CATEGORY_LABEL[cat], a.cases, pct(a.hitRate), pct(a.recall), pct(a.precision), a.unnecessaryCalls, a.repeatedCalls]));
}
const all = aggregateTools(rs.filter((r) => r.toolSel).map((r) => r.toolSel as ToolSelection));
emit(row(['**전체**', all.cases, pct(all.hitRate), pct(all.recall), pct(all.precision), all.unnecessaryCalls, all.repeatedCalls]));
const missed = rs.filter((r) => r.toolSel && !r.toolSel.hit).map((r) => `${r.id}#${r.run}: ${r.toolSel.missing.join(',')}`);
const extras = rs.filter((r) => r.toolSel?.unnecessary.length).map((r) => `${r.id}#${r.run}: ${r.toolSel.unnecessary.join(',')}`);
emit(`\nrequired 누락: ${missed.join(' · ') || '없음'}\n불필요 호출 사례: ${extras.join(' · ') || '없음'}`);

emit('\n### 모드 라우팅 · 상태\n');
const modeOk = rs.filter((r) => r.modeOk).length;
const status = rs.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
emit(`자동 모드가 기대한 Quick/Deep 을 고른 비율: ${modeOk}/${rs.length}\n상태 분포: ${JSON.stringify(status)}`);

emit('\n### Workflow\n');
const wf = rs.filter((r) => r.mode === 'workflow' && r.steps);
const byType = new Map<string, R[]>();
for (const r of wf) byType.set(r.workflow, [...(byType.get(r.workflow) ?? []), r]);
emit(row(['workflow', 'runs', 'required 단계 호출·완료 (해당 단계 기준)', 'optional 단계 실행', 'tool-limit', 'waiting-for-review', 'failed', '반복 차단']));
emit(row(['---', '---', '---', '---', '---', '---', '---', '---']));
for (const [t, xs] of byType) {
  const reqA = sum(xs, (r) => r.wf.requiredApplicable), reqT = sum(xs, (r) => r.wf.requiredAttempted), reqC = sum(xs, (r) => r.wf.requiredCompleted);
  const opt = sum(xs, (r) => r.wf.optionalExecuted), optP = sum(xs, (r) => r.wf.optionalApplicable);
  emit(row([t, xs.length, `호출 ${reqT}/${reqA} · 완료 ${reqC}/${reqA}`, `${opt}/${optP}`, xs.filter((r) => r.stateStatus === 'tool-limit').length, xs.filter((r) => r.status === 'waiting-for-review').length, xs.filter((r) => r.status === 'failed').length, sum(xs, (r) => (r.tools as R[]).filter((x) => x.status === 'repeat-blocked').length)]));
}

emit('\n### Grounding (최종 답변 기준)\n');
const dw = answered.filter((r) => r.mode === 'workflow');
const dq = answered.filter((r) => r.mode === 'quick');
const crit = ['unsupportedNumericalClaims', 'ungroundedNumbers', 'unitConversionErrors', 'hallucinatedSources', 'waccSemanticErrors'];
emit(row(['mode', 'answers', ...crit, 'prompt-leak', 'injection 성공']));
emit(row(['---', '---', ...crit.map(() => '---'), '---', '---']));
for (const [name, xs] of [['Deep (claim-evidence)', dw], ['Quick (tool-guardrails)', dq]] as const) emit(row([name, xs.length, ...crit.map((k) => sum(xs, (r) => fin(r, k))), xs.filter((r) => r.leak).length, xs.filter((r) => r.injected).length]));
const cov = dw.map((r) => r.final.coverage).filter((x: number | null) => x !== null) as number[];
const fp = dw.map((r) => r.firstPass?.coverage).filter((x: number | null | undefined) => x !== null && x !== undefined) as number[];
emit(`\nDeep 핵심 claim 커버리지: first-pass 평균 ${pct(mean(fp))} → 최종 평균 ${pct(mean(cov))} (n=${cov.length})`);
const regen = dw.filter((r) => r.regenerated), fb = dw.filter((r) => r.fallback), blocked = dw.filter((r) => r.firstPass?.blocking?.length);
emit(`first-pass 차단 ${blocked.length}/${dw.length} · 교정 재생성 ${regen.length}/${dw.length} · fallback ${fb.length}/${dw.length} (${pct(fb.length / (dw.length || 1))})`);
const improved = regen.filter((r) => (r.afterRegeneration?.blocking?.length ?? 1) === 0).length;
emit(`재생성 후 차단 해소 ${improved}/${regen.length} · 재생성이 해소하지 못해 fallback ${fb.length}`);
const codes = blocked.flatMap((r) => [...new Set(r.firstPass.blocking as string[])]).reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {});
emit(`first-pass 차단 코드(run 수): ${JSON.stringify(codes)}`);
const ack = rs.filter((r) => r.acknowledged !== null && r.acknowledged !== undefined);
emit(`missing/no-data 질문에서 한계를 밝힌 비율: ${ack.filter((r) => r.acknowledged).length}/${ack.length}`);
const src = rs.filter((r) => r.sourceHit !== null && r.sourceHit !== undefined);
emit(`새 PDF 질문에서 해당 PDF(page 포함)가 최종 출처로 인용된 비율: ${src.filter((r) => r.sourceHit).length}/${src.length}`);
const nollm = rs.filter((r) => r.noLlmOk !== null && r.noLlmOk !== undefined);
emit(`미지원 기업에서 LLM 미호출: ${nollm.filter((r) => r.noLlmOk).length}/${nollm.length}`);

emit('\n### 지연 · 호출 수 (실제 환경, 상대 비교용)\n');
emit(row(['구분', 'runs', 'p50', 'p90', 'max', '평균 LLM 호출', '평균 Tool 호출', '재생성 호출']));
emit(row(['---', '---', '---', '---', '---', '---', '---', '---']));
const lat = (name: string, xs: R[]) => emit(row([name, xs.length, `${percentile(xs.map((r) => r.sec), 0.5).toFixed(1)}s`, `${percentile(xs.map((r) => r.sec), 0.9).toFixed(1)}s`, `${Math.max(0, ...xs.map((r) => r.sec)).toFixed(1)}s`, mean(xs.map((r) => r.llmCalls)).toFixed(1), mean(xs.map((r) => r.toolSel?.executed.length ?? 0)).toFixed(1), sum(xs, (r) => r.regenCalls)]));
const real = rs.filter((r) => !r.noLlmOk);
lat('Quick', real.filter((r) => r.mode === 'quick'));
lat('Deep (workflow)', real.filter((r) => r.mode === 'workflow'));
for (const t of byType.keys()) lat(`  └ ${t}`, real.filter((r) => r.workflow === t));
lat('검색 Tool 포함 Quick', real.filter((r) => r.mode === 'quick' && r.searchCalls > 0));
lat('외부 provider Tool 포함 Quick', real.filter((r) => r.mode === 'quick' && r.externalCalls > 0));
lat('Quick (내부 Tool 만)', real.filter((r) => r.mode === 'quick' && r.searchCalls === 0 && r.externalCalls === 0));
emit(`\n호출 수 합계: LLM ${sum(real, (r) => r.llmCalls)} (재생성 ${sum(real, (r) => r.regenCalls)}) · Tool ${sum(real, (r) => r.toolSel?.executed.length ?? 0)} · 검색(embedding + rerank) ${sum(real, (r) => r.searchCalls)} · 외부 provider ${sum(real, (r) => r.externalCalls)}`);
console.log(out.join('\n'));
