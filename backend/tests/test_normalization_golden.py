"""TS normalizer(source of truth)와 Python normalizer 가 같은 입력에서 같은 결과를 내는지 검증한다 (golden)."""
import json
from pathlib import Path

import pytest

from app.dart.models import FinancialAccount
from app.normalization.normalize import normalize_financials

ROOT = Path(__file__).resolve().parents[2]
GOLDEN = sorted((Path(__file__).parent / "golden").glob("*.json"))


def to_accounts(rows: list[dict]) -> list[FinancialAccount]:
    return [FinancialAccount(
        account_name=r["accountName"], account_id=r.get("accountId"), statement_type=r["statementType"],
        raw_statement_type=r.get("rawStatementType") or r["statementType"], basis=r["basis"],
        fiscal_year=r.get("fiscalYear"), report_year=r.get("reportYear") or 0, amount=r.get("amount"), currency=r.get("currency"), raw=r.get("raw") or {},
    ) for r in rows]


def accounts_for(case: dict) -> list[dict]:
    if case.get("accounts") is not None:
        return case["accounts"]
    return json.loads((ROOT / case["inputFile"]).read_text(encoding="utf-8"))["accounts"]


def relative_periods(rows: list[dict]) -> list[dict]:
    """상대 기간(당기/전기/전전기)만 있는 입력은 backend 단계에서 연도로 해석된 뒤 정규화에 들어간다."""
    offset = {"당기": 0, "전기": 1, "전전기": 2}
    out = []
    for r in rows:
        if r.get("fiscalYear") is None and r.get("periodLabel") and r.get("reportYear") is not None:
            r = {**r, "fiscalYear": r["reportYear"] - offset[r["periodLabel"].replace(" ", "")]}
        out.append(r)
    return out


@pytest.mark.parametrize("path", GOLDEN, ids=[p.stem for p in GOLDEN])
def test_python_matches_ts(path):
    case = json.loads(path.read_text(encoding="utf-8"))
    opts = case["options"]
    result = normalize_financials(
        to_accounts(relative_periods(accounts_for(case))), opts["fiscalYears"],
        {"name": opts["company"]["name"], "corpCode": opts["company"].get("corpCode"), "stockCode": opts["company"].get("stockCode")},
        opts["fetchedAt"], preferred_basis=opts.get("preferredBasis", "Consolidated"), allow_basis_fallback=opts.get("allowBasisFallback", True),
        source=opts.get("source", "DART Annual Report"),
    )
    expected = case["expected"]
    assert result["ok"] == expected["ok"]
    assert result["quality"]["warnings"] == expected["quality"]["warnings"]
    assert result["quality"]["fields"] == expected["quality"]["fields"]
    assert result["quality"]["trace"] == expected["quality"]["trace"]
    assert result["quality"]["checks"] == expected["quality"]["checks"]
    assert {k: result["quality"][k] for k in ("basisRequested", "basisUsed", "basisFallback")} == {k: expected["quality"][k] for k in ("basisRequested", "basisUsed", "basisFallback")}
    if expected["ok"]:
        assert result["data"] == expected["data"]
    else:
        assert result["code"] == expected["code"]
        assert result["reason"] == expected["reason"]
        assert result["missingRequired"] == expected["missingRequired"]
