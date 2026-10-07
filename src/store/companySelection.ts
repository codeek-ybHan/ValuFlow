// 기업 선택 흐름과 출처 표시의 순수 로직 (React 비의존). 화면은 이 결과를 그대로 렌더링한다.
import type { HistoricalData, SelectedCompany } from '../data/types.ts';
import type { CompanyProfile, FinancialRepository } from '../data/repository/financialRepository.ts';
import { DartClientError } from '../data/dart/client.ts';

export type SelectCompanyResult = { ok: true; company: SelectedCompany } | { ok: false; message: string };

/** 검색 결과에서 [선택] 한 기업의 개황을 repository 로 조회해 SelectedCompany 로 만든다. 재무데이터는 요청하지 않는다. */
export async function selectCompany(repo: FinancialRepository, profile: CompanyProfile): Promise<SelectCompanyResult> {
  if (!profile.corpCode) return { ok: false, message: 'corpCode 가 없어 기업개황을 조회할 수 없습니다.' };
  try {
    const detail = await repo.getCompany({ corpCode: profile.corpCode });
    if (!detail || !detail.corpCode || !detail.fetchedAt) return { ok: false, message: '기업개황을 찾지 못했습니다.' };
    return {
      ok: true,
      company: {
        corpCode: detail.corpCode, corpName: detail.name, corpNameEng: detail.nameEng ?? null, stockCode: detail.stockCode ?? null,
        corpClass: detail.corpClass ?? null, source: 'OpenDART', fetchedAt: detail.fetchedAt,
      },
    };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

/** 사용자에게 보여 줄 오류 문구. 알 수 없는 오류의 내부 내용은 노출하지 않는다. */
export function errorMessage(e: unknown): string {
  return e instanceof DartClientError ? e.message : '요청을 처리하지 못했습니다.';
}

const CORP_CLASS: Record<string, string> = { Y: '유가증권', K: '코스닥', N: '코넥스', E: '기타' };

export interface SourceLine { label: string; value: string }

/** 선택한 기업의 표시 항목. Source 는 OpenDART 이며 조회 시각을 함께 보여 준다. */
export function companyView(c: SelectedCompany): { title: string; lines: SourceLine[] } {
  return {
    title: c.corpName,
    lines: [
      ...(c.corpNameEng ? [{ label: 'English Name', value: c.corpNameEng }] : []),
      { label: 'Stock Code', value: c.stockCode ?? '비상장' },
      { label: 'Corp Code', value: c.corpCode },
      ...(c.corpClass ? [{ label: 'Market', value: CORP_CLASS[c.corpClass] ?? c.corpClass }] : []),
      { label: 'Source', value: 'OpenDART' },
      { label: 'Fetched at', value: c.fetchedAt },
    ],
  };
}

/** Historical 재무데이터의 출처 표시. 메타가 없거나 Fixture 면 학습용이다. 실제 공시처럼 보이지 않게 구분한다. */
export function historicalSourceView(h: HistoricalData): { source: 'Fixture' | 'OpenDART' | 'Database'; label: string; fetchedAt: string | null } {
  const s = h.meta?.source;
  if (s === 'DART Annual Report') return { source: 'OpenDART', label: 'OpenDART (사업보고서)', fetchedAt: h.meta?.fetchedAt ?? null };
  if (s === 'Database') return { source: 'Database', label: 'Database', fetchedAt: h.meta?.fetchedAt ?? null };
  return { source: 'Fixture', label: 'Fixture (학습용)', fetchedAt: h.meta?.fetchedAt ?? null };
}
