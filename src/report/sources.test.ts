// STEP 09-5: Sources / Evidence / Footnotes — 출처 종류 · 안정적인 번호 · 표/서술 인용 · 문서 위치 · provider 신뢰 등급 · 시장/Peer 근거 경로 · 미사용 출처 정책.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPresentation, buildReport, buildReportDocument, buildReportInput, checkCitations, markersOf, type AiAnalysisInput, type ReportInput } from './index.ts';
import { buildScenario } from '../ai/eval/scenarios.ts';
import type { AnswerSource } from '../ai/answer.ts';
import type { Evidence, GroundedClaim } from '../ai/grounding/types.ts';

const golden = JSON.parse(readFileSync(new URL('../../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const NOW = () => new Date('2026-10-08T01:02:03Z');
const proj = () => structuredClone(buildScenario('full', golden).project);
const base = () => buildReportInput(proj(), { now: NOW });
const claim = (claimId: string, text: string, type: GroundedClaim['type'], evidenceIds: string[], basis: GroundedClaim['basis'] = 'objective', confidence: GroundedClaim['confidence'] = 'medium'): GroundedClaim =>
  ({ claimId, text, type, basis, evidenceIds, status: 'supported', confidence, numbers: [], issues: [], confidenceNotes: [] });
const DEV = { name: 'Yahoo Finance', reliability: 'unofficial', tier: 'development', official: false, valuationGrade: false };
const AT = '2026-10-07T03:00:00+00:00';
const EVIDENCE: Evidence[] = [
  { evidenceId: 'h', tool: 'getHistoricalAnalysis', sourceType: 'financial-data', sourceKind: 'actual' },
  { evidenceId: 'doc', tool: 'searchDisclosures', sourceType: 'disclosure-document', sourceKind: 'document', origin: 'opendart', sourceLabel: '사업보고서 (2025.12)', documentId: '20260310002820', section: 'II. 사업의 내용', asOf: '2026-03-10' },
  { evidenceId: 'pdf', tool: 'searchUploadedDocuments', sourceType: 'uploaded-document', sourceKind: 'document', origin: 'user-upload', sourceLabel: '2026 Semiconductor Outlook', documentId: '7', page: 18 },
  { evidenceId: 'news', tool: 'searchCompanyNews', sourceType: 'news', sourceKind: 'external', origin: 'google-news', sourceLabel: '평택 신규 라인 투자 확정', asOf: '2026-10-06T01:00:00+00:00', url: 'https://news.example/1', provider: { name: 'Google News', reliability: 'unofficial', tier: 'development', official: false, valuationGrade: false } },
  { evidenceId: 'cap', tool: 'getMarketData', sourceType: 'market-data', sourceKind: 'external', origin: 'yahoo-finance', sourceLabel: '005930.KS market data', fieldPath: 'marketCap.valueEok', value: 17631220, unit: '억원', asOf: AT, provider: DEV },
  { evidenceId: 'capraw', tool: 'getMarketData', sourceType: 'market-data', sourceKind: 'external', origin: 'yahoo-finance', sourceLabel: '005930.KS market data', fieldPath: 'marketCap.value', value: 1.763122e15, unit: 'KRW', asOf: AT, provider: DEV },
  { evidenceId: 'px', tool: 'getMarketData', sourceType: 'market-data', sourceKind: 'external', origin: 'yahoo-finance', sourceLabel: '005930.KS market data', fieldPath: 'price.value', value: 268500, unit: 'KRW', asOf: AT, provider: DEV },
  { evidenceId: 'rf', tool: 'getMarketAssumptions', sourceType: 'market-data', sourceKind: 'external', origin: 'fred', sourceLabel: 'KR 10Y', fieldPath: 'riskFreeRate.rate', value: 0.04286, unit: 'ratio', asOf: '2026-08-01', provider: { name: 'FRED (OECD)', reliability: 'secondary', tier: 'development', official: false, valuationGrade: false } },
  { evidenceId: 'beta', tool: 'getMarketAssumptions', sourceType: 'market-data', sourceKind: 'external', origin: 'yahoo-finance', sourceLabel: '005930.KS beta', fieldPath: 'beta.value', value: 1.545, asOf: AT, provider: DEV },
  { evidenceId: 'peer', tool: 'getComparableCompanies', sourceType: 'peer-data', sourceKind: 'external', origin: 'yahoo-finance', sourceLabel: 'Peer set', fieldPath: 'subject.multiples.evEbitda', value: 7.2, asOf: AT, provider: DEV },
  { evidenceId: 'off', tool: 'getMarketData', sourceType: 'market-data', sourceKind: 'external', origin: 'krx', sourceLabel: 'KRX', fieldPath: 'price.value', value: 270000, unit: 'KRW', asOf: AT, provider: { name: 'KRX', reliability: 'official', tier: 'production', official: true, valuationGrade: true } },
];
const SOURCES: AnswerSource[] = [
  { kind: 'document', type: 'disclosure-document', origin: 'opendart', basis: null, fetchedAt: null, reportName: '사업보고서 (2025.12)', corpName: '삼성전자', filingDate: '2026-03-10', receiptNo: '20260310002820', section: 'II. 사업의 내용', documentId: '20260310002820' },
  { kind: 'document', type: 'uploaded-document', origin: 'user-upload', basis: null, fetchedAt: null, title: '2026 Semiconductor Outlook', page: 18, sourceName: 'PwC Insight', uploadedAt: '2026-10-01T00:00:00Z', documentId: '7' },
  { kind: 'external', type: 'news', origin: 'google-news', basis: null, fetchedAt: null, title: '평택 신규 라인 투자 확정', publisher: '한국경제', publishedAt: '2026-10-06T01:00:00+00:00', url: 'https://news.example/1' },
];
const CLAIMS = [
  claim('c1', '2025년 영업이익률은 13.07%이다.', 'fact', ['h'], 'objective', 'high'),
  claim('c2', '회사는 설비투자 확대를 공시에서 언급했다.', 'fact', ['doc'], 'objective', 'high'),
  claim('c3', '업로드 리포트는 HBM 수요 성장을 전망한다.', 'fact', ['pdf'], 'objective', 'medium'),
  claim('c4', '최근 평택 신규 라인 투자 확정 보도가 있다.', 'fact', ['news'], 'objective', 'low'),
  claim('c5', '시가총액과 베타가 높다.', 'fact', ['cap', 'beta'], 'objective', 'low'),
  claim('c6', '같은 공시를 다시 인용한 해석이다.', 'interpretation', ['doc', 'h'], 'judgment', 'medium'),
];
const ai = (input: ReportInput, claims = CLAIMS, evidence = EVIDENCE, over: Partial<AiAnalysisInput> = {}): AiAnalysisInput => ({
  analysisId: 'wf_s', question: 'q', workflowType: 'full-valuation-review', contextSnapshotId: input.snapshot.contextSnapshotId, createdAt: '2026-10-08T00:00:00Z', groundingLevel: 'claim-evidence', claims, evidence, sources: SOURCES, limitations: [], ...over,
});
const build = (over: Partial<AiAnalysisInput> = {}, claims = CLAIMS, evidence = EVIDENCE) => {
  const b = base();
  const input = buildReportInput(proj(), { now: NOW, aiAnalysis: ai(b, claims, evidence, over) });
  const model = buildReport(input).model!;
  const doc = buildReportDocument(model);
  return { input, model, doc, pres: buildPresentation(doc) };
};

test('출처 종류: ValuFlow Engine · OpenDART · Disclosure · Uploaded PDF · Assumption · Market Data · Peer Data · News · Learning Fixture', () => {
  const { doc } = build({}, [...CLAIMS, claim('c7', 'Peer EV/EBITDA 는 7.2배이다.', 'fact', ['peer'], 'objective', 'low')]);
  const types = new Set(doc.sources.map((s) => s.type));
  for (const t of ['ValuFlow Engine', 'OpenDART', 'Disclosure', 'Uploaded PDF', 'Market Data', 'Peer Data', 'News', 'Learning Fixture']) assert.ok(types.has(t), `${t} 가 있어야 한다: ${[...types]}`);
  // 학습용 가정은 Learning Fixture, Historical(OpenDART) 은 OpenDART
  assert.equal(doc.sources.find((s) => s.id === 'src-assumptions')!.type, 'Learning Fixture');
  assert.equal(doc.sources.find((s) => s.id === 'src-historical')!.type, 'OpenDART');
  // fixture Historical 은 Learning Fixture
  const fx = proj();
  const m = buildReport(buildReportInput({ ...fx, historicalProvenance: { source: 'fixture', persisted: false } }, { now: NOW })).model!;
  assert.equal(buildReportDocument(m).sources.find((s) => s.id === 'src-historical')!.type, 'Learning Fixture');
});

test('안정적인 번호: 같은 출처는 같은 번호이고 S1 부터 연속이며 같은 입력이면 같은 번호', () => {
  const a = build();
  const b = build();
  assert.deepEqual(a.doc.sources.map((s) => [s.id, s.marker]), b.doc.sources.map((s) => [s.id, s.marker]));
  assert.deepEqual(a.doc.sources.map((s) => s.marker), a.doc.sources.map((_, i) => `S${i + 1}`));
  // c2 와 c6 은 같은 공시를 인용 → 같은 marker
  const items = a.model.executiveSummary.narrative.status === 'ok' ? a.model.executiveSummary.narrative.data.items : [];
  const all = [a.model.executiveSummary.narrative, a.model.historicalPerformance.narrative, a.model.forecast.narrative, a.model.dcf.narrative].flatMap((s) => (s.status === 'ok' ? s.data.items : []));
  void items;
  const docSrc = a.doc.sources.find((s) => s.type === 'Disclosure')!;
  const withDoc = all.filter((i) => i.sourceIds.includes(docSrc.id));
  assert.ok(withDoc.length >= 2, '같은 공시를 두 claim 이 인용한다');
  assert.ok(withDoc.every((i) => markersOf(a.doc.footnoteIndex, i.sourceIds).includes(docSrc.marker)));
  assert.equal(new Set(a.doc.sources.map((s) => s.marker)).size, a.doc.sources.length);
  // 알 수 없는 sourceId 는 marker 를 만들지 않는다
  assert.deepEqual(markersOf(a.doc.footnoteIndex, ['src-not-registered']), []);
  assert.equal(checkCitations(a.doc, a.pres).numberingStable, true);
});

test('표 · KPI 출처: 숫자 Cell 의 sourceId 가 footnote marker 가 된다 (Revenue … [S1])', () => {
  const { pres, doc } = build();
  const rev = pres.tables['historical-core']!.rows[0]!.cells[2]!;
  assert.deepEqual([rev.sourceId, rev.markers], ['src-historical', ['S1']]);
  assert.equal(doc.sources.find((s) => s.marker === 'S1')!.id, 'src-historical');
  assert.ok(pres.kpis.every((k) => k.cell.markers.length === 1));
  assert.deepEqual(pres.kpis.find((k) => k.key === 'wacc')!.cell.markers, [doc.footnoteIndex['src-engine']]);
  assert.deepEqual(pres.tables['forecast-assumptions']!.rows[0]!.cells[0]!.markers, [doc.footnoteIndex['src-assumptions']]);
});

test('서술 출처: Grounded Claim 의 evidence source 가 footnote 가 되고 문서 위치가 Sources 에 있다', () => {
  const { doc, model } = build();
  const pdf = doc.sources.find((s) => s.type === 'Uploaded PDF')!;
  assert.deepEqual([pdf.label, pdf.document?.page, pdf.document?.documentId, pdf.reference], ['2026 Semiconductor Outlook', 18, '7', 'p.18 · documentId 7']);
  const disc = doc.sources.find((s) => s.type === 'Disclosure')!;
  assert.deepEqual([disc.document?.reportName, disc.document?.filingDate, disc.document?.receiptNo, disc.document?.section], ['사업보고서 (2025.12)', '2026-03-10', '20260310002820', 'II. 사업의 내용']);
  assert.equal(disc.reference, 'II. 사업의 내용 · 접수번호 20260310002820 · 공시일 2026-03-10 · documentId 20260310002820');
  assert.equal(disc.asOf, '2026-03-10');
  const news = doc.sources.find((s) => s.type === 'News')!;
  assert.deepEqual([news.url, news.document?.publisher, news.asOf], ['https://news.example/1', '한국경제', '2026-10-06T01:00:00+00:00']);
  // 서술 항목 → marker
  const items = [model.executiveSummary.narrative, model.historicalPerformance.narrative, model.forecast.narrative, model.dcf.narrative].flatMap((s) => (s.status === 'ok' ? s.data.items : []));
  const c2 = items.find((i) => i.claimId === 'c2')!;
  assert.deepEqual(markersOf(doc.footnoteIndex, c2.sourceIds), [disc.marker]);
});

test('외부 provider: provider · 신뢰 등급 · official · valuationGrade · asOf, Development provider 는 명확히 표시한다', () => {
  const { doc } = build();
  const mk = doc.sources.find((s) => s.type === 'Market Data')!;
  assert.deepEqual(mk.providerInfo, { name: 'Yahoo Finance', reliability: 'unofficial', tier: 'development', official: false, valuationGrade: false, development: true });
  assert.deepEqual([mk.reliability, mk.asOf], ['unofficial · development', AT]);
  assert.match(mk.notice!, /Development Source/);
  const news = doc.sources.find((s) => s.type === 'News')!;
  assert.ok(news.providerInfo?.development && news.notice);
  // 문서 · 엔진 · Historical 에는 provider 고지가 없다
  assert.ok(doc.sources.filter((s) => ['OpenDART', 'ValuFlow Engine', 'Disclosure', 'Uploaded PDF'].includes(s.type)).every((s) => s.notice === null));
  // 공식 provider 는 고지 없음
  const official = build({}, [claim('o1', 'KRX 종가는 270,000원이다.', 'fact', ['off'], 'objective', 'high')]).doc.sources.find((s) => s.provider === 'krx')!;
  assert.deepEqual([official.providerInfo?.official, official.providerInfo?.valuationGrade, official.providerInfo?.development, official.notice], [true, true, false, null]);
});

test('시장 · Peer 입력 경로: 선택한 AI 분석 evidence snapshot 으로만 들어오고 Valuation 에는 쓰이지 않는다', () => {
  const { model, doc, pres } = build({}, [...CLAIMS, claim('c7', 'Peer EV/EBITDA 는 7.2배이다.', 'fact', ['peer'], 'objective', 'low')]);
  assert.equal(model.externalReference.status, 'ok');
  const items = model.externalReference.status === 'ok' ? model.externalReference.data.items : [];
  const byKey = new Map(items.map((i) => [i.key, i]));
  assert.ok(byKey.has('getMarketData:marketCap.valueEok') && !byKey.has('getMarketData:marketCap.value'), '큰 원화 값은 억원 표시 하나만 (중복 제외)');
  const cap = byKey.get('getMarketData:marketCap.valueEok')!;
  assert.deepEqual([cap.cell.kind, cap.cell.unit, cap.cell.text, cap.cell.largeText, cap.asOf, cap.development], ['reference', 'eok', '17,631,220억원', '1,763.12조원', AT, true]);
  assert.deepEqual([byKey.get('getMarketData:price.value')!.cell.text, byKey.get('getMarketAssumptions:beta.value')!.cell.unit, byKey.get('getMarketAssumptions:riskFreeRate.rate')!.cell.text, byKey.get('getComparableCompanies:subject.multiples.evEbitda')!.cell.text], ['268,500원', 'factor', '4.29%', '7.2배']);
  assert.equal(byKey.get('getComparableCompanies:subject.multiples.evEbitda')!.group, 'peer');
  assert.match(byKey.get('getMarketData:price.value')!.providerLabel!, /Yahoo Finance \(unofficial\)/);
  assert.ok(items.every((i) => i.cell.sourceId && doc.footnoteIndex[i.cell.sourceId]));
  // 문서 section · 표 · 범례
  const sec = doc.sections.find((s) => s.sectionId === 'marketReference')!;
  assert.deepEqual([sec.title, sec.number !== null], ['Market & Peer Reference', true]);
  const t = pres.tables['market-reference']!;
  assert.ok(t.rows.every((r) => r.kind === 'reference' && r.note!.includes('as of') && r.cells[0]!.markers.length === 1));
  assert.ok(t.rows.some((r) => r.note!.includes('Development Source')));
  assert.match(t.notices[0]!, /Valuation 계산에 쓰이지 않았습니다/);
  assert.ok(model.appendix.kindLegend.some((k) => k.kind === 'reference'));
  // 같은 Project 로 AI 없이 만든 Report 와 Valuation 숫자가 같다 (참고값은 계산에 들어가지 않는다)
  const plain = buildReport(base()).model!;
  assert.deepEqual(model.executiveSummary.headline, plain.executiveSummary.headline);
  assert.equal(JSON.stringify(model.dcf.rows), JSON.stringify(plain.dcf.rows));
  assert.equal(plain.externalReference.status, 'unavailable');
  assert.equal(buildReportDocument(plain).sections.some((s) => s.sectionId === 'marketReference'), false);
  // Report 코드는 네트워크를 호출하지 않는다
  const src = readFileSync(new URL('./sections/externalReference.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/fetch\(|XMLHttpRequest|axios|http\.request/.test(src));
});

test('stale AI 분석의 시장 근거는 쓰지 않는다', () => {
  const { model } = build({ contextSnapshotId: 'ctx-old' });
  assert.equal(model.externalReference.status, 'unavailable');
  assert.match((model.externalReference as { reason: string }).reason, /다른 Project snapshot/);
});

test('미사용 출처 정책: 인용되지 않은 출처는 목록에서 빼고, 목록의 모든 출처는 한 번 이상 인용된다', () => {
  // 항목 수 제한으로 싣지 못한 claim 들의 출처는 목록에 남지 않는다
  const many = [
    ...Array.from({ length: 8 }, (_, i) => claim(`m${i}`, `역사적 사실 ${i}.`, 'fact', ['h'], 'objective', 'high')),
    claim('late', '맨 뒤의 낮은 신뢰 뉴스 claim.', 'fact', ['news'], 'objective', 'low'),
  ];
  const { doc, pres, model } = build({}, many);
  const omitted = model.appendix.narrativeOmitted;
  assert.ok(omitted > 0);
  const c = checkCitations(doc, pres);
  assert.deepEqual(c.unusedSources, [], '목록의 모든 출처는 인용된다');
  assert.deepEqual(c.orphanMarkers, []);
  assert.deepEqual(c.unknownSourceIds, []);
  assert.ok(c.referenced >= doc.sources.length);
  // 반대로 채택된 claim 의 출처는 목록에 있다
  const full = build();
  assert.equal(checkCitations(full.doc, full.pres).unusedSources.length, 0);
});

test('citation 검증기: 등록되지 않은 출처 · orphan marker 를 잡아낸다', () => {
  const { doc, pres } = build();
  const broken = structuredClone(doc);
  const removed = broken.sources.pop()!;
  const r = checkCitations(broken, pres);
  assert.ok(r.orphanMarkers.includes(removed.marker) || r.unknownSourceIds.includes(removed.id));
  const tampered = structuredClone(pres);
  tampered.tables['historical-core']!.rows[0]!.cells[0]!.markers = ['S99'];
  assert.deepEqual(checkCitations(doc, tampered).orphanMarkers, ['S99']);
});
