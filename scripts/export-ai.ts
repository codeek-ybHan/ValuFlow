// AI Tool 카탈로그 / system instruction 의 source of truth 는 TS(src/ai)다. backend 는 여기서 내보낸 파일을 읽어
// 모델에 노출할 Tool 이름 · schema 를 스스로 검증한다 (frontend 가 보낸 schema 를 믿지 않는다).
//   node scripts/export-ai.ts  → backend/app/ai/tool_catalog.json
import { writeFileSync, mkdirSync } from 'node:fs';
import { TOOL_CATALOG } from '../src/ai/tools/definitions.ts';
import { TOOL_CALLING_INSTRUCTIONS, buildSystemInstruction, UNSUPPORTED_DISCLOSURE } from '../src/ai/policy.ts';

export const aiCatalogJson = () => JSON.stringify({
  tools: TOOL_CATALOG.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, allowedWhenUnsupported: t.allowedWhenUnsupported, execution: t.execution })),
  systemInstruction: `${buildSystemInstruction()}\n\n${TOOL_CALLING_INSTRUCTIONS}`,
  unsupportedDisclosure: UNSUPPORTED_DISCLOSURE,
}, null, 1) + '\n';

const root = new URL('..', import.meta.url).pathname;
if (process.argv[1] && process.argv[1].endsWith('export-ai.ts')) {
  mkdirSync(`${root}backend/app/ai`, { recursive: true });
  writeFileSync(`${root}backend/app/ai/tool_catalog.json`, aiCatalogJson());
  console.log('exported');
}
