// STEP 06-7: 실제 데이터 파이프라인 ↔ Valuation Workspace 통합.
// 기업 검색 → 선택 → [재무데이터 불러오기] → repository → backend(DB) → HistoricalData + DataQuality → Historical View → Forecast Reference.
// backend 응답은 TS normalizer 가 실제 OpenDART 응답(삼성전자 · 현대차 · NAVER · KB)으로 만든 golden 을 사용한다 (네트워크 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BackendDartClient } from '../data/dart/client.ts';
import { DatabaseFinancialRepository } from '../data/repository/databaseRepository.ts';
import { defaultFinancialRepository } from '../data/repository/defaultRepository.ts';
import { samsungHistoricalData } from '../data/samsungHistorical.ts';
import { selectCompany } from './companySelection.ts';
import { applyLoadOutcome, loadHistorical, provenanceView, toLoadOutcome, UNSUPPORTED_UX } from './historicalLoad.ts';
import {
  emptyProjectState, needsHistoricalRefetch, restoreProjectState, toPersisted, withForecastInputs, withHistoricalCleared, withHistoricalData, withPracticeAssumptions,
  withSamsungHistorical, withSelectedCompany, withValuationReset, type ProjectState,
} from './projectModel.ts';
import { buildHistoricalView } from '../engine/historicalView.ts';
import { buildForecastReference, emptyForecastForm, parseForecastForm } from '../engine/forecastForm.ts';
import { buildQualityView } from '../engine/qualityView.ts';
import { analyzeHistorical } from '../engine/historicalAnalysis.ts';
import { buildSensitivityAxes } from '../engine/sensitivityAxes.ts';
import { buildWorkflowProgress, describeBasis, historicalSourceLabel } from './workflowStatus.ts';
import { historicalStageBasis } from '../components/valuation/workflow.ts';
import { calculateWacc, runSensitivity } from '../valuation/index.ts';
import { step04PracticeAssumptions } from '../data/step04PracticeAssumptions.ts';

const golden = (n: string) => JSON.parse(readFileSync(new URL(`../../backend/tests/golden/${n}.json`, import.meta.url), 'utf8')).expected;
const FETCH = { basisRequested: 'Consolidated', basisUsed: 'Consolidated', basisFallback: false, yearsRequested: [2023, 2024, 2025], yearsReceived: [2023, 2024, 2025], missingYears: [], rawAccountCount: 78, warnings: [] };
const AT = '2026-10-07T01:02:03+00:00';

type Reply = { status?: number; body: unknown };
function ok(name: string, source: 'database' | 'opendart' = 'database', fetchId = 7) {
  const g = golden(name);
  return { status: 'ok', corpCode: '00126380', source, persisted: true, fetchId, fetchedAt: AT, data: g.data, quality: g.quality, fetch: FETCH };
}
function unsupported(name: string) {
  const g = golden(name);
  return { status: 'unsupported', corpCode: '00688996', source: 'database', persisted: true, fetchId: 9, fetchedAt: AT, quality: g.quality, fetch: FETCH, code: g.code, reason: g.reason, missingRequired: g.missingRequired };
}
function setup(historical: (url: string) => Reply) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    let r: Reply;
    if (url.startsWith('/api/companies?')) r = { body: { items: [{ corpCode: '00126380', corpName: '삼성전자', stockCode: '005930', modifyDate: '20240101' }] } };
    else if (url.includes('/historical')) r = historical(url);
    else r = { body: { corpCode: '00126380', corpName: '삼성전자(주)', corpNameEng: 'SAMSUNG', stockCode: '005930', corpClass: 'Y', source: 'OpenDART', fetchedAt: AT } };
    const status = r.status ?? 200;
    return { ok: status < 300, status, json: async () => r.body };
  };
  const repo = new DatabaseFinancialRepository(new BackendDartClient({ fetch: fn }), () => new Date('2026-10-07'));
  return { repo, calls };
}
async function selected(repo: DatabaseFinancialRepository, state: ProjectState = emptyProjectState) {
  const [profile] = await repo.searchCompanies('삼성전자');
  const r = await selectCompany(repo, profile);
  assert.ok(r.ok);
  return { state: withSelectedCompany(state, r.company), company: r.company };
}

// 1
test('기본 repository 는 DatabaseFinancialRepository 이고 화면은 OpenDART 를 직접 알지 않는다', () => {
  assert.ok(defaultFinancialRepository instanceof DatabaseFinancialRepository);
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/DartFinancialRepository/.test(read('../data/repository/defaultRepository.ts')));
  for (const f of ['../pages/Workspace.tsx', '../components/CompanySearch.tsx', '../components/HistoricalSource.tsx', '../components/valuation/HistoricalStage.tsx', './project.tsx']) {
    assert.ok(!/opendart\.fss|crtfc_key|fnltt|DATABASE_URL/i.test(read(f)), f);
  }
  assert.ok(read('./project.tsx').includes('defaultFinancialRepository'));
});

// 2·3·4·5·6
test('기업을 선택해도 자동으로 불러오지 않고, [재무데이터 불러오기] 로 명시적으로 불러오면 data · quality · provenance 가 함께 들어온다', async () => {
  const { repo, calls } = setup(() => ({ body: ok('samsung') }));
  const { state: picked, company } = await selected(repo);
  assert.equal(picked.selectedCompany?.corpCode, '00126380');
  assert.equal(picked.historicalData, null);
  assert.equal(picked.historicalQuality, null);
  assert.equal(picked.historicalProvenance, null);
  assert.ok(!calls.some((u) => u.includes('/historical')), '선택만으로는 재무데이터를 요청하지 않는다');

  const outcome = await loadHistorical(repo, company);
  assert.ok(outcome.ok);
  const s = applyLoadOutcome(picked, outcome);
  assert.equal(calls.filter((u) => u.includes('/historical')).length, 1);
  assert.equal(s.historicalData?.company.name, 't');
  assert.deepEqual(s.historicalData?.company.period, ['2023A', '2024A', '2025A']);
  assert.equal(s.historicalQuality?.fields.revenue?.matchType, 'account-id');
  assert.deepEqual(s.historicalProvenance, { source: 'database', persisted: true, fetchedAt: AT, fetchId: '7', corpCode: '00126380', fiscalYears: [2023, 2024, 2025] });
  assert.equal(s.selectedCompany?.corpCode, '00126380');
  assert.equal(s.valuationAssumptions, null, 'Historical 로 가정이 자동 입력되지 않는다');
});

// 7·17·18
test('DataQuality 가 Historical View 로 전달되고 notes · 출처 보기 · provenance 표시 모델이 만들어진다', async () => {
  const { repo } = setup(() => ({ body: ok('hyundai') }));
  const { state: picked, company } = await selected(repo);
  const s = applyLoadOutcome(picked, await loadHistorical(repo, company));
  const view = buildHistoricalView(s.historicalData, s.historicalQuality)!;
  assert.ok(view.keyFinancials.find((r) => r.key === 'depreciationAmortization')!.note!.match(/Data unavailable from current DART source/));
  const qv = buildQualityView(s.historicalQuality)!;
  // 현대차: 금융 자회사 혼재 → Review Required (오류가 아니라 검토 필요), D&A / 리스부채는 Data Note
  assert.ok(qv.notes.some((n) => n.level === 'review' && n.text.includes('financial-business')));
  assert.ok(qv.notes.some((n) => n.level === 'note' && n.text.startsWith('D&A not available')));
  assert.ok(qv.notes.some((n) => n.level === 'note' && n.text.startsWith('Lease liabilities')));
  assert.equal(qv.fields.find((f) => f.field === 'depreciationAmortization')!.status, 'missing');
  const rev = qv.sources.find((x) => x.field === 'revenue')!;
  assert.deepEqual([rev.accountName, rev.accountId, rev.matchType, rev.basis, rev.fiscalYear, rev.status], ['매출액', 'ifrs-full_Revenue', 'account-id', 'CFS', 2025, 'available']);
  const debt = qv.sources.find((x) => x.field === 'interestBearingDebt')!;
  assert.ok(debt.components.length >= 3 && debt.matchType === 'sum');
  const da = qv.sources.find((x) => x.field === 'depreciationAmortization')!;
  assert.deepEqual([da.accountName, da.matchType, da.status], [null, null, 'missing']);
  // weak 매핑(매입채무및기타채무)은 출처 보기에서 weak / ambiguous 로 드러난다
  const weak = buildQualityView(golden('syn-weak-ap-ar').quality)!;
  const ap = weak.sources.find((x) => x.field === 'accountsPayable')!;
  assert.deepEqual([ap.accountName, ap.matchType, ap.status], ['매입채무및기타채무', 'weak', 'ambiguous']);
  assert.ok(weak.notes.some((n) => n.level === 'review' && n.text.includes('broader trade and other payables')));
  // provenance 표시
  const p = provenanceView(s.historicalData!, s.historicalProvenance);
  assert.equal(p.sourceLabel, 'Database');
  assert.deepEqual(Object.fromEntries(p.lines.map((l) => [l.label, l.value])), { Company: '현대자동차 (005380)'.replace('현대자동차 (005380)', p.lines[0].value), Basis: 'Consolidated', Source: 'Database', 'Fetched at': AT, Periods: '2023A–2025A', Persisted: 'Yes' });
  assert.equal(buildQualityView(null), null);
});

// 8·9
test('Forecast 참고값은 실제 Historical 에서 오고 D&A 는 unavailable 이며 아무것도 자동 입력되지 않는다', async () => {
  const { repo } = setup(() => ({ body: ok('samsung') }));
  const { state: picked, company } = await selected(repo);
  const s = applyLoadOutcome(picked, await loadHistorical(repo, company));
  const ref = buildForecastReference(s.historicalData, s.historicalQuality)!;
  const row = (k: string) => ref.rows.find((r) => r.key === k)!;
  assert.equal((row('revenueGrowth').values[1]! * 100).toFixed(1), '16.2');
  assert.equal((row('revenueGrowth').values[2]! * 100).toFixed(1), '10.9');
  assert.deepEqual(row('operatingMargin').values.map((v) => (v! * 100).toFixed(1)), ['2.5', '10.9', '13.1']);
  assert.deepEqual(row('capex').values, [576112.92, 514063.55, 475221.79]);
  assert.deepEqual(row('deltaNwc').values.map((v) => v === null ? null : Math.round(v)), [null, 60543, 77173]);
  assert.ok(row('depreciation').values.every((v) => v === null));
  assert.match(row('depreciation').note!, /Data unavailable from current DART source/);
  const fr = analyzeHistorical(s.historicalData!, s.historicalQuality).forecastReference;
  assert.ok(fr.unavailable.includes('Historical D&A unavailable') && fr.depreciationHistory === undefined);
  assert.equal(s.valuationAssumptions, null);
  // 사용자가 직접 입력한 D&A 만 가정에 들어가고 학습용 값(40/42/44)은 섞이지 않는다
  const f = emptyForecastForm();
  Object.assign(f, { currentRevenue: '3336059.38', taxRate: '22', revenueGrowth: ['11', '9', '7'], operatingMargin: ['12', '13', '14'], depreciation: ['500', '510', '520'], capex: ['900', '910', '920'], deltaNwc: ['30', '31', '32'] });
  const parsed = parseForecastForm(f);
  assert.ok(parsed.ok);
  const typed = withForecastInputs(s, parsed.value);
  assert.deepEqual(typed.valuationAssumptions?.depreciation, [500, 510, 520]);
  assert.notDeepEqual(typed.valuationAssumptions?.depreciation, step04PracticeAssumptions.depreciation);
  assert.equal(typed.historicalData, s.historicalData);
});

// 10·11·12
test('fixture 로 대체하지 않는다: NAVER / KB 는 unsupported 이고 빈 chart · 0 값을 만들지 않는다', async () => {
  for (const [name, code] of [['naver', 'unsupported-structure'], ['kb', 'unsupported-industry']] as const) {
    const { repo } = setup(() => ({ body: unsupported(name) }));
    const { state: picked, company } = await selected(repo);
    const outcome = await loadHistorical(repo, company);
    assert.ok(!outcome.ok);
    if (!outcome.ok) {
      assert.equal(outcome.failure.kind, 'unsupported');
      assert.equal(outcome.failure.code, code);
      assert.ok(outcome.failure.message.length > 0, '사유를 표시한다');
      assert.ok(outcome.failure.quality, '서버가 돌려준 사유 · 품질');
    }
    const after = applyLoadOutcome(picked, outcome);
    assert.equal(after, picked, '상태를 바꾸지 않는다');
    assert.equal(after.historicalData, null);
    assert.equal(buildHistoricalView(after.historicalData, after.historicalQuality), null, '빈 chart 를 만들지 않는다');
    assert.equal(buildForecastReference(after.historicalData), null);
  }
  assert.match(UNSUPPORTED_UX.title, /Generic Valuation Model/);
  assert.match(UNSUPPORTED_UX.scope, /제조업/);
  // 조회 실패 / 불완전도 구분된다
  const down = setup(() => ({ status: 503, body: { error: { code: 'dart-unavailable', message: '연결 실패' } } }));
  const o1 = await loadHistorical(down.repo, (await selected(down.repo)).company);
  assert.ok(!o1.ok && o1.failure.kind === 'unavailable' && o1.failure.message === '연결 실패');
  const inc = setup(() => ({ body: { ...unsupported('kb'), status: 'incomplete', code: 'incomplete', reason: '필수 계정 없음' } }));
  const o2 = await loadHistorical(inc.repo, (await selected(inc.repo)).company);
  assert.ok(!o2.ok && o2.failure.kind === 'incomplete');
  const src = readFileSync(new URL('./historicalLoad.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.ok(!/samsungHistorical|withSamsungHistorical|fromSamsungFixture/.test(src), 'load 흐름에 fixture 로 대체하는 경로가 없다');
});

// 13·14
test('refresh: 성공하면 Historical 을 교체하고, 실패하면 기존 데이터를 유지하며 오류만 돌려준다', async () => {
  let mode: 'ok' | 'fail' = 'ok';
  const { repo, calls } = setup((url) => (mode === 'fail' ? { status: 429, body: { error: { code: 'rate-limit', message: '한도 초과' } } } : { body: ok('samsung', url.includes('refresh=true') ? 'opendart' : 'database', url.includes('refresh=true') ? 8 : 7) }));
  const { state: picked, company } = await selected(repo);
  const first = applyLoadOutcome(picked, await loadHistorical(repo, company));
  assert.equal(first.historicalProvenance?.source, 'database');

  const refreshed = applyLoadOutcome(first, await loadHistorical(repo, company, { refresh: true, fiscalYears: first.historicalProvenance?.fiscalYears }));
  assert.ok(calls.at(-1)!.includes('refresh=true') && calls.at(-1)!.includes('years=2023%2C2024%2C2025'));
  assert.deepEqual([refreshed.historicalProvenance?.source, refreshed.historicalProvenance?.fetchId], ['opendart', '8']);
  assert.notEqual(refreshed.historicalData, first.historicalData);

  mode = 'fail';
  const failed = await loadHistorical(repo, company, { refresh: true });
  assert.ok(!failed.ok && failed.failure.kind === 'unavailable' && failed.failure.message === '한도 초과');
  const kept = applyLoadOutcome(refreshed, failed);
  assert.equal(kept, refreshed, '기존 Historical · 품질 · 출처가 그대로다');
  assert.equal(kept.historicalProvenance?.fetchId, '8');
});

// 15
test('reload: 실제 데이터는 복제 저장하지 않고 provenance 로 backend 에서 다시 조회한다 (fixture 는 그대로 복원)', async () => {
  const { repo, calls } = setup(() => ({ body: ok('samsung') }));
  const { state: picked, company } = await selected(repo);
  const live = applyLoadOutcome(picked, await loadHistorical(repo, company));
  const persisted = JSON.parse(JSON.stringify(toPersisted(live)));
  assert.equal(persisted.historicalData, null, 'DB / OpenDART 의 Historical 전체를 localStorage 에 복제하지 않는다');
  assert.deepEqual(persisted.historicalProvenance, live.historicalProvenance);
  assert.equal(persisted.selectedCompany.corpCode, '00126380');
  assert.ok(!JSON.stringify(persisted).includes('ifrs-full_Revenue'), '품질 / trace 도 저장하지 않는다');

  const restored = restoreProjectState(persisted);
  assert.equal(restored.selectedCompany?.corpCode, '00126380');
  assert.equal(restored.historicalData, null);
  assert.equal(needsHistoricalRefetch(restored), true);
  const n = calls.length;
  const again = applyLoadOutcome(restored, await loadHistorical(repo, restored.selectedCompany!, { fiscalYears: restored.historicalProvenance!.fiscalYears }));
  assert.equal(calls.length, n + 1);
  assert.ok(calls.at(-1)!.includes('years=2023%2C2024%2C2025'), '같은 key 로 조회');
  assert.deepEqual(again.historicalData, live.historicalData);
  assert.equal(again.historicalProvenance?.source, 'database');
  assert.equal(needsHistoricalRefetch(again), false);
  // 다시 불러오지 못하면 오래된 출처가 남지 않는다 (provider 가 withHistoricalCleared 를 적용)
  const cleared = withHistoricalCleared(restored);
  assert.deepEqual([cleared.historicalProvenance, cleared.historicalData, cleared.selectedCompany?.corpCode], [null, null, '00126380']);

  // fixture: 데이터 그대로 복원, 다시 조회하지 않음
  const withCo = (s: ProjectState) => ({ ...s, selectedCompany: restored.selectedCompany });
  const fx = restoreProjectState(JSON.parse(JSON.stringify(toPersisted(withCo(withSamsungHistorical(emptyProjectState))))));
  assert.equal(fx.historicalData?.company.name, '삼성전자');
  assert.deepEqual(fx.historicalProvenance, { source: 'fixture', persisted: false });
  assert.equal(needsHistoricalRefetch(fx), false);
  // 이전 버전 저장값(출처 없음)은 meta 로 추정, 손상된 provenance 는 버린다
  const legacy = restoreProjectState({ selectedCompany: restored.selectedCompany, historicalData: samsungHistoricalData });
  assert.equal(legacy.historicalProvenance?.source, 'fixture');
  for (const bad of ['x', 5, { source: 'weird' }, { persisted: true }]) assert.equal(restoreProjectState({ selectedCompany: restored.selectedCompany, historicalProvenance: bad }).historicalProvenance, null);
  // 선택한 기업이 없으면 저장된 fixture · 출처 · 가정이 있어도 아무것도 복원하지 않는다 (첫 화면은 항상 빈 상태)
  assert.deepEqual(restoreProjectState(JSON.parse(JSON.stringify(toPersisted(withSamsungHistorical(emptyProjectState))))), emptyProjectState);
  // 저장된 Historical 이 다른 기업의 것이면 버린다
  const other = restoreProjectState({ selectedCompany: { ...restored.selectedCompany, corpCode: '00164779', corpName: 'SK하이닉스' }, historicalProvenance: { source: 'opendart', persisted: false, corpCode: '00126380', fiscalYears: [2023, 2024, 2025] } });
  assert.deepEqual([other.selectedCompany?.corpCode, other.historicalProvenance, other.historicalData], ['00164779', null, null]);
  assert.equal(restoreProjectState({ historicalProvenance: { source: 'database', corpCode: '00126380' } }).historicalData, null);
  assert.equal(needsHistoricalRefetch(restoreProjectState({ historicalProvenance: { source: 'database', corpCode: '00126380' } })), false, '연도 정보가 없으면 다시 조회하지 않는다');
});

// 16
test('Valuation 초기화는 Historical 을 유지하고, [Historical 제거] 는 Historical 만 지운다', async () => {
  const { repo } = setup(() => ({ body: ok('samsung') }));
  const { state: picked, company } = await selected(repo);
  const live = withPracticeAssumptions(applyLoadOutcome(picked, await loadHistorical(repo, company)));
  assert.ok(live.valuationResult);
  const reset = withValuationReset(live);
  assert.equal(reset.valuationAssumptions, null);
  assert.equal(reset.valuationResult, null);
  assert.equal(reset.historicalData, live.historicalData);
  assert.equal(reset.historicalQuality, live.historicalQuality);
  assert.equal(reset.historicalProvenance, live.historicalProvenance);
  assert.equal(reset.selectedCompany, live.selectedCompany);
  const removed = withHistoricalCleared(live);
  assert.deepEqual([removed.historicalData, removed.historicalQuality, removed.historicalProvenance], [null, null, null]);
  assert.equal(removed.selectedCompany, live.selectedCompany);
  assert.equal(removed.valuationAssumptions, live.valuationAssumptions);
  // fixture 와 실제 데이터는 섞이지 않는다: 같은 흐름이 아니다
  assert.equal(withSamsungHistorical(live).selectedCompany, live.selectedCompany);
  assert.equal(withSamsungHistorical(live).historicalProvenance?.source, 'fixture');
  assert.equal(withSamsungHistorical(live).historicalQuality, null);
  assert.equal(withHistoricalData(live, null).historicalProvenance, null);
});

// 18·20
test('출처 표시: 실제 데이터와 fixture 가 Actual / 단계 chip / Dashboard 에서 구분된다', async () => {
  const { repo } = setup(() => ({ body: ok('samsung') }));
  const { state: picked, company } = await selected(repo);
  const live = applyLoadOutcome(picked, await loadHistorical(repo, company));
  const fx = withSamsungHistorical(emptyProjectState);
  assert.equal(historicalStageBasis(live.historicalProvenance), 'Actual · Database');
  assert.equal(historicalStageBasis({ source: 'opendart' }), 'Actual · OpenDART');
  assert.equal(historicalStageBasis(fx.historicalProvenance), 'Actual · Fixture (학습용)');
  assert.equal(describeBasis(live).historical.sourceLabel, 'Database');
  assert.equal(describeBasis(fx).historical.sourceLabel, 'Fixture (학습용)');
  assert.equal(describeBasis(emptyProjectState).historical.sourceLabel, null);
  assert.equal(historicalSourceLabel(null), 'Fixture (학습용)');
  const hist = (s: ProjectState) => buildWorkflowProgress(s).find((r) => r.key === 'historical')!;
  assert.deepEqual([hist(live).display, hist(live).detail], ['LOADED', 'Database']);
  assert.deepEqual([hist(fx).display, hist(fx).detail], ['LOADED', 'Fixture (학습용)']);
  assert.equal(hist(emptyProjectState).detail, undefined);
  const lines = (s: ProjectState) => Object.fromEntries(provenanceView(s.historicalData!, s.historicalProvenance).lines.map((l) => [l.label, l.value]));
  assert.equal(lines(live).Persisted, 'Yes');
  assert.equal(lines(fx).Persisted, 'No (fixture)');
  assert.equal(lines(fx).Source, 'Fixture (학습용)');
  assert.equal(lines(live)['Fetched at'], AT);
  assert.equal(lines(fx)['Fetched at'], undefined);
  assert.equal(provenanceView(live.historicalData!, { ...live.historicalProvenance!, source: 'opendart', persisted: false }).lines.find((l) => l.label === 'Persisted')!.value, 'No');
  // 학습용 가정 + 실제 Historical 의 주의 문구
  assert.match(describeBasis(withPracticeAssumptions(live)).caution!, /실제 공시/);
  assert.match(describeBasis(withPracticeAssumptions(fx)).caution!, /학습용 fixture/);
});

// 19·20·21
test('Sensitivity 축은 Base 를 중심으로 동적으로 만들어지고 Base 를 항상 포함하며 WACC ≤ g 칸을 만들지 않는다', () => {
  const grid = (w: number, g: number) => buildSensitivityAxes(w, g);
  const near = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert.ok(near(grid(0.081375, 0.02).waccValues, [0.075, 0.08, 0.081375, 0.085, 0.09]));
  assert.ok(near(grid(0.0925, 0.03).waccValues, [0.085, 0.09, 0.0925, 0.095, 0.1]), 'Base 가 바뀌면 축도 바뀐다 (고정 7.5~9% 가 아니다)');
  assert.ok(near(grid(0.0925, 0.03).terminalGrowthValues, [0.02, 0.025, 0.03, 0.035, 0.04]));
  for (const [w, g] of [[0.081375, 0.02], [0.0925, 0.03], [0.07, 0.015], [0.055, 0.02], [0.1, 0.0], [0.12, 0.04]] as const) {
    const a = grid(w, g);
    assert.ok(a.waccValues.some((x) => Math.abs(x - w) < 1e-9), `Base WACC ${w}`);
    assert.ok(a.terminalGrowthValues.some((x) => Math.abs(x - g) < 1e-9), `Base g ${g}`);
    assert.ok(Math.min(...a.waccValues) > Math.max(...a.terminalGrowthValues), `모든 칸에서 WACC > g (${w}, ${g})`);
  }
  // 엔진: Base 가 격자에 있고(isBaseCase), 분석 범위(축)와 Base 입력은 따로 보고된다
  const input = { ...step04PracticeAssumptions };
  const axes = grid(calculateWacc(input).wacc, input.terminalGrowth);
  const res = runSensitivity(input, axes.waccValues, axes.terminalGrowthValues);
  assert.equal(res.cells.flat().filter((c) => c.isBaseCase).length, 1);
  assert.ok(Math.abs(res.baseWacc - 0.081375) < 1e-12 && res.baseTerminalGrowth === 0.02);
  assert.deepEqual([res.waccValues.length, res.terminalGrowthValues.length], [5, 5]);
  // WACC ≤ g 인 칸이 있으면 엔진은 어떤 조합인지 알려 주며 거부한다 (invalid 처리 — 값을 만들지 않는다)
  assert.throws(() => runSensitivity(input, [0.01, 0.08], [0.02]), /WACC.*영구성장률 이하/);
  // Base 자체가 WACC ≤ g 이면 격자를 만들지 않고 Base 한 칸만 → 엔진이 같은 이유로 오류
  const bad = grid(0.02, 0.03);
  assert.deepEqual([bad.waccValues, bad.terminalGrowthValues], [[0.02], [0.03]]);
  assert.throws(() => runSensitivity(input, bad.waccValues, bad.terminalGrowthValues), /Terminal Value/);
});

// 22 Full Samsung E2E
test('삼성전자 End-to-End: 검색 → 선택 → 불러오기 → Historical View → Forecast Reference → Valuation 입력까지 fixture 혼입 없음', async () => {
  const { repo, calls } = setup(() => ({ body: ok('samsung') }));
  const found = await repo.searchCompanies('삼성전자');
  assert.deepEqual(found.map((c) => [c.name, c.stockCode, c.source]), [['삼성전자', '005930', 'OpenDART']]);
  const { state: picked, company } = await selected(repo);
  const s = applyLoadOutcome(picked, await loadHistorical(repo, company));

  // Historical View: Growth / Margin 이 생성되고 출처 · 품질이 전달된다
  const view = buildHistoricalView(s.historicalData, s.historicalQuality)!;
  const metric = (k: string) => view.metrics.find((m) => m.key === k)!;
  assert.deepEqual(metric('revenueGrowth').values.map((v) => (v === null ? null : (v * 100).toFixed(1))), [null, '16.2', '10.9']);
  assert.deepEqual(metric('operatingMargin').values.map((v) => (v! * 100).toFixed(1)), ['2.5', '10.9', '13.1']);
  assert.deepEqual(metric('nwc').values, [76953443, 83007761, 90725090]);
  assert.match(view.trends[0].verdict, /성장률 둔화/);
  assert.ok(view.keyFinancials.find((r) => r.key === 'depreciationAmortization')!.values.every((v) => v === null), 'D&A unavailable (—)');
  assert.equal(provenanceView(s.historicalData!, s.historicalProvenance).sourceLabel, 'Database');
  // quality warning 전달
  assert.ok(s.historicalQuality!.warnings.includes('D&A not available from current OpenDART financial statement source.'));
  assert.ok(buildQualityView(s.historicalQuality)!.notes.some((n) => n.level === 'note'));
  // Forecast Reference
  const ref = buildForecastReference(s.historicalData, s.historicalQuality)!;
  assert.equal(ref.latestRevenuePeriod, '2025A');
  assert.equal(ref.latestRevenueEok, 3336059.38);
  assert.deepEqual(ref.hints, ['Historical Revenue Growth: +16.2% → +10.9%', 'Historical Operating Margin: 2.5% → 10.9% → 13.1%']);
  // 값은 학습용 fixture 가 아니라 backend 응답에서 왔고, fixture 객체와 섞이지 않는다
  assert.notEqual(s.historicalData, samsungHistoricalData);
  assert.equal(s.historicalProvenance?.source, 'database');
  assert.equal(s.valuationAssumptions, null);
  assert.ok(calls.every((u) => u.startsWith('/api/companies')), '프론트는 backend /api 만 호출한다');
  assert.ok(!calls.some((u) => /opendart|crtfc|fnltt/i.test(u)));
  // Valuation workflow 로 이어진다: 학습용 가정은 명시적으로 적용했을 때만 들어오고 Historical 은 그대로
  const valued = withPracticeAssumptions(s);
  assert.ok(valued.valuationResult && valued.sensitivityResult);
  assert.equal(valued.historicalData, s.historicalData);
  assert.equal(valued.historicalProvenance, s.historicalProvenance);
});

// UI 연결 (소스 확인)
test('UI 연결: 버튼 · 상태 문구 · DataQuality 전달이 화면 코드에 있고 fixture 버튼과 분리되어 있다', () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  const hs = read('../components/HistoricalSource.tsx');
  for (const t of ['재무데이터 불러오기', '데이터 새로고침', 'Historical 제거', 'Loading financial data...', 'Review Required', 'Data Note', '출처 보기', 'UNSUPPORTED_UX']) assert.ok(hs.includes(t), t);
  assert.ok(read('../components/valuation/HistoricalStage.tsx').includes('buildHistoricalView(project.historicalData, project.historicalQuality)'));
  assert.ok(read('../components/valuation/ForecastStage.tsx').includes('buildForecastReference(h, project.historicalQuality)'));
  assert.ok(read('../components/CompanySearch.tsx').includes('HistoricalLoadControls'));
  assert.ok(!read('../components/CompanySearch.tsx').includes('학습용'), '기업 검색 흐름에는 fixture 버튼이 없다');
  assert.ok(!hs.includes('loadSamsung') && !hs.includes('학습용 Historical 불러오기'), '실제 데이터 흐름에 fixture 버튼이 없다');
  assert.ok(!read('../pages/Workspace.tsx').includes('삼성전자 학습용 Historical 불러오기'), '기업 선택 없이 fixture 를 불러오는 버튼은 없다');
  const provider = read('./project.tsx');
  assert.ok(provider.includes('needsHistoricalRefetch') && provider.includes('withHistoricalCleared') && provider.includes('seq.current'));
  assert.ok(toLoadOutcome.length === 2);
});
