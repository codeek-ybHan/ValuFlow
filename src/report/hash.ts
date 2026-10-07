// snapshot · 입력 식별자용 해시 (FNV-1a). 같은 내용이면 같은 값이다 (보안 목적이 아니다).
export function hashOf(value: unknown): string {
  const s = JSON.stringify(value) ?? 'undefined';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
