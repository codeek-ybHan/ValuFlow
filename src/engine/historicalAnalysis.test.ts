// STEP 06-5: Historical Analysis Engine — 지표 · 추세 · 품질 상속 · Forecast 참고 모델.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { samsungHistoricalData as sam } from '../data/samsungHistorical.ts';
import type { HistoricalData } from '../data/types.ts';
import { normalizeFinancials } from '../data/normalization/normalizeFinancials.ts';
import type { DataQuality, FieldQuality, FieldStatus } from '../data/normalization/quality.ts';
import type { CanonicalField } from '../data/normalization/accounts.ts';
import type { DartFinancialsResponse, DartRawAccount } from '../data/dart/types.ts';
import { DartFinancialRepository } from '../data/repository/dartRepository.ts';
import { BackendDartClient } from '../data/dart/client.ts';
import { cagr } from './analysis.ts';
import { TREND_THRESHOLDS, UNSUPPORTED_MESSAGE, analyzeHistorical, analyzeNormalized, analyzeRepositoryResult, type HistoricalAnalysis } from './historicalAnalysis.ts';
import { deriveHistoricalMetrics } from './historical.ts';
import { buildHistoricalView } from './historicalView.ts';
import { buildForecastReference } from './forecastForm.ts';

const load = (n: string) => JSON.parse(readFileSync(new URL(`../data/fixtures/${n}DartFinancials.json`, import.meta.url), 'utf8')) as DartFinancialsResponse;
const YEARS = [2023, 2024, 2025];
const normalize = (accounts: DartRawAccount[]) => normalizeFinancials({ company: { name: 't', corpCode: '00000001' }, accounts, fiscalYears: YEARS, fetchedAt: 'x' });
const real = (n: string) => { const r = normalize(load(n).accounts); assert.ok(r.ok); return r; };
const close = (x: number | null, y: number, e = 1e-9) => assert.ok(x !== null && Math.abs(x - y) < e, `${x} !≈ ${y}`);
const clone = <T,>(v: T): T => structuredClone(v);

/** 기간 수만큼 값을 가진 최소 HistoricalData (필요한 계열만 덮어쓴다) */
function data(over: { revenue?: number[]; operatingProfit?: number[]; cfo?: number[]; ppe?: number[]; ar?: number[]; inv?: number[]; ap?: number[] } = {}, periods = ['2023A', '2024A', '2025A']): HistoricalData {
  const n = periods.length;
  const z = (v = 100) => Array.from({ length: n }, () => v);
  return {
    company: { name: 't', ticker: '1', basis: 'Consolidated', currency: 'KRW', unit: 'million', period: periods },
    incomeStatement: { revenue: over.revenue ?? z(), cogs: z(60), grossProfit: z(40), sga: z(20), operatingProfit: over.operatingProfit ?? z(20), netIncome: z(10) },
    balanceSheet: { accountsReceivable: over.ar ?? z(10), inventory: over.inv ?? z(10), accountsPayable: over.ap ?? z(5), totalAssets: z(300), totalLiabilities: z(100), totalEquity: z(200) },
    cashFlow: { cfo: over.cfo ?? z(30), ppeAcquisition: over.ppe ?? z(10), intangibleAcquisition: z(2) },
  };
}
function quality(over: Partial<Record<CanonicalField, FieldStatus>> = {}, warnings: string[] = []): DataQuality {
  const fields: Partial<Record<CanonicalField, FieldQuality>> = {};
  for (const f of ['revenue', 'grossProfit', 'operatingProfit', 'netIncome', 'accountsReceivable', 'inventory', 'accountsPayable', 'cfo', 'ppeAcquisition', 'intangibleAcquisition', 'cash', 'interestBearingDebt', 'depreciationAmortization'] as CanonicalField[]) {
    fields[f] = { status: over[f] ?? 'available', missingYears: [], sources: [] };
  }
  for (const [f, s] of Object.entries(over)) fields[f as CanonicalField] = { status: s, missingYears: [], sources: [] };
  return { basisRequested: 'Consolidated', basisUsed: 'Consolidated', basisFallback: false, fields, warnings, trace: [], checks: [] };
}
function noNaN(a: HistoricalAnalysis): void {
  const walk = (o: unknown, path: string): void => {
    if (typeof o === 'number') assert.ok(Number.isFinite(o), `${path} = ${o}`);
    else if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (k !== 'dataQuality') walk(v, `${path}.${k}`);
  };
  walk(a, 'analysis');
}

// 1~8. 지표 계산
test('Revenue YoY / CAGR (Samsung fixture)', () => {
  const a = analyzeHistorical(sam);
  assert.equal(a.metrics.revenueGrowth.values[0], null);
  close(a.metrics.revenueGrowth.values[1], 300870903 / 258935494 - 1);
  close(a.metrics.revenueGrowth.values[2], 333605938 / 300870903 - 1);
  close(a.revenueCagr, Math.pow(333605938 / 258935494, 1 / 2) - 1);
  close(cagr(100, 121, 2), 0.1);
  assert.equal(analyzeHistorical(data({}, ['2025A'])).revenueCagr, null, '기간이 1개면 CAGR 없음');
  assert.equal(analyzeHistorical(data({ revenue: [-5, 10, 20] })).revenueCagr, null, '시작값이 0 이하면 CAGR 없음');
});
test('Operating / Net / Gross margin', () => {
  const a = analyzeHistorical(sam);
  close(a.metrics.operatingMargin.values[0], 6566976 / 258935494);
  close(a.metrics.operatingMargin.values[2], 43601051 / 333605938);
  close(a.metrics.netMargin.values[1], 34451351 / 300870903);
  close(a.metrics.grossMargin.values[2], 131370425 / 333605938);
  assert.equal(analyzeHistorical(data({ revenue: [0, 100, 100] })).metrics.operatingMargin.values[0], null, '매출 0 이면 계산하지 않는다');
});
test('NWC / ΔNWC / NWC÷Revenue', () => {
  const a = analyzeHistorical(sam);
  assert.deepEqual(a.metrics.nwc.values, [76953443, 83007761, 90725090]);
  assert.deepEqual(a.metrics.deltaNwc.values, [null, 6054318, 7717329]);
  close(a.metrics.nwcToRevenue.values[2], 90725090 / 333605938);
});
test('CFO, CAPEX(기준 메타데이터), CFO − CAPEX 는 FCFF 가 아니다', () => {
  const a = analyzeHistorical(sam);
  assert.deepEqual(a.metrics.cfoMinusCapex.values, [-13473865, 21576266, 37792969]);
  assert.equal(a.capexBasis, 'ppe');
  assert.match(a.capexBasisLabel, /PPE only/);
  assert.match(a.metrics.capex.basis!, /PPE only/);
  assert.match(a.metrics.cfoMinusCapex.basis!, /FCFF 가 아닙니다/);
  assert.ok(!JSON.stringify(a).toLowerCase().includes('fcff":'), 'FCFF 라는 이름의 지표는 없다');
  const both = analyzeHistorical(sam, null, 'ppe+intangible');
  assert.deepEqual(both.metrics.capex.values, [60534167, 53741639, 52153149]);
  assert.match(both.metrics.capex.basis!, /PPE \+ Intangible/);
  close(a.metrics.cfoToCapex.values[2], 85315148 / 47522179);
});

// 9. D&A
test('D&A 가 missing 이면 값 · 추세를 만들지 않고 "unavailable" 로 전달한다', () => {
  const a = analyzeHistorical(sam, quality({ depreciationAmortization: 'missing' }));
  assert.deepEqual(a.metrics.depreciation.values, [null, null, null]);
  assert.equal(a.metrics.depreciation.quality.status, 'missing');
  assert.equal(a.trends.depreciation.direction, 'unavailable');
  assert.equal(a.forecastReference.depreciationHistory, undefined);
  assert.ok(a.forecastReference.unavailable.includes('Historical D&A unavailable'));
  // 데이터가 있으면 그대로 (추정 없음)
  const withDa = analyzeHistorical({ ...sam, cashFlow: { ...sam.cashFlow, depreciationAmortization: [30, 33, 36] } });
  assert.deepEqual(withDa.metrics.depreciation.values, [30, 33, 36]);
  assert.deepEqual(withDa.forecastReference.depreciationHistory?.values, [30, 33, 36]);
  assert.ok(!withDa.forecastReference.unavailable.includes('Historical D&A unavailable'));
  assert.notEqual(withDa.trends.depreciation.direction, 'unavailable');
  // 학습용 값 / CAPEX 비율로 채우지 않는다
  assert.ok(!analyzeHistorical(sam).metrics.depreciation.values.some((v) => v !== null));
});

// 10. Net debt
test('Net Debt 는 리스부채를 포함하지 않고 basis 를 밝힌다', () => {
  const h = data();
  h.balanceSheet.cash = [50, 60, 70];
  h.balanceSheet.interestBearingDebt = [100, 90, 80];
  h.balanceSheet.leaseLiabilities = [7, 7, 7];
  const a = analyzeHistorical(h);
  assert.deepEqual(a.metrics.netDebtExLease.values, [50, 30, 10]);
  assert.equal(a.metrics.netDebtExLease.label, 'Net Debt (excluding lease liabilities)');
  assert.equal(a.metrics.netDebtExLease.basis, 'Net Debt (excluding lease liabilities)');
  assert.deepEqual(a.metrics.leaseLiabilities.values, [7, 7, 7], '리스부채는 따로 보여 준다');
  assert.deepEqual(a.metrics.cash.values, [50, 60, 70]);
  // 입력이 없으면 만들지 않는다
  const none = analyzeHistorical(sam);
  assert.equal(none.metrics.netDebtExLease.quality.status, 'missing');
  assert.deepEqual(none.metrics.netDebtExLease.values, [null, null, null]);
});

// 11. Trend
test('Trend: growth accelerating / decelerating / stable / insufficient-data', () => {
  const t = (revenue: number[]) => analyzeHistorical(data({ revenue })).trends.revenueGrowth;
  assert.equal(t([100, 110, 130]).direction, 'accelerating'); // +10% → +18.2%
  assert.equal(t([100, 120, 130]).direction, 'decelerating'); // +20% → +8.3%
  assert.equal(t([100, 110, 121]).direction, 'stable');       // +10% → +10%
  assert.equal(t([100, 110]).direction, 'insufficient-data'); // 성장률 구간 1개
  assert.equal(analyzeHistorical(sam).trends.revenueGrowth.direction, 'decelerating');
  // 경계: 0.5%p 미만이면 stable
  assert.equal(TREND_THRESHOLDS.growthChange, 0.005);
  assert.equal(t([1000, 1100, 1209]).direction, 'stable');   // +10% → +9.9%
});
test('Trend: margin / NWC / cash generation', () => {
  const m = (operatingProfit: number[]) => analyzeHistorical(data({ operatingProfit })).trends.operatingMargin;
  assert.equal(m([10, 15, 20]).direction, 'improving');
  assert.equal(m([20, 15, 10]).direction, 'deteriorating');
  assert.equal(m([20, 20.3, 20.4]).direction, 'stable'); // 0.4%p < 0.5%p
  close(m([10, 15, 20]).change!, 10);
  assert.equal(analyzeHistorical(data({}, ['2025A'])).trends.operatingMargin.direction, 'insufficient-data');
  const nwc = (ar: number[]) => analyzeHistorical(data({ ar })).trends.nwc;
  assert.equal(nwc([10, 12, 20]).direction, 'increasing');
  assert.equal(nwc([20, 12, 10]).direction, 'decreasing');
  assert.equal(nwc([10, 10.1, 10.2]).direction, 'stable');
  const cash = (cfo: number[]) => analyzeHistorical(data({ cfo })).trends.cashGeneration;
  assert.equal(cash([10, 20, 40]).direction, 'improving');
  assert.equal(cash([40, 20, 10]).direction, 'deteriorating');
  assert.equal(cash([30, 30, 30.5]).direction, 'stable');
  assert.deepEqual([TREND_THRESHOLDS.marginChangePp, TREND_THRESHOLDS.nwcChange, TREND_THRESHOLDS.cashGenerationChange], [0.5, 0.03, 0.05]);
  const src = readFileSync(new URL('./historicalAnalysis.ts', import.meta.url), 'utf8');
  assert.match(src, /heuristic/); // 기준이 회계 기준이 아님을 명시
});

// 12~14. 품질 전파
test('Quality propagation: 입력 품질을 상속한다 (available → available)', () => {
  const a = analyzeHistorical(sam, quality());
  for (const k of ['revenueGrowth', 'operatingMargin', 'netMargin', 'nwc', 'cfoMinusCapex'] as const) assert.equal(a.metrics[k].quality.status, 'available', k);
  assert.deepEqual(a.metrics.operatingMargin.quality.inputs.map((i) => i.field), ['revenue', 'operatingProfit']);
  assert.deepEqual(a.metrics.nwc.quality.inputs.map((i) => i.field), ['accountsReceivable', 'inventory', 'accountsPayable']);
  // 품질 정보가 없는 fixture 는 데이터 존재 여부로 판단한다
  assert.equal(analyzeHistorical(sam).metrics.nwc.quality.status, 'available');
});
test('Missing propagation: 입력이 하나라도 missing 이면 파생지표는 missing 이고 값은 null', () => {
  const a = analyzeHistorical(sam, quality({ inventory: 'missing' }));
  for (const k of ['nwc', 'deltaNwc', 'nwcToRevenue'] as const) {
    assert.equal(a.metrics[k].quality.status, 'missing', k);
    assert.ok(a.metrics[k].values.every((v) => v === null), `${k} 값은 0 이 아니라 null`);
  }
  assert.equal(a.trends.nwc.direction, 'insufficient-data');
  assert.equal(a.trends.nwc.quality, 'missing');
  assert.equal(a.metrics.operatingMargin.quality.status, 'available', '무관한 지표는 영향받지 않는다');
  const noRev = analyzeHistorical(sam, quality({ revenue: 'missing' }));
  for (const k of ['revenueGrowth', 'operatingMargin', 'netMargin', 'grossMargin', 'nwcToRevenue'] as const) assert.equal(noRev.metrics[k].quality.status, 'missing', k);
  // partial 도 전파
  assert.equal(analyzeHistorical(sam, quality({ cfo: 'partial' })).metrics.cfoMinusCapex.quality.status, 'partial');
});
test('Ambiguous propagation: AP 가 ambiguous 면 NWC 계열이 ambiguous 이고 사유(notes)를 함께 전달한다', () => {
  const warn = 'Accounts Payable mapped from broader trade and other payables account.';
  const a = analyzeHistorical(sam, quality({ accountsPayable: 'ambiguous' }, [warn, 'D&A not available from current OpenDART financial statement source.']));
  for (const k of ['nwc', 'deltaNwc', 'nwcToRevenue'] as const) {
    assert.equal(a.metrics[k].quality.status, 'ambiguous', k);
    assert.deepEqual(a.metrics[k].quality.notes, [warn]);
  }
  assert.equal(a.metrics.operatingMargin.quality.status, 'available');
  assert.deepEqual(a.metrics.operatingMargin.quality.notes, []);
  assert.equal(a.trends.nwc.quality, 'ambiguous');
  // missing 이 ambiguous 보다 우선
  assert.equal(analyzeHistorical(sam, quality({ accountsPayable: 'ambiguous', inventory: 'missing' })).metrics.nwc.quality.status, 'missing');
  // 실제 정규화 경로: weak AP 매핑 → NWC ambiguous
  const accounts = clone(load('hynix').accounts).map((x) => (x.accountName === '매입채무' ? { ...x, accountName: '매입채무및기타채무', accountId: 'ifrs-full_TradeAndOtherCurrentPayables' } : x));
  const r = normalize(accounts);
  assert.ok(r.ok);
  const an = analyzeHistorical(r.data, r.quality);
  assert.equal(an.metrics.nwc.quality.status, 'ambiguous');
  assert.ok(an.metrics.nwc.quality.notes.some((n) => n.includes('broader trade and other payables')));
  // 화면 모델에도 전달된다
  const view = buildHistoricalView(r.data, r.quality)!;
  assert.match(view.metrics.find((x) => x.key === 'nwc')!.note!, /broader trade and other payables/);
});

// 15. Samsung 실제
test('삼성전자 실제 OpenDART 데이터: 기존 학습 결과와 일치', () => {
  const r = real('samsung');
  const a = analyzeHistorical(r.data, r.quality);
  assert.equal((a.metrics.revenueGrowth.values[1]! * 100).toFixed(1), '16.2');
  assert.equal((a.metrics.revenueGrowth.values[2]! * 100).toFixed(1), '10.9');
  assert.deepEqual(a.metrics.operatingMargin.values.map((v) => (v! * 100).toFixed(1)), ['2.5', '10.9', '13.1']);
  assert.deepEqual(a.metrics.nwc.values, [76953443, 83007761, 90725090]);
  assert.deepEqual(a.metrics.deltaNwc.values, [null, 6054318, 7717329]);
  assert.deepEqual(a.metrics.cfo.values, sam.cashFlow.cfo);
  assert.deepEqual(a.metrics.capex.values, sam.cashFlow.ppeAcquisition);
  assert.deepEqual(a.metrics.cfoMinusCapex.values, [-13473865, 21576266, 37792969]);
  assert.deepEqual(a.metrics.interestBearingDebt.values, [12685944, 19330184, 25239139]); // 단기차입금 + 유동성장기부채 + 사채 + 장기차입금
  assert.deepEqual(a.metrics.netDebtExLease.values, [12685944 - 69080893, 19330184 - 53705579, 25239139 - 57856378]);
  assert.equal(a.metrics.leaseLiabilities.quality.status, 'missing'); // 삼성전자 재무제표에는 리스부채 행이 없다
  assert.equal(a.metrics.netDebtExLease.quality.status, 'available');
  assert.equal(a.metrics.depreciation.quality.status, 'missing');
  assert.equal(a.trends.depreciation.direction, 'unavailable');
  for (const k of ['revenueGrowth', 'operatingMargin', 'nwc', 'cfoMinusCapex'] as const) assert.equal(a.metrics[k].quality.status, 'available', k);
  assert.deepEqual([a.trends.revenueGrowth.direction, a.trends.operatingMargin.direction, a.trends.nwc.direction, a.trends.cashGeneration.direction], ['decelerating', 'improving', 'increasing', 'improving']);
  noNaN(a);
});

// 16·17. 다른 기업
test('현대자동차: 지표 · 품질 · 추세 생성, NaN / Infinity 없음', () => {
  const r = real('hyundai');
  const a = analyzeHistorical(r.data, r.quality);
  close(a.metrics.revenueGrowth.values[1], 175231153 / 162663579 - 1);
  close(a.metrics.operatingMargin.values[2], 11467851 / 186254472);
  close(a.metrics.netMargin.values[2], 10364775 / 186254472);
  assert.equal(a.metrics.nwc.quality.status, 'available');
  assert.ok(a.metrics.leaseLiabilities.values.every((v) => v !== null && v > 0));
  assert.ok(a.warnings.some((w) => w.includes('financial-business')), '금융 부문 혼재 경고가 전달된다');
  assert.equal(a.trends.revenueGrowth.direction, 'decelerating');
  assert.equal(a.trends.operatingMargin.direction, 'deteriorating');
  assert.equal(a.metrics.depreciation.quality.status, 'missing');
  noNaN(a);
});
test('SK하이닉스: 지표 · 품질 · 추세 생성, NaN / Infinity 없음', () => {
  const r = real('hynix');
  const a = analyzeHistorical(r.data, r.quality);
  close(a.metrics.revenueGrowth.values[1], 66192960 / 32765719 - 1);
  close(a.metrics.operatingMargin.values[0], r.data.incomeStatement.operatingProfit[0] / 32765719);
  assert.ok(a.metrics.operatingMargin.values[0]! < 0, '2023 영업적자: 음수 마진도 그대로 계산한다');
  assert.equal(a.trends.revenueGrowth.direction, 'decelerating');
  assert.equal(a.trends.operatingMargin.direction, 'improving');
  assert.equal(a.metrics.netDebtExLease.quality.status, 'available');
  assert.equal(a.metrics.nwc.quality.status, 'available');
  noNaN(a);
  assert.ok(a.metrics.cfoToCapex.values.every((v) => v !== null && v > 0));
});

// 18. unsupported
test('NAVER / KB금융: unsupported 는 분석하지 않고 사유를 전달한다', () => {
  for (const [name, code] of [['naver', 'unsupported-structure'], ['kb', 'unsupported-industry']] as const) {
    const out = analyzeNormalized(normalize(load(name).accounts));
    assert.equal(out.status, 'unsupported', name);
    if (out.status === 'unsupported') {
      assert.equal(out.code, code);
      assert.equal(out.message, UNSUPPORTED_MESSAGE);
      assert.equal(out.message, 'This company is not supported by the current generic analysis model.');
      assert.ok(out.reason.length > 0);
      assert.ok(!('analysis' in out), '억지 빈 지표를 만들지 않는다');
    }
  }
  // 정상 / 불완전
  assert.equal(analyzeNormalized(real('hynix')).status, 'ok');
  const missing = analyzeNormalized(normalize(load('hynix').accounts.filter((a) => a.accountName !== '재고자산')));
  assert.equal(missing.status, 'incomplete');
  // repository 경로: unsupported / 조회 실패 도 그대로
  const repo = (body: unknown, ok = true, status = 200) => new DartFinancialRepository(new BackendDartClient({ fetch: async () => ({ ok, status, json: async () => body }) }));
  return repo(load('kb')).getHistoricalFinancials({ corpCode: '00688996', fiscalYears: YEARS }).then(async (res) => {
    const out = analyzeRepositoryResult(res);
    assert.equal(out.status, 'unsupported');
    if (out.status === 'unsupported') assert.equal(out.code, 'unsupported-industry');
    const ok = analyzeRepositoryResult(await repo(load('hyundai')).getHistoricalFinancials({ corpCode: '00164742', fiscalYears: YEARS }));
    assert.equal(ok.status, 'ok');
    const down = analyzeRepositoryResult(await repo({ error: { code: 'dart-unavailable', message: 'x' } }, false, 503).getHistoricalFinancials({ corpCode: '00164742' }));
    assert.equal(down.status, 'unavailable');
  });
});

// 7(스펙). Forecast Reference
test('ForecastReferenceModel: 과거 참고값만 담고 Forecast 값은 만들지 않는다', () => {
  const a = analyzeHistorical(sam, quality({ depreciationAmortization: 'missing' }));
  const fr = a.forecastReference;
  assert.deepEqual(fr.periods, ['2023A', '2024A', '2025A']);
  assert.deepEqual(fr.revenueGrowthHistory.values, a.metrics.revenueGrowth.values);
  assert.deepEqual(fr.operatingMarginHistory.values, a.metrics.operatingMargin.values);
  assert.deepEqual(fr.capexHistory.values, sam.cashFlow.ppeAcquisition);
  assert.match(fr.capexHistory.basis!, /PPE only/);
  assert.deepEqual(fr.deltaNwcHistory.values, [null, 6054318, 7717329]);
  assert.equal(fr.taxRateHistory, undefined);
  assert.ok(fr.unavailable.includes('Historical tax rate unavailable'));
  assert.deepEqual(fr.latestRevenue, { period: '2025A', value: 333605938 });
  // 평균 · 추정 · 제안 필드가 없다
  assert.ok(!/average|suggest|recommend|forecastValue|projected/i.test(Object.keys(fr).join(',')));
  // Forecast 화면용 참고(억원)가 이 모델에서 만들어진다. 입력칸은 채우지 않는다
  const ref = buildForecastReference(sam, quality({ depreciationAmortization: 'missing' }))!;
  assert.deepEqual(ref.rows.find((x) => x.key === 'capex')!.values, [576112.92, 514063.55, 475221.79]);
  assert.ok(ref.rows.find((x) => x.key === 'depreciation')!.values.every((v) => v === null));
  assert.equal(ref.latestRevenueEok, 3336059.38);
});

// 19. 기존 Historical View 호환 / 중복 계산 제거
test('기존 Historical View 와 호환되고 지표 계산식은 한 곳(historicalAnalysis)에만 있다', () => {
  const a = analyzeHistorical(sam);
  const m = deriveHistoricalMetrics(sam);
  assert.deepEqual(m.nwc, a.metrics.nwc.values);
  assert.deepEqual(m.revenueGrowth, a.metrics.revenueGrowth.values);
  assert.deepEqual(m.cfoMinusCapex, a.metrics.cfoMinusCapex.values);
  const view = buildHistoricalView(sam)!;
  const row = (k: string) => view.metrics.find((x) => x.key === k)!;
  assert.deepEqual(row('nwc').values, [76953443, 83007761, 90725090]);
  assert.deepEqual(row('deltaNwc').values, [null, 6054318, 7717329]);
  assert.deepEqual(row('cfoMinusCapex').values, [-13473865, 21576266, 37792969]);
  assert.deepEqual(row('netMargin').values, a.metrics.netMargin.values);
  assert.match(view.trends[0].verdict, /성장률 둔화/);
  assert.match(view.trends[1].verdict, /^개선/);
  assert.match(view.trends[2].verdict, /2023A → 2025A 증가/);
  assert.match(view.trends[3].verdict, /^개선/);
  // 중복 계산 없음: 어댑터 / 화면 모델 / Forecast 참고는 계산식을 갖지 않고 엔진을 호출한다
  const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/from '\.\/analysis\.ts'|nwc\s*=|ar\.map|growth\(/.test(src('./historical.ts')), 'historical.ts 에 계산식 없음');
  assert.ok(src('./historical.ts').includes('analyzeHistorical'));
  for (const f of ['./historicalView.ts', './forecastForm.ts']) {
    assert.ok(src(f).includes('analyzeHistorical'), f);
    assert.ok(!/deriveHistoricalMetrics/.test(src(f)), `${f} 는 파생지표를 다시 계산하지 않는다`);
  }
  assert.ok(!/ar\[i\]|inv\[i\]|revenue\[i - 1\]/.test(src('./historicalView.ts')));
  const ws = readFileSync(new URL('../pages/Workspace.tsx', import.meta.url), 'utf8');
  assert.ok(ws.includes('analyzeHistorical') && !ws.includes('deriveHistoricalMetrics'));
});

// 20. 불변
test('분석은 원본 HistoricalData / DataQuality 를 변경하지 않고, 결과를 바꿔도 원본에 영향이 없다', () => {
  const r = real('hyundai');
  const freeze = (o: unknown): void => { if (typeof o === 'object' && o !== null) { Object.values(o).forEach(freeze); Object.freeze(o); } };
  const h = clone(r.data), q = clone(r.quality);
  freeze(h); freeze(q);
  const snap = JSON.stringify([h, q]);
  assert.doesNotThrow(() => analyzeHistorical(h, q));
  assert.doesNotThrow(() => buildHistoricalView(h, q));
  assert.doesNotThrow(() => buildForecastReference(h, q));
  assert.equal(JSON.stringify([h, q]), snap);
  const a = analyzeHistorical(clone(r.data), clone(r.quality));
  const before = JSON.stringify(r.data);
  a.metrics.cfo.values[0] = -1;
  a.metrics.capex.values[0] = -1;
  assert.equal(JSON.stringify(r.data), before);
});
