// STEP 08-7: AI Analyst 화면 렌더링 (React 를 esbuild 로 번들해 서버 렌더링한 HTML 을 검증한다).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { buildAiContext, AiClientError, type AiGatewayClient, type AiQueryRequest, type AiToolResultRequest, type GatewayResponse, type WorkflowAnswer } from './index.ts';
import { askAnalyst } from './analyst/ask.ts';
import { addTurn, emptySession, type AnalystSession } from './analyst/session.ts';
import type { AnalystTurn } from './analyst/view.ts';
import { emptyProjectState, toPersisted, withPracticeAssumptions, withSamsungHistorical, type ProjectState } from '../store/projectModel.ts';

type Harness = { renderPage(p: string | null, s?: AnalystSession, path?: string): string; renderKnowledge(d: unknown[] | null, e?: string | null): string };
let h: Harness;

before(() => {
  const out = join(mkdtempSync(join(tmpdir(), 'valuflow-render-')), 'harness.cjs');
  buildSync({ entryPoints: [new URL('./analyst/renderHarness.tsx', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', outfile: out, jsx: 'automatic', logLevel: 'silent', define: { 'import.meta.env': '{}' } });
  h = createRequire(import.meta.url)(out) as Harness;
  assert.ok(readFileSync(out, 'utf8').length > 0);
});

const samsung = (): ProjectState => withPracticeAssumptions(withSamsungHistorical(emptyProjectState));
const persisted = (p: ProjectState) => JSON.stringify(toPersisted(p));

class Gateway implements AiGatewayClient {
  private i = 0;
  private readonly steps: ((r: AiQueryRequest | AiToolResultRequest) => GatewayResponse)[];
  constructor(steps: ((r: AiQueryRequest | AiToolResultRequest) => GatewayResponse)[]) { this.steps = steps; }
  private next(r: AiQueryRequest | AiToolResultRequest) { const s = this.steps[this.i++]; if (!s) throw new AiClientError('provider-error', 'x'); return Promise.resolve(s(r)); }
  query(r: AiQueryRequest) { return this.next(r); }
  sendToolResult(r: AiToolResultRequest) { return this.next(r); }
}
const call = (tool: string): GatewayResponse => ({ status: 'tool-call', conversationId: 'c1', state: 's1', callId: 'k1', tool, input: {}, toolCalls: 1, backendToolResults: [] });
const done = (answer: Partial<WorkflowAnswer>): GatewayResponse => ({ status: 'final', conversationId: 'c1', toolCalls: 1, toolTrace: [], backendToolResults: [], answer: { mode: 'explain', summary: '요약', evidence: [], warnings: [], sources: [], suggestedNextActions: [], reviewedAreas: [], limitations: [], judgmentItems: [], claims: [], proposedActions: [], ...answer } as never });

async function turnFor(question: string, project: ProjectState, client: AiGatewayClient, id = 't1'): Promise<AnalystTurn> {
  return askAnalyst({ question, project, client, newId: () => id });
}
const session = (...turns: AnalystTurn[]) => turns.reduce(addTurn, emptySession);

test('페이지 렌더링: 기업 context · 질문 입력 · Quick / Deep 선택 · 예시 질문 · PDF 영역', () => {
  const p = samsung();
  const html = h.renderPage(persisted(p));
  const company = buildAiContext(p).company!;
  assert.match(html, /AI Analyst/);
  assert.ok(html.includes(company.name), '현재 기업 표시');
  assert.match(html, /textarea/);
  assert.match(html, /전송/);
  assert.match(html, /Quick Answer/);
  assert.match(html, /Deep Analysis/);
  assert.match(html, /최근 영업이익률을 분석해줘/);
  assert.match(html, /Knowledge Documents/);
  assert.match(html, /Upload PDF/);
  assert.match(html, /History/);
  assert.match(html, /Evidence/);
  assert.match(html, /Sources/);
  assert.match(html, /Warnings/);
  assert.doesNotMatch(html, /disabled=""[^>]*placeholder/, '기업이 있으면 질문창은 활성이다');
});

test('기업을 선택하기 전에는 질문 · 기록 · 문서 영역 없이 공통 빈 상태만 보인다 (실행 불가, 샘플을 채우지 않는다)', () => {
  const html = h.renderPage(null, undefined, '/ai', { noCompany: true });
  assert.match(html, /기업을 선택해 기업가치평가를 시작하세요\./);
  assert.match(html, /href="\/workspace"[^>]*>기업 검색 · 선택/);
  assert.doesNotMatch(html, /<textarea|전송|Quick Answer|History|Knowledge Documents|Upload PDF|Evidence/);
  assert.doesNotMatch(html, /삼성전자/);
  // 저장된 이전 세션의 기업 데이터가 있어도 선택한 기업이 없으면 보이지 않는다 (reload 후 빈 상태)
  const stale = h.renderPage(persisted(samsung()), undefined, '/ai', { noCompany: true });
  assert.match(stale, /기업을 선택해 기업가치평가를 시작하세요\./);
  assert.doesNotMatch(stale, /삼성전자|textarea/);
});

test('기업은 선택했지만 재무데이터가 없으면 불러오도록 안내하고 값을 만들어 보이지 않는다', () => {
  const html = h.renderPage(null);
  assert.match(html, /현재 기업: 삼성전자/);
  assert.match(html, /Workspace 에서 재무데이터를 먼저 불러오세요/);
  assert.doesNotMatch(html, /2,346|Enterprise Value/);
});

test('Valuation 이 없으면 안내만 하고 값을 자동으로 만들지 않는다', () => {
  const html = h.renderPage(persisted(withSamsungHistorical(emptyProjectState)));
  assert.match(html, /Valuation 을 실행한 뒤/);
  assert.doesNotMatch(html, /<textarea[^>]*disabled/);
});

test('답변 화면: Summary · Key Findings · Interpretation · FACT / JUDGMENT · 상태 · 신뢰도 · 단위 있는 Evidence', async () => {
  const p = samsung();
  const claims = [
    { claimId: 'c1', text: '2025년 영업이익률은 13.07%이다.', type: 'fact', evidenceRefs: [{ tool: 'getHistoricalAnalysis', fieldPath: 'metrics.operatingMargin.values[2]' }] },
    { claimId: 'c2', text: '영업이익률 개선 추세는 수익성 회복을 시사한다.', type: 'interpretation', evidenceRefs: [{ tool: 'getHistoricalAnalysis', fieldPath: 'metrics.operatingMargin.values' }] },
  ];
  const turn = await turnFor('최근 영업이익률을 분석해줘.', p, new Gateway([() => call('getHistoricalAnalysis'), () => done({ summary: '2025년 영업이익률은 13.07%이다.', claims: claims as never, limitations: ['감가상각비 데이터 미수집'] })]));
  const html = h.renderPage(persisted(p), session(turn));
  for (const re of [/Summary/, /Key Findings/, /Interpretation/, /Limitations/, /감가상각비 데이터 미수집/, /FACT/, /JUDGMENT/, /Supported/, /High Confidence|Medium Confidence|Low Confidence/, /Deep Analysis/, /Historical Performance Review/, /Used Data Sources/, /Historical Analysis/, /AI 답변은 자동으로 검증되었습니다/, /Grounded/]) assert.match(html, re, String(re));
  assert.match(html, /claim-fact/);
  assert.match(html, /claim-judgment/);
  assert.match(html, /class="[^"]*completed[^"]*"/);
  assert.doesNotMatch(html, /regenerat|fallback|coverage/i, '일반 화면에는 내부 용어를 노출하지 않는다');
  assert.doesNotMatch(html, /\{"/, 'JSON 을 그대로 보이지 않는다');
});

test('waiting-for-user: 승인 카드(Keep Current · Review Later · Apply / Continue)와 WACC 분리 표시, 적용하지 않는다는 문구', async () => {
  const p = samsung();
  const turn = await turnFor('현재 삼성전자 WACC 가정을 검토해줘.', p, new Gateway([() => call('getForecastAssumptions'), () => done({
    summary: '무위험수익률 가정을 검토하세요.',
    proposedActions: [{ type: 'change-risk-free-rate', target: 'Risk-free Rate', currentValue: '3.0%', proposedValue: '4.29%', rationale: '시장 관찰값이 높다.' }] as never,
  })]));
  const html = h.renderPage(persisted(p), session(turn));
  for (const re of [/Waiting for review/, /Review risk-free rate assumption/, /Keep Current/, /Review Later/, /Apply \/ Continue/, /Current/, /Suggested/, /3\.0%/, /4\.29%/, /구성요소/, /WACC \(결과\)/, /Components/, /Risk-free Rate/, /Beta/, /Market Risk Premium/, /Cost of Debt/, /Project 가정과 결과는 바뀌지 않습니다/]) assert.match(html, re, String(re));
});

test('실패 · 취소 · 한도: 상태 문구와 사용자용 오류 (JSON 없음)', async () => {
  const p = samsung();
  const failed = await turnFor('최근 영업이익률을 분석해줘.', p, new Gateway([() => { throw new AiClientError('backend-unreachable', 'RAW {"x":1}'); }]), 'f1');
  const cancelled = await askAnalyst({ question: '최근 영업이익률을 분석해줘.', project: p, client: new Gateway([() => call('getHistoricalAnalysis')]), newId: () => 'c1', signal: { aborted: true } });
  const html = h.renderPage(persisted(p), session(failed, cancelled), '/ai');
  assert.match(html, /Cancelled/, '마지막 turn 이 선택된다');
  const failedHtml = h.renderPage(persisted(p), session(failed));
  for (const re of [/Failed/, /ValuFlow 서버에 연결할 수 없습니다/, /role="alert"/]) assert.match(failedHtml, re, String(re));
  assert.doesNotMatch(failedHtml, /RAW|\{"x"/);
});

test('이전 Project 상태 표시 · 다른 기업 알림 · History (기업 · workflow · 상태)', async () => {
  const p1 = withSamsungHistorical(emptyProjectState);
  const turn = await turnFor('최근 영업이익률을 분석해줘.', p1, new Gateway([() => call('getHistoricalAnalysis'), () => done({ summary: '요약' })]));
  const stale = h.renderPage(persisted(samsung()), session(turn));   // Project 가 바뀐 뒤(Forecast 가정 추가)
  assert.match(stale, /Based on previous project state/);
  assert.match(stale, /Historical Performance Review/);
  assert.match(stale, /Completed|Completed with limitations/);
  const fresh = h.renderPage(persisted(p1), session(turn));
  assert.doesNotMatch(fresh, /Based on previous project state/);
  const other = h.renderPage(null, session(turn));
  assert.match(other, /현재 선택한 기업과 다른 기업/);
});

test('Evidence / Sources / Warnings 영역: 선택 전 안내 · 출처 배지 · 시점 · 경고', async () => {
  const p = samsung();
  const turn = await turnFor('최근 영업이익률을 분석해줘.', p, new Gateway([() => call('getHistoricalAnalysis'), () => done({
    summary: '2025년 영업이익률은 13.07%이다.',
    claims: [{ claimId: 'c1', text: '2025년 영업이익률은 13.07%이다.', type: 'fact', evidenceRefs: [{ tool: 'getHistoricalAnalysis', fieldPath: 'metrics.operatingMargin.values[2]' }] }] as never,
    warnings: ['D&A 데이터를 사용할 수 없습니다.'],
    sources: [{ kind: 'actual', type: 'financial-data', origin: 'fixture', basis: 'consolidated', fetchedAt: '2026-10-07T00:00:00Z' }] as never,
  })]));
  const html = h.renderPage(persisted(p), session(turn));
  for (const re of [/Claim 을 선택하면 연결된 근거를 보여 줍니다/, /Data Basis/, /FY2023|FY2025/, /Learning Data|OpenDART/, /D&amp;A 데이터를 사용할 수 없습니다/, /Data<\/span>/]) assert.match(html, re, String(re));
});

test('PDF 관리 화면: 목록 · 상태(Ready / Indexing / Failed / Already exists) · Re-index · Delete · 빈 상태 · 오류', () => {
  const doc = (id: number, state: string, title: string) => ({ documentId: id, sourceType: 'user-upload', title, documentType: 'research', corpName: null, businessYear: 2026, uploadedAt: null, filingDate: null, chunkCount: 42, sectionCount: 3, embeddingModel: 'm', originalFilename: `${title}.pdf`, state });
  const html = h.renderKnowledge([doc(1, 'ready', 'Outlook'), doc(2, 'indexing', 'Draft'), doc(3, 'failed', 'Broken'), doc(4, 'already-exists', 'Dup')]);
  for (const re of [/Outlook/, /Ready/, /Indexing/, /Failed/, /Already exists/, /Re-index/, /Delete/, /42 chunks/]) assert.match(html, re, String(re));
  assert.match(h.renderKnowledge([]), /리서치 문서를 업로드하면 AI 분석에 포함됩니다/);
  const err = h.renderKnowledge(null, 'ValuFlow 서버에 연결할 수 없습니다.');
  assert.match(err, /role="alert"/);
  assert.doesNotMatch(err, /문서 목록을 불러오는 중/);
});
