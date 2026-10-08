// backend 호출의 공통 fetch: 배포 환경의 API 주소(VITE_API_BASE_URL, 비밀이 아닌 공개 주소). 모든 client 의 기본 fetch 가 이것을 쓴다.
// 방문자 기능에는 access key 가 필요 없다 (비용이 드는 기능은 서버의 IP rate limit 이 보호한다). 관리자 API(저장/조회)는 브라우저가 아니라 운영자가 직접 호출한다 — 번들에 token 이 없다.

type Init = { method?: string; headers?: Record<string, string>; body?: unknown };

/** 빌드 때 정해지는 API 주소. 비어 있으면 같은 origin(개발 proxy / 같은 도메인 배포)을 쓴다. */
export function apiBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return (env?.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
}

export function apiFetch(input: string, init: Init = {}): Promise<Response> {
  return fetch(input.startsWith('/') ? `${apiBase()}${input}` : input, { ...init, headers: { ...(init.headers ?? {}) } } as RequestInit);
}
