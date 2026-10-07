// STEP 08-6 acceptance: 표시용 deterministic 값(단일 출처). LLM 은 금액 단위 환산을 하지 않고 Tool 이 준 display 값을 인용한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAiContext, executeTool, extractEvidence, groundAnalysis, type ToolResult } from './index.ts';
import { displaySeries, eokToTrillion, financialDisplayValue, formatFinancialValue, formatPercent, isAmountUnit, krwMillionToEok, normalizeDisplayUnit, percentSeries, ratioToPercent } from './tools/display.ts';
import { matchesValue, parseNumbers } from './grounding/numbers.ts';
import { authorityRank } from './grounding/confidence.ts';
import { emptyProjectState, withHistoricalLoaded, withPracticeAssumptions, withRelativeInputs, withSelectedCompany } from '../store/projectModel.ts';
import type { Evidence } from './grounding/types.ts';

const golden = JSON.parse(readFileSync(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const project = withRelativeInputs(withPracticeAssumptions(withHistoricalLoaded(withSelectedCompany(emptyProjectState, { corpCode: '00126380', corpName: '삼성전자', corpNameEng: null, stockCode: '005930', corpClass: 'Y', source: 'OpenDART', fetchedAt: 'x' }),
  { data: golden.data, quality: golden.quality, provenance: { source: 'database', persisted: true, fetchedAt: 'x', fetchId: '7', corpCode: '00126380', fiscalYears: [2023, 2024, 2025] } })), { netIncome: 150, per: 12, bookEquity: 1000, pbr: 1.5, ebitda: 220, evEbitda: 10 });
const ctx = buildAiContext(project);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data = (t: string): any => (executeTool(t, ctx) as { data: unknown }).data;

test('display helper: 단위 정규화 · 원화 환산 · 표시용 값은 full precision, 문자열만 자릿수를 정한다', () => {
  assert.deepEqual(['KRW million (비율 제외)', '억원', '조원', 'KRW', '원', 'ratio (소수)', 'percent', '주', '배', '', 'weird'].map(normalizeDisplayUnit), ['krw-million', 'eok', 'jo', 'krw', 'won', 'ratio', 'percent', 'shares', 'multiple', 'unknown', 'unknown']);
  assert.ok(isAmountUnit('krw-million') && isAmountUnit('eok') && !isAmountUnit('ratio'));
  const d = financialDisplayValue(37_792_969, 'KRW million')!;
  assert.deepEqual(d, { valueMillionKrw: 37_792_969, valueEok: 377_929.69, valueTrillion: 37.792969 });
  const ev = financialDisplayValue(2345.5630041825984, '억원')!;
  assert.equal(ev.valueEok, 2345.5630041825984, '원본 값을 반올림하지 않는다');
  assert.ok(Math.abs(ev.valueTrillion - 0.23455630041825984) < 1e-15);
  assert.equal(financialDisplayValue(0.13, 'ratio'), null);
  assert.deepEqual([krwMillionToEok(37_792_969), eokToTrillion(10_000), ratioToPercent(0.1307)], [377_929.69, 1, 13.07]);
  assert.deepEqual([formatFinancialValue(37_792_969, 'KRW million', 'eok'), formatFinancialValue(37_792_969, 'KRW million', 'jo'), formatFinancialValue(37_792_969, 'KRW million'), formatFinancialValue(2345.563, '억원'), formatFinancialValue(1.763122e15, 'KRW', 'jo'), formatFinancialValue(0.1, 'ratio')], ['377,930억원', '37.79조원', '37.79조원', '2,346억원', '1,763.12조원', null]);
  assert.equal(formatPercent(0.13069), '13.07%');
  assert.deepEqual(displaySeries([null, 100, 37_792_969], 'KRW million'), { valuesEok: [null, 1, 377_929.69], valuesTrillion: [null, 0.0001, 37.792969] });
  assert.equal(displaySeries([1], 'ratio'), null);
  assert.deepEqual(percentSeries([null, 0.5]), [null, 50]);
});

test('Tool 결과에 표시용 값이 함께 온다: Historical(억원 · 조원 · 퍼센트) · Valuation(EV · 주당 · WACC) · 원본 값은 그대로', () => {
  const h = data('getHistoricalAnalysis');
  const cfo = h.metrics.cfoMinusCapex;
  assert.deepEqual(cfo.values, [-13473865, 21576266, 37792969], '원본 KRW million 값은 full precision 그대로');
  assert.deepEqual(cfo.display.valuesEok, [-134738.65, 215762.66, 377929.69]);
  assert.ok(Math.abs(cfo.display.valuesTrillion[2] - 37.792969) < 1e-9);
  assert.ok(Math.abs(h.metrics.operatingMargin.display.valuesPercent[2] - h.metrics.operatingMargin.values[2] * 100) < 1e-9 && h.metrics.operatingMargin.display.valuesEok === undefined);
  assert.equal(h.metrics.revenueGrowth.display.valuesPercent[0], null);
  const v = data('getValuationResult');
  assert.deepEqual([v.display.enterpriseValueEok, v.display.perShareWon, v.display.waccPercent], [v.enterpriseValue, v.perShareValue, v.wacc * 100]);
  assert.equal(v.display.enterpriseValueTrillion, v.enterpriseValue / 1e4);
  assert.ok(typeof v.display.terminalGrowthPercent === 'number' && typeof v.display.tvContributionPercent === 'number');
  // 같은 환산 규칙 한 곳: Tool 의 display 값은 helper 와 같고, 재생성 요청의 표시 문자열도 helper 로 만든다
  assert.equal(formatFinancialValue(cfo.values[2], 'KRW million', 'jo'), '37.79조원');
});

test('Evidence 는 display 값을 근거로 추출하고, 모델이 display 값을 그대로 인용하면 바로 검증된다', () => {
  const r = ['getHistoricalAnalysis', 'getValuationResult'].map((t) => executeTool(t, ctx)) as ToolResult<unknown>[];
  const idx = extractEvidence(r);
  const e = idx.byId.get('getHistoricalAnalysis:metrics.cfoMinusCapex.display.valuesEok[2]')!;
  assert.deepEqual([e.unit, e.value], ['억원', 377929.69]);
  assert.equal(idx.byId.get('getHistoricalAnalysis:metrics.cfoMinusCapex.display.valuesTrillion[2]')!.unit, '조원');
  assert.equal(idx.byId.get('getHistoricalAnalysis:metrics.operatingMargin.display.valuesPercent[2]')!.unit, 'percent');
  assert.equal(idx.byId.get('getValuationResult:display.perShareWon')!.unit, '원');
  assert.equal(idx.byId.get('getValuationResult:display.waccPercent')!.unit, 'percent');
  const claim = (text: string, path: string) => groundAnalysis({ summary: 's', claims: [{ claimId: 'c', text, type: 'fact', evidenceRefs: [{ tool: 'getHistoricalAnalysis', fieldPath: path }] }], proposedActions: [], index: idx }).claims[0];
  assert.equal(claim('2025년 CFO−CAPEX 는 377,930억원이다.', 'metrics.cfoMinusCapex.display.valuesEok[2]').status, 'supported');
  assert.equal(claim('2025년 CFO−CAPEX 는 37.79조원이다.', 'metrics.cfoMinusCapex.display.valuesTrillion').status, 'supported');
  assert.equal(claim('2025년 영업이익률은 13.07%다.', 'metrics.operatingMargin.display.valuesPercent[2]').status, 'supported');
});

test('단위를 아는 근거는 같은 종류끼리만 비교한다 (우연한 일치 차단) · 단위 환산 착오(unitSlip)를 구분해서 센다', () => {
  const p = (t: string) => parseNumbers(t)[0];
  assert.ok(matchesValue(p('37.79조원'), 37_792_969, 'KRW million') && matchesValue(p('377,930억원'), 37_792_969, 'KRW million') && matchesValue(p('37.79조원'), 377_929.69, '억원'));
  assert.ok(!matchesValue(p('377.93억 원'), 37_792_969, 'KRW million') && !matchesValue(p('3,779억 원'), 37_792_969, 'KRW million'), '100배 · 1000배 착오');
  assert.ok(matchesValue(p('13.1%'), 0.1307, 'ratio (소수)') && !matchesValue(p('13.1%'), 13.1, 'KRW million'), '금액 근거는 퍼센트 claim 의 근거가 아니다');
  assert.ok(!matchesValue(p('8.14조원'), 0.0814, 'ratio'), '비율 근거는 금액 claim 의 근거가 아니다');
  assert.ok(matchesValue(p('13.07%'), 13.0696, 'percent') && matchesValue(p('1.5'), 1.545, 'multiple') && matchesValue(p('214,556원'), 214556.3, '원'));
  assert.ok(matchesValue(p('900'), 900, '억원'), '단위 없이 적은 값은 같은 값이면 인정');
  assert.ok(matchesValue(p('13.1%'), 0.1307), '단위를 모르는 근거는 기존처럼 허용 변환 후보를 모두 시도한다');
  const r = [executeTool('getHistoricalAnalysis', ctx)] as ToolResult<unknown>[];
  const o = groundAnalysis({ summary: 's', claims: [{ claimId: 'c', text: '2025년 CFO−CAPEX 는 377.93억 원이다.', type: 'fact', evidenceRefs: [{ tool: 'getHistoricalAnalysis', fieldPath: 'metrics.cfoMinusCapex.values[2]' }] },
    { claimId: 'd', text: '2025년 CFO−CAPEX 는 5조원이다.', type: 'fact', evidenceRefs: [{ tool: 'getHistoricalAnalysis', fieldPath: 'metrics.cfoMinusCapex.values[2]' }] }], proposedActions: [], index: extractEvidence(r) });
  assert.deepEqual(o.claims.map((c) => c.numbers[0].unitSlip ?? false), [true, false], '37.79조원의 1/1000 은 단위 착오, 5조원은 단순한 틀린 값');
});

test('claim 범주별 source authority · 개수 제한 · 분석 구조(sections) · first-pass / 재생성 지표', () => {
  const ev = (o: Partial<Evidence>) => ({ evidenceId: 'x', tool: 't', sourceType: 'financial-data', sourceKind: 'actual', ...o }) as Evidence;
  const actual = ev({ sourceKind: 'actual' }), engine = ev({ sourceKind: 'calculated' }), disc = ev({ sourceType: 'disclosure-document', sourceKind: 'document' }), up = ev({ sourceType: 'uploaded-document', sourceKind: 'document' });
  const dev = ev({ sourceType: 'market-data', sourceKind: 'external', provider: { name: 'Y', reliability: 'unofficial', tier: 'development' } }), news = ev({ sourceType: 'news', sourceKind: 'external' });
  const order = (cat: Parameters<typeof authorityRank>[1]) => [actual, engine, disc, up, dev, news].map((e) => authorityRank(e, cat));
  assert.deepEqual(order(undefined), [2, 1, 3, 4, 6, 7], '기본 우선순위는 그대로');
  assert.ok(authorityRank(actual, 'historical') < authorityRank(engine, 'historical'), '과거 실적은 OpenDART 실적이 우선');
  assert.ok(authorityRank(engine, 'valuation') < authorityRank(actual, 'valuation'), 'valuation 결과는 ValuFlow 엔진이 우선');
  assert.ok(authorityRank(dev, 'market') < authorityRank(engine, 'market'), '현재 주가는 시장 provider 가 우선');
  assert.ok(authorityRank(disc, 'management') < authorityRank(news, 'management') && authorityRank(up, 'industry') < authorityRank(disc, 'industry') && authorityRank(news, 'news') === 1);
  const r = [executeTool('getHistoricalAnalysis', ctx), executeTool('getValuationResult', ctx)] as ToolResult<unknown>[];
  const claims = Array.from({ length: 11 }, (_, i) => ({ claimId: `c${i + 1}`, text: '2025년 영업이익률은 13.1%다.', type: i < 3 ? 'fact' : i < 5 ? 'interpretation' : i < 7 ? 'risk' : 'recommendation', evidenceRefs: [{ tool: 'getHistoricalAnalysis', fieldPath: 'metrics.operatingMargin.values[2]' }] }));
  const o = groundAnalysis({ summary: 's', claims, proposedActions: [], index: extractEvidence(r) });
  assert.equal(o.claims.length, 8);
  assert.equal(o.report.claimsDropped, 3);
  assert.ok(o.issues.some((i) => i.code === 'too-many-claims' && !i.blocking));
  assert.deepEqual([o.report.sections.verifiedFacts.length, o.report.sections.interpretations.length, o.report.sections.valuationRisks.length, o.report.sections.recommendations.length], [3, 2, 2, 1], '검증된 사실 · 해석 · valuation 위험 · 권고');
  const none = groundAnalysis({ summary: 's', claims: [{ claimId: 'c1', text: '시장 변동성이 커질 수 있다.', type: 'risk', evidenceRefs: [] }], proposedActions: [], index: extractEvidence(r) });
  assert.deepEqual([none.claims[0].status, none.report.sections.valuationRisks], ['unsupported', []], '근거가 없는 위험은 제거 대상이고 sections 에도 들어가지 않는다');
});

test('표시용 문자열(Text)과 만 단위 복합 금액 파싱: 모델이 문자열을 옮기면 바로 검증되고, "26만 8,500원" 을 8,500원으로 오해하지 않는다', () => {
  const h = data('getHistoricalAnalysis');
  assert.deepEqual(h.metrics.cfoMinusCapex.display.valuesEokText, ['-134,739억원', '215,763억원', '377,930억원']);
  assert.deepEqual(h.metrics.cfoMinusCapex.display.valuesTrillionText, ['-13.47조원', '21.58조원', '37.79조원']);
  assert.equal(h.metrics.operatingMargin.display.valuesPercentText[2], '13.07%');
  assert.equal(h.metrics.revenueGrowth.display.valuesPercentText[0], null);
  const v = data('getValuationResult');
  assert.deepEqual([v.display.enterpriseValueText, v.display.perShareWonText, v.display.waccPercentText], ['2,346억원', '214,556원', '8.14%']);
  // 텍스트 그대로 옮긴 숫자는 검증을 통과한다
  const idx = extractEvidence(['getHistoricalAnalysis', 'getValuationResult'].map((t) => executeTool(t, ctx)) as ToolResult<unknown>[]);
  const o = groundAnalysis({ summary: '2023년 CFO−CAPEX 는 -134,739억원이고 2025년에는 377,930억원(37.79조원)입니다. 기업가치는 2,346억원, WACC 는 8.14%, 주당 214,556원입니다.', claims: [], proposedActions: [], index: idx });
  assert.deepEqual(o.report.summaryNumbers.map((n) => n.status), ['grounded', 'grounded', 'grounded', 'grounded', 'grounded', 'grounded']);
  assert.deepEqual(parseNumbers('주가는 26만 8,500원이다.').map((n) => [n.unit, n.value]), [['won', 268500]]);
  assert.deepEqual(parseNumbers('규모는 3억 5,000만원이다.').map((n) => [n.unit, n.value]), [['won', 350_000_000]]);
  assert.deepEqual(parseNumbers('목표가 5만원').map((n) => [n.unit, n.value]), [['won', 50000]]);   // 5만원 = 50,000원
  const mk = groundAnalysis({ summary: '주가는 26만 8,500원입니다.', claims: [], proposedActions: [], index: extractEvidence([{ status: 'ok', tool: 'getMarketData', data: { asOf: 'x', price: { value: 268500, unit: 'KRW', asOf: 'x', source: 'Y' } }, sources: [], warnings: [] } as ToolResult<unknown>]) });
  assert.equal(mk.report.summaryNumbers[0].status, 'grounded');
  // 모델이 여전히 환산하다 틀리면(100배) 잡는다
  const bad = groundAnalysis({ summary: '2025년 CFO−CAPEX 는 3,779억원입니다.', claims: [], proposedActions: [], index: idx });
  assert.deepEqual([bad.report.summaryNumbers[0].status, bad.report.summaryNumbers[0].unitSlip], ['ungrounded', true]);
});
