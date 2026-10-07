// 숫자 추출 · 허용 변환 매칭. 변환 규칙은 deterministic 이다 (LLM 의 임의 계산은 근거가 아니다).
// 허용: 비율 ↔ 퍼센트(0.131 → 13.1%), KRW 단위 환산(원 · KRW million · 억원 · 조원), 표시 반올림(문장에 적힌 소수 자릿수의 절반 이내), 같은 값의 표시 형식 변환.
import { isAmountUnit, normalizeDisplayUnit, toKrw, type DisplayUnit } from '../tools/display.ts';

export type NumUnit = 'jo' | 'eok' | 'man' | 'won' | 'pct' | 'pctp' | 'x' | 'shares' | 'plain';

export interface ParsedNumber {
  /** 문장에 적힌 그대로 */
  text: string;
  value: number;
  unit: NumUnit;
  /** 적힌 소수 자릿수 (반올림 허용 범위 계산) */
  decimals: number;
  start: number;
}

// 연도 · 날짜 · 분기 · 개수 · 만기(10Y) 같은 숫자는 근거 확인 대상이 아니다
const NOISE: RegExp[] = [
  /\b(?:19|20)\d{2}\s*[-./]\s*\d{1,2}(?:\s*[-./]\s*\d{1,2})?/g,
  /(?:19|20)\d{2}\s*년(?:\s*\d{1,2}\s*월)?(?:\s*\d{1,2}\s*일)?/g,
  /\d{1,2}\s*월(?:\s*\d{1,2}\s*일)?/g,
  /\b(?:19|20)\d{2}\s*[A-Za-z]\b/g,
  /\bFY\s*\d{2,4}\b/gi,
  /\b[Qq][1-4]\b|\d\s*분기/g,
  /\d+(?:\.\d+)?\s*(?:개|건|회|가지|단계|위|번|일간|일|명|곳|종|차)(?![가-힣])/g,
  /\b\d+\s*Y\b/g,
  /\b52\s*주|\d+\s*주\s*(?:간|전|후|차)/g,   // 52주 범위 · 4주 간 같은 기간 표현은 '주(shares)' 단위가 아니다
  /\bp\.\s*\d+\b/g,
  /(?<![\d,.])(?:19|20)\d{2}(?![\d,.]|\s*(?:%|원|억|조|배|주|명|달러|x\b))/g,   // 단위 없는 연도("2026 Semiconductor Outlook") — 단위가 붙은 값(2026원)은 제외
  /제\s*\d+\s*기/g,
];

const decimalsOf = (s: string) => (s.includes('.') ? s.length - s.indexOf('.') - 1 : 0);
const num = (s: string) => Number(s.replace(/,/g, ''));

export function parseNumbers(text: string): ParsedNumber[] {
  let t = text;
  for (const re of NOISE) t = t.replace(re, (m) => ' '.repeat(m.length));
  const out: ParsedNumber[] = [];
  const taken: [number, number][] = [];
  // 복합 금액(만 단위): "26만 8,500원" · "3억 5,000만원" → 원 단위 한 값으로 읽는다
  for (const m of t.matchAll(/(?<![A-Za-z_\d.,])(?:(\d[\d,]*)\s*억\s*)?(\d[\d,]*)\s*만\s*(\d[\d,]*)?\s*원/g)) {
    const krw = (m[1] ? num(m[1]) * 1e8 : 0) + num(m[2]) * 1e4 + (m[3] ? num(m[3]) : 0);
    out.push({ text: m[0].trim(), value: krw, unit: 'won', decimals: 0, start: m.index! });
    taken.push([m.index!, m.index! + m[0].length]);
  }
  // 복합 금액: "1,763조 1,222억원" · "52.7조원"
  for (const m of t.matchAll(/(?<![A-Za-z_])(\d[\d,]*(?:\.\d+)?)\s*조\s*(?:(\d[\d,]*(?:\.\d+)?)\s*억)?\s*원?/g)) {
    const jo = num(m[1]);
    out.push(m[2] !== undefined ? { text: m[0].trim(), value: jo * 1e4 + num(m[2]), unit: 'eok', decimals: Math.max(decimalsOf(m[2]), 0), start: m.index! } : { text: m[0].trim(), value: jo, unit: 'jo', decimals: decimalsOf(m[1]), start: m.index! });
    taken.push([m.index!, m.index! + m[0].length]);
  }
  for (const m of t.matchAll(/(?<![A-Za-z_\d.,])(\d[\d,]*(?:\.\d+)?)\s*(억\s*원|억|만\s*원|%\s*p(?![a-z])|%\s*포인트|%|퍼센트|배|원|주(?![가-힣])|x(?![A-Za-z]))?/g)) {
    const s = m.index!;
    if (taken.some(([a, b]) => s >= a && s < b)) continue;
    const unitRaw = (m[2] ?? '').replace(/\s+/g, '');
    const unit: NumUnit = unitRaw === '' ? 'plain' : unitRaw.startsWith('억') ? 'eok' : unitRaw.startsWith('만') ? 'man' : unitRaw === '%p' || unitRaw === '%포인트' ? 'pctp' : unitRaw === '%' || unitRaw === '퍼센트' ? 'pct' : unitRaw === '배' || unitRaw === 'x' ? 'x' : unitRaw === '주' ? 'shares' : 'won';
    const value = num(m[1]);
    if (!Number.isFinite(value)) continue;
    if (unit === 'plain' && Number.isInteger(value) && Math.abs(value) < 100) continue;   // 순번 · 개수 같은 작은 정수
    out.push({ text: m[0].trim(), value, unit, decimals: decimalsOf(m[1]), start: s });
  }
  return out.sort((a, b) => a.start - b.start);
}

const half = (p: ParsedNumber) => 0.5 * 10 ** -p.decimals * 1.0001;
const near = (p: ParsedNumber, b: number) => Math.abs(p.value - b) <= Math.max(half(p), Math.abs(p.value) * 0.003);

/** 평가용 값 v(단위를 모르는 Tool 값)가 문장의 숫자 p 와 같은 값인가: 허용 변환 후보를 모두 시도한다. */
export function matchesValue(p: ParsedNumber, v: number, evidenceUnit?: string | null): boolean {
  if (!Number.isFinite(v)) return false;
  const du = normalizeDisplayUnit(evidenceUnit);
  if (du !== 'unknown') return matchesKnownUnit(p, v, du);   // 단위를 아는 근거는 그 단위로만 환산한다 (우연한 값 일치를 줄인다)
  const cands: number[] = (() => {
    switch (p.unit) {
      case 'pct': case 'pctp': return [v * 100, v];                                  // 0.131 → 13.1%, 이미 percent 인 값
      case 'x': return [v];
      case 'jo': return [v / 1e12, v / 1e6, v / 1e4];                                // KRW · KRW million · 억원 → 조원
      case 'eok': return [v / 1e8, v / 100, v];                                      // KRW · KRW million · 억원 → 억원
      case 'man': return [v / 1e4, v * 100, v * 1e4];
      case 'won': return [v, v * 1e6, v * 1e8];
      case 'shares': return [v];
      default: return [v, v * 100, v / 100];                                         // 단위 없는 숫자: 값 그대로 또는 비율 표기
    }
  })();
  return cands.some((c) => near(p, c) || near(p, Math.abs(c)));
}

const CLAIM_KRW: Partial<Record<NumUnit, number>> = { jo: 1e12, eok: 1e8, man: 1e4, won: 1 };

/** 근거의 단위가 알려진 경우: 같은 종류(금액 · 비율 · 퍼센트 · 주식수 · 배수)끼리만 비교하고, 금액은 원화로 환산해서 비교한다 (display.ts 의 환산 규칙). */
function matchesKnownUnit(p: ParsedNumber, v: number, du: DisplayUnit): boolean {
  const claimKrw = CLAIM_KRW[p.unit];
  if (isAmountUnit(du)) {
    if (p.unit === 'plain') return near(p, v) || near(p, Math.abs(v));   // 단위 없이 적은 값은 근거의 표시 단위와 같은 값이어야 한다
    if (claimKrw === undefined) return false;
    const a = p.value * claimKrw, b = toKrw(v, du)!;
    return Math.abs(a - b) <= Math.max(half(p) * claimKrw, Math.abs(a) * 0.003) || Math.abs(a - Math.abs(b)) <= Math.max(half(p) * claimKrw, Math.abs(a) * 0.003);
  }
  if (du === 'ratio') return (p.unit === 'pct' || p.unit === 'pctp') ? near(p, v * 100) || near(p, Math.abs(v) * 100) : p.unit === 'plain' ? near(p, v) || near(p, v * 100) : false;
  if (du === 'percent') return (p.unit === 'pct' || p.unit === 'pctp' || p.unit === 'plain') && (near(p, v) || near(p, Math.abs(v)));
  if (du === 'shares') return (p.unit === 'shares' || p.unit === 'plain') && near(p, v);
  if (du === 'multiple') return (p.unit === 'x' || p.unit === 'plain') && near(p, v);
  return false;
}

/** 문서 · 뉴스 발췌에 적힌 숫자 d 와 문장의 숫자 p 가 같은가 (같은 단위 체계로 환산해서 비교). */
export function matchesDocNumber(p: ParsedNumber, d: ParsedNumber): boolean {
  const krw = (n: ParsedNumber): number | null => (n.unit === 'jo' ? n.value * 1e12 : n.unit === 'eok' ? n.value * 1e8 : n.unit === 'man' ? n.value * 1e4 : n.unit === 'won' ? n.value : null);
  const a = krw(p), b = krw(d);
  if (a !== null && b !== null) return Math.abs(a - b) <= Math.max(Math.abs(a) * 0.003, half(p) * (a / (p.value || 1)));
  if (p.unit === d.unit || (p.unit === 'plain' && d.unit === 'plain')) return near(p, d.value) || near(d, p.value);
  if ((p.unit === 'pct' || p.unit === 'pctp') && (d.unit === 'pct' || d.unit === 'pctp')) return near(p, d.value);
  return false;
}

/** 파생 수치: "2.5%에서 13.1%로 10.6%p 상승" 의 %p 는 같은 문장의 두 퍼센트의 차이다 (deterministic 계산, LLM 이 계산한 값이 아니다). */
export function isDerivedPointChange(p: ParsedNumber, others: ParsedNumber[]): boolean {
  const pcts = others.filter((o) => o.unit === 'pct');
  for (let i = 0; i < pcts.length; i++) for (let j = i + 1; j < pcts.length; j++) {
    const diff = Math.abs(pcts[j].value - pcts[i].value);
    if (Math.abs(diff - p.value) <= Math.max(half(p), 0.5 * 10 ** -Math.min(pcts[i].decimals, pcts[j].decimals) * 2.0001)) return true;
  }
  return false;
}
