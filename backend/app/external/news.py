"""뉴스 adapter: Google News RSS (API Key 없음, 개인 · 비상업 이용 조건의 비공식 feed). 제목 · 언론사 · 발행 시각 · 링크 · 짧은 요약만 얻고 기사 본문은 가져오지 않는다.
상업 서비스라면 네이버 뉴스 검색 API 나 뉴스 라이선스 provider 를 같은 NewsProvider Protocol 로 교체한다."""
from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from datetime import timezone
from email.utils import parsedate_to_datetime

import httpx

from app.external.cache import TTLCache
from app.external.errors import ProviderError
from app.external.providers import NewsItem

URL = "https://news.google.com/rss/search"
MAX_BYTES = 800_000
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
SNIPPET_CHARS = 300


def clean_text(s: str | None, limit: int = SNIPPET_CHARS) -> str | None:
    """HTML 태그 · 제어문자를 제거하고 길이를 제한한다 (외부 텍스트는 데이터이며, 가능한 한 가볍게 정리해서 전달한다)."""
    if not s:
        return None
    text = _WS.sub(" ", _TAG.sub(" ", html.unescape(s))).strip()
    text = "".join(ch for ch in text if ch >= " " or ch in "\n\t")
    return text[:limit] or None


class GoogleNews:
    name = "Google News"

    def __init__(self, client: httpx.Client | None = None, cache: TTLCache | None = None, ttl: float = 900, base_url: str = URL):
        self._http, self._cache, self._ttl, self._url = client or httpx.Client(timeout=15, headers={"User-Agent": "Mozilla/5.0 (ValuFlow)"}), cache or TTLCache(), ttl, base_url

    def search(self, query: str, days: int, limit: int) -> list[NewsItem]:
        q = f"{query} when:{days}d"

        def load() -> list[NewsItem]:
            try:
                res = self._http.get(self._url, params={"q": q, "hl": "ko", "gl": "KR", "ceid": "KR:ko"})
            except httpx.HTTPError:
                raise ProviderError("unavailable", "The news provider could not be reached.") from None
            if res.status_code == 429 or res.status_code == 503:
                raise ProviderError("rate-limit", "The news provider rate limit was reached. Try again later.")
            if res.status_code >= 400 or len(res.content) > MAX_BYTES:
                raise ProviderError("unavailable", "The news provider returned an error.")
            try:
                root = ET.fromstring(res.content)
            except ET.ParseError:
                raise ProviderError("unavailable", "The news provider returned an unreadable response.") from None
            items: list[NewsItem] = []
            seen: set[str] = set()
            for it in root.iter("item"):
                title, link, pub = clean_text(it.findtext("title"), 300), (it.findtext("link") or "").strip(), it.findtext("pubDate")
                publisher = clean_text(it.findtext("source"), 80)
                if not title or not link.startswith("http") or not pub or title in seen:
                    continue
                try:
                    when = parsedate_to_datetime(pub)
                except (TypeError, ValueError):
                    continue
                if publisher and title.endswith(f" - {publisher}"):
                    title = title[: -len(publisher) - 3]
                snippet = clean_text(it.findtext("description"))
                if snippet and snippet.startswith(title):   # RSS 요약은 보통 제목 + 언론사의 반복이다: 새 내용이 없으면 버린다
                    snippet = snippet[len(title):].lstrip(" -·\u00a0") or None
                elif snippet and title.startswith(snippet):
                    snippet = None
                if snippet and publisher and snippet == publisher:
                    snippet = None
                seen.add(title)
                items.append(NewsItem(title, publisher, (when if when.tzinfo else when.replace(tzinfo=timezone.utc)).astimezone(timezone.utc), link, snippet))
            items.sort(key=lambda n: n.published_at, reverse=True)
            return items
        return self._cache.get_or_load(f"news:{q}", self._ttl, load)[:limit]
