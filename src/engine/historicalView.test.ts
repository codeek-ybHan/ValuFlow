import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { samsungHistoricalData as h } from '../data/samsungHistorical.ts';
import { buildHistoricalView } from './historicalView.ts';

const close = (x: number, y: number, e = 1e-9) => assert.ok(Math.abs(x - y) < e, `${x} !≈ ${y}`);
const view = buildHistoricalView(h)!;
const row = (rows: { key: string }[], key: string) => rows.find((r) => r.key === key) as ReturnType<typeof get>;
const get = () => view.metrics[0];

test('Empty State: historicalData 가 없으면 view 가 없다', () => {
  assert.equal(buildHistoricalView(null), null);
});

test('Samsung 데이터: 3개년이 모두 표시된다', () => {
  assert.equal(view.header.periods.length, 3);
  for (const r of [...view.keyFinancials, ...view.metrics]) assert.equal(r.values.length, 3, r.key);
  assert.deepEqual(view.keyFinancials.map((r) => r.key), ['revenue', 'operatingProfit', 'netIncome', 'cfo', 'capex']);
  assert.deepEqual(view.keyFinancials[0].values, [258935494, 300870903, 333605938]);
});

test('Header: 회사 / Basis / 통화 / 단위 / 기간', () => {
  assert.equal(view.header.name, '삼성전자');
  assert.equal(view.header.basis, 'Consolidated');
  assert.equal(view.header.unitLabel, 'KRW million');
  assert.equal(view.header.periodRange, '2023A – 2025A');
});

test('Actual(A) 라벨: 모든 기간이 A 로 끝난다 (Forecast 는 E 로 구분 예정)', () => {
  for (const p of view.header.periods) assert.match(p, /^\d{4}A$/);
  assert.deepEqual(view.chart.labels, ['2023A', '2024A', '2025A']);
});

test('Revenue Growth = 당기 / 전기 − 1 (첫 해는 계산 불가 null)', () => {
  const g = row(view.metrics, 'revenueGrowth').values;
  assert.equal(g[0], null);
  close(g[1]!, 300870903 / 258935494 - 1);
  close(g[2]!, 333605938 / 300870903 - 1);
  assert.equal((g[1]! * 100).toFixed(1), '16.2');
  assert.equal((g[2]! * 100).toFixed(1), '10.9');
});

test('Operating Margin = Operating Profit / Revenue', () => {
  const m = row(view.metrics, 'operatingMargin').values;
  assert.deepEqual(m.map((v) => (v! * 100).toFixed(1)), ['2.5', '10.9', '13.1']);
});

test('NWC = AR + Inventory − AP, ΔNWC = 당기 NWC − 전기 NWC', () => {
  assert.deepEqual(row(view.metrics, 'nwc').values, [76953443, 83007761, 90725090]);
  assert.deepEqual(row(view.metrics, 'deltaNwc').values, [null, 6054318, 7717329]);
});

test('CFO − CAPEX 는 참고지표이며 FCFF 로 표시하지 않는다', () => {
  const r = row(view.metrics, 'cfoMinusCapex') as { label: string; values: number[]; note: string };
  assert.deepEqual(r.values, [-13473865, 21576266, 37792969]);
  assert.match(r.label, /Reference/);
  assert.notEqual(r.label.trim(), 'FCFF');
  assert.match(r.note, /FCFF 가 아닙니다/);
});

test('CAPEX 는 PPE acquisition 기준임을 표시한다', () => {
  const capex = row(view.keyFinancials, 'capex') as { label: string; values: number[]; note: string };
  assert.match(capex.label, /PPE acquisition basis/);
  assert.deepEqual(capex.values, [57611292, 51406355, 47522179]);
  assert.match(capex.note, /실무 조정치가 아닙니다/);
});

test('Trend Summary: 규칙 기반 요약', () => {
  const t = Object.fromEntries(view.trends.map((x) => [x.key, x]));
  assert.deepEqual(t.revenueGrowth.lines, ['2024A: +16.2%', '2025A: +10.9%']);
  assert.match(t.revenueGrowth.verdict, /성장률 둔화/);
  assert.deepEqual(t.operatingMargin.lines, ['2023A: 2.5%', '2024A: 10.9%', '2025A: 13.1%']);
  assert.match(t.operatingMargin.verdict, /^개선/);
  assert.match(t.nwc.verdict, /2023A → 2025A 증가/);
  assert.match(t.cashGeneration.verdict, /^개선/);
  assert.match(t.cashGeneration.lines[0], /CFO\/CAPEX 0\.77x/);
});

test('Chart 데이터: 조원 환산은 차트 필드에만 적용되고 원본은 그대로다', () => {
  close(view.chart.revenueTrillion[2], 333.605938);
  close(view.chart.operatingProfitTrillion[2], 43.601051);
  assert.equal(view.chart.operatingMarginPct[0]!.toFixed(1), '2.5');
  assert.equal(view.chart.revenueGrowthPct[0], null);
  assert.equal(h.incomeStatement.revenue[2], 333605938);
});

test('원본 historicalData 를 변경하지 않는다', () => {
  const snapshot = JSON.stringify(h);
  buildHistoricalView(h);
  assert.equal(JSON.stringify(h), snapshot);
});

test('1개년 데이터도 오류 없이 처리한다 (비교 불가 메시지)', () => {
  const one = { ...h, company: { ...h.company, period: ['2025A'] },
    incomeStatement: { revenue: [100], cogs: [60], grossProfit: [40], sga: [20], operatingProfit: [20], netIncome: [15] },
    balanceSheet: { accountsReceivable: [10], inventory: [10], accountsPayable: [5], totalAssets: [200], totalLiabilities: [80], totalEquity: [120] },
    cashFlow: { cfo: [25], ppeAcquisition: [10], intangibleAcquisition: [1] } };
  const v = buildHistoricalView(one)!;
  assert.equal(v.metrics[0].values[0], null);
  assert.match(v.trends[0].verdict, /2개 이상/);
  assert.match(v.trends[1].verdict, /부족/);
});

test('Forecast / Result 데이터가 섞이지 않는다: view 의 입력은 historicalData 하나뿐이다', () => {
  assert.equal(buildHistoricalView.length, 1);
  const src = readFileSync(new URL('../components/valuation/HistoricalStage.tsx', import.meta.url), 'utf8');
  for (const forbidden of ['valuationAssumptions', 'valuationResult', 'sensitivityResult', 'runValuation', 'runSensitivity']) {
    assert.ok(!src.includes(forbidden), `HistoricalStage 가 ${forbidden} 를 사용한다`);
  }
  const viewSrc = readFileSync(new URL('./historicalView.ts', import.meta.url), 'utf8');
  for (const forbidden of ['valuationAssumptions', 'valuationResult', "from '../valuation", 'step04Practice']) {
    assert.ok(!viewSrc.includes(forbidden), `historicalView 가 ${forbidden} 를 사용한다`);
  }
});

test('Empty State / CTA 문구가 화면 코드에 있다', () => {
  const src = readFileSync(new URL('../components/valuation/HistoricalStage.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('No historical data loaded'));
  assert.ok(src.includes('삼성전자 학습용 Historical 불러오기'));
  assert.ok(src.includes('Continue to Forecast'));
  assert.ok(src.includes('Use historical trends to build forecast assumptions'));
});
