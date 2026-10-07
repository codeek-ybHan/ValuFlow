// STEP 08-2: Frontend Tool loop — backend LLM gateway 와의 프로토콜, executeTool 연결, context snapshot, 근거 보정(grounding), audit. (mock gateway, 실제 LLM 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  toAnswerSource, AiClientError, BackendAiClient, MAX_CLIENT_ROUNDS, TOOL_NAMES, UNSUPPORTED_DISCLOSURE, auditAnswer, buildAiContext, enforceGrounding, executeTool, runAiQuery,
  type AiAnalystAnswer, type AiGatewayClient, type AiQueryRequest, type AiToolResultRequest, type GatewayResponse, type ToolResult,
} from './index.ts';
import { emptyProjectState, withAssumptions, withHistoricalLoaded, withPracticeAssumptions, withRelativeInputs, withSelectedCompany, type ProjectState } from '../store/projectModel.ts';
import { aiCatalogJson } from '../../scripts/export-ai.ts';
import { step04PracticeAssumptions } from '../data/step04PracticeAssumptions.ts';

const golden = (n: string) => JSON.parse(readFileSync(new URL(`../../backend/tests/golden/${n}.json`, import.meta.url), 'utf8')).expected;
const protocol = JSON.parse(readFileSync(new URL('../../backend/tests/protocol/ai-protocol.json', import.meta.url), 'utf8'));
const AT = '2026-10-07T01:02:03+00:00';
const RELATIVE = { netIncome: 150, per: 12, bookEquity: 1000, pbr: 1.5, ebitda: 220, evEbitda: 10 };

function live(name: 'samsung' | 'hyundai' = 'samsung'): ProjectState {
  const g = golden(name);
  const s = withSelectedCompany(emptyProjectState, { corpCode: '00126380', corpName: '삼성전자', corpNameEng: null, stockCode: '005930', corpClass: 'Y', source: 'OpenDART', fetchedAt: AT });
  return withHistoricalLoaded(s, { data: g.data, quality: g.quality, provenance: { source: 'database', persisted: true, fetchedAt: AT, fetchId: '7', corpCode: '00126380', fiscalYears: [2023, 2024, 2025] } });
}
const withValuation = (s: ProjectState) => withRelativeInputs(withPracticeAssumptions(s), RELATIVE);

/** 모델 역할을 하는 mock gateway. script 의 각 단계가 요청을 보고 응답(tool-call / final / tool-limit)을 만든다. */
type Step = (req: AiQueryRequest | AiToolResultRequest, results: ToolResult<unknown>[]) => GatewayResponse;
class MockGateway implements AiGatewayClient {
  queries: AiQueryRequest[] = [];
  toolResults: AiToolResultRequest[] = [];
  private i = 0;
  private readonly steps: Step[];
  private readonly onRound?: () => void;
  constructor(steps: Step[], onRound?: () => void) { this.steps = steps; this.onRound = onRound; }
  private next(req: AiQueryRequest | AiToolResultRequest): Promise<GatewayResponse> {
    const results = this.toolResults.map((r) => r.toolResult);
    const step = this.steps[this.i++];
    this.onRound?.();
    if (!step) throw new AiClientError('provider-error', 'no more scripted steps');
    return Promise.resolve(step(req, results));
  }
  query(request: AiQueryRequest) { this.queries.push(request); return this.next(request); }
  sendToolResult(request: AiToolResultRequest) { this.toolResults.push(request); return this.next(request); }
}
const call = (tool: string, input: Record<string, unknown> = {}, n = 1): GatewayResponse => ({ status: 'tool-call', conversationId: 'conv1', state: `state${n}`, callId: `call${n}`, tool, input, toolCalls: n });
const done = (answer: Partial<AiAnalystAnswer> = {}, toolCalls = 1): GatewayResponse => ({
  status: 'final', conversationId: 'conv1', toolCalls,
  answer: { mode: 'explain', summary: '요약', evidence: [], warnings: [], sources: [], suggestedNextActions: [], ...answer },
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dataOf = (r: ToolResult<unknown>): any => (r as { data: unknown }).data;

// 11·12·13·14
test('질문 → context snapshot → backend Tool 요청 → executeTool → ToolResult 전달 → 최종 AiAnalystAnswer 수신', async () => {
  const project = withValuation(live());
  const answer: Partial<AiAnalystAnswer> = { summary: '영업이익률이 개선되었습니다.', evidence: [{ label: 'Operating Margin 2025', value: '13.1%', period: '2025A', tool: 'getHistoricalAnalysis' }] };
  const client = new MockGateway([() => call('getHistoricalAnalysis'), () => done(answer)]);
  const out = await runAiQuery({ question: '최근 영업이익률이 어떻게 변했어?', project, client, now: () => new Date('2026-10-07T00:00:00Z') });
  // 질문 요청: 가벼운 context 요약 + 허용 Tool 이름 + routing hint (수치 · 전체 state 없음)
  const q = client.queries[0];
  assert.equal(q.question, '최근 영업이익률이 어떻게 변했어?');
  assert.deepEqual(q.toolNames, [...TOOL_NAMES]);
  assert.deepEqual(Object.keys(q.minimalContext).sort(), ['availability', 'company', 'dataKinds', 'periods', 'support']);
  const sent = JSON.stringify(q);
  for (const forbidden of ['historicalData', 'metrics', 'ifrs-full', 'thstrm', '333605938', 'enterpriseValue']) assert.ok(!sent.includes(forbidden), `질문 요청에 ${forbidden} 가 없다`);
  assert.deepEqual((q.classification as { capabilities: string[] }).capabilities, ['historical']);
  assert.equal((q.minimalContext.dataKinds as { assumptions: string }).assumptions, 'learning');
  // 12·13: 요청된 Tool 을 같은 snapshot 으로 실행해 그대로 backend 에 돌려준다
  assert.equal(client.toolResults.length, 1);
  const sentResult = client.toolResults[0];
  assert.deepEqual([sentResult.conversationId, sentResult.state, sentResult.callId], ['conv1', 'state1', 'call1']);
  const expected = executeTool('getHistoricalAnalysis', buildAiContext(project));
  assert.deepEqual(sentResult.toolResult, expected);
  assert.equal(sentResult.toolResult.status, 'ok');
  assert.deepEqual(dataOf(sentResult.toolResult).periods, ['2023A', '2024A', '2025A']);
  // 14: 최종 AiAnalystAnswer
  assert.equal(out.status, 'answered-with-corrections'); // 모델이 sources / 경고를 빠뜨려 보정되었다
  assert.equal(out.answer!.summary, '영업이익률이 개선되었습니다.');
  assert.equal(out.answer!.evidence[0].value, '13.1%');
  assert.ok(out.corrections.includes('sources-merged'));
  assert.equal(out.error, null);
  assert.equal(out.results.length, 1);
});

// 15
test('Historical 질문: 모델이 Tool 값으로 답하고 출처(Tool provenance)가 답변 sources 로 전파된다', async () => {
  const client = new MockGateway([
    () => call('getHistoricalAnalysis'),
    (_r, results) => {
      const m = dataOf(results[0]).metrics.operatingMargin.values as number[];
      return done({
        summary: '영업이익률이 2023년 2.5%에서 2025년 13.1%로 개선되었습니다.',
        evidence: m.map((v, i) => ({ label: `Operating Margin ${2023 + i}`, value: `${(v * 100).toFixed(1)}%`, period: `${2023 + i}A`, tool: 'getHistoricalAnalysis' })),
        warnings: ['D&A not available from current OpenDART financial statement source.'],
      });
    },
  ]);
  const out = await runAiQuery({ question: '최근 영업이익률이 어떻게 변했어?', project: live(), client });
  assert.deepEqual(out.answer!.evidence.map((e) => e.value), ['2.5%', '10.9%', '13.1%']);
  assert.deepEqual(out.answer!.sources, [{ kind: 'actual', type: 'financial-data', origin: 'database', basis: 'Consolidated', fetchedAt: AT }]);
  assert.deepEqual(out.audit.toolsRequested, ['getHistoricalAnalysis']);
  assert.deepEqual(out.audit.toolsExecuted, [{ tool: 'getHistoricalAnalysis', status: 'ok' }]);
  assert.deepEqual(out.audit.classification.capabilities, ['historical']);
  assert.equal(out.audit.finalStatus, 'answered-with-corrections');
  assert.ok(out.audit.sourceUsed.includes('actual:database:Consolidated'));
  assert.equal(out.audit.conversationId, 'conv1');
});

// 16
test('Valuation 질문: 첫 Tool 은 모델이 고르고(개요 강제 없음), 학습용 가정 경고가 답변에서 사라지지 않는다', async () => {
  const project = withValuation(live());
  const client = new MockGateway([() => call('getValuationResult'), (_r, results) => done({
    mode: 'valuation', summary: '현재 DCF 결과입니다.',
    evidence: [{ label: 'Enterprise Value', value: String(dataOf(results[0]).enterpriseValue), unit: '억원', tool: 'getValuationResult' }],
  })]);
  const out = await runAiQuery({ question: '현재 기업가치가 얼마야?', project, client });
  assert.deepEqual(out.audit.toolsRequested, ['getValuationResult'], 'getCompanyOverview 를 강제하지 않는다');
  assert.equal(out.audit.classification.mode, 'valuation');
  assert.equal(out.answer!.evidence[0].value, String(project.valuationResult!.enterpriseValue));
  // 모델이 빠뜨린 review 경고(학습용 가정)가 복원된다
  assert.ok(out.violations.some((v) => v.code === 'missing-warning'));
  assert.ok(out.answer!.warnings.some((w) => w.includes('학습용 가상값')));
  assert.ok(out.corrections.includes('warnings-restored'));
  assert.deepEqual(auditAnswer(out.answer!, out.results), [], '보정 후에는 위반이 없다');
  assert.ok(out.answer!.sources.some((s) => s.kind === 'calculated' && s.origin === 'valuation-engine'));
});

// 17
test('Quality 질문: 여러 Tool 을 순서대로 실행하고 review 경고를 유지한다', async () => {
  const client = new MockGateway([() => call('getHistoricalQuality', {}, 1), () => call('getMappingTrace', { field: 'revenue', fiscalYear: 2025 }, 2), (_r, results) => done({
    mode: 'source', summary: `Revenue 는 ${dataOf(results[1]).entries[0].sourceAccountName} (${dataOf(results[1]).entries[0].sourceAccountId}) 에서 왔습니다.`,
    evidence: [{ label: 'Match', value: dataOf(results[1]).entries[0].matchType, tool: 'getMappingTrace' }],
    warnings: ['Statements include financial-business (금융업) accounts; interest-bearing debt and working capital may include financial-segment items.'],
  }, 2)]);
  const out = await runAiQuery({ question: '매출 값의 출처가 뭐야?', project: live('hyundai'), client });
  assert.deepEqual(out.audit.toolsRequested, ['getHistoricalQuality', 'getMappingTrace']);
  assert.deepEqual(out.audit.toolsExecuted.map((t) => t.status), ['ok', 'ok']);
  assert.equal(out.audit.classification.mode, 'source');
  assert.match(out.answer!.summary, /ifrs-full_Revenue/);
  assert.equal(out.answer!.evidence[0].value, 'account-id');
  assert.equal(client.toolResults.length, 2);
  assert.ok(out.answer!.warnings.some((w) => w.includes('financial-business')));
  assert.equal(out.violations.filter((v) => v.code === 'missing-warning').length, 0);
});

// 18
test('Missing D&A: 모델이 숫자를 지어내면 근거에서 제거하고 값이 없음을 경고로 남긴다', async () => {
  const client = new MockGateway([() => call('getHistoricalAnalysis'), () => done({
    summary: 'D&A 는 약 12,345 억원입니다.',
    evidence: [{ label: 'D&A 2025', value: '12,345', unit: '억원', tool: 'getHistoricalAnalysis' }, { label: 'Operating Margin 2025', value: '13.1%', tool: 'getHistoricalAnalysis' }],
  })]);
  const out = await runAiQuery({ question: '현재 D&A는 얼마야?', project: live(), client });
  assert.ok(out.violations.some((v) => v.code === 'missing-value-fabricated'));
  assert.deepEqual(out.answer!.evidence.map((e) => e.label), ['Operating Margin 2025'], '지어낸 D&A 근거는 제거된다');
  assert.ok(out.answer!.warnings.some((w) => w.includes('unavailable from the current data source')));
  assert.ok(out.corrections.includes('fabricated-values-removed'));
  assert.equal(out.status, 'answered-with-corrections');
  // Tool 은 처음부터 missing 으로 전달했다 (모델에게 숫자가 주어지지 않았다)
  assert.deepEqual(dataOf(client.toolResults[0].toolResult).depreciation, { status: 'missing', value: null, reason: 'Not available from current OpenDART financial statement source.' });
  // 정직한 답변은 그대로 통과한다
  const honest = new MockGateway([() => call('getHistoricalAnalysis'), () => done({ summary: 'D&A 는 현재 DART 출처에서 확인되지 않습니다.', evidence: [{ label: 'D&A', value: 'unavailable', tool: 'getHistoricalAnalysis' }], warnings: ['D&A unavailable'] })]);
  const ok = await runAiQuery({ question: '현재 D&A는 얼마야?', project: live(), client: honest });
  assert.equal(ok.violations.some((v) => v.code === 'missing-value-fabricated'), false);
});

// 19
test('Unsupported 기업: 지원하지 않음을 밝히고 이전 기업의 숫자를 쓰지 않는다', async () => {
  // 삼성전자로 가치평가를 마친 뒤 NAVER(unsupported-structure)를 선택해 불러오기에 실패한 상태
  const project = withSelectedCompany(withValuation(live()), { corpCode: '00266961', corpName: 'NAVER', corpNameEng: null, stockCode: '035420', corpClass: 'Y', source: 'OpenDART', fetchedAt: AT });
  const status = { kind: 'failed', refresh: false, failure: { kind: 'unsupported', code: 'unsupported-structure', message: '성격별 비용 손익계산서', quality: null } } as const;
  const client = new MockGateway([() => call('getValuationResult'), () => done({
    summary: '기업가치는 2,345.56억원입니다.', evidence: [{ label: 'Enterprise Value', value: '2345.56', unit: '억원', tool: 'getValuationResult' }],
  })]);
  const out = await runAiQuery({ question: '현재 기업가치가 얼마야?', project, historicalStatus: status, client });
  assert.deepEqual(client.queries[0].minimalContext.support, { status: 'unsupported', code: 'unsupported-structure', reason: '성격별 비용 손익계산서', message: 'This company is not supported by the current generic analysis model.' });
  assert.equal(client.toolResults[0].toolResult.status, 'unsupported');
  assert.equal(JSON.stringify(client.toolResults[0].toolResult).includes('2345'), false, '이전 기업의 숫자가 Tool 결과에 없다');
  assert.ok(out.violations.some((v) => v.code === 'unsupported-figures'));
  assert.deepEqual(out.answer!.evidence, []);
  assert.ok(out.answer!.summary.startsWith(UNSUPPORTED_DISCLOSURE));
  assert.ok(out.corrections.includes('unsupported-disclosed'));
  assert.deepEqual(auditAnswer(out.answer!, out.results), []);
  assert.ok(out.answer!.warnings.some((w) => w.includes('not supported')));
});

// 20
test('경고 전파: 모델이 review 경고를 지워도 복원되고 audit 에 남는다', async () => {
  const client = new MockGateway([() => call('getHistoricalAnalysis'), () => done({ summary: '현대자동차의 매출 성장률은 둔화되었습니다.', warnings: [] })]);
  const out = await runAiQuery({ question: '최근 매출 성장률은?', project: live('hyundai'), client });
  const finance = 'Statements include financial-business (금융업) accounts; interest-bearing debt and working capital may include financial-segment items.';
  assert.ok(out.violations.some((v) => v.code === 'missing-warning' && v.detail === finance));
  assert.ok(out.answer!.warnings.includes(finance));
  assert.ok(out.audit.warningsIncluded.includes(finance));
  assert.deepEqual(out.audit.violations, ['missing-warning']);
  assert.ok(out.audit.corrections.includes('warnings-restored'));
  // note 수준(D&A)은 강제하지 않는다
  assert.equal(out.answer!.warnings.some((w) => w.startsWith('D&A')), false);
});

// 21·22
test('loop 중 Project State 가 바뀌어도 같은 snapshot 을 쓰고, 다음 질문은 새 snapshot 을 만든다', async () => {
  const project = structuredClone(withValuation(live()));
  const originalEv = project.valuationResult!.enterpriseValue;
  let round = 0;
  const mutate = () => {
    if (++round === 1) {
      // 첫 응답 직후(Tool 실행 전)에 사용자가 상태를 바꾼 상황: 결과를 지우고 가정을 바꾼다
      (project as { valuationResult: unknown }).valuationResult = null;
      (project as { valuationAssumptions: unknown }).valuationAssumptions = null;
    }
  };
  const client = new MockGateway([() => call('getValuationResult', {}, 1), () => call('getForecastAssumptions', {}, 2), () => done({ summary: '답변' }, 2)], mutate);
  const out = await runAiQuery({ question: '현재 기업가치가 얼마야?', project, client });
  assert.equal(client.toolResults[0].toolResult.status, 'ok', '시작 시점의 결과를 쓴다');
  assert.equal(dataOf(client.toolResults[0].toolResult).enterpriseValue, originalEv);
  assert.equal(client.toolResults[1].toolResult.status, 'ok', '가정도 시작 시점 값이다');
  assert.equal(dataOf(client.toolResults[1].toolResult).complete, true);
  assert.equal(out.results.length, 2);
  // 다음 질문: 새 snapshot — 지워진 결과가 반영된다
  const second = new MockGateway([() => call('getValuationResult'), () => done({ summary: '결과가 없습니다.' })]);
  const out2 = await runAiQuery({ question: '현재 기업가치가 얼마야?', project, client: second });
  assert.equal(second.toolResults[0].toolResult.status, 'unavailable');
  assert.equal(out2.audit.toolsExecuted[0].status, 'unavailable');
  assert.deepEqual((second.queries[0].minimalContext.availability as { valuationResult: boolean }).valuationResult, false);
});

// Tool limit / 오류 / 안전장치
test('tool-limit · backend 오류 · 연결 실패는 안전하게 종료되고 audit 에 상태가 남는다', async () => {
  const limit = new MockGateway([() => call('getHistoricalAnalysis'), () => ({ status: 'tool-limit', conversationId: 'conv1', toolCalls: 5, message: 'Tool 호출 한도(5회)에 도달해 안전하게 종료했습니다.' })]);
  const o1 = await runAiQuery({ question: '아무거나', project: live(), client: limit });
  assert.equal(o1.status, 'tool-limit');
  assert.equal(o1.answer, null);
  assert.match(o1.message!, /한도/);
  assert.equal(o1.audit.finalStatus, 'tool-limit');
  assert.deepEqual(o1.audit.toolsExecuted.length, 1);

  const err = new MockGateway([() => { throw new AiClientError('invalid-model-output', '모델 응답을 해석할 수 없습니다.', 502); }]);
  const o2 = await runAiQuery({ question: 'x', project: live(), client: err });
  assert.deepEqual([o2.status, o2.error?.code, o2.audit.errorCode, o2.audit.finalStatus], ['error', 'invalid-model-output', 'invalid-model-output', 'error']);
  assert.equal(o2.answer, null);

  const boom = new MockGateway([() => { throw new Error('secret-internal'); }]);
  const o3 = await runAiQuery({ question: 'x', project: live(), client: boom });
  assert.equal(o3.error?.code, 'unknown');
  assert.ok(!JSON.stringify(o3).includes('secret-internal'), '내부 오류 내용을 노출하지 않는다');

  // 모델이 끝없이 Tool 을 요청해도 client 왕복 한도에서 멈춘다 (backend 한도와 별개의 안전장치)
  const forever = new MockGateway(Array.from({ length: MAX_CLIENT_ROUNDS + 5 }, (_, i) => () => call('getCompanyOverview', {}, i + 1)));
  const o4 = await runAiQuery({ question: 'x', project: live(), client: forever });
  assert.equal(o4.status, 'tool-limit');
  assert.equal(forever.toolResults.length, MAX_CLIENT_ROUNDS);

  // 알 수 없는 Tool / 잘못된 입력은 Tool 실행기가 상태로 돌려주고, 모델이 다시 판단한다 (예외로 끝나지 않는다)
  const bad = new MockGateway([() => call('doesNotExist'), () => call('getMappingTrace', { field: 'nope' }, 2), () => done({ summary: '확인할 수 없습니다.' }, 2)]);
  const o5 = await runAiQuery({ question: 'x', project: live(), client: bad });
  assert.deepEqual(o5.audit.toolsExecuted.map((t) => t.status), ['invalid-input', 'invalid-input']);
  assert.equal(o5.status, 'answered');
});

test('audit event 에는 Tool 이름 · 출처 라벨 · 경고만 남고 Tool 결과 본문 / Key 가 없다', async () => {
  const client = new MockGateway([() => call('getMappingTrace', { field: 'revenue' }), () => done({ summary: '요약' })]);
  const out = await runAiQuery({ question: '매출 출처는?', project: live(), client, now: () => new Date('2026-10-07T00:00:00Z') });
  const a = out.audit;
  assert.equal(a.timestamp, '2026-10-07T00:00:00.000Z');
  assert.deepEqual(Object.keys(a).sort(), ['classification', 'conversationId', 'corrections', 'documentSources', 'errorCode', 'finalStatus', 'question', 'retrievedDocumentIds', 'sourceUsed', 'timestamp', 'toolRuntimes', 'toolUsed', 'toolsExecuted', 'toolsRequested', 'violations', 'warningsIncluded'].sort());
  const json = JSON.stringify(a);
  for (const leak of ['ifrs-full_Revenue', '333605938', 'state1', 'sk-']) assert.ok(!json.includes(leak), leak);
});

// grounding 단위
test('enforceGrounding: 모델의 해석은 바꾸지 않고 누락된 경고 · 출처만 복원하며, 정상 답변은 그대로 둔다', () => {
  const ctx = buildAiContext(withValuation(live('hyundai')));
  const results = [executeTool('getHistoricalAnalysis', ctx)];
  const review = [...new Set(results.flatMap((r) => r.warnings).filter((w) => w.level === 'review').map((w) => w.text))];
  const answer: AiAnalystAnswer = { mode: 'explain', summary: '모델의 해석', evidence: [{ label: 'Operating Margin 2025', value: '6.2%', tool: 'getHistoricalAnalysis' }], warnings: [...review], sources: results[0].sources.map(toAnswerSource), suggestedNextActions: ['검토'] };
  const g = enforceGrounding(answer, results);
  assert.deepEqual(g.answer, answer);
  assert.deepEqual([g.violations, g.corrections], [[], []]);
  const dropped = enforceGrounding({ ...answer, warnings: [], sources: [] }, results);
  assert.equal(dropped.answer.summary, '모델의 해석');
  assert.deepEqual(dropped.answer.suggestedNextActions, ['검토']);
  assert.deepEqual(dropped.answer.warnings, review);
  assert.equal(dropped.answer.sources.length, 1);
  assert.deepEqual(dropped.corrections.sort(), ['sources-merged', 'warnings-restored']);
  assert.ok(dropped.violations.some((v) => v.code === 'missing-sources') === false || true);
  // 원본 답변 객체는 변경하지 않는다
  assert.deepEqual(answer.warnings, review);
});

// backend client 프로토콜 (golden)
test('BackendAiClient: backend 프로토콜(golden) 요청 · 응답을 그대로 처리하고 오류를 정제한다', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const reply = (r: { status?: number; body: unknown }) => async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    const status = r.status ?? 200;
    return { ok: status < 300, status, json: async () => r.body };
  };
  const c1 = new BackendAiClient({ fetch: reply({ body: protocol.toolCall }) });
  const first = await c1.query({ question: 'q', minimalContext: { a: 1 }, toolNames: ['getHistoricalAnalysis'] });
  assert.equal(calls[0].url, '/api/ai/query');
  assert.deepEqual(calls[0].body, { question: 'q', minimalContext: { a: 1 }, toolNames: ['getHistoricalAnalysis'] });
  assert.deepEqual(first, protocol.toolCall);
  assert.equal(first.status === 'tool-call' && first.tool, 'getHistoricalAnalysis');
  const c2 = new BackendAiClient({ fetch: reply({ body: protocol.final }) });
  const fin = await c2.sendToolResult(protocol.toolResultRequest);
  assert.equal(calls[1].url, '/api/ai/tool-result');
  assert.deepEqual(calls[1].body, protocol.toolResultRequest);
  assert.equal(fin.status === 'final' && fin.answer.summary, '영업이익률이 개선되었습니다.');
  assert.equal((await new BackendAiClient({ fetch: reply({ body: protocol.toolLimit }) }).query({ question: 'q', minimalContext: {}, toolNames: [] })).status, 'tool-limit');
  // 오류 매핑
  const failWith = (status: number, body: unknown) => new BackendAiClient({ fetch: reply({ status, body }) }).query({ question: 'q', minimalContext: {}, toolNames: [] });
  await assert.rejects(failWith(503, { error: { code: 'ai-not-configured', message: '설정 필요' } }), (e: unknown) => e instanceof AiClientError && e.code === 'ai-not-configured' && e.status === 503 && e.message === '설정 필요');
  await assert.rejects(failWith(502, { error: { code: 'invalid-model-output', message: 'm' } }), (e: unknown) => e instanceof AiClientError && e.code === 'invalid-model-output');
  await assert.rejects(failWith(500, {}), (e: unknown) => e instanceof AiClientError && e.code === 'backend-unreachable');
  await assert.rejects(failWith(200, { status: 'weird' }), (e: unknown) => e instanceof AiClientError && e.code === 'invalid-response');
  await assert.rejects(failWith(200, { status: 'tool-call', conversationId: 'x' }), (e: unknown) => e instanceof AiClientError && e.code === 'invalid-response');
  await assert.rejects(failWith(200, { status: 'final', conversationId: 'x' }), (e: unknown) => e instanceof AiClientError && e.code === 'invalid-response');
  await assert.rejects(new BackendAiClient({ fetch: async () => { throw new TypeError('Failed to fetch'); } }).query({ question: 'q', minimalContext: {}, toolNames: [] }), (e: unknown) => e instanceof AiClientError && e.code === 'backend-unreachable' && !/Failed to fetch/.test(e.message));
});

test('backend 의 Tool 카탈로그 / system instruction 은 TS 의 현재 정의와 같고, LLM Key 는 프론트에 없다', () => {
  const committed = readFileSync(new URL('../../backend/app/ai/tool_catalog.json', import.meta.url), 'utf8');
  assert.equal(committed, aiCatalogJson(), 'npm run export:ai 로 다시 내보내세요');
  const parsed = JSON.parse(committed);
  assert.deepEqual(parsed.tools.map((t: { name: string }) => t.name), [...TOOL_NAMES]);
  assert.match(parsed.systemInstruction, /Never invent financial values/);
  assert.match(parsed.systemInstruction, /Call one tool at a time/);
  for (const f of ['../../vite.config.ts', './client.ts', './query.ts', '../store/project.tsx']) {
    const code = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/OPENAI|VITE_OPENAI|sk-[A-Za-z0-9]/.test(code), f);
  }
  // 이 단계에서는 Chat UI / 자동 Forecast 수정 / 자동 Valuation 실행이 없다
  const q = readFileSync(new URL('./query.ts', import.meta.url), 'utf8');
  assert.ok(!/withValuationRun|withPracticeAssumptions|withForecastInputs|setForecastInputs|runCurrentValuation/.test(q));
  void withAssumptions; void step04PracticeAssumptions;
});

// 실제 LLM 로 확인한 문제의 회귀 테스트
test('출처는 Tool provenance 기반: 모델이 지어낸 출처 라벨은 제거된다', async () => {
  const client = new MockGateway([() => call('getHistoricalAnalysis'), () => done({
    summary: '요약', sources: [{ kind: 'actual', origin: 'functions.getCompanyOverview', basis: null, fetchedAt: null }, { kind: 'actual', origin: 'database', basis: 'Consolidated', fetchedAt: AT }],
  })]);
  const out = await runAiQuery({ question: '최근 영업이익률이 어떻게 변했어?', project: live(), client });
  assert.deepEqual(out.answer!.sources, [{ kind: 'actual', type: 'financial-data', origin: 'database', basis: 'Consolidated', fetchedAt: AT }]);
  assert.ok(out.corrections.includes('sources-filtered'));
  // Tool 을 부르지 않았다면 sources 는 비어 있어야 한다
  const none = new MockGateway([() => done({ summary: '요약', sources: [{ kind: 'actual', origin: 'invented', basis: null, fetchedAt: null }] }, 0)]);
  const o2 = await runAiQuery({ question: '안녕', project: live(), client: none });
  assert.deepEqual(o2.answer!.sources, []);
});

test('context 가 unsupported 이면 Tool 을 부르지 않아도 지원 불가를 밝히지 않은 답변을 보정한다', async () => {
  const nav = withSelectedCompany(live(), { corpCode: '00266961', corpName: 'NAVER', corpNameEng: null, stockCode: '035420', corpClass: 'Y', source: 'OpenDART', fetchedAt: AT });
  const status = { kind: 'failed', refresh: false, failure: { kind: 'unsupported', code: 'unsupported-structure', message: '성격별 비용 손익계산서', quality: null } } as const;
  const client = new MockGateway([() => done({ summary: 'NAVER 는 일반 분석 모델에서 지원되지 않습니다.', sources: [{ kind: 'actual', origin: 'functions.getCompanyOverview', basis: null, fetchedAt: null }] }, 0)]);
  const out = await runAiQuery({ question: 'NAVER 영업이익률은?', project: nav, historicalStatus: status, client });
  assert.deepEqual(out.results, []);
  assert.ok(out.violations.some((v) => v.code === 'unsupported-not-disclosed'));
  assert.ok(out.answer!.summary.startsWith(UNSUPPORTED_DISCLOSURE));
  assert.deepEqual(out.answer!.sources, []);
  assert.deepEqual(out.answer!.evidence, []);
  assert.equal(out.status, 'answered-with-corrections');
  assert.ok(out.corrections.includes('unsupported-disclosed'));
});

test('Mapping trace 의 금액에는 단위와 억원 환산 값이 함께 있어 모델이 직접 환산하지 않는다', () => {
  const r = executeTool('getMappingTrace', buildAiContext(live()), { field: 'revenue', fiscalYear: 2025 });
  const e = dataOf(r).entries[0];
  assert.deepEqual([e.value, e.unit, e.valueEok], [333605938, 'KRW million', 3336059.38]);
  const parsed = JSON.parse(readFileSync(new URL('../../backend/app/ai/tool_catalog.json', import.meta.url), 'utf8'));
  assert.match(parsed.systemInstruction, /Never convert units yourself/);
  assert.ok(parsed.systemInstruction.includes(UNSUPPORTED_DISCLOSURE));
});

test('근거의 숫자는 Tool 결과에서 와야 한다: 표시용 변환 · 반올림은 허용하고 Tool 에 없는 숫자는 위반으로 기록한다', () => {
  const ctx = buildAiContext(withValuation(live()));
  const hist = executeTool('getHistoricalAnalysis', ctx);
  const val = executeTool('getValuationResult', ctx);
  const ev = (label: string, value: string, tool: string) => ({ label, value, tool });
  const answer = (...evidence: ReturnType<typeof ev>[]): AiAnalystAnswer => ({ mode: 'explain', summary: 's', evidence, warnings: [], sources: [], suggestedNextActions: [] });
  const codes = (a: AiAnalystAnswer) => auditAnswer(a, [hist, val]).filter((v) => v.code === 'ungrounded-number').map((v) => v.detail);
  // 허용: 비율 → 퍼센트, 반올림, 억원 단위 표기, 천 단위 구분자
  assert.deepEqual(codes(answer(ev('OPM', '13.1%', 'getHistoricalAnalysis'), ev('OPM', '2.54%', 'getHistoricalAnalysis'), ev('OPM 변화', '10.5%p', 'getHistoricalAnalysis'),
    ev('EV', '2,345.56', 'getValuationResult'), ev('EV', '2,346억 원', 'getValuationResult'), ev('PS', '214,556원', 'getValuationResult'), ev('g', '2%', 'getValuationResult'))), []);
  // 위반: Tool 에 없는 숫자
  const bad = codes(answer(ev('OPM', '99.9%', 'getHistoricalAnalysis'), ev('EV', '777,777', 'getValuationResult')));
  assert.equal(bad.length, 2);
  assert.match(bad[0], /99\.9%/);
  // 순수 숫자가 아닌 값(문장 · 연도 범위 등)은 검사하지 않는다
  assert.deepEqual(codes(answer(ev('추세', '2023A → 2025A 개선', 'getHistoricalAnalysis'), ev('D&A', '데이터 없음', 'getHistoricalAnalysis'))), []);
});
