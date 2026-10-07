// STEP 08-6: Grounded Analysis — Evidence 추출, Claim ↔ Evidence 검증, 숫자 · 단위 · 파생 수치, WACC 의미 검증, 우선순위 · 충돌 · 신뢰도 · 시점, 교정 재생성 · fallback · coverage · audit. (mock, 실제 LLM 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildAiContext, enforceGrounding, executeTool, extractEvidence, groundAnalysis, groundWithRepair, koreanAliases, parseNumbers, sourcePriority, termsIn, validateProposal, detectContradictions,
  type AiAnalystAnswer, type AiGatewayClient, type AiRegenerateRequest, type Evidence, type ToolResult,
} from './index.ts';
import { emptyProjectState, withHistoricalLoaded, withPracticeAssumptions, withRelativeInputs, withSelectedCompany } from '../store/projectModel.ts';

const golden = JSON.parse(readFileSync(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const AT = '2026-10-07T03:00:00+00:00';
const project = withRelativeInputs(withPracticeAssumptions(withHistoricalLoaded(withSelectedCompany(emptyProjectState, { corpCode: '00126380', corpName: '삼성전자', corpNameEng: null, stockCode: '005930', corpClass: 'Y', source: 'OpenDART', fetchedAt: AT }),
  { data: golden.data, quality: golden.quality, provenance: { source: 'database', persisted: true, fetchedAt: AT, fetchId: '7', corpCode: '00126380', fiscalYears: [2023, 2024, 2025] } })), { netIncome: 150, per: 12, bookEquity: 1000, pbr: 1.5, ebitda: 220, evEbitda: 10 });
const ctx = buildAiContext(project);
const det = (...tools: string[]) => tools.map((t) => executeTool(t, ctx));
const ext = (type: string, origin: string, extra: Record<string, unknown> = {}) => ({ kind: 'external', type, origin, basis: null, fetchedAt: AT, persisted: false, note: null, asOf: AT, ...extra }) as ToolResult<unknown>['sources'][number];
const ok = (tool: string, data: unknown, sources: ToolResult<unknown>['sources'] = [], warnings: ToolResult<unknown>['warnings'] = []): ToolResult<unknown> => ({ status: 'ok', tool, data, sources, warnings });
const PROVIDER = { name: 'Yahoo Finance', reliability: 'unofficial', tier: 'development', official: false, valuationGrade: false, note: 'x' };
const market = ok('getMarketData', { asOf: AT, providers: [PROVIDER], marketCap: { value: 1.763122e15, unit: 'KRW', asOf: AT, source: 'Yahoo Finance', valueEok: 1.763122e7, valueTrillion: 1763.122 }, price: { value: 268500, unit: 'KRW', asOf: AT, source: 'Yahoo Finance' },
  sharesOutstanding: { status: 'missing', value: null, reason: 'not reported' } }, [ext('market-data', 'yahoo-finance')]);
const assumptions = ok('getMarketAssumptions', { asOf: AT, providers: [PROVIDER], riskFreeRate: { rate: 0.04286, unit: 'ratio (decimal)', maturity: '10Y', asOf: '2026-08-01', source: 'FRED' }, beta: { value: 1.545, basis: 'raw', asOf: AT, source: 'Yahoo Finance' } }, [ext('market-data', 'fred')]);
const passage = (i: number, text: string, extra: Record<string, unknown> = {}) => ({ text, title: '사업보고서 (2025.12)', sourceType: 'opendart', reportName: '사업보고서 (2025.12)', documentId: '20260310002820', section: 'II. 사업의 내용 > 3. 원재료 및 생산설비', filingDate: '2026-03-10', retrievalScore: 0.5, rerankScore: 0.9 - i * 0.1, finalRank: i + 1, receiptNo: '20260310002820', ...extra });
const DOC_SOURCE = ext('disclosure-document', 'opendart', { kind: 'document', reportName: '사업보고서 (2025.12)', documentId: '20260310002820' });
const disclosure = ok('searchDisclosures', { results: [passage(0, '당사는 HBM 등 첨단 공정 전환을 위해 시설투자를 확대하고 있으며 2025년 시설투자 금액은 52.7조원입니다.'), passage(1, '환율 변동 위험을 관리합니다.')] }, [DOC_SOURCE]);
const upload = ok('searchUploadedDocuments', { results: [{ ...passage(0, 'AI 서버 수요 증가로 HBM 시장이 빠르게 성장할 전망이다.'), title: '2026 Semiconductor Outlook', sourceType: 'user-upload', documentId: '7', pageNumber: 18, section: null }] }, [ext('uploaded-document', 'user-upload', { title: '2026 Semiconductor Outlook', page: 18, documentId: '7' })]);
const news = ok('searchCompanyNews', { results: [{ title: '삼성전자 평택 신규 라인 투자 확정', publisher: '한국경제', publishedAt: '2026-10-06T01:00:00+00:00', url: 'https://n/1', snippet: '투자 규모는 30조원으로 알려졌다.' }] }, [ext('news', 'google-news', { title: 'x', url: 'https://n/1' })]);
const peers = (opm: number) => ok('getComparableCompanies', { subject: { ticker: '005930.KS', operatingMargin: opm, revenueGrowth: 0.1, multiples: { per: null, pbr: null, evEbitda: 7.2 } }, peers: [{ ticker: '000660.KS', operatingMargin: 0.45, multiples: { per: 9.1, pbr: null, evEbitda: 6.5 } }], providers: [PROVIDER] }, [ext('peer-data', 'yahoo-finance')]);

const C = (claimId: string, text: string, type: 'fact' | 'calculation' | 'interpretation' | 'risk' | 'recommendation', ...refs: [string, string | null][]) => ({ claimId, text, type, evidenceRefs: refs.map(([tool, fieldPath]) => ({ tool, fieldPath })) });
const ground = (results: ToolResult<unknown>[], claims: unknown[], summary = '요약', proposed: never[] = []) => groundAnalysis({ summary, claims, proposedActions: proposed, index: extractEvidence(results) });
const by = (o: ReturnType<typeof ground>, id: string) => o.claims.find((c) => c.claimId === id)!;

test('Numerical · Valuation evidence: fieldPath · 값 · 단위 · 기간 · 출처 종류가 추출되고 엔진 값은 calculated, LLM 계산 값은 근거가 아니다', () => {
  const idx = extractEvidence(det('getHistoricalAnalysis', 'getValuationResult', 'getForecastAssumptions'));
  const om = idx.byId.get('getHistoricalAnalysis:metrics.operatingMargin.values[2]')!;
  assert.deepEqual([om.sourceType, om.sourceKind, om.period, om.quality], ['financial-data', 'actual', '2025A', 'available']);
  assert.ok(Math.abs((om.value as number) - 0.1307) < 1e-3 && /ratio/.test(om.unit!) && /database/.test(om.sourceLabel!));
  const ev = idx.byId.get('getValuationResult:enterpriseValue')!;
  assert.deepEqual([ev.sourceKind, ev.unit, idx.byId.get('getValuationResult:wacc')!.unit, idx.byId.get('getValuationResult:perShareValue')!.unit], ['calculated', '억원', 'ratio', '원']);
  assert.equal(idx.byId.get('getForecastAssumptions:wacc.riskFreeRate')!.sourceKind, 'assumption');
  const o = ground(det('getValuationResult'), [C('c1', '기업가치는 2,346억원이다.', 'calculation', ['getValuationResult', 'enterpriseValue']), C('c2', '기업가치는 1조 2,000억원이다.', 'calculation', ['getValuationResult', 'enterpriseValue'])]);
  assert.equal(by(o, 'c1').status, 'supported');
  assert.equal(by(o, 'c1').basis, 'objective');
  assert.equal(by(o, 'c2').status, 'unsupported', 'Tool 에 없는 값(LLM 임의 값)은 근거가 아니다');
  assert.ok(by(o, 'c2').numbers.some((n) => n.status === 'ungrounded'));
});

test('Documentary evidence: 문서 · page · section · 발췌가 연결되고 발췌에 없는 주장은 text-not-in-evidence', () => {
  const idx = extractEvidence([disclosure, upload]);
  const d = idx.byId.get('searchDisclosures:results[0]')!;
  assert.deepEqual([d.sourceType, d.documentId, d.section, d.sourceLabel], ['disclosure-document', '20260310002820', 'II. 사업의 내용 > 3. 원재료 및 생산설비', '사업보고서 (2025.12)']);
  assert.ok(d.excerpt!.includes('HBM') && d.retrieval!.rank === 1 && d.retrieval!.count === 2);
  const u = idx.byId.get('searchUploadedDocuments:results[0]')!;
  assert.deepEqual([u.sourceType, u.page, u.sourceLabel], ['uploaded-document', 18, '2026 Semiconductor Outlook']);
  const o = ground([disclosure, upload], [
    C('c1', '회사는 HBM 등 첨단 공정 전환을 위해 시설투자를 확대하고 있다고 밝혔다.', 'fact', ['searchDisclosures', 'results[0]']),
    C('c2', '회사는 2025년 시설투자가 52.7조원이라고 공시했다.', 'fact', ['searchDisclosures', 'results[0]']),
    C('c3', '회사는 신규 데이터센터 사업 진출을 공시했다.', 'fact', ['searchDisclosures', null]),
    C('c4', '업로드 리포트는 AI 서버 수요 증가로 HBM 시장이 성장한다고 본다.', 'fact', ['searchUploadedDocuments', 'results[0]']),
  ]);
  assert.deepEqual(['c1', 'c2', 'c3', 'c4'].map((id) => by(o, id).status), ['supported', 'supported', 'unsupported', 'supported']);
  assert.ok(by(o, 'c3').issues.includes('text-not-in-evidence'));
  assert.ok(by(o, 'c2').numbers[0].status === 'grounded' && by(o, 'c2').evidenceIds.includes('searchDisclosures:results[0]'), '문서의 숫자도 발췌에서 확인된다');
  assert.deepEqual(o.report.evidenceMap.filter((e) => e.sourceType === 'uploaded-document').map((e) => [e.documentId, e.page]), [['7', 18]]);
});

test('Market evidence: 시점(asOf · publishedAt) · provider 등급이 붙고 단위 환산(KRW → 조원)이 허용된다', () => {
  const idx = extractEvidence([market, news, assumptions]);
  const mc = idx.byId.get('getMarketData:marketCap.value')!;
  assert.deepEqual([mc.sourceType, mc.asOf, mc.provider?.reliability, mc.unit], ['market-data', AT, 'unofficial', 'KRW']);
  assert.equal(idx.byId.get('searchCompanyNews:results[0]')!.asOf, '2026-10-06T01:00:00+00:00');
  assert.equal(idx.byId.get('getMarketData:sharesOutstanding')!.missing, true);
  const o = ground([market, assumptions], [
    C('c1', `${'2026-10-07'} 기준 시가총액은 약 1,763조원이다.`, 'fact', ['getMarketData', 'marketCap.value']),
    C('c2', '10년 국고채 기준 무위험수익률은 4.29%다.', 'fact', ['getMarketAssumptions', 'riskFreeRate.rate']),
    C('c3', '베타는 1.5로 관찰된다.', 'fact', ['getMarketAssumptions', 'beta.value']),
  ]);
  assert.deepEqual(['c1', 'c2', 'c3'].map((id) => by(o, id).status), ['supported', 'supported', 'supported']);
  assert.ok(['c1', 'c2'].every((id) => by(o, id).confidence === 'low'), '개발용 provider 의 값은 신뢰도 low');
});

test('Fact · Interpretation · Recommendation: fact 는 수치 근거, 해석 · 권고는 관련 근거 하나 이상이 필요하고 judgment 로 구분된다', () => {
  const r = det('getHistoricalAnalysis', 'getValuationResult', 'getForecastAssumptions');
  const o = ground([...r, assumptions], [
    C('c1', '2025년 영업이익률은 약 13.1%다.', 'fact', ['getHistoricalAnalysis', 'metrics.operatingMargin.values[2]']),
    C('c2', '수익성이 크게 회복됐다.', 'interpretation', ['getHistoricalAnalysis', 'metrics.operatingMargin.values[2]']),
    C('c3', 'WACC 가정을 재검토할 필요가 있다.', 'recommendation', ['getValuationResult', 'wacc'], ['getMarketAssumptions', 'riskFreeRate.rate']),
    C('c4', '영업이익률 추이가 개선 방향이다.', 'interpretation'),
    C('c5', '지정학적 위험이 커졌다.', 'risk'),
  ]);
  assert.deepEqual(['c1', 'c2', 'c3'].map((id) => [by(o, id).status, by(o, id).basis]), [['supported', 'objective'], ['supported', 'judgment'], ['supported', 'judgment']]);
  assert.equal(by(o, 'c4').status, 'supported', '인용이 없어도 용어(영업이익률)로 관련 근거가 연결된다');
  assert.ok(by(o, 'c4').evidenceIds.some((id) => id.includes('operatingMargin')));
  assert.equal(by(o, 'c5').status, 'unsupported');
  assert.ok(by(o, 'c5').issues.includes('no-evidence'), '근거가 없는 위험 서술은 막힌다');
  assert.ok(['c2', 'c3'].every((id) => by(o, id).confidence !== 'high'), '근거가 좋아도 judgment 는 high 가 될 수 없다');
  assert.equal(by(o, 'c1').confidence, 'high');
  assert.ok(o.issues.some((i) => i.target === 'c5' && i.code === 'ungrounded-claim' && i.blocking));
});

test('숫자 검증: 퍼센트 변환 · 단위 환산 · 반올림 · 파생 수치(%p) · 값 없음', () => {
  const r = det('getHistoricalAnalysis', 'getValuationResult');
  const num = (text: string, tool = 'getHistoricalAnalysis', path: string | null = null) => by(ground([...r, market], [C('c', text, 'fact', [tool, path])]), 'c').numbers.map((n) => n.status);
  assert.deepEqual(num('2025년 영업이익률은 13.1%다.'), ['grounded']);                               // 0.1307 → 13.1%
  assert.deepEqual(num('2025년 영업이익률은 13.07%다.'), ['grounded']);
  assert.deepEqual(num('2025년 영업이익률은 13.5%다.'), ['ungrounded']);                              // 반올림 허용 범위 밖
  assert.deepEqual(num('주당 가치는 약 214,556원이다.', 'getValuationResult'), ['grounded']);
  assert.deepEqual(num('기업가치는 2,346억원이다.', 'getValuationResult'), ['grounded']);
  assert.deepEqual(num('기업가치는 0.23조원이다.', 'getValuationResult').map((s) => (s === 'grounded' ? 'g' : s)).length, 1);
  assert.deepEqual(num('시가총액은 1,763.1조원이다.', 'getMarketData').length, 1);
  assert.deepEqual(by(ground([market], [C('c', '시가총액은 약 1,763조원이다.', 'fact', ['getMarketData', null])]), 'c').numbers.map((n) => n.status), ['grounded']);  // KRW → 조원
  assert.deepEqual(by(ground([market], [C('c', '시가총액은 약 1,763조 1,222억원이다.', 'fact', ['getMarketData', null])]), 'c').numbers.map((n) => n.status), ['grounded']);   // 복합 금액
  assert.deepEqual(by(ground([market], [C('c', '시가총액은 약 1,500조원이다.', 'fact', ['getMarketData', null])]), 'c').numbers.map((n) => n.status), ['ungrounded']);
  // 파생 수치: 같은 문장의 두 퍼센트의 차이만 허용한다
  const d1 = by(ground(r, [C('c', '영업이익률이 2.5%에서 13.1%로 10.6%p 상승했다.', 'fact', ['getHistoricalAnalysis', null])]), 'c');
  assert.deepEqual(d1.numbers.map((n) => n.status), ['grounded', 'grounded', 'derived']);
  assert.equal(d1.status, 'supported');
  const d2 = by(ground(r, [C('c', '영업이익률이 2.5%에서 13.1%로 25.0%p 상승했다.', 'fact', ['getHistoricalAnalysis', null])]), 'c');
  assert.deepEqual(d2.numbers.map((n) => n.status), ['grounded', 'grounded', 'ungrounded']);
  // 연도 · 날짜 · 개수 · 만기는 숫자 검증 대상이 아니다
  assert.deepEqual(parseNumbers('2025년 12월 31일 기준 FY2025 2025A 5개 Q3 10Y 2026-10-07').length, 0);
  assert.deepEqual(parseNumbers('영업이익률 13.1%, 매출 333.6조원, 베타 1.5, 주당 214,556원').map((n) => [n.unit, n.value]), [['pct', 13.1], ['jo', 333.6], ['plain', 1.5], ['won', 214556]]);
  // missing: 값이 없는 항목을 숫자로 채우면 막고, "확인되지 않는다"는 진술은 값 없음 표시가 근거다
  const m1 = by(ground([market], [C('c', '발행주식수는 5,764,191,903주다.', 'fact', ['getMarketData', null])]), 'c');
  assert.equal(m1.status, 'unsupported');
  assert.ok(m1.issues.includes('evidence-missing-value'));
  const m2 = by(ground([market], [C('c', '발행주식수는 현재 데이터에서 확인되지 않습니다.', 'fact', ['getMarketData', 'sharesOutstanding'])]), 'c');
  assert.equal(m2.status, 'supported');
});

test('한국어 라벨 정규화: 용어 → field, 누락 값을 한국어 라벨로 채우는 답변도 잡는다', () => {
  assert.deepEqual(termsIn('발행 주식수와 영업이익률, 무위험수익률 그리고 베타').map((t) => t.key).sort(), ['beta', 'operatingMargin', 'riskFreeRate', 'sharesOutstanding']);
  assert.deepEqual(termsIn('영업이익 대비 영업이익률').map((t) => t.key).sort(), ['operatingMargin', 'operatingProfit'], '긴 표현이 짧은 표현을 소비한다');
  assert.ok(koreanAliases('sharesOutstanding').includes('발행주식수') && koreanAliases('marketCap').includes('시가총액') && koreanAliases('enterpriseValue').includes('기업가치') && koreanAliases('perShareValue').includes('주당가치'));
  const base: AiAnalystAnswer = { mode: 'explain', summary: '요약', evidence: [{ label: '발행주식수', value: '5,764,191,903주', tool: 'getMarketData' }], warnings: [], sources: [], suggestedNextActions: [] };
  assert.ok(enforceGrounding(base, [market]).violations.some((v) => v.code === 'missing-value-fabricated'), '한국어 라벨 "발행주식수" 로 채운 값을 잡는다 (기존에는 영문 field 만 감지)');
});

test('WACC 의미 모델: 구성요소 변경을 WACC 직접 변경으로 표기하면 의미 오류로 잡고 근거로 바로잡는다', () => {
  const idx = extractEvidence([...det('getForecastAssumptions', 'getValuationResult'), assumptions]);
  const P = (type: string, target: string, cur: string | null, prop: string | null) => ({ type, target, currentValue: cur, proposedValue: prop, rationale: '시장 관찰값 기준' }) as never;
  // 08-5 live 에서 나온 오류: Rf(3.0%)를 WACC 직접 변경으로 분류
  const rf = validateProposal(P('change-wacc-directly', 'WACC', '3.0%', '4.286%'), idx);
  assert.equal(rf.ok, true);
  assert.deepEqual(rf.retyped, { from: 'change-wacc-directly', to: 'change-risk-free-rate' });
  assert.equal(rf.proposal.type, 'change-risk-free-rate');
  assert.equal(rf.proposal.target, '무위험수익률');
  const beta = validateProposal(P('change-wacc-directly', 'WACC', '1.1', '1.545'), idx);
  assert.equal(beta.proposal.type, 'change-beta');
  // 전체 WACC 를 바꾸자는 제안은 현재 값이 getValuationResult 의 WACC 일 때만 직접 변경이다
  assert.deepEqual([validateProposal(P('change-wacc-directly', 'WACC', '8.1%', '7.8%'), idx).ok, validateProposal(P('change-wacc-directly', 'WACC', '8.1%', '7.8%'), idx).retyped], [true, undefined]);
  // 구성요소 type 인데 대상 · 값이 다른 구성요소를 가리키면 그 구성요소로 바로잡는다
  assert.equal(validateProposal(P('change-beta', '무위험수익률', '3.0%', '4.286%'), idx).proposal.type, 'change-risk-free-rate');
  assert.equal(validateProposal(P('change-risk-free-rate', '무위험수익률', '3.0%', '4.286%'), idx).retyped, undefined);
  assert.equal(validateProposal(P('change-market-risk-premium', '시장위험프리미엄', '6.0%', '5.5%'), idx).ok, true);
  // 현재 값이 어느 Tool 에도 없으면 근거 없는 제안
  const bad = validateProposal(P('change-risk-free-rate', '무위험수익률', '9.99%', '4.286%'), idx);
  assert.deepEqual([bad.ok, bad.issue?.code], [false, 'proposal-ungrounded']);
  // 어느 구성요소의 값도 아닌 값으로 WACC 직접 변경을 주장하면 의미 오류
  assert.equal(validateProposal(P('change-wacc-directly', 'WACC', '900', '800'), idx).proposal.type, 'change-capital-structure', '900 은 자기자본 시장가치 가정이다');
  assert.equal(validateProposal(P('change-wacc-directly', 'WACC', '8.7%', '8.0%'), idx).issue?.code, 'proposal-ungrounded');
  assert.equal(validateProposal(P('apply-peer-multiple', 'EV/EBITDA', '10', '8'), idx).ok, true, 'WACC 와 무관한 제안은 이 검사 대상이 아니다');
  // groundAnalysis 가 변경 제안을 한꺼번에 검사하고 violation 으로 남긴다
  const o = groundAnalysis({ summary: '요약', claims: [], proposedActions: [P('change-wacc-directly', 'WACC', '3.0%', '4.286%'), P('change-beta', '베타', '9.9', '1.5')], index: idx });
  assert.deepEqual(o.proposals.map((c) => [c.ok, c.proposal.type]), [[true, 'change-risk-free-rate'], [false, 'change-beta']]);
  assert.ok(o.issues.some((i) => i.target === 'proposal:1' && i.code === 'proposal-semantic-mismatch' && !i.blocking) && o.issues.some((i) => i.target === 'proposal:2' && i.blocking));
  // claim: 구성요소 근거만으로 "WACC 를 낮춰야 한다" 고 단정하는 문장
  const c = ground([...det('getForecastAssumptions', 'getValuationResult'), assumptions], [C('c1', 'WACC 를 낮춰야 한다.', 'recommendation', ['getMarketAssumptions', 'riskFreeRate.rate'])]);
  assert.ok(by(c, 'c1').issues.includes('wacc-component-conflation'));
});

test('Source priority · 충돌: OpenDART 기준과 provider 값이 충돌하면 provider 값은 재무 Actual 로 쓰지 않고 충돌을 숨기지 않는다', async () => {
  assert.deepEqual(['calculated', 'actual', 'disclosure-document', 'uploaded-document', 'news'].map((k) => (k === 'calculated' || k === 'actual' ? sourcePriority({ sourceKind: k, sourceType: 'financial-data' } as Evidence) : sourcePriority({ sourceKind: 'document', sourceType: k } as Evidence))), [1, 2, 3, 4, 7]);
  assert.equal(sourcePriority({ sourceKind: 'external', sourceType: 'market-data', provider: { name: 'KRX', reliability: 'official', tier: 'production' } } as Evidence), 5);
  assert.equal(sourcePriority({ sourceKind: 'external', sourceType: 'market-data', provider: PROVIDER } as unknown as Evidence), 6);
  const results = [...det('getHistoricalAnalysis'), peers(0.522)];
  const idx = extractEvidence(results);
  const cons = detectContradictions(idx);
  assert.deepEqual(cons.map((c) => c.metric), ['operatingMargin']);
  assert.match(cons[0].note, /OpenDART 기준/);
  assert.ok(cons[0].preferred.evidenceId.startsWith('getHistoricalAnalysis') && cons[0].other.evidenceId === 'getComparableCompanies:subject.operatingMargin');
  assert.deepEqual(detectContradictions(extractEvidence([...det('getHistoricalAnalysis'), peers(0.131)])), [], '일치하면 충돌이 아니다');
  const o = ground(results, [C('c1', '삼성전자의 영업이익률은 52.2%다.', 'fact', ['getComparableCompanies', 'subject.operatingMargin']), C('c2', '2025년 영업이익률은 13.1%다.', 'fact', ['getHistoricalAnalysis', 'metrics.operatingMargin.values[2]'])]);
  assert.equal(by(o, 'c1').status, 'unsupported');
  assert.ok(by(o, 'c1').issues.includes('contradicted-by-priority-source'));
  assert.equal(by(o, 'c2').status, 'supported');
  // 같은 숫자가 엔진 값과 provider 값에 모두 있으면 우선순위가 높은 source 를 쓴다
  const both = ground([...det('getHistoricalAnalysis'), peers(0.1307)], [C('c', '영업이익률은 13.1%다.', 'fact', ['getHistoricalAnalysis', null], ['getComparableCompanies', null])]);
  assert.ok(by(both, 'c').evidenceIds[0].startsWith('getHistoricalAnalysis'));
  // 답변 단계: 충돌은 limitations 로 남는다
  const raw = { mode: 'explain', summary: '삼성전자의 영업이익률은 13.1%입니다.', evidence: [], warnings: [], sources: [], suggestedNextActions: [], claims: [C('c2', '2025년 영업이익률은 13.1%다.', 'fact', ['getHistoricalAnalysis', 'metrics.operatingMargin.values[2]'])] } as never;
  const r = await groundWithRepair({ question: 'q', raw, results, unsupported: false });
  assert.ok(r.extraLimitations.some((l) => l.includes('재무 Actual 에는 사용하지 않았습니다')) && r.audit.contradictions === 1 && r.violations.some((v) => v.code === 'provider-contradiction'));
});

test('Confidence: source 등급 · DataQuality · 검색 품질이 신뢰도에 전파된다', () => {
  const quality = ok('getHistoricalAnalysis', { periods: ['2023A', '2024A', '2025A'], metrics: { operatingMargin: { unit: 'ratio (소수)', status: 'partial', values: [0.02, 0.1, 0.13] }, revenueGrowth: { unit: 'ratio (소수)', status: 'available', values: [null, 0.16, 0.11] } } }, [ext('financial-data', 'database', { kind: 'actual' as never })]);
  const idx = extractEvidence([quality]);
  assert.equal(idx.byId.get('getHistoricalAnalysis:metrics.operatingMargin.values[2]')!.quality, 'partial');
  const o = ground([quality], [C('c1', '2025년 영업이익률은 13.0%다.', 'fact', ['getHistoricalAnalysis', 'metrics.operatingMargin.values[2]']), C('c2', '2025년 매출 성장률은 11.0%다.', 'fact', ['getHistoricalAnalysis', 'metrics.revenueGrowth.values[2]'])]);
  assert.deepEqual([by(o, 'c1').confidence, by(o, 'c2').confidence], ['medium', 'high']);
  assert.ok(by(o, 'c1').confidenceNotes.some((n) => /data quality: partial/.test(n)));
  // 검색 품질: 낮은 순위 · 같은 검색의 최고 점수 대비 낮은 점수 · 근거가 문단 하나뿐
  const docs = ok('searchDisclosures', { results: [passage(0, '시설투자를 확대한다 HBM 라인'), passage(1, '다른 내용입니다'), passage(2, '또 다른 내용'), passage(3, '시설투자 계획 일부 HBM'), passage(4, '시설투자 HBM 약간', { rerankScore: 0.1 })] }, [DOC_SOURCE]);
  const d = ground([docs], [C('c1', '시설투자를 확대한다.', 'fact', ['searchDisclosures', 'results[0]']), C('c2', '시설투자 계획 일부에 HBM 이 포함된다.', 'fact', ['searchDisclosures', 'results[3]'])]);
  assert.equal(by(d, 'c1').confidence, 'low', '문단 하나뿐이고 문서 근거라 medium 에서 한 단계 내려간다');
  assert.equal(by(d, 'c2').confidence, 'low');
  assert.ok(by(d, 'c2').confidenceNotes.some((n) => /retrieval rank 4/.test(n)));
  const news1 = ground([news], [C('c1', '삼성전자가 평택 신규 라인 투자를 확정했다는 보도가 있다.', 'fact', ['searchCompanyNews', 'results[0]'])]);
  assert.equal(by(news1, 'c1').confidence, 'low');
});

test('시점 일관성: Historical · 시장 · 뉴스의 시점을 섞으면 시점을 밝히지 않은 claim 을 표시하고 시점 요약을 만든다', () => {
  const r = [...det('getHistoricalAnalysis'), market, news];
  const o = ground(r, [
    C('c1', '영업이익률은 13.1%이고 시가총액은 약 1,763조원이다.', 'fact', ['getHistoricalAnalysis', 'metrics.operatingMargin.values[2]'], ['getMarketData', 'marketCap.value']),
    C('c2', '2025A 영업이익률은 13.1%이고 2026-10-07 기준 시가총액은 약 1,763조원이다.', 'fact', ['getHistoricalAnalysis', 'metrics.operatingMargin.values[2]'], ['getMarketData', 'marketCap.value']),
  ], '요약');
  assert.ok(by(o, 'c1').issues.includes('time-basis-not-stated') && by(o, 'c1').status === 'partially-supported');
  assert.ok(!by(o, 'c2').issues.includes('time-basis-not-stated') && by(o, 'c2').status === 'supported');
  assert.deepEqual(Object.keys(o.report.timeBasis!).sort(), ['historical', 'market']);
  assert.equal(o.report.timeBasis!.historical, '2025A');
  assert.equal(o.report.timeBasis!.market, AT);
});

const client = (replies: unknown[], seen: AiRegenerateRequest[] = []): AiGatewayClient => ({
  query: () => { throw new Error('unused'); }, sendToolResult: () => { throw new Error('unused'); },
  regenerate: async (req) => { seen.push(req); const a = replies.shift(); if (a instanceof Error) throw a; return { status: 'final', answer: a }; },
});
const rawAnswer = (summary: string, claims: unknown[], extra: Record<string, unknown> = {}) => ({ mode: 'explain', summary, evidence: [], warnings: [], sources: [], suggestedNextActions: [], reviewedAreas: [], limitations: [], judgmentItems: [], claims, proposedActions: [], ...extra }) as never;

test('교정 재생성(1회): 위반 목록과 허용 근거만 보내고(Tool 결과 원문 전체는 보내지 않는다), 고쳐진 답변이 검증을 통과하면 채택한다', async () => {
  const results = det('getHistoricalAnalysis', 'getValuationResult');
  const bad = rawAnswer('영업이익률은 13.1%이고 기업가치는 9,999억원입니다.', [C('c1', '2025년 영업이익률은 13.1%다.', 'fact', ['getHistoricalAnalysis', 'metrics.operatingMargin.values[2]']), C('c2', '기업가치는 9,999억원이다.', 'fact', ['getValuationResult', 'enterpriseValue'])]);
  const fixed = rawAnswer('영업이익률은 13.1%이고 기업가치는 2,346억원입니다.', [C('c1', '2025년 영업이익률은 13.1%다.', 'fact', ['getHistoricalAnalysis', 'metrics.operatingMargin.values[2]']), C('c2', '기업가치는 2,346억원이다.', 'fact', ['getValuationResult', 'enterpriseValue'])]);
  const seen: AiRegenerateRequest[] = [];
  const r = await groundWithRepair({ question: '기업가치는?', raw: bad, results, unsupported: false, client: client([fixed], seen) });
  assert.equal(seen.length, 1, '재생성은 1회');
  const payload = JSON.stringify(seen[0]);
  assert.ok(seen[0].issues.some((i) => i.target === 'c2' && i.code === 'ungrounded-number') && seen[0].issues.some((i) => i.target === 'summary'));
  assert.ok(seen[0].evidence.length <= 120 && seen[0].evidence.every((e) => typeof e.evidenceId === 'string' && 'fieldPath' in e), '허용 근거 목록');
  assert.ok(!payload.includes('"fcff"') && !payload.includes('"status":"ok"') && !payload.includes('"data"') && !payload.includes('waccValues'), 'ToolResult 원문 · envelope 은 보내지 않는다');
  assert.ok(seen[0].evidence.some((e) => e.evidenceId === 'getValuationResult:enterpriseValue'));
  assert.equal(r.regenerated, true);
  assert.equal(r.fallbackUsed, false);
  assert.equal(r.answer.summary.includes('2,346억원'), true);
  assert.deepEqual(r.claims.map((c) => c.status), ['supported', 'supported']);
  assert.ok(r.violations.some((v) => v.code === 'ungrounded-number') && r.corrections.includes('regenerated'), '첫 답변의 위반은 기록된다');
  assert.deepEqual([r.audit.regenerated, r.audit.fallbackUsed, r.audit.unsupportedNumbers], [true, false, 0]);
  // 재생성이 필요 없으면 호출하지 않는다
  const none: AiRegenerateRequest[] = [];
  await groundWithRepair({ question: 'q', raw: fixed, results, unsupported: false, client: client([], none) });
  assert.equal(none.length, 0);
});

test('Safe fallback: 재생성도 실패하거나 여전히 위반이면 근거 없는 claim · 숫자를 제거하고 검증된 사실만으로 답한다', async () => {
  const results = det('getHistoricalAnalysis', 'getValuationResult');
  const bad = rawAnswer('영업이익률은 13.1%이고 기업가치는 9,999억원입니다.', [C('c1', '2025년 영업이익률은 13.1%다.', 'fact', ['getHistoricalAnalysis', 'metrics.operatingMargin.values[2]']), C('c2', '기업가치는 9,999억원이다.', 'fact', ['getValuationResult', 'enterpriseValue']), C('c3', '수익성이 개선됐다.', 'interpretation', ['getHistoricalAnalysis', 'metrics.operatingMargin.values[2]'])],
    { evidence: [{ label: '기업가치', value: '9,999억원', tool: 'getValuationResult' }, { label: '영업이익률', value: '13.1%', tool: 'getHistoricalAnalysis' }] });
  for (const c of [undefined, client([bad]), client([new Error('boom')])]) {   // 재생성 없음 · 재생성했지만 그대로 틀림 · 재생성 호출 실패
    const r = await groundWithRepair({ question: 'q', raw: bad, results, unsupported: false, client: c });
    assert.equal(r.fallbackUsed, true);
    assert.deepEqual(r.claims.map((x) => x.claimId), ['c1', 'c3'], '근거 없는 claim 제거');
    assert.ok(!r.answer.summary.includes('9,999') && r.answer.summary.includes('13.1%') && r.answer.summary.includes('(해석)'), '검증된 claim 으로 만든 요약, 해석은 구분');
    assert.deepEqual(r.answer.evidence.map((e) => e.label), ['영업이익률'], '근거 없는 evidence 항목 제거');
    assert.ok(r.corrections.includes('fallback-used') && r.corrections.includes('unsupported-claims-removed') && r.extraLimitations.some((l) => l.includes('제거했습니다')));
    assert.equal(r.audit.fallbackUsed, true);
  }
  // 근거가 하나도 없으면 분석을 지어내지 않는다
  const empty = await groundWithRepair({ question: 'q', raw: rawAnswer('기업가치는 1조원입니다.', [C('c1', '기업가치는 1조원이다.', 'fact')]), results, unsupported: false });
  assert.match(empty.answer.summary, /근거가 확인된 내용이 없어/);
});

test('Hallucinated source: Tool 결과에 없는 출처는 제거하고 violation 으로 기록한다', async () => {
  const results = [disclosure];
  const raw = rawAnswer('공시를 확인했습니다.', [], { sources: [{ kind: 'document', type: 'uploaded-document', origin: 'user-upload', basis: null, fetchedAt: null, title: 'PwC Industry Report', page: 3 }, { kind: 'document', type: 'disclosure-document', origin: 'opendart', basis: null, fetchedAt: AT, reportName: '사업보고서 (2025.12)', documentId: '20260310002820', asOf: AT }] });
  const r = await groundWithRepair({ question: 'q', raw, results, unsupported: false });
  assert.equal(r.audit.hallucinatedSources, 1);
  assert.ok(r.violations.some((v) => v.code === 'hallucinated-source') && r.corrections.includes('sources-filtered'));
  assert.ok(!r.answer.sources.some((s) => s.title === 'PwC Industry Report'));
  assert.ok(r.answer.sources.some((s) => s.type === 'disclosure-document'));
});

test('Evidence coverage · graph · calculation 의 deterministic 근거 · valuation 숫자의 엔진 근거', () => {
  const r = [...det('getHistoricalAnalysis', 'getValuationResult'), news, disclosure];
  const o = ground(r, [
    C('c1', '2025년 영업이익률은 13.1%다.', 'fact', ['getHistoricalAnalysis', 'metrics.operatingMargin.values[2]']),
    C('c2', 'WACC 는 8.1%다.', 'calculation', ['getValuationResult', 'wacc']),
    C('c3', 'WACC 는 7.0%다.', 'fact', ['getValuationResult', 'wacc']),
    C('c4', '투자 규모는 30조원이라는 보도가 있다.', 'calculation', ['searchCompanyNews', 'results[0]']),
    C('c5', '기업가치는 30조원이다.', 'fact', ['searchCompanyNews', 'results[0]']),
  ]);
  assert.deepEqual(o.claims.map((c) => c.status), ['supported', 'supported', 'unsupported', 'unsupported', 'unsupported']);
  assert.ok(by(o, 'c4').issues.includes('calculation-not-deterministic'), 'calculation claim 은 deterministic Tool 값이어야 한다');
  assert.ok(by(o, 'c5').issues.includes('valuation-number-not-from-engine'), '기업가치(valuation) 숫자는 엔진 결과에서만 인정된다');
  assert.equal(o.report.coverage, 2 / 5);
  assert.deepEqual([o.report.stats.claims, o.report.stats.supported, o.report.stats.unsupported], [5, 2, 3]);
  assert.ok(o.report.graph.some((e) => e.claimId === 'c1' && e.tool === 'getHistoricalAnalysis' && e.sourceType === 'financial-data'));
  assert.ok(o.report.graph.every((e) => o.report.evidenceMap.some((m) => m.evidenceId === e.evidenceId)), 'graph 의 모든 근거가 Evidence Map 에 있다');
  assert.equal(ground(r, []).report.coverage, null, 'claim 이 없으면 coverage 는 null (모든 문장을 claim 으로 세지 않는다)');
});

test('audit 에는 근거 값 · 문장 · 문서 내용이 없다 (개수와 코드만)', async () => {
  const secret = '공시본문-비밀문장-XYZ';
  const docs = ok('searchDisclosures', { results: [passage(0, `${secret} 시설투자를 확대한다`)] }, [DOC_SOURCE]);
  const raw = rawAnswer('시설투자를 확대한다고 밝혔습니다. 규모는 77조원입니다.', [C('c1', '회사는 시설투자를 확대한다고 밝혔다.', 'fact', ['searchDisclosures', 'results[0]']), C('c2', '시설투자 규모는 77조원이다.', 'fact', ['searchDisclosures', 'results[0]'])]);
  const r = await groundWithRepair({ question: 'q', raw, results: [docs], unsupported: false });
  const json = JSON.stringify(r.audit);
  assert.deepEqual(Object.keys(r.audit).sort(), ['afterRegeneration', 'contradictions', 'corrections', 'coverage', 'evidenceCount', 'fallbackUsed', 'firstPass', 'groundedClaims', 'hallucinatedSources', 'regenerated', 'totalClaims', 'unsupportedNumbers', 'violations'].sort());
  for (const leak of [secret, '77조원', '시설투자를 확대한다']) assert.ok(!json.includes(leak), `audit 에 ${leak} 가 없다`);
  assert.equal(r.audit.fallbackUsed, true);
  assert.ok(r.audit.unsupportedNumbers >= 1 && r.audit.violations.includes('ungrounded-number'));
});

test('evidenceRefs 해석: 정확한 경로 → 상위 경로(results[0].text) → 하위 값들(객체를 가리킨 경우), 어느 것도 없으면 잘못된 인용', () => {
  const idx = extractEvidence([...det('getHistoricalAnalysis'), disclosure]);
  const refs = (path: string) => { const o = ground([...det('getHistoricalAnalysis'), disclosure], [C('c', '2025년 영업이익률은 13.1%다.', 'fact', ['getHistoricalAnalysis', path])]); return by(o, 'c'); };
  assert.ok(!refs('metrics.operatingMargin.values[2]').issues.includes('evidence-ref-invalid'));
  assert.ok(!refs('data.metrics.operatingMargin.values[2]').issues.includes('evidence-ref-invalid'), '`data.` 접두사 허용');
  assert.ok(!refs('metrics.operatingMargin.values.2').issues.includes('evidence-ref-invalid'), '`.2` 표기 허용');
  assert.ok(!refs('metrics.operatingMargin').issues.includes('evidence-ref-invalid') && refs('metrics.operatingMargin').status === 'supported', '객체를 가리키면 하위 값들이 근거 후보다');
  assert.ok(refs('metrics.nonexistent.values[2]').issues.includes('evidence-ref-invalid'), '없는 경로는 잘못된 인용');
  const o = ground([disclosure], [C('c1', '회사는 HBM 등 첨단 공정 전환을 위해 시설투자를 확대하고 있다.', 'fact', ['searchDisclosures', 'results[0].text']), C('c2', '회사는 HBM 등 첨단 공정 전환을 위해 시설투자를 확대하고 있다.', 'fact', ['searchDisclosures', 'results[0].excerpt'])]);
  assert.deepEqual(o.claims.map((c) => [c.status, c.issues.includes('evidence-ref-invalid')]), [['supported', false], ['supported', false]], '모델이 `.text` / `.excerpt` 처럼 문단 안의 field 를 가리켜도 문단 근거로 해석한다');
  assert.ok(idx.texts.has('searchDisclosures:results[0]') && idx.texts.has('searchDisclosures:results[1]') && idx.byId.get('searchDisclosures:results[0]')!.excerpt!.length <= 240);
});

test('문서 claim 은 발췌(240자 표시용)가 아니라 전체 문단과 대조한다 · 같은 claim 의 중복 위반은 한 번만 기록한다', () => {
  const long = `${'서론 문장입니다. '.repeat(40)}당사는 메모리 차세대 기술 경쟁력 강화와 중장기 수요 대비를 위해 설비투자를 확대했습니다.`;
  const r = ok('searchDisclosures', { results: [passage(0, long)] }, [DOC_SOURCE]);
  const idx = extractEvidence([r]);
  assert.ok(!idx.byId.get('searchDisclosures:results[0]')!.excerpt!.includes('중장기') && idx.texts.get('searchDisclosures:results[0]')!.includes('중장기'));
  const o = ground([r], [C('c1', '회사는 메모리 차세대 기술 경쟁력 강화와 중장기 수요 대비를 위해 설비투자를 확대했다.', 'fact', ['searchDisclosures', 'results[0]']), C('c2', '회사는 우주 정거장 사업을 확대했다.', 'fact', ['searchDisclosures', 'results[0]'])]);
  assert.deepEqual(o.claims.map((c) => c.status), ['supported', 'unsupported']);
  assert.equal(o.issues.filter((i) => i.target === 'c2' && i.code === 'ungrounded-claim').length, 1);
});

test('missing 감지: 다른 Tool 에 같은 이름의 실제 값이 있으면(Forecast 가정의 시장위험프리미엄) 값을 채운 것으로 보지 않는다', () => {
  const noMrp = ok('getMarketAssumptions', { marketRiskPremium: { status: 'missing', value: null, reason: 'no provider' } });
  const base: AiAnalystAnswer = { mode: 'explain', summary: '요약', evidence: [{ label: '시장 위험 프리미엄(Forecast 가정)', value: '6.0%', tool: 'getForecastAssumptions' }], warnings: [], sources: [], suggestedNextActions: [] };
  const forecast = det('getForecastAssumptions')[0];
  assert.ok(!enforceGrounding(base, [noMrp, forecast]).violations.some((v) => v.code === 'missing-value-fabricated'), 'Forecast 가정에 6.0% 가 실제로 있다');
  assert.ok(enforceGrounding(base, [noMrp]).violations.some((v) => v.code === 'missing-value-fabricated'), '어느 Tool 에도 값이 없으면 여전히 잡는다');
  const o = ground([noMrp], [C('c1', '외부 시장위험프리미엄 자료가 없어 분석가가 값을 선택해야 한다.', 'risk', ['getMarketAssumptions', 'marketRiskPremium'])]);
  assert.equal(by(o, 'c1').status, 'supported', '"없어" 같은 부재 진술은 값 없음 표시가 근거다');
});

test('실제 live 에서 나온 오류 유형: KRW million 의 단위 착오(377.93억 · 3,779억)는 잡고 올바른 표기(37.79조원 · 377,930억원)는 통과시키며, 재생성 요청에는 deterministic 표시 형식이 들어간다', async () => {
  const r = det('getHistoricalAnalysis');
  const num = (text: string) => by(ground(r, [C('c', text, 'fact', ['getHistoricalAnalysis', 'metrics.cfoMinusCapex.values[2]'])]), 'c').numbers.map((n) => n.status);
  assert.deepEqual(num('2025년 CFO−CAPEX 는 377.93억 원이다.'), ['ungrounded']);       // 1000배 착오
  assert.deepEqual(num('2025년 CFO−CAPEX 는 3,779억 원이다.'), ['ungrounded']);        // 100배 착오
  assert.deepEqual(num('2025년 CFO−CAPEX 는 약 37.79조원이다.'), ['grounded']);
  assert.deepEqual(num('2025년 CFO−CAPEX 는 약 377,930억원이다.'), ['grounded']);
  const seen: AiRegenerateRequest[] = [];
  const bad = rawAnswer('요약', [C('c1', '2025년 CFO−CAPEX 는 377.93억 원이다.', 'fact', ['getHistoricalAnalysis', 'metrics.cfoMinusCapex.values[2]'])]);
  await groundWithRepair({ question: 'q', raw: bad, results: r, unsupported: false, client: client([bad], seen) });
  const ev = seen[0].evidence.find((e) => e.evidenceId === 'getHistoricalAnalysis:metrics.cfoMinusCapex.values[2]') as { display?: Record<string, string> };
  assert.deepEqual(ev.display, { 억원: '377,930억원', 조원: '37.79조원' });
  const pct = seen[0].evidence.find((e) => e.evidenceId === 'getHistoricalAnalysis:metrics.operatingMargin.values[2]') as { display?: Record<string, string> };
  assert.equal(pct.display?.percent, '13.07%');
});

test('절(clause) 단위 지표 연결 · 기간 표현(52주) · 여러 기사에 걸친 뉴스 claim · 해석 claim 은 발췌와 일치할 필요가 없다', () => {
  const r = det('getValuationResult');
  const c3 = by(ground(r, [C('c3', 'DCF 평가에서 기업가치는 2,346억원, WACC는 8.14%, Terminal Value 기여도는 84.34%로 매우 높다.', 'fact', ['getValuationResult', 'enterpriseValue'], ['getValuationResult', 'wacc'], ['getValuationResult', 'tvContribution'])]), 'c3');
  assert.deepEqual(c3.numbers.map((n) => n.status), ['grounded', 'grounded', 'grounded'], 'Terminal Value 기여도 용어가 사전에 있어 지표가 연결된다');
  assert.equal(c3.status, 'supported');
  // 숫자가 속한 절에 용어가 없으면(사전에 없는 표현) 지표 제한을 걸지 않는다
  assert.equal(by(ground(r, [C('c', '기업가치는 2,346억원이고 터미널 비중은 84.3%다.', 'fact', ['getValuationResult', null])]), 'c').numbers[1].status, 'grounded');
  // 다른 절의 지표로 우연히 같은 값을 쓰면 불인정 (WACC 절에 영구성장률 값)
  assert.deepEqual(by(ground(r, [C('c', '기업가치는 2,346억원이고 WACC 는 2.0%다.', 'fact', ['getValuationResult', null])]), 'c').numbers.map((n) => n.status), ['grounded', 'ungrounded']);
  assert.deepEqual(parseNumbers('52주 최고가 대비 4주 간 하락').length, 0);
  const many = ok('searchCompanyNews', { results: [
    { title: '삼성전자 반도체 성과급 지급 예정', publisher: 'A', publishedAt: '2026-10-06T00:00:00+00:00', url: 'https://n/1', snippet: null },
    { title: '삼성바이오 노조 갈등 우려', publisher: 'B', publishedAt: '2026-10-06T01:00:00+00:00', url: 'https://n/2', snippet: null }] }, [ext('news', 'google-news')]);
  const o = ground([many, ...det('getValuationResult')], [
    C('c1', '최근 뉴스는 반도체 성과급 지급과 노조 갈등 이슈를 포함한다.', 'fact', ['searchCompanyNews', 'results']),
    C('c2', '최근 뉴스는 우주 정거장 발사 계획을 포함한다.', 'fact', ['searchCompanyNews', 'results']),
    C('c3', '성과급 · 노조 이슈는 비용 구조 리스크로 작용할 수 있다.', 'risk', ['searchCompanyNews', 'results'], ['getValuationResult', 'warnings']),
  ]);
  assert.deepEqual(o.claims.map((c) => c.status), ['supported', 'unsupported', 'supported'], '여러 기사가 함께 받치면 인정, 해석 · 위험은 발췌 일치를 요구하지 않고 Tool 경고(warnings)도 근거가 된다');
  assert.ok(o.claims[2].confidence === 'low' && o.claims[2].evidenceIds.some((id) => id.startsWith('getValuationResult:warnings[')));
});

test('live 에서 나온 오탐 · 누락 보정: 구성 지표로 풀어 쓴 파생 지표, 문장 경계를 넘는 용어 누수 방지', () => {
  const r = det('getHistoricalAnalysis', 'getValuationResult');
  const st = (summary: string) => ground(r, [], summary).report.summaryNumbers.map((n) => n.status);
  // "CFO에서 CAPEX를 뺀 현금흐름" = cfoMinusCapex (CFO · CAPEX 지표와 한 묶음)
  assert.deepEqual(st('2023년 기준 CFO에서 CAPEX를 뺀 현금흐름은 -134,739억원이었으나 2025년에는 377,930억원으로 개선되었습니다.'), ['grounded', 'grounded']);
  // 앞 문장의 용어(순부채)가 다음 문장의 숫자에 영향을 주지 않는다
  assert.deepEqual(st('순부채는 안정적입니다. DCF 가치의 약 84.34%가 터미널 밸류에 의존합니다.'), ['grounded']);
  // 그래도 같은 값이 전혀 다른 지표에만 있으면 불인정: 영업이익률 절에 순이익률 값
  assert.deepEqual(by(ground(r, [C('c', '영업이익률은 13.5%다.', 'fact', ['getHistoricalAnalysis', null])]), 'c').numbers.map((n) => n.status), ['ungrounded']);
});

test('hallucinated source 는 Tool 출처에 같은 종류 · 문서가 없는 것만 센다(표기만 다른 출처는 Tool 출처로 바뀐다)', async () => {
  const results = [disclosure];
  const same = { kind: 'document', type: 'disclosure-document', origin: 'opendart', basis: null, fetchedAt: null, reportName: '사업보고서 (2025.12)', documentId: '20260310002820' };   // fetchedAt 만 다름
  const fake = { kind: 'document', type: 'disclosure-document', origin: 'opendart', basis: null, fetchedAt: null, reportName: '사업보고서 (2099.12)', documentId: '99999999999999' };
  const r = await groundWithRepair({ question: 'q', raw: rawAnswer('공시를 확인했습니다.', [], { sources: [same, fake] }), results, unsupported: false });
  assert.equal(r.audit.hallucinatedSources, 1);
  assert.ok(!r.answer.sources.some((s) => s.documentId === '99999999999999') && r.answer.sources.some((s) => s.documentId === '20260310002820'));
});

test('정성 근거: Tool 경고(warnings[i]) · 엔진의 검토 경고(validationWarnings[i]) · 추세 방향이 위험 · 해석 claim 의 근거가 된다 (live 에서 validationWarnings 인용이 "근거 없음"으로 처리되던 계약 문제)', () => {
  const r = [ok('getValuationResult', { wacc: 0.081, tvContribution: 0.8434, validationWarnings: [{ code: 'tv-share', message: '터미널 가치 비중이 높아 가정 변화에 민감합니다.', basis: 'TV 비중 > 75%' }] }, [DOC_SOURCE], [{ code: 'tv-share', text: '터미널 가치 비중이 높습니다.', level: 'review' }]),
    ...det('getHistoricalAnalysis')];
  const idx = extractEvidence(r);
  assert.equal(idx.byId.get('getValuationResult:validationWarnings[0]')!.excerpt, '터미널 가치 비중이 높아 가정 변화에 민감합니다. (TV 비중 > 75%)');
  assert.ok(idx.byId.has('getValuationResult:warnings[0]') && idx.byId.get('getHistoricalAnalysis:trends.operatingMargin.direction')!.value === 'improving');
  const o = ground(r, [
    C('c1', 'DCF 는 터미널 가치 의존도가 높아 가정 변화에 따른 가치 변동성 위험이 있다.', 'risk', ['getValuationResult', 'validationWarnings']),
    C('c2', '영업이익률 추세는 개선 방향이다.', 'interpretation', ['getHistoricalAnalysis', 'trends.operatingMargin']),
    C('c3', '해외 규제 위험이 커졌다.', 'risk', ['getValuationResult', 'validationWarnings']),
  ]);
  assert.deepEqual(o.claims.map((c) => c.status), ['supported', 'supported', 'unsupported'], '관련 근거가 연결되면 인정되고(내용 일치는 fact 에만 엄격), 엉뚱한 경고를 인용한 위험 서술(해외 규제)은 걸러진다');
  assert.ok(o.claims[0].evidenceIds.includes('getValuationResult:validationWarnings[0]'));
  const fact = ground(r, [C('c', '터미널 가치 비중이 높다는 경고가 있다.', 'fact', ['getValuationResult', 'validationWarnings']), C('d', '환율 위험 경고가 있다.', 'fact', ['getValuationResult', 'validationWarnings'])]);
  assert.deepEqual(fact.claims.map((c) => c.status), ['supported', 'unsupported'], 'fact 는 경고 문장에 실제로 있는 내용이어야 한다');
});

test('인용한 문단 번호가 틀려도 같은 Tool 이 검색한 다른 문단이 주장을 받치면 인정한다 (인용 오류는 정보로만 남는다)', () => {
  const o = ground([disclosure], [
    C('c1', '회사는 HBM 등 첨단 공정 전환을 위해 시설투자를 확대하고 있다.', 'fact', ['searchDisclosures', 'results[1]']),   // 내용은 results[0] 에 있다
    C('c2', '회사는 신규 데이터센터 사업 진출을 공시했다.', 'fact', ['searchDisclosures', 'results[1]']),
  ]);
  assert.deepEqual(o.claims.map((c) => c.status), ['supported', 'unsupported']);
  assert.ok(o.claims[0].evidenceIds.includes('searchDisclosures:results[0]') && o.claims[0].invalidRefs?.length === 1);
});
