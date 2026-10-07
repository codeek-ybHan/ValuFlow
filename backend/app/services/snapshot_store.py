"""검증된 AI 분석과 Report snapshot 의 저장소. 저장 전에 한 번 더 정리한다: 문서 발췌(excerpt) 제거 · credential 포함 여부 검사 · 크기 제한."""
from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import AiAnalysisRun, ReportSnapshot

ID = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
CORP = re.compile(r"^\d{8}$")
MAX_ANALYSIS_BYTES = 600_000
MAX_REPORT_BYTES = 1_500_000
DROP_KEYS = {"excerpt", "rawResult", "toolResult", "raw"}   # 문서 발췌 · Tool 원문은 저장하지 않는다


class SnapshotError(Exception):
    def __init__(self, code: str, message: str, status: int = 422):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def scrub(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items() if k not in DROP_KEYS}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    return value


def _checked(payload: Any, limit: int, secrets: list[str]) -> Any:
    clean = scrub(payload)
    text = json.dumps(clean, ensure_ascii=False)
    if len(text.encode()) > limit:
        raise SnapshotError("payload-too-large", "저장할 데이터가 너무 큽니다.", 413)
    if any(s in text for s in secrets if len(s) >= 6):   # 방어선: credential 값이 섞여 있으면 저장하지 않는다
        raise SnapshotError("invalid-payload", "저장할 수 없는 값이 포함되어 있습니다.")
    return clean


class SnapshotStore:
    def __init__(self, factory: sessionmaker[Session], secrets: list[str] | None = None):
        self._f, self._secrets = factory, secrets or []

    # ── AI analysis
    def save_analysis(self, body: dict[str, Any]) -> dict[str, Any]:
        aid, snap = str(body.get("analysisId", "")), str(body.get("contextSnapshotId", ""))
        claims, evidence = body.get("claims"), body.get("evidence")
        if not ID.match(aid) or not snap or not isinstance(claims, list) or not isinstance(evidence, list) or body.get("groundingLevel") != "claim-evidence":
            raise SnapshotError("invalid-payload", "검증된 AI 분석 형식이 아닙니다.")
        corp = body.get("corpCode") if CORP.match(str(body.get("corpCode") or "")) else None
        payload = _checked({k: v for k, v in body.items() if k != "corpCode" and k != "companyName"}, MAX_ANALYSIS_BYTES, self._secrets)
        summary = {"claims": len(claims), "supported": sum(1 for c in claims if isinstance(c, dict) and c.get("status") == "supported"), "evidence": len(evidence)}
        row = AiAnalysisRun(id=aid, corp_code=corp, company_name=str(body.get("companyName") or "")[:200] or None, context_snapshot_id=snap[:32], workflow_type=str(body.get("workflowType", ""))[:48],
                            question=str(body.get("question", ""))[:2000], grounding_summary=summary, payload=payload)
        with self._f() as s:
            s.merge(row)
            s.commit()
            saved = s.get(AiAnalysisRun, aid)
            return {"id": aid, "createdAt": saved.created_at.isoformat() if saved else None, "groundingSummary": summary}

    def list_analyses(self, corp_code: str | None, limit: int) -> list[dict[str, Any]]:
        with self._f() as s:
            q = select(AiAnalysisRun).order_by(AiAnalysisRun.created_at.desc()).limit(limit)
            if corp_code:
                q = q.where(AiAnalysisRun.corp_code == corp_code)
            return [{"id": r.id, "corpCode": r.corp_code, "companyName": r.company_name, "contextSnapshotId": r.context_snapshot_id, "workflowType": r.workflow_type,
                     "question": r.question, "groundingSummary": r.grounding_summary, "createdAt": r.created_at.isoformat()} for r in s.scalars(q)]

    def get_analysis(self, analysis_id: str) -> dict[str, Any] | None:
        with self._f() as s:
            r = s.get(AiAnalysisRun, analysis_id)
            return None if r is None else {"id": r.id, "corpCode": r.corp_code, "companyName": r.company_name, "createdAt": r.created_at.isoformat(), "analysis": r.payload}

    # ── Report snapshot
    def save_report(self, body: dict[str, Any]) -> dict[str, Any]:
        model = body.get("model")
        meta = model.get("metadata") if isinstance(model, dict) else None
        rid = str(meta.get("reportId", "")) if isinstance(meta, dict) else ""
        snap = meta.get("snapshot") if isinstance(meta, dict) else None
        if not ID.match(rid) or not isinstance(snap, dict) or not snap.get("contextSnapshotId") or not isinstance(model.get("schemaVersion"), str):
            raise SnapshotError("invalid-payload", "Report snapshot 형식이 아닙니다.")
        clean = _checked(model, MAX_REPORT_BYTES, self._secrets)
        corp = (meta.get("company") or {}).get("corpCode")
        row = ReportSnapshot(report_id=rid, corp_code=corp if CORP.match(str(corp or "")) else None, company_name=str((meta.get("company") or {}).get("name") or "")[:200] or None,
                             context_snapshot_id=str(snap["contextSnapshotId"])[:32], schema_version=str(model["schemaVersion"])[:16], template_version=str(body.get("templateVersion") or "")[:32],
                             input_hash=str(snap.get("inputHash") or "")[:32] or None, model=clean)
        with self._f() as s:
            s.merge(row)
            s.commit()
            saved = s.get(ReportSnapshot, rid)
            return {"reportId": rid, "createdAt": saved.created_at.isoformat() if saved else None}

    def list_reports(self, corp_code: str | None, limit: int) -> list[dict[str, Any]]:
        with self._f() as s:
            q = select(ReportSnapshot).order_by(ReportSnapshot.created_at.desc()).limit(limit)
            if corp_code:
                q = q.where(ReportSnapshot.corp_code == corp_code)
            return [{"reportId": r.report_id, "corpCode": r.corp_code, "companyName": r.company_name, "contextSnapshotId": r.context_snapshot_id, "schemaVersion": r.schema_version,
                     "templateVersion": r.template_version, "createdAt": r.created_at.isoformat()} for r in s.scalars(q)]

    def get_report(self, report_id: str) -> dict[str, Any] | None:
        with self._f() as s:
            r = s.get(ReportSnapshot, report_id)
            return None if r is None else {"reportId": r.report_id, "templateVersion": r.template_version, "createdAt": r.created_at.isoformat(), "model": r.model}
