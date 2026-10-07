// backend 호출의 공통 fetch: (1) 배포 환경의 API 주소(VITE_API_BASE_URL, 비밀이 아닌 공개 주소) (2) demo access key 헤더. 모든 client 의 기본 fetch 가 이것을 쓴다.
import { ACCESS_HEADER, getAccessKey } from './access.ts';

type Init = { method?: string; headers?: Record<string, string>; body?: unknown };

/** 빌드 때 정해지는 API 주소. 비어 있으면 같은 origin(개발 proxy / 같은 도메인 배포)을 쓴다. */
export function apiBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return (env?.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
}

export function apiFetch(input: string, init: Init = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  const key = getAccessKey();
  if (key !== '' && input.startsWith('/api/')) headers[ACCESS_HEADER] = key;
  return fetch(input.startsWith('/') ? `${apiBase()}${input}` : input, { ...init, headers } as RequestInit);
}
