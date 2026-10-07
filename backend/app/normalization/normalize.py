"""Raw(FinancialAccount[]) → HistoricalData + DataQuality. 프론트 TS normalizer(src/data/normalization)의 Python 구현.

TS 구현이 source of truth 다: 규칙은 `rules.json`(TS 에서 내보냄)을 읽고, 같은 입력에 같은 결과가 나오는지를
`tests/golden/*.json`(TS 결과)으로 검증한다. 순수 함수이며 입력을 바꾸지 않는다. missing 은 0 으로 바꾸지 않는다.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

from app.dart.models import FinancialAccount

TIER_ORDER = ["account-id", "exact-name", "alias", "weak"]
KRW_PER_UNIT = {"KRW": 1, "thousand": 1_000, "million": 1_000_000}
RELATIVE_OFFSET = {"당기": 0, "전기": 1, "전전기": 2}
SOURCE_LABEL_DEFAULT = "DART Annual Report"


@lru_cache(maxsize=1)
def load_rules() -> dict[str, Any]:
    return json.loads((Path(__file__).with_name("rules.json")).read_text(encoding="utf-8"))


def normalize_account_name(name: str) -> str:
    """공백 · 앞 번호(Ⅰ. 1.) 제거, 소문자."""
    return re.sub(r"\s+", "", re.sub(r"^[\sⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ0-9.]+", "", name)).lower()


def js_num(x: float | int) -> str:
    """JS 의 숫자 문자열화와 같은 형태 (정수면 소수점 없이)."""
    if isinstance(x, float) and x.is_integer():
        return str(int(x))
    return repr(x)


def to_krw_million(amount: float | int, unit: str) -> float:
    per = KRW_PER_UNIT.get(unit)
    if per is None:
        raise TypeError(f"unknown unit {unit}")
    return (float(amount) * per) / 1_000_000


def basis_code(basis: str) -> str:
    return "CFS" if basis == "Consolidated" else "OFS"


def other_basis(basis: str) -> str:
    return "Separate" if basis == "Consolidated" else "Consolidated"


def fiscal_year_label(year: int) -> str:
    return f"{year}A"


class _Row:
    """연도가 해석된 원본 행."""

    __slots__ = ("year", "account")

    def __init__(self, year: int, account: FinancialAccount):
        self.year = year
        self.account = account


def _raw_type(a: FinancialAccount) -> str:
    return a.raw_statement_type or a.statement_type


def _classify(rule: dict, a: FinancialAccount) -> tuple[str, str | None] | None:
    if a.statement_type not in rule["statements"]:
        return None
    if a.account_id and a.account_id in rule.get("excludeIds", []):
        return None
    if a.account_id and a.account_id in rule.get("ids", []):
        return ("account-id", None)
    n = normalize_account_name(a.account_name)
    if any(normalize_account_name(x) == n for x in rule.get("names", [])):
        return ("exact-name", None)
    if any(normalize_account_name(x) == n for x in rule.get("aliases", [])):
        return ("alias", None)
    for w in rule.get("weak", []):
        if (w.get("id") and a.account_id == w["id"]) or (w.get("name") and normalize_account_name(w["name"]) == n):
            return ("weak", w["note"])
    return None


def _classify_part(rule: dict, part: dict, a: FinancialAccount) -> str | None:
    if a.statement_type not in rule["statements"]:
        return None
    if a.account_id and a.account_id in part.get("ids", []):
        return "account-id"
    n = normalize_account_name(a.account_name)
    if any(normalize_account_name(x) == n for x in part.get("names", [])):
        return "exact-name"
    return None


_EMPTY = {"value": None, "ambiguous": False, "weak": False, "notes": [], "sources": [], "trace": None}


def _apply_rule(rule: dict, rows: list[_Row], year: int) -> dict:
    mine = [r.account for r in rows if r.year == year and r.account.amount is not None]

    def conv(a: FinancialAccount) -> float:
        v = to_krw_million(a.amount, "KRW")  # backend 의 Raw 금액은 항상 원 단위
        return abs(v) if rule.get("magnitude") else v

    if rule.get("kind") == "components":
        parts = rule.get("parts", [])
        picked: list[dict] = []
        used: list[FinancialAccount] = []
        for part in parts:
            cands = []
            for a in mine:
                if any(a is u for u in used):
                    continue
                t = _classify_part(rule, part, a)
                if t:
                    cands.append((a, t))
            if not cands:
                continue
            best = next(t for t in TIER_ORDER if any(c[1] == t for c in cands))
            top = [c for c in cands if c[1] == best]
            values = [conv(c[0]) for c in top]
            picked.append({"part": part, "account": top[0][0], "tier": best, "value": values[0], "conflict": any(v != values[0] for v in values)})
            used.append(top[0][0])
            if part.get("combined"):
                break
        if not picked:
            return dict(_EMPTY, notes=[], sources=[])
        notes: list[str] = []
        non_combined = [p for p in parts if not p.get("combined")]
        if rule.get("warnIfPartial") and not any(p["part"].get("combined") for p in picked) and len(picked) < len(non_combined):
            notes.append(f"{rule['label']} is partial: only {', '.join(p['account'].account_name for p in picked)} found")
        conflict = any(p["conflict"] for p in picked)
        if conflict:
            notes.append(f"{rule['label']}: multiple different values found for a component in {year}, first one used")
        total = 0
        for p in picked:
            total = total + p["value"]
        components = [{"accountName": p["account"].account_name, "accountId": p["account"].account_id or None, "value": p["value"], "matchType": p["tier"]} for p in picked]
        first = picked[0]["account"]
        return {
            "value": total, "ambiguous": conflict, "weak": False, "notes": notes, "sources": [p["account"].account_name for p in picked],
            "trace": {"value": total, "sourceAccountName": " + ".join(p["account"].account_name for p in picked), "sourceAccountId": None, "matchType": "sum", "rawStatementType": _raw_type(first), "components": components},
        }

    cands = []
    for a in mine:
        m = _classify(rule, a)
        if m:
            cands.append((a, m))
    if not cands:
        return dict(_EMPTY, notes=[], sources=[])
    best = next(t for t in TIER_ORDER if any(c[1][0] == t for c in cands))
    top = sorted((c for c in cands if c[1][0] == best), key=lambda c: rule["statements"].index(c[0].statement_type))
    values = [conv(c[0]) for c in top]
    conflict = any(v != values[0] for v in values)
    chosen = top[0]
    notes = []
    selection = None
    if best == "weak" and chosen[1][1]:
        notes.append(chosen[1][1])
    if conflict:
        notes.append(f"{rule['label']}: multiple different values found for {year}, first one used")
        selection = f"multiple different values ({', '.join(_raw_type(c[0]) for c in top)}); {_raw_type(chosen[0])} used"
    elif len(top) > 1:
        kinds = list(dict.fromkeys(_raw_type(c[0]) for c in top))
        selection = f"same value in {' and '.join(kinds)}; counted once, {_raw_type(chosen[0])} preferred"
    trace = {"value": values[0], "sourceAccountName": chosen[0].account_name, "sourceAccountId": chosen[0].account_id or None, "matchType": best, "rawStatementType": _raw_type(chosen[0])}
    if selection:
        trace["selection"] = selection
    return {"value": values[0], "ambiguous": conflict, "weak": best == "weak", "notes": notes, "sources": [chosen[0].account_name], "trace": trace}


def _build_for_basis(rules: list[dict], basis: str, resolved: list[_Row], years: list[int], source_label: str) -> dict:
    rows = [r for r in resolved if r.account.basis == basis]
    series: dict[str, list] = {}
    fields: dict[str, dict] = {}
    notes: list[str] = []
    trace: list[dict] = []
    for rule in rules:
        per = [_apply_rule(rule, rows, y) for y in years]
        series[rule["field"]] = [p["value"] for p in per]
        missing_years = [y for y, p in zip(years, per) if p["value"] is None]
        if len(missing_years) == len(years):
            status = "missing"
        elif missing_years:
            status = "partial"
        elif any(p["ambiguous"] or p["weak"] for p in per):
            status = "ambiguous"
        else:
            status = "available"
        types = [p["trace"]["matchType"] for p in per if p["trace"]]
        match_type = "sum" if "sum" in types else next((t for t in reversed(TIER_ORDER) if t in types), None)
        fq: dict[str, Any] = {"status": status, "source": source_label}
        if match_type:
            fq["matchType"] = match_type
        fq["missingYears"] = missing_years
        fq["sources"] = list(dict.fromkeys(s for p in per for s in p["sources"]))
        fields[rule["field"]] = fq
        for y, p in zip(years, per):
            if p["trace"]:
                trace.append({"canonicalField": rule["field"], "fiscalYear": y, "basis": basis_code(basis), **p["trace"]})
        for n in dict.fromkeys(n for p in per for n in p["notes"]):
            notes.append(n)
    return {"series": series, "fields": fields, "notes": notes, "trace": trace, "rows": [r.account for r in rows]}


def _run_checks(years: list[int], series: dict[str, list], cfg: dict) -> list[dict]:
    rel, abs_tol, jump = cfg["relTol"], cfg["absTol"], cfg["unitJump"]
    out: list[dict] = []

    def get(f: str, i: int):
        s = series.get(f)
        return s[i] if s is not None else None

    def within(a, b) -> bool:
        return abs(a - b) <= max(abs_tol, rel * max(abs(a), abs(b)))

    for i, year in enumerate(years):
        assets, liab, eq = get("totalAssets", i), get("totalLiabilities", i), get("totalEquity", i)
        if assets is not None and liab is not None and eq is not None:
            ok = within(assets, liab + eq)
            out.append({"name": "assets = liabilities + equity", "fiscalYear": year, "status": "pass" if ok else "warn",
                        "message": "ok" if ok else f"Assets ({js_num(assets)}) differ from Liabilities + Equity ({js_num(liab + eq)}) in {year}"})
        rev, cogs, gp = get("revenue", i), get("cogs", i), get("grossProfit", i)
        if rev is not None and cogs is not None and gp is not None:
            ok = within(gp, rev - cogs)
            out.append({"name": "gross profit = revenue - cogs", "fiscalYear": year, "status": "pass" if ok else "warn",
                        "message": "ok" if ok else f"Gross Profit ({js_num(gp)}) differs from Revenue - COGS ({js_num(rev - cogs)}) in {year}"})
        op = get("operatingProfit", i)
        if rev is not None and op is not None and rev != 0:
            margin = op / rev
            ok = abs(margin) <= 1
            out.append({"name": "operating margin in range", "fiscalYear": year, "status": "pass" if ok else "warn",
                        "message": "ok" if ok else f"Operating margin {margin * 100:.1f}% is outside ±100% in {year}"})
        for f in ["revenue", "totalAssets", "inventory", "accountsReceivable", "accountsPayable", "cash", "interestBearingDebt", "depreciationAmortization"]:
            v = get(f, i)
            if v is not None and v < 0:
                out.append({"name": "sign anomaly", "fiscalYear": year, "status": "warn", "message": f"Sign anomaly: {f} is negative in {year}"})
        ar, inv, ap = get("accountsReceivable", i), get("inventory", i), get("accountsPayable", i)
        if ar is not None and inv is not None and ap is not None:
            out.append({"name": "nwc computable", "fiscalYear": year, "status": "pass", "message": "NWC = AR + Inventory - AP"})
    for f in ["revenue", "totalAssets"]:
        for i in range(1, len(years)):
            a, b = get(f, i - 1), get(f, i)
            if a is not None and b is not None and a > 0 and b > 0 and (b / a >= jump or a / b >= jump):
                out.append({"name": "unit mismatch", "fiscalYear": years[i], "status": "warn",
                            "message": f"Possible unit mismatch: {f} changes by more than {jump}x between {years[i - 1]} and {years[i]}"})
    return out


def _detect_unsupported(rows: list[FinancialAccount], has_revenue: bool, has_op: bool, has_cogs_or_gp: bool, cfg: dict) -> dict | None:
    bs_ids = cfg["financialBsIds"]
    bs_names = [normalize_account_name(n) for n in cfg["financialBsNames"]]
    is_names = [normalize_account_name(n) for n in cfg["financialIsNames"]]
    bs_signal = any(a.statement_type == "BS" and ((a.account_id and a.account_id in bs_ids) or normalize_account_name(a.account_name) in bs_names) for a in rows)
    is_signal = (not has_revenue) and (not has_op) and any(a.statement_type == "IS" and normalize_account_name(a.account_name) in is_names for a in rows)
    if bs_signal or is_signal:
        return {"kind": "financial", "message": "금융업(은행 · 보험 · 증권) 재무제표 구조는 아직 지원하지 않습니다. 일반 기업용 계정 매핑으로 값을 만들지 않습니다."}
    if has_revenue and has_op and not has_cogs_or_gp:
        return {"kind": "expense-by-nature", "message": "비용을 성격별로 분류한 손익계산서(매출원가 · 매출총이익 없음)는 아직 지원하지 않습니다."}
    return None


def normalize_financials(
    accounts: Iterable[FinancialAccount],
    fiscal_years: Iterable[int],
    company: dict[str, str | None],
    fetched_at: str,
    preferred_basis: str = "Consolidated",
    allow_basis_fallback: bool = True,
    source: str = SOURCE_LABEL_DEFAULT,
) -> dict[str, Any]:
    cfg = load_rules()
    rules = cfg["rules"]
    required, optional = cfg["requiredFields"], cfg["optionalFields"]
    label_of = {r["field"]: r["label"] for r in rules}
    years = sorted(set(fiscal_years))
    requested = preferred_basis
    warnings: list[str] = []

    resolved: list[_Row] = []
    unresolved = 0
    for a in accounts:
        y = a.fiscal_year
        if y is None:
            unresolved += 1
        elif y in years:
            resolved.append(_Row(y, a))
    if unresolved:
        warnings.append(f"{unresolved} account row(s) skipped: fiscal year could not be determined")

    source_label = "OpenDART Financial Statement" if source == SOURCE_LABEL_DEFAULT else str(source)

    def ok(b: dict, f: str) -> bool:
        s = b["fields"].get(f, {}).get("status")
        return s in ("available", "ambiguous")

    def complete(b: dict) -> bool:
        return all(ok(b, f) for f in required)

    def coverage(b: dict) -> int:
        return sum(1 for f in required if ok(b, f))

    first = _build_for_basis(rules, requested, resolved, years, source_label)
    used, chosen = requested, first
    if not complete(first) and allow_basis_fallback:
        alt = _build_for_basis(rules, other_basis(requested), resolved, years, source_label)
        if complete(alt) or coverage(alt) > coverage(first):
            used, chosen = other_basis(requested), alt
    fallback = used != requested
    if fallback:
        warnings.append("Separate statements used because consolidated data unavailable" if used == "Separate" else "Consolidated statements used because separate data unavailable")
    warnings.extend(chosen["notes"])

    missing_required = [f for f in required if not ok(chosen, f)]
    for f in optional:
        q = chosen["fields"].get(f)
        if q and q["status"] == "missing":
            if f == "depreciationAmortization":
                warnings.append("D&A not available from current OpenDART financial statement source.")
            elif f != "leaseLiabilities":
                warnings.append(f"{label_of[f]} account not found")
        elif q and q["status"] == "partial":
            warnings.append(f"{label_of[f]} missing for {', '.join(str(y) for y in q['missingYears'])}")
    lease = chosen["fields"].get("leaseLiabilities")
    if lease and lease["status"] != "missing":
        warnings.append("Lease liabilities found but not included in interest-bearing debt (kept separately as leaseLiabilities).")
    if any(a.statement_type == "BS" and re.sub(r"\s+", "", a.account_name).startswith("금융업") for a in chosen["rows"]):
        warnings.append("Statements include financial-business (금융업) accounts; interest-bearing debt and working capital may include financial-segment items.")
    for f in missing_required:
        warnings.append(f"{label_of[f]} account not found or incomplete")

    checks = _run_checks(years, chosen["series"], cfg["checks"])
    for c in checks:
        if c["status"] == "warn":
            warnings.append(c["message"])

    quality = {"basisRequested": requested, "basisUsed": used, "basisFallback": fallback, "fields": chosen["fields"], "warnings": warnings, "trace": chosen["trace"], "checks": checks}
    if not years:
        return {"ok": False, "code": "incomplete", "reason": "fiscalYears 가 비어 있습니다.", "missingRequired": list(required), "quality": quality}

    def has(f: str) -> bool:
        return any(v is not None for v in chosen["series"].get(f, []))

    unsupported = _detect_unsupported(chosen["rows"], has("revenue"), has("operatingProfit"), has("cogs") or has("grossProfit"), cfg["industry"])
    if unsupported:
        warnings.append(f"Unsupported statement structure ({unsupported['kind']}): {unsupported['message']}")
        code = "unsupported-industry" if unsupported["kind"] == "financial" else "unsupported-structure"
        return {"ok": False, "code": code, "reason": unsupported["message"], "missingRequired": missing_required, "quality": quality}
    if missing_required:
        return {"ok": False, "code": "incomplete", "reason": f"필수 계정을 찾지 못했습니다: {', '.join(missing_required)}", "missingRequired": missing_required, "quality": quality}

    s = chosen["series"]
    opt = lambda f: {"value": s[f]} if ok(chosen, f) else None  # noqa: E731
    cash, debt, lease_o, da = opt("cash"), opt("interestBearingDebt"), opt("leaseLiabilities"), opt("depreciationAmortization")
    meta: dict[str, Any] = {"source": source}
    if company.get("corpCode") is not None:
        meta["corpCode"] = company["corpCode"]
    if company.get("stockCode") is not None:
        meta["stockCode"] = company["stockCode"]
    meta["fetchedAt"] = fetched_at
    bs: dict[str, Any] = {"accountsReceivable": s["accountsReceivable"], "inventory": s["inventory"], "accountsPayable": s["accountsPayable"]}
    if cash:
        bs["cash"] = cash["value"]
    if debt:
        bs["interestBearingDebt"] = debt["value"]
    if lease_o:
        bs["leaseLiabilities"] = lease_o["value"]
    bs.update({"totalAssets": s["totalAssets"], "totalLiabilities": s["totalLiabilities"], "totalEquity": s["totalEquity"]})
    cf: dict[str, Any] = {"cfo": s["cfo"], "ppeAcquisition": s["ppeAcquisition"], "intangibleAcquisition": s["intangibleAcquisition"]}
    if da:
        cf["depreciationAmortization"] = da["value"]
    data = {
        "meta": meta,
        "company": {"name": company["name"], "ticker": company.get("stockCode") or "", "basis": used, "currency": "KRW", "unit": "million", "period": [fiscal_year_label(y) for y in years]},
        "incomeStatement": {k: s[k] for k in ("revenue", "cogs", "grossProfit", "sga", "operatingProfit", "netIncome")},
        "balanceSheet": bs,
        "cashFlow": cf,
    }
    return {"ok": True, "data": data, "quality": quality}
