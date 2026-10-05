import json
import re
from collections import defaultdict
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parent / "public" / "data"
DUMMY_CODES = {"9977", "9988", "9999"}
UNIT_ALIASES = {
    "kg": ("mass", 1),
    "kilogram": ("mass", 1),
    "kilograms": ("mass", 1),
    "quintal": ("mass", 100),
    "quintals": ("mass", 100),
    "qunital": ("mass", 100),
    "qunitals": ("mass", 100),
    "qtl": ("mass", 100),
    "tonne": ("mass", 1000),
    "tonnes": ("mass", 1000),
    "ton": ("mass", 1000),
    "tons": ("mass", 1000),
    "mt": ("mass", 1000),
    "sqm": ("area", 1),
    "m2": ("area", 1),
    "cum": ("volume", 1),
    "m3": ("volume", 1),
    "litre": ("litre", 1),
    "litres": ("litre", 1),
    "liter": ("litre", 1),
    "liters": ("litre", 1),
    "metre": ("length", 1),
    "metres": ("length", 1),
    "meter": ("length", 1),
    "meters": ("length", 1),
    "m": ("length", 1),
    "no": ("count", 1),
    "nos": ("count", 1),
    "each": ("count", 1),
    "hole": ("count", 1),
    "holes": ("count", 1),
    "tree": ("count", 1),
    "trees": ("count", 1),
    "item": ("count", 1),
    "items": ("count", 1),
    "piece": ("count", 1),
    "pieces": ("count", 1),
    "number": ("count", 1),
    "numbers": ("count", 1),
    "unit": ("count", 1),
    "units": ("count", 1),
}
UNIT_PATTERN = (
    r"holes?|trees?|items?|pieces?|numbers?|units?|qunitals?|quintals?|qtl|tonnes?|tons?|mt|kilograms?|kgs?|kg|"
    r"square\s*met(?:re|er)s?|sqm|m2|cubic\s*met(?:re|er)s?|cum|m3|"
    r"lit(?:re|er)s?|met(?:re|er)s?|nos?\.?|m|each"
)
NUMBER_PATTERN = r"(one|a|\d+(?:\.\d+)?)"


def normalize_code(value) -> str:
    return str(value or "").strip().upper()


def normalize_unit(value):
    unit = re.sub(r"[.\s]", "", str(value or "").lower())
    aliases = {
        "kilograms": "kilogram",
        "kgs": "kg",
        "qunital": "quintal",
        "qunitals": "quintal",
        "quintals": "quintal",
        "tons": "ton",
        "tonnes": "tonne",
        "squaremetre": "sqm",
        "squaremetres": "sqm",
        "squaremeter": "sqm",
        "squaremeters": "sqm",
        "cubicmetre": "cum",
        "cubicmetres": "cum",
        "cubicmeter": "cum",
        "cubicmeters": "cum",
        "litres": "litre",
        "liter": "litre",
        "liters": "litre",
        "metres": "metre",
        "meter": "metre",
        "meters": "metre",
        "m": "metre",
        "nos": "no",
        "hole": "each",
        "holes": "each",
        "number": "each",
        "numbers": "each",
        "unit": "each",
        "units": "each",
        "trees": "tree",
        "items": "item",
        "pieces": "piece",
    }
    return aliases.get(unit, unit)


def parse_formula_basis(description):
    text = str(description or "").strip()
    if "=" not in text:
        return None
    formula_rhs = text.rsplit("=", 1)[-1]
    formula_match = re.match(
        rf"\s*{NUMBER_PATTERN}\s*({UNIT_PATTERN})\b[.,;:)\-]*\s*$",
        formula_rhs,
        re.IGNORECASE,
    )
    if formula_match:
        quantity = 1.0 if formula_match.group(1).lower() in {"one", "a"} else float(formula_match.group(1))
        return quantity, normalize_unit(formula_match.group(2))
    return None


def parse_basis(description):
    text = str(description or "").strip()
    formula_basis = parse_formula_basis(text)
    if formula_basis:
        return formula_basis
    match = re.search(
        rf"(?:details?\s+of\s+cost|cost\s+(?:for|of))\s+{NUMBER_PATTERN}\s*({UNIT_PATTERN})\b",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None
    quantity = 1.0 if match.group(1).lower() in {"one", "a"} else float(match.group(1))
    return quantity, normalize_unit(match.group(2))


def parse_analysis_basis(rows, target_unit=None):
    opening_index = next(
        (
            index
            for index, row in enumerate(rows)
            if re.match(
                r"^(?:details?\s+of\s+cost|cost\s+(?:for|of))\b",
                str(row.get("description") or "").strip(),
                re.IGNORECASE,
            )
        ),
        None,
    )
    if opening_index is None:
        return None

    if target_unit:
        bottom_summary_bases = []
        for row in reversed(rows[opening_index + 1 :]):
            description = str(row.get("description") or "").strip()
            if not re.match(r"^cost\s+(?:for|of)\b", description, re.IGNORECASE):
                continue
            summary_basis = parse_basis(description)
            if summary_basis and convert_divisor(summary_basis, target_unit) is not None:
                bottom_summary_bases.append(summary_basis)
        non_unit_summary = next((basis for basis in bottom_summary_bases if basis[0] != 1), None)
        if non_unit_summary:
            return non_unit_summary
        if bottom_summary_bases:
            return bottom_summary_bases[0]

    opening_description = rows[opening_index].get("description")
    opening_formula = parse_formula_basis(opening_description)
    opening_basis = parse_basis(opening_description)
    if target_unit and opening_formula and convert_divisor(opening_formula, target_unit) is not None:
        return opening_formula
    if target_unit and opening_basis and convert_divisor(opening_basis, target_unit) is not None:
        return opening_basis

    introductory_formulas = []
    for row in rows[opening_index + 1 :]:
        description = str(row.get("description") or "").strip()
        if row.get("code") or re.match(r"^(?:materials?|labou?r|carriage|plant|tools?)\b", description, re.IGNORECASE):
            break
        formula_basis = parse_formula_basis(description)
        if formula_basis:
            if not target_unit or convert_divisor(formula_basis, target_unit) is not None:
                introductory_formulas.append(formula_basis)
            if target_unit and convert_divisor(formula_basis, target_unit) is not None:
                return formula_basis
    if target_unit:
        if UNIT_ALIASES.get(normalize_unit(target_unit), (None,))[0] == "count":
            return 1.0, normalize_unit(target_unit)
        return None
    if opening_basis:
        return opening_basis
    if opening_formula:
        return opening_formula
    if introductory_formulas:
        return introductory_formulas[0]
    if target_unit and UNIT_ALIASES.get(normalize_unit(target_unit), (None,))[0] == "count":
        return 1.0, normalize_unit(target_unit)
    return None


def convert_divisor(basis, target_unit):
    quantity, basis_unit = basis
    target = normalize_unit(target_unit)
    source_info = UNIT_ALIASES.get(basis_unit)
    target_info = UNIT_ALIASES.get(target)
    if not source_info or not target_info or source_info[0] != target_info[0]:
        return None
    return quantity * source_info[1] / target_info[1]


def parse_summary(description):
    text = str(description or "").strip()
    if text.lower() == "say":
        return "rate", None
    if re.match(r"^rate\s+per\b", text, re.IGNORECASE):
        return "rate", parse_basis(text.replace("Rate per", "Cost for", 1))
    if re.match(r"^cost\s+(?:for|of|per)\b", text, re.IGNORECASE):
        return "cost", parse_basis(text)
    return None, None


def numeric_amount(row):
    try:
        value = float(str(row.get("amount", "")).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def load_inputs():
    catalog = json.loads((DATA_DIR / "pure_dsr.json").read_text(encoding="utf-8"))
    analyses = json.loads((DATA_DIR / "rate_analysis_master.json").read_text(encoding="utf-8"))
    material_rows = json.loads((DATA_DIR / "basic_rates.json").read_text(encoding="utf-8"))
    return catalog, analyses, material_rows


def scan_zero_rates(catalog, analyses, material_rows):
    basic_rates = {}
    basic_descriptions = {}
    for row in material_rows:
        code = normalize_code(row.get("No."))
        if code:
            try:
                basic_rates[code] = float(str(row.get("Unnamed: 3", "")).replace(",", "").strip())
                basic_descriptions[code] = str(row.get("Unnamed: 1") or "").strip()
            except ValueError:
                continue

    items = [
        item
        for group in catalog.values()
        for item in group.get("items", [])
    ]
    parent_codes = set()
    for item in items:
        code = normalize_code(item.get("code"))
        parts = code.split(".")
        for end in range(1, len(parts)):
            parent_codes.add(".".join(parts[:end]))
        if re.match(r"^\d+", code):
            parent_codes.add(re.match(r"^\d+", code).group(0))

    zero_findings = {}
    for code, rate in basic_rates.items():
        description = basic_descriptions.get(code, "")
        if rate == 0 and code not in DUMMY_CODES and description:
            key = ("basic-rate", code, description)
            zero_findings[key] = (description, rate, "basic material-rate table")

    for item in items:
        code = normalize_code(item.get("code"))
        if not code or code in DUMMY_CODES or item.get("isMain") or code in parent_codes:
            continue
        try:
            rate = float(item.get("rate") or 0)
        except (TypeError, ValueError):
            rate = 0
        if rate == 0:
            zero_findings[("catalog", code, item.get("description", ""))] = (
                item.get("description", ""),
                rate,
                "DSR catalog item",
            )

    component_references = defaultdict(set)
    component_descriptions = {}
    for parent, entry in analyses.items():
        for row in entry.get("analysis", []):
            code = normalize_code(row.get("code"))
            if not code.isdigit() or code in DUMMY_CODES:
                continue
            component_references[code].add(parent)
            component_descriptions.setdefault(code, row.get("description", ""))
            try:
                rate = float(str(row.get("rate", "")).replace(",", "").strip() or 0)
            except ValueError:
                rate = 0
            mapped_rate = basic_rates.get(code, 0)
            effective_rate = mapped_rate if rate == 0 and mapped_rate > 0 else rate
            if effective_rate == 0:
                description = row.get("description") or basic_descriptions.get(code, "")
                key = ("component", code, description)
                previous = zero_findings.get(key)
                parents = set(previous[2].split(", ")) if previous else set()
                parents.add(parent)
                zero_findings[key] = (description, 0, ", ".join(sorted(parents)))

    print("\nZERO-RATE FINDINGS")
    if not zero_findings:
        print("None")
    for (source, code, _), (description, rate, references) in sorted(zero_findings.items()):
        print(f"[{source}] code={code} rate={rate:.2f} description={description!r} references={references}")
    return len(zero_findings)


def scan_unit_conversions(catalog, analyses):
    catalog_items = {
        normalize_code(item.get("code")): item
        for group in catalog.values()
        for item in group.get("items", [])
    }
    findings = []
    for code, entry in analyses.items():
        rows = entry.get("analysis", [])
        if not rows:
            continue
        item = catalog_items.get(normalize_code(code), {})
        target_unit = str(item.get("unit") or "").strip()
        if not target_unit:
            continue
        basis = parse_analysis_basis(rows, target_unit)
        if not basis:
            continue
        divisor = convert_divisor(basis, target_unit)
        if not divisor or divisor <= 1:
            continue

        base_total = None
        rate_per_unit = None
        for row in rows:
            kind, summary_basis = parse_summary(row.get("description"))
            amount = numeric_amount(row)
            if not kind or amount is None:
                continue
            if kind == "cost" and summary_basis == basis:
                base_total = amount
            elif kind == "rate" and (summary_basis is None or summary_basis[0] == 1 and summary_basis[1] == normalize_unit(target_unit)):
                rate_per_unit = amount
            elif kind == "cost" and summary_basis and summary_basis[0] == 1 and summary_basis[1] == normalize_unit(target_unit):
                rate_per_unit = amount

        if base_total is None:
            findings.append((code, rows[0].get("description"), target_unit, divisor, "missing base total for bulk basis"))
            continue
        expected = base_total / divisor
        if rate_per_unit is None:
            findings.append((code, rows[0].get("description"), target_unit, divisor, f"missing per-unit summary; expected about {expected:.2f}"))
        elif abs(rate_per_unit - expected) > max(0.05, expected * 0.001):
            findings.append((code, rows[0].get("description"), target_unit, divisor, f"per-unit amount {rate_per_unit:.2f}, expected about {expected:.2f}"))

    print("\nBULK-UNIT CONVERSION FINDINGS")
    if not findings:
        print("None")
    for code, basis, unit, divisor, issue in findings:
        print(f"item={code} basis={basis!r} target_unit={unit!r} divisor={divisor:g}: {issue}")
    return len(findings)


def main():
    catalog, analyses, material_rows = load_inputs()
    print(f"Scanning {sum(len(group.get('items', [])) for group in catalog.values())} catalog items and {len(analyses)} rate analyses.")
    zero_count = scan_zero_rates(catalog, analyses, material_rows)
    conversion_count = scan_unit_conversions(catalog, analyses)
    print(f"\nAudit complete: {zero_count} zero-rate findings; {conversion_count} bulk-unit conversion findings.")


if __name__ == "__main__":
    main()
