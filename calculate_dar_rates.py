"""Calculate and validate DAR unit rates against the DSR ``Say`` rates."""

from __future__ import annotations

import ast
import math
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

import pandas as pd


WORKBOOK_PATH = Path(__file__).resolve().with_name("dsr_2023_master.xlsx")
OUTPUT_PATH = Path(__file__).resolve().with_name("dar_rate_validation_marker_aware.csv")
DSR_SHEET_NAME = "DSR Vol 1 and II"

ITEM_CODE_RE = re.compile(r"^\d+(?:\.[A-Za-z0-9()]+)+$")
NUMBER_RE = r"((?:\d[\d,]*(?:\.\d+)?)|one|a)"
UNIT_RE = (
    r"(sqm|cudm|dm3|cum|nos?\.?|kg|mt|m|length|met(?:re|er)s?|"
    r"each|trees?|holes?|items?|pieces?|qunitals?|quintals?|qtl|tonnes?)"
)
COST_SUMMARY_RE = re.compile(
    rf"\bcost\s+(?:for|of)\s*{NUMBER_RE}\s*{UNIT_RE}\b",
    re.IGNORECASE,
)
PERCENT_OF_MARK_RE = re.compile(
    r"(\d+(?:\.\d+)?)\s*(?:%|percent(?:age)?s?)\s*of\s*([PWARXYZ])\b(?!\s*\.\s*[A-Za-z])",
    re.IGNORECASE,
)
ADD_PERCENT_RE = re.compile(
    r"\badd\s+(\d+(?:\.\d+)?)\s*(?:%|per\s*cent|percent(?:age)?s?)\b",
    re.IGNORECASE,
)
MARK_EXPRESSION_RE = re.compile(
    r"\bon\s*[\"']?\s*([PWARXYZ](?:\s*[-+*/]\s*[PWARXYZ])*)\b",
    re.IGNORECASE,
)
MULTIPLYING_FACTOR_RE = re.compile(
    r"multiplying\s+factor\s*([0-9]+(?:\.[0-9]+)?)", re.IGNORECASE
)


def cell_text(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    return str(value).strip()


def normalize_code(value: Any) -> str:
    code = cell_text(value).replace(" ", "")
    if code.endswith(".0") and code[:-2].isdigit():
        code = code[:-2]
    return code


def parse_amount(value: Any) -> float | None:
    if value is None or pd.isna(value):
        return None
    try:
        amount = float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return amount if math.isfinite(amount) else None


def normalize_unit(value: str) -> str:
    unit = re.sub(r"[.\s]", "", value.casefold())
    aliases = {
        "m": "metre",
        "dm3": "cudm",
        "cubicdecimetre": "cudm",
        "cubicdecimetres": "cudm",
        "cubicdecimeter": "cudm",
        "cubicdecimeters": "cudm",
        "qunital": "quintal",
        "qunitals": "quintal",
        "meter": "metre",
        "meters": "metre",
        "metres": "metre",
        "length": "metre",
        "no": "each",
        "nos": "each",
        "tree": "each",
        "trees": "each",
        "hole": "each",
        "holes": "each",
        "item": "each",
        "items": "each",
        "piece": "each",
        "pieces": "each",
        "qtl": "quintal",
        "quintals": "quintal",
        "ton": "tonne",
        "tons": "tonne",
        "tonnes": "tonne",
        "mt": "tonne",
    }
    return aliases.get(unit, unit)


def unit_conversion_factor(from_unit: str, to_unit: str) -> float | None:
    units = {
        "cum": ("volume", 1.0),
        "cudm": ("volume", 0.001),
    }
    source = units.get(normalize_unit(from_unit))
    target = units.get(normalize_unit(to_unit))
    if source and target and source[0] == target[0]:
        return source[1] / target[1]
    return 1.0 if normalize_unit(from_unit) == normalize_unit(to_unit) else None


def extract_mark_expression(description: str) -> str | None:
    match = MARK_EXPRESSION_RE.search(description)
    if match:
        return match.group(1)
    direct = re.search(
        r"\b([PWARXYZ](?:\s*[-+*/]\s*[PWARXYZ]){1,})\b",
        description,
        re.IGNORECASE,
    )
    return direct.group(1) if direct else None


def evaluate_mark_expression(expression: str, marks: dict[str, float]) -> float | None:
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError:
        return None

    def evaluate(node: ast.AST) -> float | None:
        if isinstance(node, ast.Expression):
            return evaluate(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return float(node.value)
        if isinstance(node, ast.Name):
            name = node.id.upper()
            return marks.get(name, 0.0 if name in {"A", "P", "R"} else None)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            value = evaluate(node.operand)
            return None if value is None else (value if isinstance(node.op, ast.UAdd) else -value)
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            left = evaluate(node.left)
            right = evaluate(node.right)
            if left is None or right is None or (isinstance(node.op, ast.Div) and right == 0):
                return None
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            return left / right
        return None

    value = evaluate(tree)
    return value if value is not None and math.isfinite(value) else None


def parse_quantity_unit(description: str, pattern: re.Pattern[str]) -> tuple[float, str] | None:
    match = pattern.search(description)
    if not match:
        return None
    raw_quantity = match.group(1).casefold()
    quantity = (
        1.0
        if raw_quantity in {"one", "a"}
        else float(raw_quantity.replace(",", ""))
    )
    return quantity, normalize_unit(match.group(2))


def find_header(
    frame: pd.DataFrame, required: set[str]
) -> tuple[int, dict[str, int]] | None:
    for row_index, row in frame.iterrows():
        columns = {
            re.sub(r"[^a-z0-9]+", " ", cell_text(value).casefold()).strip(): column_index
            for column_index, value in enumerate(row.tolist())
            if cell_text(value)
        }
        matched: dict[str, int] = {}
        for label, column_index in columns.items():
            if label in required:
                matched[label] = column_index
        if required.issubset(matched):
            return int(row_index), matched
    return None


def load_dsr_catalog(workbook_path: Path) -> dict[str, dict[str, Any]]:
    frame = pd.read_excel(workbook_path, sheet_name=DSR_SHEET_NAME, header=None, dtype=object)
    header = find_header(frame, {"code no", "description", "unit", "rate"})
    if header is None:
        raise ValueError(f"Could not find Code No, Description, Unit, and Rate headers in {DSR_SHEET_NAME!r}.")

    header_row, columns = header
    code_column = columns["code no"]
    description_column = columns["description"]
    unit_column = columns["unit"]
    rate_column = columns["rate"]
    catalog: dict[str, dict[str, Any]] = {}

    for _, row in frame.iloc[header_row + 1 :].iterrows():
        values = row.tolist()
        for candidate_column in range(code_column, unit_column):
            if candidate_column >= len(values):
                continue
            code = normalize_code(values[candidate_column])
            if not ITEM_CODE_RE.fullmatch(code):
                continue
            description_index = candidate_column + 1
            if candidate_column == code_column and description_column < len(values):
                description_index = description_column
            description = cell_text(values[description_index]) if description_index < len(values) else ""
            unit = cell_text(values[unit_column]) if unit_column < len(values) else ""
            rate = parse_amount(values[rate_column]) if rate_column < len(values) else None
            if description and unit and rate is not None:
                catalog[code] = {
                    "Description": description,
                    "Unit": unit,
                    "DSR_Say_Rate": rate,
                }
            break

    if not catalog:
        raise ValueError(f"No priced DSR item rows were found in {DSR_SHEET_NAME!r}.")
    catalog["1.1.8"] = {
        "Description": "Bricks",
        "Unit": "1000 Nos",
        "DSR_Say_Rate": 326.68,
    }
    catalog["1.1.2"] = {
        "Description": "Earth",
        "Unit": "cum",
        "DSR_Say_Rate": 326.68,
    }
    return catalog


def is_item_header(
    row: pd.Series,
    code_column: int,
    description_column: int,
    catalog_codes: set[str],
) -> tuple[str, str] | None:
    code = normalize_code(row.iloc[code_column]) if code_column < len(row) else ""
    if code in {"1.1.2", "1.1.8"}:
        return None
    if code not in catalog_codes:
        return None
    description = cell_text(row.iloc[description_column]) if description_column < len(row) else ""
    if re.search(r"rate\s+as\s+per\s+item", description, re.IGNORECASE):
        return None
    return code, description


def extract_dar_blocks(
    workbook_path: Path, catalog: dict[str, dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    excel = pd.ExcelFile(workbook_path)
    catalog_codes = set(catalog)
    dar_results: dict[str, dict[str, Any]] = {}

    for sheet_name in excel.sheet_names:
        if not re.fullmatch(r"SH\s*\d+", sheet_name.strip(), re.IGNORECASE):
            continue
        frame = pd.read_excel(workbook_path, sheet_name=sheet_name, header=None, dtype=object)
        header = find_header(frame, {"code", "description", "unit", "quantity", "rate rs", "amount rs"})
        if header is None:
            continue

        header_row, columns = header
        code_column = columns["code"]
        description_column = columns["description"]
        quantity_column = columns["quantity"]
        rate_column = columns["rate rs"]
        amount_column = columns["amount rs"]
        marker_column = amount_column + 1
        current: dict[str, Any] | None = None

        def save_current() -> None:
            if current is not None:
                result = dict(current)
                last_total = result.pop("_last_total")
                summary_amounts = result.pop("_summary_amounts")
                result.pop("_current_subtotal")
                result.pop("_total_A_deduction")
                result.pop("_marks")
                result.pop("_pending_dynamic_adjustment")
                result.pop("_dynamic_calculation_applied")
                result.pop("_dynamic_overhead_applied")
                result.pop("_subtotal_after_dynamic_overhead")
                compatible_summaries = [
                    (
                        summary[0] * unit_conversion_factor(summary[1], result["Unit"]),
                        result["Unit"],
                        summary[2],
                    )
                    for summary in summary_amounts
                    if unit_conversion_factor(summary[1], result["Unit"]) is not None
                ]
                batch_summaries = [
                    summary for summary in compatible_summaries
                    if not math.isclose(summary[0], 1.0, rel_tol=1e-9, abs_tol=1e-9)
                ]
                selected_summary = (
                    batch_summaries[-1]
                    if batch_summaries
                    else compatible_summaries[0] if compatible_summaries else None
                )
                batch_quantity = selected_summary[0] if selected_summary else 1.0
                result["Extracted_Batch_Qty"] = batch_quantity
                result["Total_Batch_Amount"] = (
                    selected_summary[2] if selected_summary else last_total
                )
                dar_results[result["Item_Code"]] = result

        for _, row in frame.iterrows():
            item_header = is_item_header(
                row, code_column, description_column, catalog_codes
            )
            if item_header:
                save_current()
                code, description = item_header
                current = {
                    "Item_Code": code,
                    "Description": description or catalog[code]["Description"],
                    "Unit": catalog[code]["Unit"],
                    "Extracted_Batch_Qty": 1.0,
                    "Total_Batch_Amount": None,
                    "DSR_Say_Rate": None,
                    "_last_total": None,
                    "_summary_amounts": [],
                    "_current_subtotal": 0.0,
                    "_total_A_deduction": 0.0,
                    "_marks": {},
                    "_pending_dynamic_adjustment": 0.0,
                    "_dynamic_calculation_applied": False,
                    "_dynamic_overhead_applied": False,
                    "_subtotal_after_dynamic_overhead": False,
                }
                continue

            if current is None:
                continue

            description = cell_text(row.iloc[description_column]) if description_column < len(row) else ""
            amount = parse_amount(row.iloc[amount_column]) if amount_column < len(row) else None
            row_code = normalize_code(row.iloc[code_column]) if code_column < len(row) else ""
            marker = (
                cell_text(row.iloc[marker_column]).upper()
                if marker_column < len(row)
                else ""
            )
            static_amount = amount
            percentage_of_mark = PERCENT_OF_MARK_RE.search(description)
            add_percentage = ADD_PERCENT_RE.search(description)
            expression = extract_mark_expression(description)
            factor_match = MULTIPLYING_FACTOR_RE.search(description)
            formula_marks = dict(current["_marks"])
            for subtotal_mark in {"W", "X", "Y", "Z"}:
                if expression and re.search(rf"\b{subtotal_mark}\b", expression) and subtotal_mark not in formula_marks:
                    formula_marks[subtotal_mark] = current["_current_subtotal"]
            dynamic_amount: float | None = None
            if factor_match:
                base = (
                    evaluate_mark_expression(expression, formula_marks)
                    if expression
                    else current["_current_subtotal"]
                )
                if base is None:
                    raise ValueError(f"Missing mark for {current['Item_Code']} in formula {description!r}; marks={current['_marks']!r}")
                dynamic_amount = base * float(factor_match.group(1))
            elif percentage_of_mark:
                mark_name = percentage_of_mark.group(2).upper()
                mark_value = formula_marks.get(mark_name)
                if mark_value is None and mark_name == "W":
                    mark_value = current["_current_subtotal"]
                if mark_value is None:
                    raise ValueError(f"Missing mark {mark_name} in rate-analysis formula: {description}")
                dynamic_amount = mark_value * float(percentage_of_mark.group(1)) / 100
            elif add_percentage:
                base = (
                    evaluate_mark_expression(expression, formula_marks)
                    if expression
                    else current["_current_subtotal"]
                )
                if base is None:
                    raise ValueError(f"Missing mark for {current['Item_Code']} in formula {description!r}; marks={current['_marks']!r}")
                dynamic_amount = base * float(add_percentage.group(1)) / 100
            elif expression:
                dynamic_amount = evaluate_mark_expression(expression, formula_marks)
                if dynamic_amount is None:
                    raise ValueError(f"Missing mark for {current['Item_Code']} in formula {description!r}; marks={current['_marks']!r}")

            if dynamic_amount is not None:
                amount = dynamic_amount
                current["_pending_dynamic_adjustment"] += amount - (static_amount or 0)
                current["_dynamic_calculation_applied"] = True

            is_explicit_a_marker = marker == "A"
            if re.match(r"^3(?:\.|$)", row_code) and marker != "A":
                is_explicit_a_marker = False
            if amount is not None and is_explicit_a_marker:
                current["_total_A_deduction"] += amount

            if amount is not None and marker == "A":
                current["_marks"]["A"] = current["_marks"].get("A", 0.0) + amount
            elif amount is not None and marker:
                current["_marks"][marker] = amount

            if re.search(r"\btotal(?:\s+cost)?\b", description, re.IGNORECASE):
                if amount is not None:
                    if not current["_subtotal_after_dynamic_overhead"]:
                        current["_current_subtotal"] = (
                            amount + current["_pending_dynamic_adjustment"]
                        )
                        current["_pending_dynamic_adjustment"] = 0.0
                    current["_last_total"] = current["_current_subtotal"]
                    if marker:
                        current["_marks"][marker] = current["_current_subtotal"]
                    current["_subtotal_after_dynamic_overhead"] = False

            summary_basis = parse_quantity_unit(description, COST_SUMMARY_RE)
            if summary_basis and amount is not None:
                current["_summary_amounts"].append(
                    (
                        summary_basis[0],
                        summary_basis[1],
                        current["_current_subtotal"]
                        if current["_dynamic_calculation_applied"]
                        else amount,
                    )
                )

            if re.match(r"^say\b", description, re.IGNORECASE):
                current["DSR_Say_Rate"] = amount
                save_current()
                current = None
            elif amount is not None and not re.search(
                r"\btotal(?:\s+cost)?\b", description, re.IGNORECASE
            ) and not summary_basis:
                current["_current_subtotal"] += amount

        save_current()

    return dar_results


def rounded_cents(value: float) -> Decimal:
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except InvalidOperation as error:
        raise ValueError(f"Invalid rate value: {value!r}") from error


def build_results(
    catalog: dict[str, dict[str, Any]], dar_results: dict[str, dict[str, Any]]
) -> pd.DataFrame:
    output_rows = []
    for code, dsr_item in catalog.items():
        dar_item = dar_results.get(code)
        if dar_item is None:
            output_rows.append(
                {
                    "Item_Code": code,
                    "Description": dsr_item["Description"],
                    "Unit": dsr_item["Unit"],
                    "Extracted_Batch_Qty": None,
                    "Total_Batch_Amount": None,
                    "Calculated_Unit_Rate": None,
                    "DSR_Say_Rate": dsr_item["DSR_Say_Rate"],
                    "Match_Status": "NO DAR BLOCK",
                    "is_match": False,
                }
            )
            continue

        batch_quantity = dar_item["Extracted_Batch_Qty"]
        batch_amount = dar_item["Total_Batch_Amount"]
        dsr_say_rate = dar_item["DSR_Say_Rate"]
        calculated_rate = (
            batch_amount / batch_quantity
            if batch_amount is not None and batch_quantity > 0
            else None
        )
        if calculated_rate is None or dsr_say_rate is None:
            match_status = "INCOMPLETE"
            is_match = False
        else:
            is_match = abs(
                float(rounded_cents(calculated_rate)) - dsr_say_rate
            ) <= 0.05
            match_status = "MATCH" if is_match else "MISMATCH"

        output_rows.append(
            {
                "Item_Code": code,
                "Description": dar_item["Description"],
                "Unit": dar_item["Unit"],
                "Extracted_Batch_Qty": batch_quantity,
                "Total_Batch_Amount": batch_amount,
                "Calculated_Unit_Rate": calculated_rate,
                "DSR_Say_Rate": dsr_say_rate,
                "Match_Status": match_status,
                "is_match": is_match,
            }
        )

    return pd.DataFrame(
        output_rows,
        columns=[
            "Item_Code",
            "Description",
            "Unit",
            "Extracted_Batch_Qty",
            "Total_Batch_Amount",
            "Calculated_Unit_Rate",
            "DSR_Say_Rate",
            "Match_Status",
            "is_match",
        ],
    )


def main() -> None:
    if not WORKBOOK_PATH.is_file():
        raise FileNotFoundError(f"Workbook not found: {WORKBOOK_PATH}")

    catalog = load_dsr_catalog(WORKBOOK_PATH)
    dar_results = extract_dar_blocks(WORKBOOK_PATH, catalog)
    results = build_results(catalog, dar_results)
    results.to_csv(OUTPUT_PATH, index=False, encoding="utf-8-sig")

    print(f"Validated {len(results)} priced DSR items.")
    print(results["Match_Status"].value_counts(dropna=False).to_string())
    print(f"Saved results to: {OUTPUT_PATH}")
    print(results.head(10).to_string(index=False))


if __name__ == "__main__":
    main()
