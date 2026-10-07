// STEP 09-4: Report Narrative — Grounded Claim 을 Report 서술로 조립한다 (supported · 같은 snapshot · 출처 추적 가능 · 1:1 · 새 문장/숫자 없음 · Fact/Judgment 구분).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildNarrative, buildReport, buildReportDocument, buildReportInput, type AiAnalysisInput, type ReportInput, type ReportModel } from './index.ts';
import { SourceRegistry, baseSources } from './sources.ts';
import { buildScenario } from '../ai/eval/scenarios.ts';
import type { Evidence, GroundedClaim } from '../ai/grounding/types.ts';

const golden = JSON.parse(readFileSync(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const NOW = () => new Date('2026-10-08T01:02:03Z');
const proj = () => structuredClone(buildScenario('full', golden).project);
const base = () => buildReportInput(proj(), { now: NOW });
const claim = (claimId: string, text: string, type: GroundedClaim['type'], status: GroundedClaim['status'], evidenceIds: string[], basis: GroundedClaim['basis'] = 'objective', confidence: GroundedClaim['confidence'] = 'medium'): GroundedClaim =>
  ({ claimId, text, type, basis, evidenceIds, status, confidence, numbers: [], issues: [], confidenceNotes: [] });
const ev = (evidenceId: string, tool: string, extra: Partial<Evidence> = {}): Evidence => ({ evidenceId, tool, sourceType: 'financial-data', sourceKind: 'actual', ...extra });
const EVIDENCE: Evidence[] = [
  ev('h', 'getHistoricalAnalysis'),
  ev('f', 'getForecastAssumptions', { sourceKind: 'assumption' }),
  ev('v', 'getValuationResult', { sourceKind: 'calculated' }),
  ev('d', 'searchDisclosures', { sourceType: 'disclosure-document', sourceKind: 'document', origin: 'opendart', sourceLabel: '사업보고서 (2025.12)', documentId: '2026', asOf: '2026-03-10' }),
];
const ai = (input: ReportInput, claims: GroundedClaim[], over: Partial<AiAnalysisInput> = {}): AiAnalysisInput => ({
  analysisId: 'wf_n', question: 'q', workflowType: 'full-valuation-review', contextSnapshotId: input.snapshot.contextSnapshotId, createdAt: '2026-10-08T00:00:00Z', groundingLevel: 'claim-evidence', claims, evidence: EVIDENCE, sources: [], limitations: ['D&A 는 제공되지 않는다.'], ...over,
});
const withAi = (claims: GroundedClaim[], over: Partial<AiAnalysisInput> = {}): ReportInput => { const b = base(); return buildReportInput(proj(), { now: NOW, aiAnalysis: ai(b, claims, over) }); };
const narr = (input: ReportInput) => { const reg = new SourceRegistry(); baseSources(input, reg); return { n: buildNarrative(input, reg), reg }; };
const items = (s: ReturnType<typeof buildNarrative>['sections'][keyof ReturnType<typeof buildNarrative>['sections']]) => (s.status === 'ok' ? s.data.items : []);

const CLAIMS = [
  claim('c1', '2025년 영업이익률은 13.07%이다.', 'fact', 'supported', ['h'], 'objective', 'high'),
  claim('c2', '수익성 개선이 이어지고 있다.', 'interpretation', 'supported', ['h'], 'judgment', 'medium'),
  claim('c3', '시장 위험 프리미엄 가정은 6.0%이다.', 'fact', 'supported', ['f'], 'objective', 'high'),
  claim('c4', 'DCF 가치는 2,346억원이다.', 'calculation', 'supported', ['v'], 'objective', 'high'),
  claim('c5', '회사는 설비투자 확대를 공시에서 언급했다.', 'fact', 'supported', ['d'], 'objective', 'medium'),
  claim('c6', 'DCF 가치가 Terminal Value 에 크게 의존한다.', 'risk', 'supported', ['v'], 'judgment', 'high'),
  claim('c7', 'WACC 입력을 검토하라.', 'recommendation', 'supported', ['f'], 'judgment', 'medium'),
  claim('x1', '부분 근거 주장.', 'fact', 'partially-supported', ['h']),
  claim('x2', '근거 없는 주장.', 'fact', 'unsupported', []),
  claim('x3', '근거 id 가 없는 claim.', 'fact', 'supported', []),
  claim('x4', '추적할 수 없는 근거.', 'risk', 'supported', ['nope']),
];

test('사용 기준: supported · 같은 snapshot · 근거/출처 추적 가능만 쓰고 나머지는 이유와 함께 제외한다', () => {
  const { n } = narr(withAi(CLAIMS));
  const used = new Set(Object.values(n.sections).flatMap(items).map((i) => i.claimId));
  assert.deepEqual([...used].sort(), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
  assert.deepEqual(n.rejected.map((r) => [r.claimId, r.reason]), [['x1', 'partially-supported'], ['x2', 'unsupported'], ['x3', 'no-evidence'], ['x4', 'untraceable-evidence']]);
  assert.equal(n.stale, false);
  assert.equal(n.analysisId, 'wf_n');
  // 제외 이유는 Report Appendix 에 남는다
  const m = buildReport(withAi(CLAIMS)).model!;
  assert.deepEqual(m.appendix.narrativeRejected.map((r) => r.claimId), ['x1', 'x2', 'x3', 'x4']);
  const doc = buildReportDocument(m);
  assert.equal((doc.sections.find((s) => s.sectionId === 'appendix')!.content as { narrativeRejected: unknown[] }).narrativeRejected.length, 4);
});

test('stale snapshot: 다른 Project 상태의 분석은 전부 제외하고 이유를 남긴다', () => {
  const { n } = narr(withAi(CLAIMS, { contextSnapshotId: 'ctx-old' }));
  assert.equal(n.stale, true);
  for (const s of Object.values(n.sections)) assert.equal(s.status, 'unavailable');
  assert.ok(n.rejected.length === CLAIMS.length && n.rejected.every((r) => r.reason === 'stale-snapshot'));
  const m = buildReport(withAi(CLAIMS, { contextSnapshotId: 'ctx-old' })).model!;
  assert.match((m.executiveSummary.narrative as { reason: string }).reason, /다른 Project 상태/);
});

test('1:1 trace: claim 하나가 서술 항목 하나이고 text · evidence 를 그대로 쓰며 한 section 에만 나온다', () => {
  const input = withAi(CLAIMS);
  const { n } = narr(input);
  const all = Object.values(n.sections).flatMap(items);
  const byId = new Map(input.aiAnalysis!.claims.map((c) => [c.claimId, c]));
  assert.equal(new Set(all.map((i) => i.claimId)).size, all.length, '같은 claim 이 두 section 에 나오지 않는다');
  for (const i of all) {
    const c = byId.get(i.claimId)!;
    assert.equal(i.text, c.text, '문장을 바꾸지 않는다');
    assert.deepEqual(i.evidenceIds, c.evidenceIds);
    assert.equal(i.claimType, c.type);
    assert.equal(i.confidence, c.confidence);
    assert.ok(i.sourceIds.length > 0);
  }
  // 새 숫자 없음: 서술에 나온 모든 숫자 토큰은 claim 문장에 있던 것이다
  const nums = (s: string) => s.match(/\d[\d,.]*/g) ?? [];
  const claimNums = new Set(CLAIMS.flatMap((c) => nums(c.text)));
  assert.ok(all.every((i) => nums(i.text).every((x) => claimNums.has(x))));
});

test('Fact / Judgment 구분: basis 가 보존되고 Judgment 가 Fact 로 합쳐지지 않는다', () => {
  const { n } = narr(withAi(CLAIMS));
  const all = Object.values(n.sections).flatMap(items);
  const by = (id: string) => all.find((i) => i.claimId === id)!;
  assert.deepEqual(['c1', 'c3', 'c4', 'c5'].map((id) => by(id).basis), ['objective', 'objective', 'objective', 'objective']);
  assert.deepEqual(['c2', 'c6', 'c7'].map((id) => by(id).basis), ['judgment', 'judgment', 'judgment']);
  assert.ok(all.filter((i) => i.claimType === 'risk' || i.claimType === 'recommendation' || i.claimType === 'interpretation').every((i) => i.basis === 'judgment'));
});

test('section 배정: 근거 Tool 의 성격(Historical / Forecast / Valuation)으로 나누고 Risks · Conclusion 은 유형으로 나눈다', () => {
  const { n } = narr(withAi(CLAIMS));
  const ids = (k: keyof typeof n.sections) => items(n.sections[k]).map((i) => i.claimId);
  assert.deepEqual(ids('keyRisks'), ['c6']);
  assert.deepEqual(ids('conclusion'), ['c7']);
  // Executive Summary 는 Valuation → Forecast → Historical 순으로 주제별 최상위를 고른다 (최대 4개)
  assert.deepEqual(ids('executiveSummary'), ['c1', 'c2', 'c3', 'c4'], '주제마다 최상위(신뢰도 · 순서) 1개씩, 모자라면 같은 순서로 이어서');
  assert.deepEqual([ids('historicalCommentary'), ids('forecastCommentary'), ids('valuationCommentary')], [['c5'], [], []], 'Executive 에 못 든 공시 claim 은 Historical Commentary 로');
  // 같은 claim 이 중복되지 않는다
  assert.equal(new Set([...ids('executiveSummary'), ...ids('historicalCommentary')]).size, ids('executiveSummary').length + ids('historicalCommentary').length);
  // 주제 section: claim 이 많으면 Executive 에 못 든 것이 topical section 으로
  const more = [...CLAIMS, claim('v2', '시나리오별 가치 차이가 크다.', 'interpretation', 'supported', ['v'], 'judgment', 'low'), claim('v3', '민감도 분석 폭이 넓다.', 'interpretation', 'supported', ['v'], 'judgment', 'low'), claim('f2', '성장률 가정은 과거보다 낮다.', 'interpretation', 'supported', ['f'], 'judgment', 'low')];
  const { n: n2 } = narr(withAi(more));
  assert.ok(items(n2.sections.valuationCommentary).some((i) => i.claimId === 'v3'));
  assert.ok(items(n2.sections.forecastCommentary).some((i) => i.claimId === 'f2'));
});

test('항목 수 제한: 검증을 통과했지만 싣지 않은 claim 수를 omitted 로 센다', () => {
  const many = Array.from({ length: 8 }, (_, i) => claim(`m${i}`, `역사적 사실 ${i}.`, 'fact', 'supported', ['h']));
  const { n } = narr(withAi(many));
  const used = Object.values(n.sections).flatMap(items).length;
  assert.equal(used + n.omitted, 8);
  assert.ok(items(n.sections.executiveSummary).length <= 4 && items(n.sections.historicalCommentary).length <= 3);
});

test('AI 가 없어도 deterministic Report 가 정상 생성된다', () => {
  const input = base();
  const r = buildReport(input);
  assert.equal(r.status, 'ok');
  const m = r.model as ReportModel;
  for (const s of [m.executiveSummary.narrative, m.historicalPerformance.narrative, m.forecast.narrative, m.dcf.narrative, m.keyRisks.narrative, m.conclusion.narrative]) assert.equal(s.status, 'unavailable');
  assert.equal(m.executiveSummary.headline.enterpriseValue.state, 'ok');
  assert.ok(buildReportDocument(m).sections.length >= 14);
  assert.deepEqual(m.appendix.narrativeRejected, []);
});

test('Report 모델 · 문서에 서술이 section 별로 실린다 (Historical / Forecast / Valuation Commentary)', () => {
  const extra = [...CLAIMS, claim('v2', '시나리오별 가치 차이가 크다.', 'interpretation', 'supported', ['v'], 'judgment', 'low'), claim('v3', '민감도 분석 폭이 넓다.', 'interpretation', 'supported', ['v'], 'judgment', 'low'), claim('f2', '성장률 가정은 과거보다 낮다.', 'interpretation', 'supported', ['f'], 'judgment', 'low')];
  const m = buildReport(withAi(extra)).model!;
  const text = (s: { status: string; data?: { items: { claimId: string }[] } }) => (s.status === 'ok' ? s.data!.items.map((i) => i.claimId) : []);
  assert.deepEqual(text(m.forecast.narrative as never), ['f2']);
  assert.deepEqual(text(m.dcf.narrative as never), ['v3'], 'Executive 에 못 든 Valuation claim 이 Valuation Commentary 로');
  const doc = buildReportDocument(m);
  const f = doc.sections.find((s) => s.sectionId === 'forecast')!.content as { narrative: { status: string } };
  assert.equal(f.narrative.status, 'ok');
  // 모든 서술 항목의 sourceId 는 Source Registry 에 있다
  const ids = new Set(m.sources.map((s) => s.id));
  const all = [m.executiveSummary.narrative, m.historicalPerformance.narrative, m.forecast.narrative, m.dcf.narrative, m.keyRisks.narrative, m.conclusion.narrative].flatMap((s) => (s.status === 'ok' ? s.data.items : []));
  assert.ok(all.length >= 8 && all.every((i) => i.sourceIds.every((s) => ids.has(s))));
});
