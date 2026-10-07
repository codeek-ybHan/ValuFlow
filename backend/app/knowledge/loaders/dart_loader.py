"""OpenDART Loader: 공시 본문(XML) → NormalizedDocument. 목록(Filing)의 metadata 를 함께 붙인다."""
from __future__ import annotations

from app.dart.documents import parse_document_xml
from app.dart.filings import Filing
from app.knowledge.document import NormalizedDocument, SOURCE_OPENDART


def load_dart_document(filing: Filing, xml_bytes: bytes, company_name: str | None = None) -> NormalizedDocument:
    parsed = parse_document_xml(xml_bytes)
    return NormalizedDocument(
        document_id=filing.receipt_no, title=filing.report_name, source_type=SOURCE_OPENDART, sections=parsed.sections,
        corp_code=filing.corp_code, corp_name=filing.corp_name or company_name, document_type=filing.report_type, business_year=filing.business_year,
        filing_date=filing.filing_date, source_name="OpenDART", metadata={"receiptNo": filing.receipt_no, "isCorrection": filing.is_correction, "url": filing.url})
