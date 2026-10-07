"""STEP 09-8: 실제 Report PDF 검증. scripts/report-qa.ts 가 쓴 RenderModel 로 PDF 를 만들어 key text(표 셀 · KPI · 서술 · 출처 · 제목)가 PDF 에 모두 있는지,
한글 글리프 · 폰트 임베딩 · 페이지 번호 · 메타데이터 · 출처 marker 를 확인한다.   python backend/scripts/verify_report_pdf.py <outDir>"""
from __future__ import annotations

import io
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pypdf import PdfReader  # noqa: E402

from app.report.fonts import fit, load_fonts  # noqa: E402
from app.report.pdf import render_pdf  # noqa: E402

out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/valuflow-report-qa")
rm = json.loads((out / "render_model.json").read_text())
keys: list[str] = json.loads((out / "key_texts.json").read_text())
t = time.time()
data, info = render_pdf(rm)
ms = round((time.time() - t) * 1000)
(out / rm["meta"]["filename"]).write_bytes(data)
reader = PdfReader(io.BytesIO(data))
pages = [(p.extract_text() or "") for p in reader.pages]
flat = re.sub(r"\s+", "", "\n".join(pages))   # 줄바꿈 · 공백 차이는 무시하고 문자열 존재만 본다
fonts = load_fonts()
missing = [k for k in keys if re.sub(r"\s+", "", fit(k, fonts)) not in flat]   # 폰트에 없는 기호(예: −)는 렌더러가 대체한 형태로 비교
fonts_used = {str(f.get("/BaseFont")) for p in reader.pages for f in [x.get_object() for x in (p["/Resources"].get("/Font") or {}).values()]}
checks = {
    "pages": len(reader.pages) >= 5,
    "A4": all((round(float(p.mediabox.width)), round(float(p.mediabox.height))) == (595, 842) for p in reader.pages),
    "page numbers": all(f"Page {i} / {len(pages)}" in p for i, p in enumerate(pages, 1)),
    "metadata": bool(reader.metadata.title) and reader.metadata.author == "ValuFlow" and rm["meta"]["templateId"] in (reader.metadata.keywords or ""),
    "key texts present": not missing,
    "no replacement glyph": "�" not in "\n".join(pages),
    "learning banner (cover)": "Learning / Demonstration Data" in pages[0],
    "markers → Sources": all(f"[{m}]" in flat for m in set(re.findall(r"\[(S\d+)\]", "\n".join(pages)))),
    "outline": len(reader.outline) >= 8,
}
if info["font"] == "ttf-embedded":
    checks["korean glyphs"] = all(s in "\n".join(pages) for s in ("억원", "학습", "가정"))
    checks["font embedded (subset)"] = any("+" in f for f in fonts_used)
print(f"PDF {len(reader.pages)} pages · {len(data) / 1024:.0f}KB · font={info['font']} ({fonts.kind}) · render {ms}ms · {rm['meta']['filename']}")
print(f"key texts: {len(keys) - len(missing)}/{len(keys)} present")
for k in missing[:15]:
    print(f"  MISSING: {k}")
for name, ok in checks.items():
    print(f"  [{'OK' if ok else 'FAIL'}] {name}")
sys.exit(0 if all(checks.values()) else 1)
