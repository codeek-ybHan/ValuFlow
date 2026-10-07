// Demo access key: 비용이 드는 · 쓰기 API(AI · 업로드 · Report PDF · 저장)를 열어 주는 값. 이 브라우저 탭(sessionStorage)에만 두고, 서버가 정한 값과 같을 때만 통한다.
// 실제 secret(OpenAI · OpenDART · DB)과는 별개이며 번들에 들어가지 않는다 (사용자가 직접 입력한다).
const STORAGE = 'valuflow:access';
export const ACCESS_HEADER = 'X-ValuFlow-Access';

export function getAccessKey(): string {
  try { return sessionStorage.getItem(STORAGE) ?? ''; } catch { return ''; }
}
export function setAccessKey(value: string): void {
  try { value.trim() === '' ? sessionStorage.removeItem(STORAGE) : sessionStorage.setItem(STORAGE, value.trim()); } catch { /* 저장소 접근 불가: 이번 요청부터는 다시 입력해야 한다 */ }
}
