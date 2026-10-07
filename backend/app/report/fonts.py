"""PDF 한글 폰트 전략. 저장소에 폰트 파일을 포함하지 않는다.

탐색 순서
 1. 환경변수 REPORT_FONT_REGULAR (+ 선택: REPORT_FONT_BOLD) 가 가리키는 TTF — 배포 환경에서 명시적으로 지정하는 방법
 2. OS 표준 경로의 한글 TTF: Linux(Nanum Gothic · Noto Sans KR TTF) · macOS(AppleGothic · Arial Unicode) · Windows(Malgun Gothic)
 3. 못 찾으면 reportlab 내장 CID 폰트(HYSMyeongJo-Medium)로 대체한다. 폰트를 PDF 에 포함하지 않으므로 PDF 뷰어가 CJK 폰트를 가지고 있어야 하고, 응답 헤더 X-Report-Font: cid-fallback 으로 알린다.

TTF 는 사용한 글리프만 서브셋으로 PDF 에 임베드한다(뷰어 환경과 무관하게 한글이 보인다).
권장 배포: Debian/Ubuntu `apt-get install fonts-nanum`, 또는 REPORT_FONT_REGULAR 에 라이선스가 허용된 TTF 경로를 지정.
Noto Sans CJK 의 OTF/TTC(CFF 윤곽)는 reportlab 이 임베드할 수 없어 쓰지 않는다 (Noto Sans KR 의 TrueType 버전을 쓴다).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont

CANDIDATES: list[tuple[str, str | None]] = [
    ("/usr/share/fonts/truetype/nanum/NanumGothic.ttf", "/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf"),
    ("/usr/share/fonts/nanum/NanumGothic.ttf", "/usr/share/fonts/nanum/NanumGothicBold.ttf"),
    ("/usr/share/fonts/truetype/noto/NotoSansKR-Regular.ttf", "/usr/share/fonts/truetype/noto/NotoSansKR-Bold.ttf"),
    ("/usr/share/fonts/opentype/noto/NotoSansKR-Regular.ttf", None),
    ("C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/malgunbd.ttf"),
    ("/System/Library/Fonts/Supplemental/AppleGothic.ttf", None),
    ("/Library/Fonts/Arial Unicode.ttf", None),
]

# 글꼴에 없는 기호를 대체할 문자 (예: AppleGothic 에는 U+2212 가 없다)
SUBSTITUTES = {"−": "-", "–": "-", "→": "->", "×": "x", "·": "·", "●": "*", "✓": "v"}


@dataclass(frozen=True)
class FontSet:
    regular: str
    bold: str
    kind: str  # "ttf-embedded" | "cid-fallback"
    source: str  # 파일 경로 또는 CID 이름 (로그 · 헤더용, 경로는 노출하지 않는다)
    glyphs: frozenset[int] | None  # TTF 가 가진 코드포인트 (None 이면 확인 불가)


_cache: FontSet | None = None


def _try(regular: str, bold: str | None) -> FontSet | None:
    if not Path(regular).is_file():
        return None
    try:
        reg = TTFont("ReportRegular", regular)
        pdfmetrics.registerFont(reg)
        bold_name = "ReportRegular"
        if bold and Path(bold).is_file():
            pdfmetrics.registerFont(TTFont("ReportBold", bold))
            bold_name = "ReportBold"
        return FontSet("ReportRegular", bold_name, "ttf-embedded", Path(regular).name, frozenset(reg.face.charToGlyph.keys()))
    except Exception:  # noqa: BLE001  (손상 · 지원하지 않는 형식이면 다음 후보)
        return None


def load_fonts(refresh: bool = False) -> FontSet:
    global _cache
    if _cache is not None and not refresh:
        return _cache
    env_reg = os.environ.get("REPORT_FONT_REGULAR", "").strip()
    found = _try(env_reg, os.environ.get("REPORT_FONT_BOLD", "").strip() or None) if env_reg else None
    for reg, bold in CANDIDATES:
        if found:
            break
        found = _try(reg, bold)
    if not found:
        pdfmetrics.registerFont(UnicodeCIDFont("HYSMyeongJo-Medium"))
        found = FontSet("HYSMyeongJo-Medium", "HYSMyeongJo-Medium", "cid-fallback", "HYSMyeongJo-Medium", None)
    _cache = found
    return found


def fit(text: str, fonts: FontSet) -> str:
    """폰트에 없는 문자를 대체한다 (없으면 '?'로 바꿔 깨진 사각형이 나오지 않게 한다)."""
    if fonts.glyphs is None:
        return text
    out = []
    for ch in text:
        if ord(ch) in fonts.glyphs or ch in "\n\t ":
            out.append(ch)
        else:
            out.append(SUBSTITUTES.get(ch, "?"))
    return "".join(out)
