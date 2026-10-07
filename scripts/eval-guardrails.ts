// STEP 08-8: 오프라인 Guardrail 스위트를 실행해 Guardrail Matrix(markdown)를 출력한다.   node scripts/eval-guardrails.ts
import { readFileSync } from 'node:fs';
import { runGuardrails } from '../src/ai/eval/guardrails.ts';

const golden = JSON.parse(readFileSync(new URL('../backend/tests/golden/samsung.json', import.meta.url), 'utf8')).expected;
const results = await runGuardrails({ golden });
console.log('| ID | Risk | Guardrail | Test (악의적 · 오류 입력) | 결과 | 관찰 |\n|---|---|---|---|---|---|');
for (const r of results) console.log(`| ${r.id} | ${r.risk} | ${r.guardrail} | ${r.test} | ${r.pass ? 'PASS' : '**FAIL**'} | ${r.detail} |`);
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} PASS`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
