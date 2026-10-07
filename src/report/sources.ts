// Source 정책: 숫자마다 출처를 추적할 수 있어야 하고, Report 가 출처를 새로 만들지 않는다.
//   Historical → 원본 provenance(OpenDART / Database / fixture) · Valuation → ValuFlow Engine · 가정 → user-input / 학습용 ·
//   외부 · 문서 · 뉴스 → AI Analyst 근거(Evidence)가 가진 출처를 그대로 옮긴다.
import type { Evidence } from '../ai/grounding/types.ts';
import type { ReportInput } from './input.ts';
import type { AnswerSource } from '../ai/answer.ts';
import type { SourceDocument, SourceKind, SourceProvider, SourceRef } from './types.ts';

export const SRC_HISTORICAL = 'src-historical';
export const SRC_ASSUMPTIONS = 'src-assumptions';
export const SRC_ENGINE = 'src-engine';
export const SRC_RELATIVE = 'src-relative-inputs';

const HISTORICAL_LABEL: Record<string, string> = { database: 'OpenDART 재무제표 (Database 저장본)', opendart: 'OpenDART 재무제표', fixture: '학습용 샘플 데이터 (fixture)' };

export class SourceRegistry {
  private readonly list: SourceRef[] = [];
  private readonly byKey = new Map<string, string>();

  add(ref: Omit<SourceRef, 'id'> & { id?: string }, key: string): string {
    const known = this.byKey.get(key);
    if (known) return known;
    const id = ref.id ?? `src-${this.list.length + 1}`;
    this.list.push({ ...ref, id });
    this.byKey.set(key, id);
    return id;
  }

  has(id: string): boolean { return this.list.some((s) => s.id === id); }
  all(): SourceRef[] { return this.list.map((s) => ({ ...s })); }

  private answerSources: AnswerSource[] = [];
  /** AI 답변의 출처 목록(문서 접수번호 · 공시일 · 언론사 등 위치 정보)을 근거와 연결하는 데 쓴다. */
  setAnswerSources(list: AnswerSource[]): void { this.answerSources = list; }

  private matchAnswerSource(e: Evidence): AnswerSource | undefined {
    return this.answerSources.find((s) => (e.documentId && s.documentId === e.documentId && (e.sourceType !== 'uploaded-document' || s.page == null || e.page == null || s.page === e.page)) || (e.sourceType === 'news' && !!e.url && s.url === e.url));
  }

  /** AI 근거(Evidence)의 출처를 옮긴다. 같은 출처는 한 번만 등록한다. 값의 성격(actual / calculated / assumption)이 Report 의 기본 출처와 같으면 그쪽을 쓴다. */
  fromEvidence(e: Evidence): string {
    if (e.sourceType === 'financial-data') {
      if (e.sourceKind === 'actual') return SRC_HISTORICAL;
      if (e.sourceKind === 'assumption') return SRC_ASSUMPTIONS;
      return SRC_ENGINE;
    }
    const kind: SourceKind = e.sourceType === 'market-data' ? 'market' : e.sourceType === 'peer-data' ? 'peer' : e.sourceType === 'news' ? 'news' : e.sourceType === 'disclosure-document' ? 'disclosure' : e.sourceType === 'uploaded-document' ? 'document' : 'ai';
    const a = this.matchAnswerSource(e);
    const label = a?.reportName ?? a?.title ?? e.sourceLabel ?? e.origin ?? e.sourceType;
    const key = [kind, e.origin, e.documentId, label, e.page, e.section].map((x) => String(x ?? '')).join('|');
    const document: SourceDocument | undefined = kind === 'disclosure' || kind === 'document' || kind === 'news'
      ? { title: a?.title ?? e.sourceLabel ?? null, reportName: a?.reportName ?? null, filingDate: a?.filingDate ?? null, receiptNo: a?.receiptNo ?? null, documentId: e.documentId ?? a?.documentId ?? null, section: e.section ?? a?.section ?? null, page: e.page ?? a?.page ?? null, publisher: a?.publisher ?? null, url: e.url ?? a?.url ?? null }
      : undefined;
    const provider: SourceProvider | undefined = e.provider
      ? { name: e.provider.name, reliability: e.provider.reliability, tier: e.provider.tier, official: e.provider.official ?? null, valuationGrade: e.provider.valuationGrade ?? null, development: e.provider.tier === 'development' || e.provider.reliability === 'unofficial' || e.provider.reliability === 'unknown' }
      : undefined;
    return this.add({
      kind, label, origin: e.origin ?? e.sourceType, basis: e.page != null ? `p.${e.page}` : e.section ?? null, asOf: e.asOf ?? a?.filingDate ?? a?.publishedAt ?? null,
      reliability: e.provider ? `${e.provider.reliability} · ${e.provider.tier}` : null, note: e.documentId ? `documentId ${e.documentId}` : e.url ?? null, ...(document ? { document } : {}), ...(provider ? { provider } : {}),
    }, key);
  }
}

/** Report 의 기본 출처(Historical · 가정 · 엔진)를 등록한다. 입력에 없는 것은 등록하지 않는다. */
export function baseSources(input: ReportInput, reg: SourceRegistry): void {
  reg.setAnswerSources(input.aiAnalysis?.sources ?? []);
  const origin = input.provenance?.source ?? (input.historicalKind === 'fixture' ? 'fixture' : 'unknown');
  reg.add({ id: SRC_HISTORICAL, kind: 'historical', label: HISTORICAL_LABEL[origin] ?? origin, origin, basis: input.historical?.company.basis ?? null, asOf: input.provenance?.fetchedAt ?? null, reliability: null,
    note: input.historicalKind === 'fixture' ? '학습용 fixture 입니다. 실제 OpenDART 조회 결과가 아닙니다.' : 'Historical 지표는 ValuFlow Historical Analysis 가 이 값에서 계산한 결과를 그대로 사용했다 (Report 에서 다시 계산하지 않음).' }, SRC_HISTORICAL);
  const learning = input.assumptionKind === 'learning';
  reg.add({ id: SRC_ASSUMPTIONS, kind: 'assumption', label: learning ? 'STEP 04 학습용 가정' : '사용자 입력 가정', origin: learning ? 'learning-fixture' : 'user-input', basis: null, asOf: null, reliability: null,
    note: learning ? '이 기업에 대한 애널리스트 가정이 아닌 학습용 가상값입니다.' : '사용자가 입력한 가정입니다 (Actual 이 아닙니다).' }, SRC_ASSUMPTIONS);
  reg.add({ id: SRC_ENGINE, kind: 'engine', label: 'ValuFlow Valuation Engine', origin: 'valuation-engine', basis: null, asOf: input.snapshot.valuationSnapshotId ? input.snapshot.createdAt : null, reliability: null,
    note: `입력 가정: ${learning ? '학습용 가정' : '사용자 입력 가정'}. snapshot ${input.snapshot.valuationSnapshotId ?? '-'}` }, SRC_ENGINE);
  if (Object.values(input.relativeInputs).some((v) => v !== undefined)) reg.add({ id: SRC_RELATIVE, kind: 'assumption', label: '상대가치 입력 (사용자 입력 멀티플 · 이익)', origin: 'user-input', basis: null, asOf: null, reliability: null, note: '멀티플과 이익 기준은 사용자가 입력한 값입니다.' }, SRC_RELATIVE);
}
