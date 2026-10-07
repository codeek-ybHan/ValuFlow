// STEP 08-7 AI Analyst UI 의 view-model. React 를 모르는 순수 함수만 둔다 (화면은 이 결과만 그린다).
// 원칙: Tool 결과 JSON 을 그대로 보이지 않는다 · 내부 추론(chain-of-thought)은 없다 · Fact 와 Judgment 를 같은 스타일로 보이지 않는다 ·
//       숫자에는 단위를 붙인다 · 외부 provider 의 신뢰 등급을 숨기지 않는다 · 현재 Project 값을 다시 계산해서 과거 답변을 바꾸지 않는다.
import type { AnswerSource } from '../answer.ts';
import type { AiQueryOutcome } from '../query.ts';
import type { CheckpointKind, StepStatus, WorkflowOutcome, WorkflowType } from '../agent/types.ts';
import type { ClaimStatus, ClaimType, Confidence, Evidence, GroundedClaim } from '../grounding/types.ts';
import { UNSUPPORTED_DISCLOSURE } from '../policy.ts';
import { sameFamily } from '../agent/run.ts';
import { aiAnalysisFromWorkflow, type AiAnalysisInput } from '../../report/input.ts';
import { formatFinancialValue, formatPercent, normalizeDisplayUnit } from '../tools/display.ts';

export type AnalystMode = 'quick' | 'workflow';
export type ModePreference = 'auto' | AnalystMode;

/** 사용자에게는 기술 용어(grounding level) 대신 Quick Answer / Deep Analysis 로 보여 준다. */
export const MODE_INFO: Record<AnalystMode, { name: string; grounding: string; note: string }> = {
  quick: { name: 'Quick Answer', grounding: 'Tool Guardrails', note: 'Tool 결과를 바탕으로 빠르게 답합니다. 문장별 근거 검증은 하지 않습니다.' },
  workflow: { name: 'Deep Analysis', grounding: 'Claim-Evidence', note: '여러 Tool 을 단계별로 확인하고, 핵심 주장마다 근거를 연결해 검증합니다.' },
};

export type TurnStatus = 'completed' | 'completed-with-limitations' | 'waiting-for-review' | 'failed' | 'tool-limit' | 'unsupported' | 'cancelled';

export const STATUS_INFO: Record<TurnStatus, { label: string; detail: string }> = {
  completed: { label: 'Completed', detail: '분석이 끝났습니다.' },
  'completed-with-limitations': { label: 'Completed with limitations', detail: '일부 데이터를 확인하지 못했거나 제한이 있습니다. 아래 한계를 함께 확인하세요.' },
  'waiting-for-review': { label: 'Waiting for review', detail: '사람이 판단해야 하는 제안이 있습니다. 승인하기 전에는 어떤 값도 바뀌지 않습니다.' },
  failed: { label: 'Failed', detail: '분석을 끝내지 못했습니다.' },
  'tool-limit': { label: 'Tool limit reached', detail: '한 번에 확인할 수 있는 범위를 넘어 지금까지 확인한 내용만 정리했습니다. 질문을 나눠서 다시 요청하세요.' },
  unsupported: { label: 'Unsupported company', detail: '현재 Generic Valuation Model 이 지원하지 않는 재무제표 구조입니다.' },
  cancelled: { label: 'Cancelled', detail: '분석을 취소했습니다.' },
};

// ---- Tool · 출처 라벨 ----
export const TOOL_LABEL: Record<string, string> = {
  getCompanyOverview: 'Company Overview', getHistoricalAnalysis: 'Historical Analysis', getHistoricalQuality: 'Data Quality', getMappingTrace: 'Account Mapping',
  getForecastAssumptions: 'Forecast Assumptions', getValuationResult: 'Valuation Result', getSensitivityAnalysis: 'Sensitivity', getScenarioAnalysis: 'Scenario', getRelativeValuation: 'Relative Valuation',
  getMarketData: 'Market Data', getMarketAssumptions: 'Market Assumptions', getComparableCompanies: 'Peer Data', searchCompanyNews: 'News',
  searchDisclosures: 'Disclosure Search', searchUploadedDocuments: 'Uploaded Documents', searchKnowledge: 'Knowledge Search',
};
export const toolLabel = (tool: string) => TOOL_LABEL[tool] ?? tool;

/** 실행 중인 단계를 한 문장으로 ("무엇을 확인 중인지"만 보여 준다. 가짜 진행률은 쓰지 않는다). */
const TOOL_PROGRESS: Record<string, string> = {
  getCompanyOverview: '기업 정보를 확인하는 중…', getHistoricalAnalysis: '과거 실적을 검토하는 중…', getHistoricalQuality: '재무데이터 품질을 확인하는 중…', getMappingTrace: '계정 매핑을 확인하는 중…',
  getForecastAssumptions: '현재 가정을 확인하는 중…', getValuationResult: 'Valuation 결과를 확인하는 중…', getSensitivityAnalysis: '민감도를 확인하는 중…', getScenarioAnalysis: '시나리오를 확인하는 중…',
  getRelativeValuation: '상대가치 입력을 확인하는 중…', getMarketData: '시장 데이터를 확인하는 중…', getMarketAssumptions: '시장 가정을 확인하는 중…', getComparableCompanies: '비교기업을 확인하는 중…',
  searchCompanyNews: '최근 뉴스를 확인하는 중…', searchDisclosures: '공시를 검색하는 중…', searchUploadedDocuments: '업로드 문서를 검색하는 중…', searchKnowledge: '문서를 검색하는 중…',
};
export const VALIDATING_TEXT = '근거를 검증하는 중…';
export const QUICK_PROGRESS_TEXT = 'AI 가 답변을 준비하는 중…';

/** 지금 하고 있는 일을 한 문장으로: 실행 중인 단계 → 다음 대기 단계 → (모두 끝났으면) 근거 검증. */
export function progressText(steps: { tool: string; status: string }[]): string {
  const cur = steps.find((s) => s.status === 'running') ?? steps.find((s) => s.status === 'pending');
  return cur ? (TOOL_PROGRESS[cur.tool] ?? '분석하는 중…') : VALIDATING_TEXT;
}

export type BadgeId = 'valuflow' | 'opendart' | 'disclosure' | 'upload' | 'market' | 'peer' | 'news' | 'fixture';
export const BADGE_LABEL: Record<BadgeId, string> = {
  valuflow: 'ValuFlow Engine', opendart: 'OpenDART', disclosure: 'Disclosure', upload: 'Uploaded PDF', market: 'Market Data', peer: 'Peer Data', news: 'News', fixture: 'Learning Data',
};

export function badgeOf(type: string | undefined, kind: string | undefined, origin?: string | null): BadgeId {
  switch (type) {
    case 'disclosure-document': return 'disclosure';
    case 'uploaded-document': return 'upload';
    case 'market-data': return 'market';
    case 'peer-data': return 'peer';
    case 'news': return 'news';
  }
  if (kind === 'actual') return origin === 'fixture' || origin === 'learning-fixture' ? 'fixture' : 'opendart';
  return 'valuflow';
}

/** Actual / Estimate 구분: 공시 실적만 Actual 이다. */
export const KIND_LABEL: Record<string, string> = { actual: 'Actual', assumption: 'Estimate · 가정', calculated: 'Estimate · 계산 결과', document: 'Document', external: 'External' };

export interface ReliabilityView { label: string; note: string }
/** 외부 provider 가 공식 · 상용 등급이 아니면(개발용 · 비공식 · 미상) 공식 데이터로 오해하지 않도록 표시한다. */
export function reliabilityOf(p: { reliability?: string; tier?: string } | null | undefined, type?: string): ReliabilityView | null {
  const external = type === 'market-data' || type === 'peer-data' || type === 'news';
  if (!p) return external ? { label: 'Reference Data', note: 'Valuation 등급이 아닌 참고용 데이터입니다.' } : null;
  if (p.tier === 'development' || p.reliability === 'unofficial' || p.reliability === 'unknown') return { label: 'Development Source', note: 'Valuation 등급이 아닌 개발 · 참고용 데이터입니다.' };
  return null;
}

// ---- 신뢰도 ----
export const CONFIDENCE_INFO: Record<Confidence, { label: string; glyph: string; tip: string }> = {
  high: { label: 'High', glyph: '●●●', tip: 'High: 결정론적 계산 또는 권위 있는 출처가 직접 뒷받침합니다.' },
  medium: { label: 'Medium', glyph: '●●○', tip: 'Medium: 공시 문서 또는 공식 외부 출처가 뒷받침합니다.' },
  low: { label: 'Low', glyph: '●○○', tip: 'Low: 개발용 provider 이거나 부분적인 근거입니다.' },
};

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = { fact: 'Fact', calculation: 'Calculation', interpretation: 'Interpretation', risk: 'Risk', recommendation: 'Consideration' };
export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = { supported: 'Supported', 'partially-supported': 'Partially supported', unsupported: 'Unsupported' };

// ---- Evidence ----
export interface EvidenceView {
  id: string;
  badge: BadgeId;
  badgeLabel: string;
  kindLabel: string | null;
  sourceLabel: string;
  field: string;
  /** 단위를 붙인 값 (문서 · 뉴스 근거는 null) */
  valueText: string | null;
  period: string | null;
  asOf: string | null;
  page: number | null;
  section: string | null;
  documentId: string | null;
  excerpt: string | null;
  url: string | null;
  reliability: ReliabilityView | null;
  quality: string | null;
  missing: boolean;
}

const GENERIC = new Set(['metrics', 'values', 'data', 'display', 'results', 'trends', 'valuesPercent', 'valuesEok', 'valuesTrillion', 'valuesPercentText', 'valuesEokText', 'valuesTrillionText', 'value', 'rate']);
const WORDS: Record<string, string> = { wacc: 'WACC', dcf: 'DCF', capex: 'CAPEX', cfo: 'CFO', eps: 'EPS', ebitda: 'EBITDA', tv: 'Terminal Value', nwc: 'NWC', ev: 'EV', roe: 'ROE', roa: 'ROA', beta: 'Beta', mrp: 'MRP' };
const titleCase = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ').filter(Boolean).map((w) => WORDS[w.toLowerCase()] ?? w[0]!.toUpperCase() + w.slice(1)).join(' ');

/** `metrics.operatingMargin.values[2]` → `Operating Margin` (경로를 그대로 보이지 않는다). */
export function humanField(path: string | undefined): string {
  if (!path) return '—';
  const segs = path.replace(/^(data|\$)\./, '').split('.').map((s) => s.replace(/\[\d+\]/g, '')).filter(Boolean);
  const keep = segs.filter((s) => !GENERIC.has(s));
  return (keep.length > 0 ? keep : segs.slice(-1)).map(titleCase).join(' · ');
}

const fmt = (n: number, digits = 2) => n.toLocaleString('ko-KR', { maximumFractionDigits: digits });

/** 숫자에는 단위를 항상 붙인다. 단위를 모르면 '단위 미상' 으로 밝힌다. */
export function valueText(value: unknown, unit?: string, field?: string): string | null {
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 117)}…` : value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const u = normalizeDisplayUnit(unit);
  switch (u) {
    case 'ratio': return formatPercent(value);
    case 'percent': return `${fmt(value)}%`;
    case 'won': case 'krw': return `${fmt(value, 0)}원`;
    case 'shares': return `${fmt(value, 0)}주`;
    case 'multiple': return `${fmt(value)}배`;
    case 'unknown': return field && /beta/i.test(field) ? `${fmt(value, 3)}배` : unit ? `${fmt(value, 4)} ${unit}` : `${fmt(value, 4)} (단위 미상)`;
    default: return formatFinancialValue(value, unit, 'auto') ?? `${fmt(value)} ${unit ?? ''}`.trim();
  }
}

export const dateOf = (iso: string | null | undefined): string | null => (iso ? iso.slice(0, 10) : null);

/** `database:Consolidated` 같은 내부 표기를 사용자 라벨로 바꾼다. */
function sourceLabelOf(e: Evidence): string {
  const m = e.sourceLabel ? /^([a-z-]+):(.+)$/i.exec(e.sourceLabel) : null;
  if (m && ORIGIN_LABEL[m[1]!.toLowerCase()]) return `${ORIGIN_LABEL[m[1]!.toLowerCase()]} · ${m[2]}`;
  return e.sourceLabel ?? (e.origin && ORIGIN_LABEL[e.origin]) ?? toolLabel(e.tool);
}

export function evidenceView(e: Evidence): EvidenceView {
  const badge = badgeOf(e.sourceType, e.sourceKind, e.origin);
  return {
    id: e.evidenceId, badge, badgeLabel: BADGE_LABEL[badge], kindLabel: KIND_LABEL[e.sourceKind] ?? null, sourceLabel: sourceLabelOf(e), field: humanField(e.fieldPath),
    valueText: e.missing ? null : valueText(e.value, e.unit, e.fieldPath), period: e.period ?? null, asOf: dateOf(e.asOf), page: e.page ?? null, section: e.section ?? null, documentId: e.documentId ?? null,
    excerpt: e.excerpt ?? null, url: e.url ?? null, reliability: e.provider ? reliabilityOf(e.provider, e.sourceType) : reliabilityOf(null, e.sourceType), quality: e.quality && e.quality !== 'available' ? e.quality : null, missing: e.missing === true,
  };
}

// ---- Claim ----
export interface ClaimView {
  id: string;
  text: string;
  type: ClaimType;
  typeLabel: string;
  /** FACT: Tool · 공시 근거가 있는 객관적 사실 / JUDGMENT: AI 의 해석 · 위험 판단 · 제안 */
  kind: 'fact' | 'judgment';
  status: ClaimStatus;
  statusLabel: string;
  confidence: Confidence | null;
  evidenceIds: string[];
  evidenceCount: number;
  notes: string[];
}

export function claimView(c: GroundedClaim): ClaimView {
  return {
    id: c.claimId, text: c.text, type: c.type, typeLabel: CLAIM_TYPE_LABEL[c.type], kind: c.basis === 'objective' ? 'fact' : 'judgment', status: c.status, statusLabel: CLAIM_STATUS_LABEL[c.status],
    confidence: c.confidence ?? null, evidenceIds: [...c.evidenceIds], evidenceCount: c.evidenceIds.length, notes: [...c.confidenceNotes],
  };
}

// ---- 출처 ----
export interface SourceView {
  key: string;
  badge: BadgeId;
  badgeLabel: string;
  title: string;
  kindLabel: string | null;
  /** 짧은 메타데이터 줄 (문서명 · 쪽 · 섹션 · 공시일 · 접수번호 · 기준 시점 …) */
  lines: string[];
  page: number | null;
  section: string | null;
  asOf: string | null;
  url: string | null;
  reliability: ReliabilityView | null;
}

const ORIGIN_LABEL: Record<string, string> = { opendart: 'OpenDART 재무제표', database: 'OpenDART 재무제표 (저장본)', fixture: '학습용 샘플 데이터', 'learning-fixture': '학습용 가정', 'user-input': '사용자 입력 가정', 'valuation-engine': 'ValuFlow Valuation Engine', 'historical-analysis': 'ValuFlow Historical Analysis' };

export function sourceView(s: AnswerSource, providers: Map<string, { reliability?: string; tier?: string }>): SourceView {
  const badge = badgeOf(s.type, s.kind, s.origin);
  const provider = s.type ? providers.get(s.type) : undefined;
  const lines: string[] = [];
  let title = ORIGIN_LABEL[s.origin] ?? s.origin;
  if (s.type === 'disclosure-document') {
    title = s.reportName ?? s.title ?? 'Disclosure';
    for (const l of [s.corpName, s.section, s.filingDate ? `공시일 ${s.filingDate}` : null, s.receiptNo ? `접수번호 ${s.receiptNo}` : null]) if (l) lines.push(l);
  } else if (s.type === 'uploaded-document') {
    title = s.title ?? 'Uploaded PDF';
    for (const l of [s.page != null ? `p.${s.page}` : null, s.section, s.sourceName, s.uploadedAt ? `업로드 ${dateOf(s.uploadedAt)}` : null]) if (l) lines.push(l);
  } else if (s.type === 'news') {
    title = s.title ?? 'News';
    for (const l of [s.publisher, s.publishedAt ? `발행 ${dateOf(s.publishedAt)}` : null]) if (l) lines.push(l);
  } else if (s.type === 'market-data' || s.type === 'peer-data') {
    title = `${BADGE_LABEL[badge]} · ${s.origin}`;
    if (s.asOf) lines.push(`기준 ${dateOf(s.asOf)}`);
  } else {
    if (s.basis) lines.push(s.basis);
    if (s.fetchedAt) lines.push(`조회 ${dateOf(s.fetchedAt)}`);
  }
  return {
    key: [s.type ?? s.kind, s.origin, s.documentId, s.receiptNo, s.title, s.reportName, s.url, s.page, s.section].map((x) => String(x ?? '')).join('|'),
    badge, badgeLabel: BADGE_LABEL[badge], title, kindLabel: KIND_LABEL[s.kind] ?? null, lines, page: s.page ?? null, section: s.section ?? null, asOf: dateOf(s.asOf ?? s.publishedAt), url: s.url ?? null,
    reliability: reliabilityOf(provider, s.type),
  };
}

export function sourceViews(sources: AnswerSource[], evidence: Evidence[]): SourceView[] {
  const providers = new Map<string, { reliability?: string; tier?: string }>();
  for (const e of evidence) if (e.provider && !providers.has(e.sourceType)) providers.set(e.sourceType, e.provider);
  const seen = new Set<string>();
  const out: SourceView[] = [];
  for (const s of sources) { const v = sourceView(s, providers); if (!seen.has(v.key)) { seen.add(v.key); out.push(v); } }
  return out;
}

// ---- 기준 시점 ----
export interface TimeBasisView { historical: string | null; market: string | null; news: string | null; mismatch: boolean; notice: string | null }

export function timeBasisOf(evidence: Evidence[]): TimeBasisView | null {
  const years = evidence.filter((e) => e.sourceType === 'financial-data' && e.period).map((e) => Number.parseInt(e.period!, 10)).filter(Number.isInteger);
  const latest = (type: string) => evidence.filter((e) => e.sourceType === type && e.asOf).map((e) => e.asOf!).sort().pop();
  const historical = years.length > 0 ? (Math.min(...years) === Math.max(...years) ? `FY${years[0]}` : `FY${Math.min(...years)} – FY${Math.max(...years)}`) : null;
  const market = dateOf(latest('market-data') ?? latest('peer-data'));
  const news = dateOf(latest('news'));
  if (!historical && !market && !news) return null;
  const mismatch = historical !== null && (market !== null || news !== null);
  return { historical, market, news, mismatch, notice: mismatch ? 'Historical 과 시장 · 뉴스 데이터는 기준 시점이 서로 다릅니다.' : null };
}

// ---- 경고 · 한계 ----
export interface WarningView { kind: 'data' | 'provider' | 'partial-failure' | 'retrieval' | 'time' | 'unsupported'; text: string }

// ---- 단계 ----
export interface StepView { id: string; label: string; tool: string; status: StepStatus | 'waiting-for-user'; reason: string | null; optional: boolean }

// ---- Human checkpoint (read-only 검토) ----
export type CheckpointDecision = 'pending' | 'keep' | 'later' | 'continue';
export const CHECKPOINT_TITLE: Record<CheckpointKind, string> = {
  'change-risk-free-rate': 'Review risk-free rate assumption', 'change-beta': 'Review beta assumption', 'change-market-risk-premium': 'Review market risk premium assumption',
  'change-cost-of-debt': 'Review cost of debt assumption', 'change-tax-rate': 'Review tax rate assumption', 'change-capital-structure': 'Review capital structure assumption',
  'change-wacc-directly': 'Review WACC (direct change)', 'change-forecast-assumption': 'Review forecast assumption', 'apply-peer-multiple': 'Review peer multiple', 'save-scenario': 'Review scenario',
};
/** WACC 구성요소(Rf · Beta …)의 변경은 WACC 를 직접 바꾸는 제안이 아니다. */
export const WACC_COMPONENT_KINDS: ReadonlySet<CheckpointKind> = new Set(['change-risk-free-rate', 'change-beta', 'change-market-risk-premium', 'change-cost-of-debt', 'change-tax-rate', 'change-capital-structure']);

export interface CheckpointView {
  id: string;
  kind: CheckpointKind;
  title: string;
  target: string;
  currentValue: string | null;
  proposedValue: string | null;
  rationale: string;
  /** WACC 구성요소 제안이면 WACC 자체와 구분해 알리는 문구 */
  note: string | null;
  decision: CheckpointDecision;
}

export const APPLY_UNSUPPORTED_NOTICE = 'Apply 기능은 아직 지원되지 않습니다. 값은 바뀌지 않았습니다. 필요하면 Workspace 에서 직접 입력한 뒤 다시 계산하세요.';

// ---- WACC 표시: WACC 자체와 구성요소를 분리한다 ----
export interface WaccPanelView { wacc: string | null; components: { label: string; value: string }[] }

export function waccPanel(assumptions: Record<string, unknown> | null | undefined, result: { wacc: number } | null | undefined): WaccPanelView | null {
  const a = assumptions ?? {};
  const num = (k: string) => (typeof a[k] === 'number' ? (a[k] as number) : null);
  const rf = num('riskFreeRate'), beta = num('beta'), mrp = num('marketRiskPremium'), kd = num('preTaxCostOfDebt');
  if (!result && rf === null && beta === null && mrp === null && kd === null) return null;
  const pct = (v: number | null) => (v === null ? '미입력' : formatPercent(v));
  return {
    wacc: result ? formatPercent(result.wacc) : null,
    components: [
      { label: 'Risk-free Rate', value: pct(rf) }, { label: 'Beta', value: beta === null ? '미입력' : `${fmt(beta)}배` },
      { label: 'Market Risk Premium', value: pct(mrp) }, { label: 'Cost of Debt (pre-tax)', value: pct(kd) },
    ],
  };
}

// ---- Turn ----
export interface AnswerSections {
  summary: string;
  keyFindings: ClaimView[];
  interpretation: ClaimView[];
  considerations: ClaimView[];
  limitations: string[];
  judgmentItems: string[];
  nextActions: string[];
  reviewedAreas: string[];
  /** Quick Answer: claim 구조가 없을 때 Tool 이 준 근거 목록 */
  plainEvidence: { label: string; value: string; period: string | null; tool: string }[];
}

export type GroundingStatus = 'grounded' | 'partial' | 'needs-review';
export const GROUNDING_INFO: Record<GroundingStatus, { label: string; detail: string }> = {
  grounded: { label: 'Grounded', detail: '핵심 주장이 모두 Tool · 문서 근거로 확인되었습니다.' },
  partial: { label: 'Partially Grounded', detail: '일부 주장은 근거가 부분적이거나 다른 출처에서 가져온 값입니다.' },
  'needs-review': { label: 'Needs Review', detail: '근거를 충분히 확인하지 못했습니다. 결과를 그대로 쓰지 말고 직접 검토하세요.' },
};

export interface DebugInfo {
  coverage: number | null;
  claims: number;
  supported: number;
  unsupported: number;
  regenerated: boolean;
  fallback: boolean;
  firstPassCoverage: number | null;
  violations: string[];
  corrections: string[];
  toolsExecuted: { tool: string; status: string }[];
  groundingLevel: 'claim-evidence' | 'tool-guardrails';
}

export type ErrorKind = 'backend-unavailable' | 'llm-unavailable' | 'tool-unavailable' | 'rate-limit' | 'unsupported-company' | 'no-result' | 'no-company' | 'cancelled' | 'unknown';
export interface ErrorView { kind: ErrorKind; title: string; detail: string }

/** 오류 코드를 사용자 문구로 바꾼다 (기술 오류 JSON · 내부 메시지를 그대로 보이지 않는다). */
export function errorView(code: string | null | undefined): ErrorView {
  switch (code) {
    case 'backend-unreachable': return { kind: 'backend-unavailable', title: 'ValuFlow 서버에 연결할 수 없습니다', detail: 'backend 가 실행 중인지 확인한 뒤 다시 시도하세요.' };
    case 'ai-not-configured': return { kind: 'llm-unavailable', title: 'AI Analyst 가 설정되어 있지 않습니다', detail: '서버에 AI 서비스 설정이 필요합니다. 관리자에게 문의하세요.' };
    case 'provider-error': case 'invalid-model-output': return { kind: 'llm-unavailable', title: 'AI 서비스를 사용할 수 없습니다', detail: '잠시 후 다시 시도하세요.' };
    case 'provider-rate-limit': return { kind: 'rate-limit', title: '요청이 너무 많습니다', detail: 'AI 서비스 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.' };
    case 'cancelled': return { kind: 'cancelled', title: '분석을 취소했습니다', detail: '' };
    case 'no-company': return { kind: 'no-company', title: '기업이 선택되지 않았습니다', detail: 'Workspace 에서 기업을 선택하고 재무데이터를 불러오세요.' };
    case 'state-expired': case 'conversation-too-large': return { kind: 'unknown', title: '대화가 만료되었거나 너무 길어졌습니다', detail: '질문을 다시 시작하세요.' };
    default: return { kind: 'unknown', title: '분석을 처리하지 못했습니다', detail: '잠시 후 다시 시도하세요. 계속되면 서버 로그를 확인하세요.' };
  }
}

export interface AnalystTurn {
  id: string;
  question: string;
  mode: AnalystMode;
  askedAt: string;
  company: { name: string; stockCode: string | null; corpCode: string | null } | null;
  workflowType: WorkflowType | null;
  workflowLabel: string | null;
  /** 질문 시작 시점의 context snapshot (이후 Project 가 바뀌어도 이 답변의 근거는 그대로다) */
  contextSnapshotId: string;
  status: TurnStatus;
  steps: StepView[];
  /** 사용한 데이터 소스 (Tool 이름 → 사용자 라벨) */
  usedSources: string[];
  answer: AnswerSections | null;
  /** 이 질문 시점의 Evidence snapshot: 과거 답변을 열 때 다시 계산하지 않고 이것을 보여 준다 */
  evidence: EvidenceView[];
  sources: SourceView[];
  timeBasis: TimeBasisView | null;
  warnings: WarningView[];
  grounding: GroundingStatus | null;
  checkpoints: CheckpointView[];
  wacc: WaccPanelView | null;
  error: ErrorView | null;
  debug: DebugInfo | null;
  /** Report 에 쓸 수 있는 검증된 분석 snapshot (Deep Analysis 만. Quick 은 claim 구조가 없어 null) */
  analysis: AiAnalysisInput | null;
}

/** 검토 대기 중인 제안이 모두 처리되면 completed 로 본다. */
export function effectiveStatus(t: Pick<AnalystTurn, 'status' | 'checkpoints' | 'warnings'>): TurnStatus {
  if (t.status !== 'waiting-for-review') return t.status;
  if (t.checkpoints.some((c) => c.decision === 'pending' || c.decision === 'later')) return 'waiting-for-review';
  return t.warnings.some((w) => w.kind === 'partial-failure' || w.kind === 'retrieval') ? 'completed-with-limitations' : 'completed';
}

export function groundingStatusOf(claims: GroundedClaim[], fallback: boolean): GroundingStatus {
  if (fallback || claims.length === 0 || claims.some((c) => c.status === 'unsupported')) return 'needs-review';
  return claims.every((c) => c.status === 'supported') ? 'grounded' : 'partial';
}

function partialFailureText(failed: string[], used: string[]): string {
  const usedText = used.length > 0 ? `${used.join(' · ')} 데이터만` : '확인된 데이터만';
  return `${failed.join(' · ')} 데이터를 가져오지 못했습니다. 아래 분석은 ${usedText} 사용했습니다.`;
}

export interface BuildContext { id: string; now: string; snapshotId: string; company: AnalystTurn['company']; wacc: WaccPanelView | null; showWacc: boolean }

const groupClaims = (claims: GroundedClaim[]) => {
  const v = claims.map(claimView);
  return {
    keyFindings: v.filter((c) => c.type === 'fact' || c.type === 'calculation'),
    interpretation: v.filter((c) => c.type === 'interpretation'),
    considerations: v.filter((c) => c.type === 'risk' || c.type === 'recommendation'),
  };
};

export function buildWorkflowTurn(o: WorkflowOutcome, ctx: BuildContext, question: string): AnalystTurn {
  const a = o.answer;
  const stepViews: StepView[] = o.state.steps.map((s) => ({ id: s.id, label: s.purpose, tool: s.tool, status: s.status, reason: s.reason ?? null, optional: s.optional }));
  const failedSteps = o.state.steps.filter((s) => s.status === 'failed' && !o.state.steps.some((x) => sameFamily(x.tool, s.tool) && x.status === 'completed'));   // 같은 Tool 이 나중에 성공했다면 실패로 보이지 않는다
  const usedTools = [...new Set(o.state.toolsExecuted.filter((t) => t.status === 'ok').map((t) => t.tool))];
  const usedSources = usedTools.map(toolLabel);
  const warnings: WarningView[] = [];
  for (const w of a?.warnings ?? []) warnings.push({ kind: 'data', text: w });
  if (failedSteps.length > 0) warnings.push({ kind: 'partial-failure', text: partialFailureText([...new Set(failedSteps.map((s) => toolLabel(s.tool)))], usedSources) });
  for (const r of o.results) if ((r.status === 'no-data' || r.status === 'rate-limit') && r.tool.startsWith('search')) warnings.push({ kind: 'retrieval', text: `${toolLabel(r.tool)}: ${r.status === 'rate-limit' ? '호출 한도를 초과해 결과를 가져오지 못했습니다.' : '검색 결과가 없습니다.'}` });
  const evidence = (a?.evidenceMap ?? []);
  const timeBasis = timeBasisOf(evidence);
  if (timeBasis?.notice) warnings.push({ kind: 'time', text: timeBasis.notice });
  const reliabilitySeen = new Set<string>();
  for (const e of evidence) {
    const r = e.provider ? reliabilityOf(e.provider, e.sourceType) : null;
    if (r && !reliabilitySeen.has(e.sourceType)) { reliabilitySeen.add(e.sourceType); warnings.push({ kind: 'provider', text: `${BADGE_LABEL[badgeOf(e.sourceType, e.sourceKind, e.origin)]}: ${r.label} — ${r.note}` }); }
  }
  const unsupported = o.state.message === UNSUPPORTED_DISCLOSURE;
  if (unsupported) warnings.push({ kind: 'unsupported', text: STATUS_INFO.unsupported.detail });
  for (const l of a?.limitations ?? []) if (!warnings.some((w) => w.text === l)) warnings.push({ kind: 'data', text: l });

  let status: TurnStatus;
  if (o.error) status = o.error.code === 'cancelled' ? 'cancelled' : 'failed';
  else if (unsupported) status = 'unsupported';
  else if (o.state.status === 'tool-limit') status = 'tool-limit';
  else if (o.state.status === 'failed') status = 'failed';
  else if (o.state.status === 'waiting-for-user') status = 'waiting-for-review';
  else status = failedSteps.length > 0 || (a?.limitations.length ?? 0) > 0 ? 'completed-with-limitations' : 'completed';

  const claims = a?.claims ?? [];
  const g = o.audit.grounding;
  const grounding = a && a.grounding && !o.error && !unsupported && o.state.status !== 'failed' ? groundingStatusOf(claims, g?.fallbackUsed === true) : null;
  const sections: AnswerSections | null = a ? {
    summary: a.summary, ...groupClaims(claims), limitations: [...a.limitations], judgmentItems: [...a.judgmentItems], nextActions: [...a.suggestedNextActions], reviewedAreas: [...a.reviewedAreas],
    plainEvidence: [],
  } : null;
  const checkpoints: CheckpointView[] = o.state.checkpoints.map((c) => ({
    id: c.id, kind: c.kind, title: CHECKPOINT_TITLE[c.kind], target: /^[a-z]+[A-Z]\w*$/.test(c.target) ? humanField(c.target) : c.target, currentValue: c.currentValue, proposedValue: c.proposedValue, rationale: c.rationale,
    note: WACC_COMPONENT_KINDS.has(c.kind) ? 'WACC 의 구성요소에 대한 제안입니다. WACC 자체를 직접 바꾸는 제안이 아닙니다.' : c.kind === 'change-wacc-directly' ? 'WACC 값을 직접 바꾸는 제안입니다. 구성요소(Rf · Beta …)를 먼저 확인하세요.' : null,
    decision: 'pending',
  }));
  return {
    id: ctx.id, question, mode: 'workflow', askedAt: ctx.now, company: ctx.company, workflowType: o.plan.workflowType, workflowLabel: o.plan.label, contextSnapshotId: ctx.snapshotId,
    status, steps: stepViews, usedSources, answer: sections, evidence: evidence.map(evidenceView), sources: sourceViews(a?.sources ?? [], evidence), timeBasis, warnings, grounding, checkpoints,
    wacc: ctx.showWacc ? ctx.wacc : null, error: o.error ? errorView(o.error.code) : null,
    analysis: a && !o.error && !unsupported && a.grounding ? aiAnalysisFromWorkflow(a, { analysisId: ctx.id, question, workflowType: o.plan.workflowType, contextSnapshotId: o.state.contextSnapshotId, createdAt: ctx.now }) : null,
    debug: g ? {
      coverage: g.coverage, claims: g.totalClaims, supported: g.groundedClaims, unsupported: Math.max(0, g.totalClaims - g.groundedClaims), regenerated: g.regenerated, fallback: g.fallbackUsed,
      firstPassCoverage: g.firstPass.coverage, violations: [...g.violations], corrections: [...g.corrections], toolsExecuted: o.state.toolsExecuted.map((t) => ({ ...t })), groundingLevel: 'claim-evidence',
    } : null,
  };
}

export function buildQuickTurn(o: AiQueryOutcome, ctx: BuildContext, question: string): AnalystTurn {
  const a = o.answer;
  const executed = o.audit.toolsExecuted;
  const usedSources = [...new Set(executed.filter((t) => t.status === 'ok' || t.status === 'requested').map((t) => t.tool))].map(toolLabel);
  const failed = [...new Set(executed.filter((t) => t.status !== 'ok' && t.status !== 'requested' && t.status !== 'repeat-blocked' && t.status !== 'approval-required').map((t) => toolLabel(t.tool)))];
  const warnings: WarningView[] = (a?.warnings ?? []).map((w) => ({ kind: 'data', text: w }));
  if (failed.length > 0) warnings.push({ kind: 'partial-failure', text: partialFailureText(failed, usedSources) });
  const unsupported = o.results.some((r) => r.status === 'unsupported');
  if (unsupported) warnings.push({ kind: 'unsupported', text: STATUS_INFO.unsupported.detail });
  let status: TurnStatus;
  if (o.status === 'error') status = 'failed';
  else if (o.status === 'tool-limit') status = 'tool-limit';
  else if (unsupported) status = 'unsupported';
  else status = failed.length > 0 ? 'completed-with-limitations' : 'completed';
  const sources = sourceViews(a?.sources ?? [], []);
  for (const s of sources) if (s.reliability && !warnings.some((w) => w.text.startsWith(s.badgeLabel))) warnings.push({ kind: 'provider', text: `${s.badgeLabel}: ${s.reliability.label} — ${s.reliability.note}` });
  return {
    id: ctx.id, question, mode: 'quick', askedAt: ctx.now, company: ctx.company, workflowType: null, workflowLabel: null, contextSnapshotId: ctx.snapshotId,
    status, steps: [], usedSources, evidence: [], sources, timeBasis: null, warnings, grounding: null, checkpoints: [], wacc: ctx.showWacc ? ctx.wacc : null,
    answer: a ? { summary: a.summary, keyFindings: [], interpretation: [], considerations: [], limitations: [], judgmentItems: [], nextActions: [...a.suggestedNextActions], reviewedAreas: [], plainEvidence: a.evidence.map((e) => ({ label: e.label, value: e.value, period: e.period ?? null, tool: toolLabel(e.tool) })) } : null,
    error: o.error ? errorView(o.error.code) : null, analysis: null,
    debug: { coverage: null, claims: 0, supported: 0, unsupported: 0, regenerated: false, fallback: false, firstPassCoverage: null, violations: [...o.audit.violations], corrections: [...o.corrections], toolsExecuted: executed.map((t) => ({ ...t })), groundingLevel: 'tool-guardrails' },
  };
}

// ---- 준비 상태 · Empty state ----
export interface Notice { id: string; text: string; to?: string; action?: string }

export function readiness(input: { hasCompany: boolean; hasHistorical: boolean; hasValuation: boolean; unsupportedMessage: string | null; documentCount: number | null }): { canAsk: boolean; notices: Notice[] } {
  const notices: Notice[] = [];
  if (!input.hasCompany) notices.push({ id: 'no-company', text: '기업이 선택되지 않았습니다. Workspace 에서 기업을 선택하세요.', to: '/workspace', action: 'Workspace 로 이동' });
  else if (input.unsupportedMessage) notices.push({ id: 'unsupported', text: input.unsupportedMessage });
  else {
    if (!input.hasHistorical) notices.push({ id: 'no-historical', text: 'Workspace 에서 재무데이터를 먼저 불러오세요.', to: '/workspace', action: 'Workspace 로 이동' });
    if (!input.hasValuation) notices.push({ id: 'no-valuation', text: 'Valuation 을 실행한 뒤 Valuation 관련 질문을 하세요.', to: '/valuation', action: 'Valuation 으로 이동' });
  }
  if (input.documentCount === 0) notices.push({ id: 'no-pdf', text: '리서치 문서를 업로드하면 AI 분석에 포함됩니다.' });
  return { canAsk: input.hasCompany, notices };
}

/** 대표 질문 (입력창 아래 예시). */
export const EXAMPLE_QUESTIONS = ['최근 영업이익률을 분석해줘.', '현재 WACC 가정을 검토해줘.', '설비투자 확대 이유를 설명해줘.', '최근 실적과 시장 상황을 고려해서 valuation risk를 정리해줘.'];
