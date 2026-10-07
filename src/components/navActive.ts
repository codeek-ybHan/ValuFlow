/**
 * 사이드바의 Valuation / Analysis 활성 표시. Analysis 는 별도 페이지가 아니라 Valuation 의 Validation 단계로 연결되므로
 * 두 메뉴가 동시에 강조되지 않도록 경로로 구분한다.
 */
export function navActive(pathname: string): { valuation: boolean; analysis: boolean } {
  const analysis = pathname === '/valuation/validation' || pathname.startsWith('/analysis');
  return { analysis, valuation: pathname.startsWith('/valuation') && !analysis };
}
