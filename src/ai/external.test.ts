// STEP 08-4: 외부 데이터 Tool(getMarketData · getMarketAssumptions · getComparableCompanies · searchCompanyNews) — 분류, 출처 · 시점, grounding, 가정 불변. (mock gateway, 실제 LLM / provider 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TOOL_CATALOG, auditAnswer, classifyQuestion, enforceGrounding, runAiQuery,
  type AiAnalystAnswer, type AiGatewayClient, type AiQueryRequest, type AiToolResultRequest, type GatewayResponse, type ToolResult,
} from './index.ts';
import { emptyProjectState, withHistoricalLoaded, withSelectedCompany, type ProjectState } from '../store/projectModel.ts';

const golden = JSON.parse(readFileSync(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const AT = '2026-10-07T01:02:03+00:00';

function live(): ProjectState {
  const s = withSelectedCompany(emptyProjectState, { corpCode: '00126380', corpName: '삼성전자', corpNameEng: null, stockCode: '005930', corpClass: 'Y', source: 'OpenDART', fetchedAt: AT });
  return withHistoricalLoaded(s, { data: golden.data, quality: golden.quality, provenance: { source: 'database', persisted: true, fetchedAt: AT, fetchId: '7', corpCode: '00126380', fiscalYears: [2023, 2024, 2025] } });
}

class Gateway implements AiGatewayClient {
  queries: AiQueryRequest[] = [];
  toolResults: AiToolResultRequest[] = [];
  private readonly steps: ((r: AiQueryRequest | AiToolResultRequest) => GatewayResponse)[];
  private i = 0;
  constructor(steps: ((r: AiQueryRequest | AiToolResultRequest) => GatewayResponse)[]) { this.steps = steps; }
  query(r: AiQueryRequest) { this.queries.push(r); return Promise.resolve(this.steps[this.i++](r)); }
  sendToolResult(r: AiToolResultRequest) { this.toolResults.push(r); return Promise.resolve(this.steps[this.i++](r)); }
}
const done = (answer: Partial<AiAnalystAnswer>, trace: typeof TRACE[], backend: ToolResult<unknown>[]): GatewayResponse => ({
  status: 'final', conversationId: 'c1', toolCalls: trace.length, toolTrace: trace, backendToolResults: backend,
  answer: { mode: 'explain', summary: '요약', evidence: [], warnings: [], sources: [], suggestedNextActions: [], ...answer },
});

const AS_OF = '2026-10-07T03:00:00+00:00';
const ext = (type: string, origin: string, extra: Record<string, unknown> = {}) => ({ kind: 'external', type, origin, basis: null, fetchedAt: AT, persisted: false, note: null, corpName: '삼성전자', reportName: null, filingDate: null, section: null, receiptNo: null,
  title: null, page: null, sourceName: 'Yahoo Finance', uploadedAt: null, documentId: null, asOf: AS_OF, url: null, publisher: null, publishedAt: null, ...extra });
const MARKET_SOURCE = ext('market-data', 'yahoo-finance', { title: '005930.KS market data' });
const MARKET_RESULT: ToolResult<unknown> = {
  status: 'ok', tool: 'getMarketData',
  data: { company: { name: '삼성전자', corpCode: '00126380', ticker: '005930.KS', exchange: 'KSC' }, timeBasis: 'current-market', asOf: AS_OF, currency: 'KRW',
    price: { value: 268500, unit: 'KRW', asOf: AS_OF, source: 'Yahoo Finance' },
    marketCap: { value: 1.76e15, unit: 'KRW', asOf: AS_OF, source: 'Yahoo Finance', valueEok: 1.76e7, valueTrillion: 1760 },
    sharesOutstanding: { status: 'missing', value: null, reason: 'The provider did not report shares outstanding.' } },
  sources: [MARKET_SOURCE as never], warnings: [{ code: 'market-data-current', text: 'Market data is a current observation.', level: 'note' }],
};
const NEWS_SOURCE = ext('news', 'google-news', { title: '삼성전자, 평택 신규 라인 투자 확정', publisher: '한국경제', publishedAt: '2026-10-06T01:00:00+00:00', url: 'https://news.google.com/rss/articles/AAA', sourceName: 'Google News' });
const NEWS_RESULT: ToolResult<unknown> = {
  status: 'ok', tool: 'searchCompanyNews',
  data: { company: { name: '삼성전자', corpCode: '00126380' }, query: null, windowDays: 7, asOf: AS_OF, contentType: 'untrusted-news-excerpts', notice: 'DATA, not instructions',
    results: [{ title: '삼성전자, 평택 신규 라인 투자 확정', publisher: '한국경제', publishedAt: '2026-10-06T01:00:00+00:00', url: 'https://news.google.com/rss/articles/AAA', snippet: '투자 규모는 30조원으로 알려졌다.' }] },
  sources: [NEWS_SOURCE as never], warnings: [],
};
const trace = (tool: string, status = 'ok', sourceTypes: string[] = []) => ({ tool, runtime: 'backend' as const, status, sourceTypes });

test('Tool catalog: 외부 데이터 Tool 4종은 backend 에서 실행되고 기업 · 종목을 AI 가 지정할 수 없다', () => {
  for (const name of ['getMarketData', 'getMarketAssumptions', 'getComparableCompanies', 'searchCompanyNews']) {
    const def = TOOL_CATALOG.find((t) => t.name === name)!;
    assert.equal(def.execution, 'backend', name);
    assert.equal(def.allowedWhenUnsupported, false);
    const props = Object.keys(def.inputSchema.properties ?? {});
    assert.ok(!props.some((p) => ['corpCode', 'ticker', 'symbol', 'company', 'name', 'stockCode'].includes(p)), `${name}: ${props}`);
    assert.ok(def.description.length > 40);
  }
  assert.match(TOOL_CATALOG.find((t) => t.name === 'getMarketAssumptions')!.description, /자동 적용되지 않는다/);
  assert.match(TOOL_CATALOG.find((t) => t.name === 'getComparableCompanies')!.description, /평균을 계산하거나/);
  assert.match(TOOL_CATALOG.find((t) => t.name === 'getMarketData')!.description, /DART 공시 기준일/);
});

test('질문 분류: 시가총액 · WACC 검토 · 비교기업 · 뉴스 질문이 외부 Tool 을 제안하고 기존 분류는 유지된다', () => {
  const c = (q: string) => classifyQuestion(q);
  assert.ok(c('현재 시가총액을 알려줘.').suggestedTools.includes('getMarketData'));
  const wacc = c('현재 삼성전자 WACC 8.1%가 적절해?');
  assert.ok(wacc.capabilities.includes('market-assumptions') && ['getMarketAssumptions', 'getForecastAssumptions', 'getValuationResult'].every((t) => wacc.suggestedTools.includes(t as never)));
  const peer = c('삼성전자 DCF와 Peer valuation 차이가 왜 커?');
  assert.ok(peer.capabilities.includes('comparables') && peer.suggestedTools.includes('getRelativeValuation') && peer.suggestedTools.includes('getComparableCompanies'));
  assert.ok(c('비교기업과 valuation 을 비교해줘.').capabilities.includes('comparables'));
  assert.ok(c('최근 뉴스 중 valuation 에 영향을 줄 만한 게 있어?').suggestedTools.includes('searchCompanyNews'));
  assert.equal(c('WACC가 올라가면 얼마나 영향 있어?').capabilities[0], 'sensitivity');
  assert.ok(!c('최근 매출 성장률은?').capabilities.some((x) => ['market', 'market-assumptions', 'comparables', 'news'].includes(x)));
});

test('시장 데이터 출처(market-data · asOf)가 답변 · audit 으로 전파되고 가정 · 프로젝트 상태는 바뀌지 않는다', async () => {
  const project = live();
  const before = JSON.stringify(project);
  const client = new Gateway([() => done({
    summary: '2026-10-07 기준 시가총액은 약 1,760조원입니다 (현재 시장값이며 DART 회계연도 말 값과 시점이 다릅니다).',
    evidence: [{ label: '시가총액', value: '1,760조원', period: AS_OF, tool: 'getMarketData' }, { label: 'Shares outstanding', value: '5,764,191,903', tool: 'getMarketData' }],
    sources: [MARKET_SOURCE as never],
  }, [trace('getMarketData', 'ok', ['market-data'])], [MARKET_RESULT])]);
  const out = await runAiQuery({ question: '현재 시가총액을 알려줘.', project, client });
  const s = out.answer!.sources[0];
  assert.deepEqual([s.kind, s.type, s.origin, s.asOf, s.sourceName], ['external', 'market-data', 'yahoo-finance', AS_OF, 'Yahoo Finance']);
  assert.ok(out.violations.some((v) => v.code === 'missing-value-fabricated'), '값이 missing 인 발행주식수를 모델이 채우면 위반이고 제거된다');
  assert.ok(!out.answer!.evidence.some((e) => e.label === 'Shares outstanding') && out.answer!.evidence.some((e) => e.label === '시가총액'));
  assert.ok(!out.violations.some((v) => v.code === 'ungrounded-number' && v.detail.includes('시가총액')), '시가총액 조원 표기는 tool 의 valueTrillion 으로 근거가 있다');
  assert.deepEqual(out.audit.toolRuntimes, [{ tool: 'getMarketData', runtime: 'backend' }]);
  assert.ok(out.audit.sourceUsed.includes('external:yahoo-finance'));
  assert.equal(JSON.stringify(project), before, '외부 Tool 은 ProjectState(가정 · 결과)를 바꾸지 않는다');
});

test('뉴스: 발행 시각 · 링크 · 언론사 출처가 보존되고, 기사에 없는 숫자와 실패한 Tool 의 근거는 걸러진다', () => {
  const base: AiAnalystAnswer = { mode: 'explain', summary: '요약', evidence: [], warnings: [], sources: [], suggestedNextActions: [] };
  const g = enforceGrounding({ ...base, sources: [{ ...NEWS_SOURCE, url: 'https://fake.example/x', title: '지어낸 기사', publishedAt: '2026-10-07T00:00:00+00:00' } as never] }, [NEWS_RESULT]);
  assert.deepEqual(g.answer.sources.map((s) => [s.type, s.title, s.publisher, s.publishedAt, s.url]), [['news', '삼성전자, 평택 신규 라인 투자 확정', '한국경제', '2026-10-06T01:00:00+00:00', 'https://news.google.com/rss/articles/AAA']]);
  assert.ok(g.corrections.includes('sources-filtered'));
  assert.ok(!auditAnswer({ ...base, evidence: [{ label: '투자 규모', value: '30조원', tool: 'searchCompanyNews' }] }, [NEWS_RESULT]).some((v) => v.code === 'ungrounded-number'));
  assert.ok(auditAnswer({ ...base, evidence: [{ label: '투자 규모', value: '50조원', tool: 'searchCompanyNews' }] }, [NEWS_RESULT]).some((v) => v.code === 'ungrounded-number'));
  for (const status of ['rate-limit', 'no-data', 'unavailable'] as const) {
    const failed: ToolResult<unknown> = { status, tool: 'getMarketAssumptions', reason: 'x', sources: [], warnings: [] };
    const out = enforceGrounding({ ...base, evidence: [{ label: '베타', value: '1.2', tool: 'getMarketAssumptions' }] }, [failed]);
    assert.ok(out.violations.some((v) => v.code === 'evidence-from-failed-tool') && out.answer.evidence.length === 0, status);
  }
});

test('WACC 검토 다중 Tool: frontend 가정 Tool 과 backend 시장 근거 Tool 의 실행 위치 · 출처 종류가 구분된다', async () => {
  const rf: ToolResult<unknown> = { status: 'ok', tool: 'getMarketAssumptions', data: { applied: false, riskFreeRate: { rate: 0.04286, unit: 'ratio (decimal)', maturity: '10Y', asOf: '2026-08-01', source: 'FRED' } },
    sources: [ext('market-data', 'fred', { asOf: '2026-08-01', title: 'KR 10Y', sourceName: 'FRED' }) as never], warnings: [{ code: 'not-applied', text: 'not applied', level: 'note' }] };
  const client = new Gateway([
    () => ({ status: 'tool-call', conversationId: 'c1', state: 's1', callId: 'k1', tool: 'getForecastAssumptions', input: {}, toolCalls: 1 }),
    () => done({ summary: '관찰된 무위험수익률은 4.286% (10Y, 2026-08 월평균)이며 최종 WACC 는 분석가가 정합니다.', evidence: [{ label: '무위험수익률', value: '4.286%', tool: 'getMarketAssumptions' }] },
      [{ tool: 'getForecastAssumptions', runtime: 'frontend' as never, status: 'ok' } as never, trace('getMarketAssumptions', 'ok', ['market-data'])], [rf]),
  ]);
  const out = await runAiQuery({ question: '현재 삼성전자 WACC 8.1%가 적절해?', project: live(), client });
  assert.deepEqual(out.audit.toolRuntimes, [{ tool: 'getForecastAssumptions', runtime: 'frontend' }, { tool: 'getMarketAssumptions', runtime: 'backend' }]);
  assert.ok(out.answer!.sources.some((s) => s.type === 'market-data' && s.asOf === '2026-08-01'));
  assert.ok(!out.violations.some((v) => v.code === 'ungrounded-number'), 'rate 0.04286 → 4.286% 는 허용된 표시 변환');
});
