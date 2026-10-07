// STEP 09-2: Report Sections & Templates — 순서 · 제목 · 필수/선택 · 가시성 · 각 section 내용 · 출처 · footnote · 학습용 고지 · 재계산 금지 · template/model 분리.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildReport, buildReportInput, type AiAnalysisInput, type ReportInput, type ReportModel } from './index.ts';
import { buildFootnoteIndex, buildReportDocument, getTemplate, markerText, markersOf, TemplateError, validateTemplate, valuationStandardV1, type ReportTemplate, type ResolvedSection, type SectionId, type SectionContentMap } from './templates/index.ts';
import { buildScenario } from '../ai/eval/scenarios.ts';
import { withSensitivityRun, withValuationRun, type ProjectState } from '../store/projectModel.ts';
import type { Evidence, GroundedClaim } from '../ai/grounding/types.ts';

const golden = JSON.parse(readFileSync(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const NOW = () => new Date('2026-10-08T01:02:03Z');
const full = () => structuredClone(buildScenario('full', golden).project);
const inputOf = (p: ProjectState = full(), ai: AiAnalysisInput | null = null): ReportInput => buildReportInput(p, { now: NOW, aiAnalysis: ai });
const modelOf = (i: ReportInput): ReportModel => { const r = buildReport(i); assert.equal(r.status, 'ok', JSON.stringify(r.validation.errors)); return r.model!; };
const docOf = (p?: ProjectState, ai?: AiAnalysisInput | null, t?: ReportTemplate) => buildReportDocument(modelOf(inputOf(p, ai ?? null)), t);
const sec = <K extends SectionId>(d: ReturnType<typeof docOf>, id: K) => d.sections.find((s) => s.sectionId === id) as (ResolvedSection & { sectionId: K; content: SectionContentMap[K] | null }) | undefined;
const content = <K extends SectionId>(d: ReturnType<typeof docOf>, id: K): SectionContentMap[K] => { const s = sec(d, id); assert.ok(s?.content, `${id} 내용이 있어야 한다`); return s!.content!; };

/** 학습용이 아닌 가정(영구성장률 0.0201)으로 다시 계산한 Project: 고지 · warning 상태 비교용. */
function realProject(): ProjectState {
  const p = full();
  const a = { ...p.valuationAssumptions!, terminalGrowth: 0.0201 };
  return withSensitivityRun(withValuationRun({ ...p, valuationAssumptions: a }));
}

const claim = (claimId: string, text: string, type: GroundedClaim['type'], status: GroundedClaim['status'], evidenceIds: string[], basis: GroundedClaim['basis'] = 'objective', confidence: GroundedClaim['confidence'] = 'medium'): GroundedClaim =>
  ({ claimId, text, type, basis, evidenceIds, status, confidence, numbers: [], issues: [], confidenceNotes: [] });
const ev = (evidenceId: string, extra: Partial<Evidence> = {}): Evidence => ({ evidenceId, tool: 'getHistoricalAnalysis', sourceType: 'financial-data', sourceKind: 'actual', ...extra });
const aiFor = (input: ReportInput): AiAnalysisInput => ({
  analysisId: 'wf_9', question: 'q', workflowType: 'event-review', contextSnapshotId: input.snapshot.contextSnapshotId, createdAt: '2026-10-08T00:00:00Z', groundingLevel: 'claim-evidence',
  claims: [
    claim('c1', '회사는 설비투자 확대를 공시에서 언급했다.', 'fact', 'supported', ['e-doc']),
    claim('c2', '수익성 개선이 이어지고 있다.', 'interpretation', 'supported', ['e-hist'], 'judgment'),
    claim('c3', 'DCF 가치가 Terminal Value 에 크게 의존한다.', 'risk', 'supported', ['e-hist'], 'judgment', 'high'),
    claim('c4', '외부 시장 변수에 따른 위험이 있다.', 'risk', 'supported', ['e-mkt'], 'judgment', 'low'),
    claim('c5', '근거 없는 위험 주장.', 'risk', 'unsupported', []),
    claim('c6', '부분 근거 위험.', 'risk', 'partially-supported', ['e-mkt']),
    claim('c7', 'WACC 입력을 검토하라.', 'recommendation', 'supported', ['e-hist'], 'judgment'),
  ],
  evidence: [
    ev('e-hist', { fieldPath: 'metrics.operatingMargin.values[2]' }),
    ev('e-doc', { tool: 'searchDisclosures', sourceType: 'disclosure-document', sourceKind: 'document', origin: 'opendart', sourceLabel: '사업보고서 (2025.12)', documentId: '20260310002820', section: 'II. 사업의 내용', asOf: '2026-03-10' }),
    ev('e-mkt', { tool: 'getMarketData', sourceType: 'market-data', sourceKind: 'external', origin: 'yahoo-finance', sourceLabel: '005930.KS market data', asOf: '2026-10-07T03:00:00+00:00', provider: { name: 'Yahoo Finance', reliability: 'unofficial', tier: 'development' } }),
  ],
  sources: [], limitations: [],
});

test('1. section order: 기본 template 의 14개 section 이 정해진 순서로 나온다', () => {
  const d = docOf();
  assert.deepEqual(d.sections.map((s) => s.sectionId), ['cover', 'executiveSummary', 'companyOverview', 'historicalPerformance', 'forecast', 'wacc', 'dcf', 'sensitivity', 'scenario', 'relativeValuation', 'keyRisks', 'conclusion', 'sources', 'appendix']);
  assert.deepEqual(d.template, { id: 'valuation-standard-v1', name: 'Valuation Report (Standard)', version: '1.0' });
  // 번호는 template 이 매긴다: 표지 없음 · 본문 1..12 · 부록 A
  assert.deepEqual(d.sections.map((s) => s.number), [null, '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'].slice(0, 14).map((x, i) => (i === 0 ? null : i === 13 ? 'A' : String(i))));
});

test('2. section title', () => {
  const d = docOf();
  assert.deepEqual(d.sections.map((s) => s.title), ['Cover', 'Executive Summary', 'Company Overview', 'Historical Financial Performance', 'Forecast Assumptions', 'WACC', 'DCF Valuation', 'Sensitivity Analysis', 'Scenario Analysis', 'Relative Valuation', 'Key Risks / Considerations', 'Conclusion', 'Sources', 'Appendix']);
});

test('3. required section: 필수 section 은 숨길 수 없고, 필수 표시는 template 이 가진다', () => {
  const req = valuationStandardV1.sections.filter((s) => s.required).map((s) => s.sectionId);
  assert.deepEqual(req, ['cover', 'executiveSummary', 'companyOverview', 'historicalPerformance', 'forecast', 'wacc', 'dcf', 'conclusion', 'sources', 'appendix']);
  assert.deepEqual(valuationStandardV1.sections.filter((s) => !s.required).map((s) => s.sectionId), ['sensitivity', 'scenario', 'relativeValuation', 'keyRisks']);
  const bad: ReportTemplate = { ...valuationStandardV1, id: 'bad', sections: valuationStandardV1.sections.map((s) => (s.sectionId === 'dcf' ? { ...s, visibility: 'never' as const } : s)) };
  assert.match(validateTemplate(bad)[0]!, /필수 section 을 숨길 수 없습니다: dcf/);
  assert.throws(() => buildReportDocument(modelOf(inputOf()), bad), TemplateError);
  assert.deepEqual(validateTemplate(valuationStandardV1), []);
  assert.ok(validateTemplate({ ...valuationStandardV1, sections: [...valuationStandardV1.sections, valuationStandardV1.sections[0]!] }).some((x) => x.includes('중복')));
  // 필수 section 은 모두 문서에 있고 내용이 있다 (빈 section 을 만들지 않는다)
  const d = docOf();
  for (const s of d.sections.filter((x) => x.required)) assert.ok(s.content !== null && s.status !== 'unavailable', s.sectionId);
});

test('4. optional sensitivity: 없으면 숨기고 이유를 diagnostics 에 남기며 번호가 이어진다', () => {
  const p = full();
  const d = docOf({ ...p, sensitivityResult: null });
  assert.ok(!sec(d, 'sensitivity'));
  assert.deepEqual(d.diagnostics.hiddenSections.map((h) => [h.sectionId, h.reason]), [['sensitivity', 'Sensitivity 가 계산되지 않았습니다.']]);
  assert.deepEqual(d.sections.filter((s) => s.number !== null && s.number !== 'A').map((s) => s.number), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'], '숨긴 section 때문에 번호에 구멍이 생기지 않는다');
  // template 이 "unavailable 로 보여 주기"를 고르면 빈 표 없이 상태와 이유만 보인다
  const showing: ReportTemplate = { ...valuationStandardV1, id: 'show', sections: valuationStandardV1.sections.map((s) => (s.sectionId === 'sensitivity' ? { ...s, visibility: 'always' as const } : s)) };
  const d2 = docOf({ ...p, sensitivityResult: null }, null, showing);
  const s = sec(d2, 'sensitivity')!;
  assert.deepEqual([s.status, s.content, s.reason], ['unavailable', null, 'Sensitivity 가 계산되지 않았습니다.']);
  assert.equal(d2.diagnostics.hiddenSections.length, 0);
});

test('5. optional scenario: 모델에 없으면 숨긴다', () => {
  const m = structuredClone(modelOf(inputOf()));
  m.scenario = { status: 'unavailable', reason: 'Scenario 를 계산할 수 없습니다.' };
  const d = buildReportDocument(m);
  assert.ok(!sec(d, 'scenario'));
  assert.ok(d.diagnostics.hiddenSections.some((h) => h.sectionId === 'scenario' && /Scenario/.test(h.reason)));
  assert.ok(sec(d, 'sensitivity'), '다른 optional section 은 그대로');
});

test('6. optional relative: 입력이 없으면 not-applicable 이라 제외하고 이유를 남긴다', () => {
  const p = full();
  const d = docOf({ ...p, relativeInputs: {} });
  assert.ok(!sec(d, 'relativeValuation'));
  assert.match(d.diagnostics.hiddenSections.find((h) => h.sectionId === 'relativeValuation')!.reason, /입력하지 않은 값은 만들지 않습니다/);
  assert.ok(sec(docOf(), 'relativeValuation'));
});

test('7. cover metadata: 회사 · 제목 · 기준일 · 생성일 · 통화 · 단위 · 버전', () => {
  const d = docOf();
  const c = content(d, 'cover');
  const m = d.metadata;
  assert.deepEqual([c.company, c.title, c.subtitle, c.valuationDate, c.createdAt, c.currency, c.monetaryUnit, c.perShareUnit], [m.company.name, `${m.company.name} Valuation Report`, 'As of 2026-10-08', '2026-10-08', '2026-10-08T01:02:03.000Z', 'KRW', '억원', '원']);
  assert.deepEqual(c.reportVersion, { schema: '1.0', template: '1.0' });
  assert.equal(sec(d, 'cover')!.number, null);
});

test('8. executive headline: EV · Equity · 주당 · WACC · g 가 deterministic 숫자이고 AI 없이도 나온다', () => {
  const p = full();
  const d = docOf(p);
  const h = content(d, 'executiveSummary').headline;
  assert.equal(h.enterpriseValue.value, p.valuationResult!.enterpriseValue);
  assert.equal(h.equityValue.value, p.valuationResult!.equityValue);
  assert.equal(h.perShareValue.value, p.valuationResult!.perShareValue);
  assert.equal(h.wacc.value, p.valuationResult!.wacc);
  assert.equal(h.terminalGrowth.value, p.valuationAssumptions!.terminalGrowth);
  assert.deepEqual([h.terminalGrowth.kind, h.enterpriseValue.kind], ['estimate', 'calculated']);
  const es = content(d, 'executiveSummary');
  assert.equal(es.narrative.status, 'unavailable');
  assert.deepEqual([es.highlights.conclusion, es.highlights.judgment, es.highlights.risk], [[], [], []]);
  // AI 가 있으면 Grounded Claim 이 역할별로 나뉜다 (새 문장 없음)
  const input = inputOf();
  const d2 = docOf(full(), aiFor(input));
  const es2 = content(d2, 'executiveSummary');
  assert.deepEqual([es2.highlights.conclusion.map((i) => i.claimId), es2.highlights.judgment.map((i) => i.claimId), es2.highlights.risk.map((i) => i.claimId)], [['c1'], ['c2'], ['c3', 'c4']]);
});

test('9. historical A labels: 2023A–2025A · 핵심 6개 표 · Actual · 출처', () => {
  const d = docOf();
  const h = content(d, 'historicalPerformance');
  assert.deepEqual(h.periods.map((p) => [p.label, p.kind]), [['2023A', 'actual'], ['2024A', 'actual'], ['2025A', 'actual']]);
  assert.deepEqual(h.coreRows.map((r) => r.key), ['revenue', 'operatingProfit', 'operatingMargin', 'netIncome', 'cfo', 'capex']);
  for (const r of h.coreRows) assert.equal(r.cells.length, 3);
  assert.ok(h.coreRows.find((r) => r.key === 'revenue')!.cells.every((c) => c.kind === 'actual'));
  assert.equal(h.dataSource.sourceId, 'src-historical');
  assert.match(h.dataSource.label, /OpenDART/);
  assert.ok(h.trendSummary.some((t) => t.key === 'operatingMargin' && t.directionLabel.length > 0));
  assert.ok(h.additionalRows.some((r) => r.key === 'depreciation'));
  const co = content(d, 'companyOverview');
  assert.deepEqual([co.historicalPeriod, co.reportingBasis, co.dataKind], ['2023A – 2025A', 'Consolidated', 'actual']);
  assert.ok(co.corpCode !== undefined && co.stockCode !== undefined && co.dataSource.origin === 'database');
});

test('10. forecast E labels: 2026E+ · Estimate · 가정 출처(user-input / learning-fixture)', () => {
  const d = docOf();
  const f = content(d, 'forecast');
  assert.ok(f.periods.length >= 3 && f.periods[0]!.label === '2026E' && f.periods.every((p) => p.kind === 'estimate'));
  assert.deepEqual(f.assumptions.map((r) => r.key), ['revenueGrowth', 'operatingMargin', 'depreciation', 'capex', 'deltaNwc']);
  assert.ok(f.scalars.some((s) => s.key === 'taxRate'));
  assert.ok([...f.assumptions.flatMap((r) => r.cells), ...f.scalars.map((s) => s.cell)].every((c) => c.kind === 'estimate' && c.sourceId === 'src-assumptions'));
  assert.deepEqual([f.assumptionSource.origin, f.assumptionSource.label], ['learning-fixture', 'STEP 04 학습용 가정']);
  assert.equal(content(docOf(realProject()), 'forecast').assumptionSource.origin, 'user-input');
  assert.match(f.basisNote, /Actual/);
});

test('11. WACC components: 입력(Estimate)과 계산 결과를 분리하고 WACC 는 따로 둔다', () => {
  const w = content(docOf(), 'wacc');
  assert.deepEqual(w.inputs.map((c) => c.key), ['riskFreeRate', 'beta', 'marketRiskPremium', 'preTaxCostOfDebt', 'taxRate']);
  assert.deepEqual(w.derived.map((c) => c.key), ['costOfEquity', 'afterTaxCostOfDebt', 'equityWeight', 'debtWeight']);
  assert.ok(w.inputs.every((c) => c.cell.kind === 'estimate') && w.derived.every((c) => c.cell.kind === 'calculated'));
  assert.equal(w.wacc.kind, 'calculated');
  assert.ok(![...w.inputs, ...w.derived].some((c) => c.key === 'wacc'), 'WACC 는 구성요소 목록에 섞이지 않는다');
  assert.match(w.note, /구성요소/);
});

test('12. DCF rows: Revenue · EBIT · NOPAT · D&A · CAPEX · ΔNWC · FCFF · Discount Factor · PV, 그리고 Terminal', () => {
  const dcf = content(docOf(), 'dcf');
  assert.deepEqual(dcf.rows.map((r) => r.key), ['revenue', 'ebit', 'nopat', 'depreciation', 'capex', 'deltaNwc', 'fcff', 'discountFactor', 'pvFcff']);
  assert.ok(dcf.rows.every((r) => r.cells.length === dcf.periods.length));
  assert.ok(dcf.periods.every((p) => p.kind === 'estimate'));
  assert.deepEqual(dcf.terminal.map((t) => t.key), ['terminalGrowth', 'terminalFcff', 'terminalValue', 'pvTerminalValue']);
  assert.ok(dcf.bridge.some((b) => b.key === 'enterpriseValue'));
  assert.equal(dcf.rows.find((r) => r.key === 'fcff')!.cells.every((c) => c.kind === 'calculated'), true);
});

test('13. equity bridge (순부채): EV − Net Debt = Equity Value, 주당 가치 포함', () => {
  const p = full();
  const b = content(docOf(p), 'dcf').equityBridge;
  assert.ok(p.valuationResult!.netDebt > 0);
  assert.equal(b.kind, 'net-debt');
  assert.deepEqual(b.lines.map((l) => [l.key, l.operator]), [['enterpriseValue', null], ['netDebt', '-'], ['equityValue', '=']]);
  assert.equal(b.lines[1]!.label, 'Net Debt');
  assert.equal(b.lines[0]!.cell.value, p.valuationResult!.enterpriseValue);
  assert.equal(b.lines[1]!.cell.value, p.valuationResult!.netDebt);
  assert.equal(b.lines[2]!.cell.value, p.valuationResult!.equityValue);
  assert.equal(b.perShareValue.value, p.valuationResult!.perShareValue);
  assert.equal(b.sharesOutstanding.unit, 'shares');
});

test('14. net cash case: EV + Net Cash = Equity Value', () => {
  const input = structuredClone(inputOf());
  const r = input.valuationResult!;
  r.netDebt = -150; r.equityValue = r.enterpriseValue + 150;   // 순현금 상태 (Report 는 입력의 결과를 그대로 옮긴다)
  const b = content(buildReportDocument(modelOf(input)), 'dcf').equityBridge;
  assert.equal(b.kind, 'net-cash');
  assert.deepEqual(b.lines.map((l) => [l.key, l.operator, l.label]), [['enterpriseValue', null, 'Enterprise Value'], ['netCash', '+', 'Net Cash'], ['equityValue', '=', 'Equity Value']]);
  assert.equal(b.lines[1]!.cell.value, 150, 'Net Cash 는 Net Debt 의 부호만 바꾼 표시');
  assert.equal(b.lines[2]!.cell.value, r.enterpriseValue + 150);
  const zero = structuredClone(inputOf()); zero.valuationResult!.netDebt = 0;
  assert.equal(content(buildReportDocument(modelOf(zero)), 'dcf').equityBridge.kind, 'neutral');
});

test('15. sensitivity: 5×5 matrix · Base cell flag · invalid flag · 숫자는 모델 그대로', () => {
  const s = content(docOf(), 'sensitivity');
  assert.deepEqual([s.waccAxis.length, s.growthAxis.length, s.rows.length], [5, 5, 5]);
  assert.ok(s.rows.every((r) => r.cells.length === 5));
  const base = s.rows.flatMap((r) => r.cells).filter((c) => c.isBaseCase);
  assert.equal(base.length, 1, 'Base cell 은 semantic flag 로만 표시한다');
  assert.ok(s.rows.flatMap((r) => r.cells).every((c) => c.valid), '엔진은 WACC <= g 조합을 계산하지 않으므로 모두 valid');
  assert.ok(s.rows.flatMap((r) => r.cells).every((c) => c.enterpriseValue.kind === 'calculated' && c.wacc.value! > 0));
  assert.deepEqual(s.directionNotes, ['WACC ↑ → Value ↓', 'Terminal Growth ↑ → Value ↑']);
  assert.ok(s.enterpriseValueRange.min.value! <= s.enterpriseValueRange.max.value!);
  // invalid(WACC <= g) 셀은 flag 로 구분된다
  const m = structuredClone(modelOf(inputOf()));
  const cellRow = (m.sensitivity as { data: { rows: { terminalGrowth: { value: number }; cells: { wacc: { value: number }; valid: boolean }[] }[] } }).data.rows[0]!;
  cellRow.terminalGrowth.value = 0.5;
  const d = buildReportDocument(m);
  assert.ok(content(d, 'sensitivity').rows[0]!.cells.length === 5);
});

test('16. scenario: Bear · Base · Bull 컬럼 · 가정 · 결과, Sensitivity Range 와 분리', () => {
  const sc = content(docOf(), 'scenario');
  assert.deepEqual(sc.columns.map((c) => c.id), ['bear', 'base', 'bull']);
  for (const c of sc.columns) {
    assert.ok(c.assumptions.revenueGrowth.length >= 3 && c.assumptions.operatingMargin.length >= 3);
    assert.ok([c.wacc, c.enterpriseValue, c.equityValue, c.perShareValue, c.assumptions.terminalGrowth, c.assumptions.marketRiskPremium].every((x) => x.state === 'ok'));
  }
  assert.ok(sc.columns[0]!.equityValue.value! < sc.columns[2]!.equityValue.value!);
  assert.match(sc.note, /예측이 아닙니다/);
  assert.equal(sc.equityRange.status, 'ok');
  const sens = content(docOf(), 'sensitivity');
  assert.ok(!('equityRange' in sens) && !('columns' in sens), 'Scenario 범위와 Sensitivity 범위는 서로 다른 section 의 다른 필드다');
});

test('17. relative missing value: 입력되지 않은 멀티플은 missing 그대로, 평균을 만들지 않는다', () => {
  const p = full();
  const d = docOf({ ...p, relativeInputs: { netIncome: 150, per: 12 } });
  const r = content(d, 'relativeValuation');
  const by = (m: string) => r.rows.find((x) => x.method === m)!;
  assert.equal(by('PER').status, 'ok');
  for (const m of ['PBR', 'EV/EBITDA']) {
    assert.equal(by(m).status, 'incomplete');
    assert.deepEqual([by(m).equityValue.state, by(m).equityValue.value, by(m).equityValue.text], ['unavailable', null, null]);
  }
  assert.deepEqual(r.inputs.map((i) => i.key).sort(), ['netIncome', 'per']);
  assert.ok(!Object.keys(r).some((k) => /average|mean|median/i.test(k)), '평균 · 중앙값 필드가 없다');
  assert.deepEqual([r.inputSource?.sourceId, /Peer/.test(r.note)], ['src-relative-inputs', true]);
  assert.ok(r.inputs.every((i) => i.cell.kind === 'estimate'));
  // 범위는 입력에 이미 있는 valuationRange 만 사용한다
  const range = content(docOf(), 'conclusion').range;
  assert.equal(range.status, 'ok');
});

test('18. key risks: 검증을 통과한 AI risk claim 만 (text · confidence · sourceIds 보존), 다른 유형은 섞지 않는다', () => {
  const input = inputOf();
  const d = docOf(full(), aiFor(input));
  const k = content(d, 'keyRisks');
  assert.equal(k.narrative.status, 'ok');
  const items = k.narrative.status === 'ok' ? k.narrative.data.items : [];
  assert.deepEqual(items.map((i) => [i.claimId, i.claimType, i.confidence]), [['c3', 'risk', 'high'], ['c4', 'risk', 'low']], 'supported risk 만 (c5 unsupported · c6 partial · 다른 유형 제외)');
  assert.ok(items.every((i) => i.text.length > 0 && i.sourceIds.length > 0));
  assert.equal(k.narrative.status === 'ok' ? k.narrative.data.excludedClaims : -1, 2);
  // AI 가 없어도 deterministic 위험(엔진 검토 경고)은 남고, 없으면 section 이 사라진다
  const noAi = content(docOf(), 'keyRisks');
  assert.equal(noAi.narrative.status, 'unavailable');
  assert.ok(noAi.items.every((i) => i.origin === 'engine-review' || i.origin === 'data-quality'));
  const m = structuredClone(modelOf(inputOf())); m.keyRisks = { items: [], narrative: { status: 'unavailable', reason: '없음' } };
  const d2 = buildReportDocument(m);
  assert.ok(!sec(d2, 'keyRisks') && d2.diagnostics.hiddenSections.some((h) => h.sectionId === 'keyRisks'));
  // Conclusion: grounded recommendation 이 있으면 쓰고 없으면 deterministic headline 만
  const c = content(d, 'conclusion');
  assert.deepEqual(c.narrative.status === 'ok' ? c.narrative.data.items.map((i) => i.claimId) : [], ['c7']);
  const c0 = content(docOf(), 'conclusion');
  assert.equal(c0.narrative.status, 'unavailable');
  assert.equal(c0.headline.enterpriseValue.state, 'ok');
});

test('19. source registry: [S1]… 번호 · label · type · as-of · provider · reference', () => {
  const input = inputOf();
  const d = docOf(full(), aiFor(input));
  assert.deepEqual(d.sources.map((s) => s.marker), d.sources.map((_, i) => `S${i + 1}`));
  assert.deepEqual(d.sources.slice(0, 3).map((s) => [s.marker, s.id, s.type]), [['S1', 'src-historical', 'Historical (Actual)'], ['S2', 'src-assumptions', 'Assumption'], ['S3', 'src-engine', 'Valuation Engine']]);
  const doc = d.sources.find((s) => s.type === 'Disclosure')!;
  assert.deepEqual([doc.label, doc.asOf, doc.provider, doc.reference], ['사업보고서 (2025.12)', '2026-03-10', 'opendart', 'II. 사업의 내용 · documentId 20260310002820']);
  const mkt = d.sources.find((s) => s.type === 'Market Data')!;
  assert.deepEqual([mkt.provider, mkt.reliability, mkt.asOf], ['yahoo-finance', 'unofficial · development', '2026-10-07T03:00:00+00:00']);
  assert.deepEqual(content(d, 'sources').entries, d.sources);
  assert.deepEqual(buildFootnoteIndex([]), {});
  assert.equal(new Set(d.sources.map((s) => s.id)).size, d.sources.length);
});

test('20. footnote reference: sourceId → [S#] marker contract (Cell · narrative · section)', () => {
  const input = inputOf();
  const d = docOf(full(), aiFor(input));
  const rev = content(d, 'historicalPerformance').coreRows.find((r) => r.key === 'revenue')!.cells[2]!;
  assert.equal(d.footnoteIndex[rev.sourceId!], 'S1');
  assert.deepEqual(markersOf(d.footnoteIndex, rev.sourceId), ['S1']);
  assert.equal(markerText(markersOf(d.footnoteIndex, rev.sourceId)), '[S1]');
  const es = content(d, 'executiveSummary');
  const item = es.highlights.conclusion.find((i) => i.claimId === 'c1')!;
  const docSrc = d.sources.find((s) => s.type === 'Disclosure')!;
  assert.deepEqual(markersOf(d.footnoteIndex, item.sourceIds), [docSrc.marker]);
  assert.equal(markerText(markersOf(d.footnoteIndex, [docSrc.id, 'src-historical'])), `[S1][${docSrc.marker}]`, '번호 순서, 중복 제거');
  assert.deepEqual(markersOf(d.footnoteIndex, ['unknown-source']), [], '알 수 없는 출처는 marker 를 만들지 않는다');
  assert.deepEqual(sec(d, 'historicalPerformance')!.sourceMarkers, ['S1', docSrc.marker], 'Historical 표(S1)와 그 section 의 AI fact claim 이 인용한 공시 출처');
  assert.deepEqual(sec(docOf(), 'historicalPerformance')!.sourceMarkers, ['S1'], 'AI 가 없으면 Historical 출처만');
  assert.ok(sec(d, 'dcf')!.sourceMarkers.includes('S3') && sec(d, 'dcf')!.sourceMarkers.includes('S2'));
  assert.ok(sec(d, 'executiveSummary')!.sourceMarkers.includes(docSrc.marker));
  assert.deepEqual(sec(d, 'sources')!.sourceMarkers, []);
});

test('21. 학습용 / fixture 고지: 상단 banner 와 해당 section notice, warning 상태', () => {
  const d = docOf();
  assert.equal(d.banners.length, 1);
  assert.equal(d.banners[0]!.title, 'Learning / Demonstration Data');
  assert.match(d.banners[0]!.text, /학습용 가상값/);
  for (const id of ['executiveSummary', 'forecast', 'wacc', 'dcf', 'sensitivity', 'scenario', 'conclusion'] as const) {
    const s = sec(d, id)!;
    assert.ok(s.notices.some((n) => n.startsWith('Learning / Demonstration Data')), id);
    assert.equal(s.status, 'warning', id);
  }
  assert.equal(sec(d, 'cover')!.notices.length, 0);
  // 실제 가정(학습용 아님)이면 고지가 없다
  const real = docOf(realProject());
  assert.deepEqual(real.banners, []);
  assert.equal(sec(real, 'forecast')!.status, 'ok');
  assert.equal(sec(real, 'dcf')!.status, 'ok');
  // fixture Historical
  const fx = full();
  const fxDoc = docOf({ ...fx, historicalProvenance: { source: 'fixture', persisted: false } });
  assert.ok(sec(fxDoc, 'historicalPerformance')!.notices.some((n) => n.includes('fixture')));
  assert.match(fxDoc.banners[0]!.text, /fixture/);
});

test('22. appendix: 데이터 품질 · provenance · Missing Data · 검증 경고 · 가정 출처 · 기술 정보', () => {
  const d = docOf();
  const a = content(d, 'appendix');
  assert.ok(a.validationWarnings.some((w) => w.code === 'learning-assumptions'));
  assert.ok(a.missingData.some((m) => m.label.includes('D&A') && m.state === 'unavailable' && /공시 데이터에 없어/.test(m.reason ?? '')), 'D&A 는 Missing Data 로 기록된다');
  assert.ok(a.missingData.every((m) => m.state !== undefined && m.sectionId));
  assert.deepEqual([a.provenance?.origin, a.provenance?.kind], ['database', 'actual']);
  assert.ok(a.assumptionSources.length >= 10 && a.assumptionSources.every((x) => x.sourceLabel === 'STEP 04 학습용 가정'));
  assert.deepEqual([a.technical.schemaVersion, a.technical.templateId, a.technical.templateVersion], ['1.0', 'valuation-standard-v1', '1.0']);
  assert.match(a.technical.reportId, /^rpt-/);
  assert.ok(a.technical.inputHash && a.technical.contextSnapshotId && a.technical.valuationSnapshotId);
  assert.ok(a.unitPolicy.length > 3 && a.kindLegend.length === 3);
  assert.equal(sec(d, 'appendix')!.number, 'A');
  // 기술 정보(해시 · snapshot id)는 부록에만 있다
  for (const s of d.sections.filter((x) => x.sectionId !== 'appendix' && x.sectionId !== 'cover')) assert.ok(!JSON.stringify(s.content).includes(a.technical.inputHash), s.sectionId);
});

test('23. 재계산 금지: template 코드는 엔진 계산 함수를 호출하지 않고 모델 값을 그대로 옮긴다', () => {
  const FORBIDDEN = /\b(runValuation|runSensitivity|runScenarios?|calculateWacc|calculateCostOfEquity|calculateRelativeValuation|analyzeHistorical|buildValidationView|buildSensitivityView|buildScenarioView|buildDcfView|terminalValueContribution)\s*\(/;
  const dir = new URL('./templates/', import.meta.url).pathname;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) assert.ok(!FORBIDDEN.test(readFileSync(`${dir}${f}`, 'utf8').replace(/\/\/.*$/gm, '')), `${f} 가 엔진 계산 함수를 호출한다`);
  // sentinel: 모델의 값이 바뀌면 문서도 그대로 따라온다 (다시 계산하지 않는다)
  const m = structuredClone(modelOf(inputOf()));
  const before = JSON.stringify(m);
  (m.executiveSummary.headline.enterpriseValue as { value: number }).value = 123456.789;
  (m.dcf.equityBridge.lines[0]!.cell as { value: number }).value = 123456.789;
  const frozen = JSON.stringify(m);
  const d = buildReportDocument(m);
  assert.equal(JSON.stringify(m), frozen, '문서 생성은 모델을 바꾸지 않는다');
  assert.equal(content(d, 'executiveSummary').headline.enterpriseValue.value, 123456.789);
  assert.equal(content(d, 'dcf').equityBridge.lines[0]!.cell.value, 123456.789);
  assert.notEqual(before, frozen);
  // 숫자 Cell 의 총 개수 · 값은 section 에 옮겨도 변하지 않는다 (Net Cash 표시 제외)
  const cellValues = (o: unknown, out: number[] = []): number[] => { if (Array.isArray(o)) o.forEach((x) => cellValues(x, out)); else if (o && typeof o === 'object') { const r = o as Record<string, unknown>; if (typeof r.state === 'string' && 'sourceId' in r) { if (r.state === 'ok') out.push(r.value as number); } else Object.values(r).forEach((v) => cellValues(v, out)); } return out; };
  const model = modelOf(inputOf());
  const modelVals = new Set(cellValues(model));
  const docVals = cellValues(buildReportDocument(model).sections.filter((s) => s.sectionId !== 'appendix'));
  assert.ok(docVals.every((v) => modelVals.has(v)), '문서의 모든 숫자는 모델에 이미 있던 값이다');
});

test('24. template / model 분리: 모델에는 순서 · 제목 · 번호 · layout 이 없고 template 을 바꾸면 같은 모델로 다른 문서가 나온다', () => {
  const model = modelOf(inputOf());
  const json = JSON.stringify(model);
  for (const s of ['Key Risks / Considerations', 'Historical Financial Performance', 'pageBreakBefore', '"numbering"', '"layout"', 'valuation-standard-v1']) assert.ok(!json.includes(s), `모델에 template 정보(${s})가 없다`);
  const summary: ReportTemplate = {
    id: 'valuation-summary', name: 'Valuation Summary', version: '0.1',
    sections: [
      { sectionId: 'cover', title: '표지', order: 1, required: true, visibility: 'always', numbering: 'none', layout: { kind: 'cover' } },
      { sectionId: 'dcf', title: '가치평가', order: 2, required: true, visibility: 'always', numbering: 'decimal', layout: { kind: 'table' } },
      { sectionId: 'executiveSummary', title: '요약', order: 3, required: true, visibility: 'always', numbering: 'decimal', layout: { kind: 'summary' } },
      { sectionId: 'sensitivity', title: '민감도', order: 4, required: false, visibility: 'when-available', numbering: 'decimal', layout: { kind: 'matrix' } },
      { sectionId: 'sources', title: '출처', order: 5, required: true, visibility: 'always', numbering: 'decimal', layout: { kind: 'sources' } },
    ],
  };
  assert.deepEqual(validateTemplate(summary), []);
  const a = buildReportDocument(model);
  const b = buildReportDocument(model, summary);
  assert.deepEqual(b.sections.map((s) => [s.number, s.title]), [[null, '표지'], ['1', '가치평가'], ['2', '요약'], ['3', '민감도'], ['4', '출처']]);
  assert.equal(b.template.id, 'valuation-summary');
  assert.notDeepEqual(a.sections.map((s) => s.sectionId), b.sections.map((s) => s.sectionId));
  assert.deepEqual(content(b, 'dcf'), content(a, 'dcf'), '같은 모델의 같은 section 내용');
  assert.equal(getTemplate('valuation-standard-v1'), valuationStandardV1);
  assert.equal(getTemplate('nope'), null);
  // 같은 모델 · 같은 template → 같은 문서 (deterministic)
  assert.equal(JSON.stringify(buildReportDocument(model)), JSON.stringify(a));
});
