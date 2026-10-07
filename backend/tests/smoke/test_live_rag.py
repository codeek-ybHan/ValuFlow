"""실제 공시 RAG smoke test (DART_API_KEY + OPENAI_API_KEY + PostgreSQL 이 있을 때만; 없으면 skip).

삼성전자 최신 사업보고서를 실제로 ingestion 한 뒤 (1) 공시 검색만으로 답하는 질문, (2) 숫자 Tool(stub) + 공시 검색을 함께 쓰는 질문을 실제 LLM 으로 확인한다.
frontend Tool Runtime 은 TS 라서 getHistoricalAnalysis 는 삼성전자 golden 값의 stub 결과를 쓴다.
"""
import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from app.ai.gateway import AiGateway
from app.ai.provider import OpenAiProvider
from app.ai.runtime import make_retrieval_tools
from app.ai.state import derive_secret
from app.config import load_settings
from app.db.models import DisclosureChunk, DisclosureDocument
from scripts.eval_knowledge_retrieval import build_pdf
from app.dart.client import DartHttpClient
from app.dart.filings import DartDisclosureSource
from app.rag.embeddings import OpenAiEmbeddings
from app.rag.ingestion import DisclosureIngestionService
from app.rag.retrieval import DisclosureRetriever
from app.rag.store import DisclosureStore
from app.rag.rerank import build_reranker
from app.knowledge.service import KnowledgeService, parse_meta
from tests.smoke.test_live_ai import historical_result

settings = load_settings()
pytestmark = pytest.mark.skipif(not (settings.has_api_key and settings.has_ai), reason="DART_API_KEY / OPENAI_API_KEY 가 없어 실제 공시 RAG smoke test 를 건너뜁니다.")

SAMSUNG = "00126380"
CTX = {"company": {"corpCode": SAMSUNG, "name": "삼성전자", "stockCode": "005930"}, "support": {"status": "supported"},
       "dataKinds": {"historical": "actual", "assumptions": "none", "results": "none"}, "periods": ["2023A", "2024A", "2025A"], "availability": {"historical": True}}


@pytest.fixture(scope="module")
def runtime(request):
    pg_url = request.getfixturevalue("pg_url")
    engine = create_engine(pg_url)
    with engine.begin() as c:
        c.execute(text("TRUNCATE TABLE disclosure_chunks, disclosure_documents RESTART IDENTITY CASCADE"))
    sf = sessionmaker(bind=engine, expire_on_commit=False)
    embedder = OpenAiEmbeddings(settings.openai_api_key, settings.embedding_model, settings.openai_base_url)
    store = DisclosureStore(sf)
    report = DisclosureIngestionService(DartDisclosureSource(DartHttpClient(settings)), embedder, store).ingest(SAMSUNG, ["annual"], None, limit=1)
    assert report.failed == [] and (report.ingested or report.skipped), report
    # 실제 PDF 업로드: 같은 보고서의 '사업의 내용' 발췌를 PDF 로 만들어 올린다 (기업과 무관한 산업 문서처럼 corpCode 없이)
    with sf() as s:
        rows = s.execute(select(DisclosureChunk.section, DisclosureChunk.text).join(DisclosureDocument, DisclosureDocument.id == DisclosureChunk.document_id)
                         .where(DisclosureChunk.section.like("II. 사업의 내용%")).order_by(DisclosureChunk.chunk_index)).all()
    pages, cur = [], ""
    for sec, body in rows:
        for part in (sec + ". " + body).split("\n"):
            if cur and len(cur) + len(part) > 1500:
                pages.append(cur)
                cur = ""
            cur += " " + part
    pages.append(cur)
    up = KnowledgeService(embedder, store).upload_pdf(build_pdf(pages[:24]), "application/pdf", "outlook.pdf", parse_meta("2026 Semiconductor Outlook", None, None, "industry-report", 2026, "PwC Insight", None))
    assert up["document"]["chunkCount"] > 5
    reranker = build_reranker("cross-encoder", settings.reranker_model, "", settings.reranker_cache_dir or None)
    gateway = AiGateway(OpenAiProvider(settings.openai_api_key, settings.openai_model, settings.openai_base_url), derive_secret(settings.ai_state_secret, settings.openai_api_key),
                        backend_tools=make_retrieval_tools(DisclosureRetriever(sf, embedder, min_score=settings.retrieval_min_score, reranker=reranker)))
    yield gateway
    engine.dispose()


def drive(gateway: AiGateway, question: str):
    resp = gateway.query(question, CTX)
    frontend = []
    for _ in range(6):
        if resp["status"] != "tool-call":
            break
        frontend.append(resp["tool"])
        result = historical_result() if resp["tool"] == "getHistoricalAnalysis" else {"status": "unavailable", "tool": resp["tool"], "reason": "not available in this smoke test", "sources": [], "warnings": []}
        resp = gateway.tool_result(resp["state"], resp["callId"], result, resp["conversationId"])
    return frontend, resp


def test_capex_disclosure_question_uses_search_disclosures_with_real_report(runtime):
    frontend, resp = drive(runtime, "회사가 설비투자와 관련해 어떤 내용을 공시했어?")
    assert resp["status"] == "final", (frontend, resp)
    assert "searchDisclosures" in [t["tool"] for t in resp["toolTrace"]]
    docs = [r for r in resp["backendToolResults"] if r["tool"] == "searchDisclosures"]
    assert docs and docs[0]["status"] == "ok" and docs[0]["data"]["results"], docs
    first = docs[0]["data"]["results"][0]
    assert first["reportName"].startswith("사업보고서") and first["receiptNo"] and first["section"]
    src = docs[0]["sources"][0]
    assert (src["kind"], src["type"], src["origin"]) == ("document", "disclosure-document", "opendart") and src["receiptNo"] and src["filingDate"]
    # 최종 답변이 실제 보고서 metadata 를 출처로 포함한다
    answer_sources = [s for s in resp["answer"]["sources"] if s.get("receiptNo")]
    assert answer_sources and answer_sources[0]["reportName"].startswith("사업보고서"), resp["answer"]["sources"]
    assert not any(w in resp["answer"]["summary"] for w in ("매수", "매도"))


def test_margin_and_reason_question_combines_numeric_and_document_tools(runtime):
    frontend, resp = drive(runtime, "최근 영업이익률이 어떻게 변했고 회사는 주요 원인을 어떻게 설명하고 있어?")
    assert resp["status"] == "final", (frontend, resp)
    used = [t["tool"] for t in resp["toolTrace"]]
    assert "getHistoricalAnalysis" in used and "searchDisclosures" in used, used
    assert {t["runtime"] for t in resp["toolTrace"] if t["tool"] == "getHistoricalAnalysis"} == {"frontend"}
    assert {t["runtime"] for t in resp["toolTrace"] if t["tool"] == "searchDisclosures"} == {"backend"}


def test_uploaded_pdf_question_cites_title_and_page(runtime):
    frontend, resp = drive(runtime, "업로드한 문서에서 반도체 수요 전망과 관련된 내용을 찾아줘.")
    assert resp["status"] == "final", (frontend, resp)
    used = [t["tool"] for t in resp["toolTrace"]]
    assert any(n in used for n in ("searchUploadedDocuments", "searchKnowledge")), used
    res = [r for r in resp["backendToolResults"] if r["tool"] in ("searchUploadedDocuments", "searchKnowledge") and r["status"] == "ok"]
    assert res and res[0]["data"]["retrieval"]["reranked"] > 0 and res[0]["data"]["retrieval"]["reranker"], "reranker 가 실제로 쓰였다"
    ups = [r for r in res[0]["data"]["results"] if r["sourceType"] == "user-upload"]
    assert ups and ups[0]["pageNumber"] and ups[0]["title"] == "2026 Semiconductor Outlook" and ups[0]["rerankScore"] is not None and ups[0]["finalRank"] == 1
    answer_sources = [s for s in resp["answer"]["sources"] if s["type"] == "uploaded-document"]
    assert answer_sources and answer_sources[0]["title"] == "2026 Semiconductor Outlook" and answer_sources[0]["page"], resp["answer"]["sources"]


def test_margin_and_uploaded_outlook_combine_numeric_and_pdf_tools(runtime):
    frontend, resp = drive(runtime, "삼성전자 최근 영업이익률 변화와 업로드한 산업 전망을 같이 설명해줘.")
    assert resp["status"] == "final", (frontend, resp)
    used = [t["tool"] for t in resp["toolTrace"]]
    assert "getHistoricalAnalysis" in used and any(n in used for n in ("searchUploadedDocuments", "searchKnowledge")), used
