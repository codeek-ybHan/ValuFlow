// 문서 질문 라우팅: "이 문서" · "업로드한 PDF" 는 업로드 문서 검색, "사업보고서에서" · "공시에서" 는 공시 검색. 회사가 선택돼 있다는 이유만으로 공시로 보내지 않는다. (mock gateway, 실제 LLM / backend 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOL_CATALOG, buildAiContext, type AiAnalystAnswer, type AiGatewayClient, type AiQueryRequest, type AiToolResultRequest, type GatewayResponse, type ToolResult } from './index.ts';
import { askAnalyst } from './analyst/ask.ts';
import { planWorkflow } from './agent/planner.ts';
import { extractEvidence } from './grounding/evidence.ts';
import { evidenceView, sourceView } from './analyst/view.ts';
import { NO_UPLOADED_DOCUMENTS, routeRetrieval, toolNamesFor } from './retrievalRoute.ts';
import { TOOL_CALLING_INSTRUCTIONS } from './policy.ts';
import { countSearchableUploads, type KnowledgeDocument } from '../data/repository/knowledgeRepository.ts';
import { emptyProjectState, withHistoricalLoaded, withSelectedCompany, type ProjectState } from '../store/projectModel.ts';

const golden = JSON.parse(readFileSync(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const AT = '2026-10-07T01:02:03+00:00';
const ALL = TOOL_CATALOG.map((t) => t.name);
const SAMSUNG = '00126380', HYUNDAI = '00164742';

function live(): ProjectState {
  const s = withSelectedCompany(emptyProjectState, { corpCode: SAMSUNG, corpName: '삼성전자', corpNameEng: null, stockCode: '005930', corpClass: 'Y', source: 'OpenDART', fetchedAt: AT });
  return withHistoricalLoaded(s, { data: golden.data, quality: golden.quality, provenance: { source: 'database', persisted: true, fetchedAt: AT, fetchId: '7', corpCode: SAMSUNG, fiscalYears: [2023, 2024, 2025] } });
}

class Gateway implements AiGatewayClient {
  queries: AiQueryRequest[] = [];
  query(r: AiQueryRequest): Promise<GatewayResponse> { this.queries.push(r); return Promise.resolve(final()); }
  sendToolResult(_r: AiToolResultRequest): Promise<GatewayResponse> { throw new Error('unexpected'); }
}
const final = (answer: Partial<AiAnalystAnswer> = {}): GatewayResponse => ({ status: 'final', conversationId: 'c1', toolCalls: 0, toolTrace: [], backendToolResults: [], answer: { mode: 'explain', summary: '요약', evidence: [], warnings: [], sources: [], suggestedNextActions: [], ...answer } });

const RETRIEVAL = ['searchDisclosures', 'searchUploadedDocuments', 'searchKnowledge'];
const retrievalOf = (names: string[]) => names.filter((n) => RETRIEVAL.includes(n));

test('A. 최근 PDF 업로드 + "이 문서에서 반도체 밸류체인을 어떻게 구분하고 있나요?" → 업로드 문서 검색만 허용한다 (공시 검색 아님)', async () => {
  const q = '이 문서에서 반도체 밸류체인을 어떻게 구분하고 있나요?';
  const d = routeRetrieval(q, { uploadedCount: 1 });
  assert.equal(d.route, 'uploaded');
  assert.equal(d.limitation, null);
  const gw = new Gateway();
  const turn = await askAnalyst({ question: q, project: live(), client: gw, uploadedCount: 1, newId: () => 't1' });
  assert.equal(gw.queries.length, 1);
  assert.deepEqual(retrievalOf(gw.queries[0]!.toolNames), ['searchUploadedDocuments'], '공시 검색 · 통합 검색 Tool 은 모델에 주어지지 않는다');
  assert.equal((gw.queries[0]!.minimalContext as { retrievalRoute: { route: string } }).retrievalRoute.route, 'uploaded');
  assert.ok(gw.queries[0]!.toolNames.includes('getHistoricalAnalysis'), '숫자 Tool 은 그대로 쓸 수 있다');
  assert.notEqual(turn.error?.title, '업로드한 문서가 없습니다');
});

test('B. "업로드한 PDF에서 핵심 내용을 찾아줘." → 업로드 문서 검색', async () => {
  const q = '업로드한 PDF에서 핵심 내용을 찾아줘.';
  assert.equal(routeRetrieval(q, { uploadedCount: 2 }).route, 'uploaded');
  const gw = new Gateway();
  await askAnalyst({ question: q, project: live(), client: gw, uploadedCount: 2, newId: () => 't1' });
  assert.deepEqual(retrievalOf(gw.queries[0]!.toolNames), ['searchUploadedDocuments']);
  // 문서 표현 6종 (요구사항 목록)
  for (const phrase of ['이 문서에서 찾아줘', '업로드한 문서에서 찾아줘', '업로드한 PDF 에서 찾아줘', '이 PDF 에서 찾아줘', '첨부 문서에서 찾아줘', 'Knowledge Document 에서 찾아줘', '방금 올린 문서에서 찾아줘']) {
    assert.equal(routeRetrieval(phrase, { uploadedCount: 1 }).route, 'uploaded', phrase);
  }
});

test('C. "삼성전자 사업보고서에서 반도체 투자 내용을 찾아줘." → 공시 검색 (업로드 문서가 있어도)', async () => {
  const q = '삼성전자 사업보고서에서 반도체 투자 내용을 찾아줘.';
  assert.equal(routeRetrieval(q, { uploadedCount: 3 }).route, 'disclosure');
  for (const phrase of ['공시에서 설비투자 계획을 찾아줘', '삼성전자 공시에서 위험요인은?']) assert.equal(routeRetrieval(phrase, { uploadedCount: 3 }).route, 'disclosure', phrase);
  const gw = new Gateway();
  await askAnalyst({ question: q, project: live(), client: gw, preference: 'quick', uploadedCount: 3, newId: () => 't1' });
  assert.deepEqual(retrievalOf(gw.queries[0]!.toolNames), ['searchDisclosures'], '업로드 문서 검색은 주어지지 않는다');
  // 둘 다 명시하면 모두 허용
  assert.equal(routeRetrieval('공시와 업로드한 문서를 비교해줘', { uploadedCount: 1 }).route, 'both');
  assert.deepEqual(retrievalOf(toolNamesFor(ALL, 'both')).sort(), [...RETRIEVAL].sort());
});

test('D. 업로드한 PDF 가 없는데 "이 문서" → LLM 을 부르지 않고 명확한 limitation (공시로 우회하지 않는다)', async () => {
  const q = '이 문서에서 반도체 밸류체인을 어떻게 구분하고 있나요?';
  const d = routeRetrieval(q, { uploadedCount: 0 });
  assert.equal(d.route, 'uploaded');
  assert.equal(d.limitation, NO_UPLOADED_DOCUMENTS);
  const gw = new Gateway();
  const turn = await askAnalyst({ question: q, project: live(), client: gw, uploadedCount: 0, newId: () => 't1' });
  assert.equal(gw.queries.length, 0, 'gateway(LLM) 호출 없음');
  assert.equal(turn.status, 'failed');
  assert.equal(turn.error?.title, '업로드한 문서가 없습니다');
  assert.match(turn.error!.detail, /Knowledge Documents/);
  assert.equal(turn.answer, null);
  // 공시를 명시한 질문은 업로드 문서가 없어도 막지 않는다
  assert.equal(routeRetrieval('삼성전자 사업보고서에서 투자 내용을 찾아줘', { uploadedCount: 0 }).limitation, null);
  // 업로드 문서 수를 모르면(목록을 못 받음) 막지 않는다
  assert.equal(routeRetrieval(q, { uploadedCount: null }).limitation, null);
});

const doc = (id: number, corpCode: string | null, over: Partial<KnowledgeDocument> = {}): KnowledgeDocument => ({ documentId: id, sourceType: 'user-upload', title: `doc${id}`, documentType: null, corpCode, corpName: null, businessYear: null, uploadedAt: AT, filingDate: null, chunkCount: 5, sectionCount: null, embeddingModel: 'm', originalFilename: `doc${id}.pdf`, state: 'ready', ...over });

test('E. 다른 기업에 귀속된 PDF 는 범위에 들어오지 않는다 (현재 기업 문서 + 일반 문서만)', async () => {
  const list = (docs: KnowledgeDocument[]) => ({ list: async () => docs });
  assert.equal(await countSearchableUploads(SAMSUNG, list([doc(1, HYUNDAI)])), 0, '현대차 문서만 있으면 삼성전자 범위는 0');
  assert.equal(await countSearchableUploads(SAMSUNG, list([doc(1, HYUNDAI), doc(2, null), doc(3, SAMSUNG)])), 2, '일반 문서 + 현재 기업 문서');
  assert.equal(await countSearchableUploads(SAMSUNG, list([doc(1, SAMSUNG, { state: 'failed' })])), 0, '실패한 문서는 검색 대상이 아니다');
  assert.equal(await countSearchableUploads(SAMSUNG, { list: async () => { throw new Error('x'); } }), null, '목록을 못 받으면 모름');
  // 다른 기업 문서만 있는 상태에서 "이 문서" → 업로드 문서가 없다는 안내 (그 문서를 검색하지 않는다)
  const n = await countSearchableUploads(SAMSUNG, list([doc(1, HYUNDAI)]));
  const gw = new Gateway();
  const turn = await askAnalyst({ question: '이 문서에서 핵심을 찾아줘', project: live(), client: gw, uploadedCount: n, newId: () => 't1' });
  assert.equal(gw.queries.length, 0);
  assert.equal(turn.error?.title, '업로드한 문서가 없습니다');
});

test('문서 지시가 없으면 기존 동작: 모든 검색 Tool 이 주어지고 라우팅 지시는 붙지 않는다', async () => {
  const gw = new Gateway();
  await askAnalyst({ question: '최근 영업이익률은?', project: live(), client: gw, preference: 'quick', uploadedCount: 2, newId: () => 't1' });
  assert.deepEqual(gw.queries[0]!.toolNames, [...ALL]);
  assert.ok(!('retrievalRoute' in gw.queries[0]!.minimalContext));
  assert.equal(routeRetrieval('삼성전자 영업이익률은?', { uploadedCount: 2 }).route, 'default');
  // "문서" 일반 표현: 공시를 말하지 않았고 업로드 문서가 있으면 업로드 문서로, 없으면 default
  assert.equal(routeRetrieval('문서에서 HBM 언급을 찾아줘', { uploadedCount: 1 }).route, 'uploaded');
  assert.equal(routeRetrieval('문서에서 HBM 언급을 찾아줘', { uploadedCount: 0 }).route, 'default');
});

test('Deep Analysis 도 같은 라우팅: "이 문서에서 설비투자 이유" 는 공시 검색 단계가 업로드 문서 검색으로 바뀐다', () => {
  const ctx = buildAiContext(live());
  const q = '이 문서에서 설비투자 확대 이유를 어떻게 설명하나요?';
  const by = (route: 'uploaded' | 'disclosure' | 'default') => planWorkflow(q, ctx, { route })!.steps.map((s) => s.tool);
  assert.equal(planWorkflow(q, ctx)!.workflowType, 'disclosure-review');
  assert.deepEqual(by('uploaded').filter((t) => t.startsWith('search')), ['searchUploadedDocuments']);
  assert.ok(!by('uploaded').includes('searchDisclosures') && !by('uploaded').includes('searchKnowledge'));
  assert.deepEqual(by('disclosure').filter((t) => t.startsWith('search')), ['searchDisclosures']);
  assert.deepEqual(by('default').filter((t) => t.startsWith('search')), ['searchDisclosures', 'searchKnowledge'], '지시가 없으면 기존 workflow 그대로');
  const step = planWorkflow(q, ctx, { route: 'uploaded' })!.steps.find((s) => s.tool === 'searchUploadedDocuments')!;
  assert.equal(step.optional, false, '공시 검색의 필수 단계를 그대로 이어받는다');
});

test('Evidence: Uploaded PDF · 파일명 · 페이지 · 발췌를 표시한다', () => {
  const result: ToolResult<unknown> = {
    status: 'ok', tool: 'searchUploadedDocuments',
    data: { query: '밸류체인', company: { name: '삼성전자', corpCode: SAMSUNG }, results: [{ text: '반도체 밸류체인은 설계(팹리스) · 제조(파운드리) · 패키징 · 장비/소재로 구분한다.', title: '2026 Semiconductor Outlook', sourceType: 'user-upload',
      reportName: '2026 Semiconductor Outlook', pageNumber: 18, section: null, retrievalScore: 0.5, finalRank: 1, documentId: '7', receiptNo: null, sourceName: 'PwC Insight', uploadedAt: AT, filename: 'semiconductor-outlook-2026.pdf' }] },
    sources: [{ kind: 'document', type: 'uploaded-document', origin: 'user-upload', basis: null, fetchedAt: AT, title: '2026 Semiconductor Outlook', page: 18, documentId: '7', uploadedAt: AT, filename: 'semiconductor-outlook-2026.pdf' } as never], warnings: [],
  };
  const ev = extractEvidence([result]).list[0]!;
  const v = evidenceView(ev);
  assert.equal(v.badgeLabel, 'Uploaded PDF');
  assert.equal(v.filename, 'semiconductor-outlook-2026.pdf');
  assert.equal(v.page, 18);
  assert.match(v.excerpt ?? '', /밸류체인/);
  const s = sourceView(result.sources[0] as never, new Map());
  assert.ok(s.lines.some((l) => l.includes('semiconductor-outlook-2026.pdf')) && s.lines.includes('p.18'));
  const parts = readFileSync(new URL('../components/analyst/parts.tsx', import.meta.url), 'utf8');
  assert.match(parts, /<dt>File<\/dt>/);
  assert.match(parts, /details open=\{e\.badge === 'upload'\}/, '업로드 문서의 발췌는 펼쳐서 보여 준다');
});

test('LLM 지침과 backend catalog 에 retrievalRoute 규칙이 있다 (모델이 context 의 라우팅을 따른다)', () => {
  assert.match(TOOL_CALLING_INSTRUCTIONS, /retrievalRoute[\s\S]*never searchDisclosures[\s\S]*selected is never a reason/);
  const catalog = JSON.parse(readFileSync(new URL('../../backend/app/ai/tool_catalog.json', import.meta.url), 'utf8'));
  assert.match(JSON.stringify(catalog.systemInstruction), /retrievalRoute/);
});
