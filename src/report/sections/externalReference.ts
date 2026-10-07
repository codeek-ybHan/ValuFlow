// Market & Peer Reference section (STEP 09-5): Project State 에 없는 시장 · Peer 값은 "선택한 AI 분석의 evidence snapshot"을 통해서만 Report 에 들어온다.
// Report 는 외부 API 를 호출하지 않고, 이 값을 Valuation 에 쓰지 않는다 (kind = reference). provider · 신뢰 등급 · 기준 시점을 유지하고 Development provider 는 명확히 표시한다.
import { normalizeDisplayUnit } from '../../ai/tools/display.ts';
import { humanField, toolLabel } from '../../ai/analyst/view.ts';
import type { Evidence } from '../../ai/grounding/types.ts';
import type { ReportInput } from '../input.ts';
import type { ExternalReference, ExternalReferenceItem } from '../model.ts';
import type { SourceRegistry } from '../sources.ts';
import type { ReportUnit, SectionState } from '../types.ts';
import { cell } from '../units.ts';

const MAX_ITEMS = 24;

/** evidence 의 값 · 단위를 Report 정책 단위로 옮긴다 (단위 환산은 display helper 의 정규화만 사용). 옮길 수 없으면 null (중복 표기 · 알 수 없는 단위는 건너뛴다). */
function unitOf(e: Evidence): ReportUnit | null {
  if (typeof e.value !== 'number' || !Number.isFinite(e.value) || e.missing) return null;
  const u = normalizeDisplayUnit(e.unit);
  if (u === 'eok') return 'eok';
  if (u === 'ratio') return 'ratio';
  if (u === 'multiple') return 'multiple';
  if (u === 'krw' || u === 'won') return Math.abs(e.value) < 1e8 ? 'won' : null;   // 큰 원화 값은 같은 근거의 억원 표시(valueEok)가 따로 있다
  if (u === 'unknown' && /beta/i.test(e.fieldPath ?? '')) return 'factor';
  if (u === 'unknown' && /multiples?\./i.test(e.fieldPath ?? '')) return 'multiple';
  return null;
}

export function buildExternalReference(input: ReportInput, reg: SourceRegistry): SectionState<ExternalReference> {
  const ai = input.aiAnalysis;
  if (!ai) return { status: 'unavailable', reason: '선택한 AI 분석의 시장 · Peer 근거가 없습니다 (Report 는 외부 API 를 호출하지 않습니다).' };
  if (ai.contextSnapshotId !== input.snapshot.contextSnapshotId) return { status: 'unavailable', reason: 'AI 분석이 다른 Project snapshot 기준이라 시장 · Peer 근거를 사용하지 않았습니다.' };
  const items: ExternalReferenceItem[] = [];
  const seen = new Set<string>();
  for (const e of ai.evidence) {
    if (e.sourceType !== 'market-data' && e.sourceType !== 'peer-data') continue;
    const unit = unitOf(e);
    const key = `${e.tool}:${e.fieldPath}`;
    if (!unit || seen.has(key) || items.length >= MAX_ITEMS) continue;
    seen.add(key);
    const sourceId = reg.fromEvidence(e);
    const src = reg.all().find((s) => s.id === sourceId);
    items.push({
      key, label: humanField(e.fieldPath), group: e.sourceType === 'peer-data' ? 'peer' : 'market', toolLabel: toolLabel(e.tool),
      cell: cell(e.value as number, unit, 'reference', sourceId), asOf: e.asOf ?? null, evidenceId: e.evidenceId,
      providerLabel: src?.provider ? `${src.provider.name} (${src.provider.reliability})` : null, development: src?.provider?.development ?? false,
    });
  }
  if (items.length === 0) return { status: 'unavailable', reason: '선택한 AI 분석에 Report 에 옮길 수 있는 시장 · Peer 수치 근거가 없습니다.' };
  return { status: 'ok', data: { items, notice: '이 값들은 AI 분석이 사용한 외부 데이터의 스냅샷이며 Valuation 계산에 쓰이지 않았습니다. Development provider 의 값은 공식 · Valuation 등급 데이터가 아닙니다.' } };
}
