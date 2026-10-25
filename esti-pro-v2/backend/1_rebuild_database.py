import sqlite3
import pandas as pd
import re
import os
import decimal

DB_NAME = "CPWD_Software_Backend.db"
DAR_FILE = "dar_2023_for db_01.xlsx"
DSR_FILE = "dsr_for db_1.xlsx"

def setup_database():
    if os.path.exists(DB_NAME): os.remove(DB_NAME)
    conn = sqlite3.connect(DB_NAME)
    conn.executescript("""
        CREATE TABLE dar_items (
            dar_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_code TEXT,
            description TEXT,
            unit TEXT,
            dar_rate REAL,
            source_sheet TEXT
        );
        CREATE TABLE rate_analysis (
            ar_id INTEGER PRIMARY KEY AUTOINCREMENT,
            dar_item_id INTEGER,
            component_sequence INTEGER,
            row_type TEXT,
            component_code TEXT,
            description TEXT,
            unit TEXT,
            quantity REAL,
            rate REAL,
            amount REAL,
            amount_str TEXT,
            calc_mark TEXT,
            is_sub_ar BOOLEAN,
            FOREIGN KEY(dar_item_id) REFERENCES dar_items(dar_item_id)
        );
        CREATE TABLE algebra_memory (
            memory_id INTEGER PRIMARY KEY AUTOINCREMENT,
            dar_item_id INTEGER,
            mark TEXT,
            amount REAL,
            FOREIGN KEY(dar_item_id) REFERENCES dar_items(dar_item_id)
        );
    """)
    return conn

def clean_text(val):
    if pd.isna(val) or str(val).lower() == 'nan': return ""
    return str(val).strip() 

def clean_num(val):
    if pd.isna(val) or str(val).lower() == 'nan' or str(val).strip() == '': return None
    val = str(val).replace(',', '').strip()
    if val == "0" or val == "0.00" or val == "0.0": return 0.0
    match = re.search(r'(-?\d*\.\d+|-?\d+)', val)
    return float(match.group(1)) if match else None

def fix_cpwd_code(code, last_minor, last_major):
    code_str = str(code).strip().replace(" ", "").replace("\n", "").replace("\r", "").upper()
    parts = code_str.split('.')
    
    if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
        major, minor = int(parts[0]), int(parts[1])
        
        # Sequence tracking: if we are in the same major subhead
        if major == last_major:
            # If Pandas gives us .1 but we just processed .9, it is actually .10
            if len(parts) == 2 and minor == 1 and last_minor == 9:
                parts[1] = "10"
                minor = 10
                code_str = ".".join(parts)
                
        return code_str, minor, major
        
    return code_str, last_minor, last_major

def is_true_ar_header(code, desc, qty, amt_parsed):
    code = str(code).strip().replace(" ", "").replace("\n", "")
    if not ('.' in code and code[0].isdigit()): return False
    
    # If the row has math quantities and amounts, it is a calculation row, not a header
    if qty is not None and amt_parsed is not None: return False 
    
    desc_upper = str(desc).upper()
    if re.search(r'\bRATE AS PER\b', desc_upper): return False
    
    # Allow strict CPWD structures (e.g., 16.32.1) to bypass the "RATE OF" ban
    is_strict = bool(re.match(r'^\d+\.\d+(?:\.\d+)*[A-Z]?$', code))
    if re.search(r'\bRATE OF\b', desc_upper) and not is_strict: 
        return False
        
    return True

def is_financial_add(desc_upper):
    if "ADD " not in desc_upper and "ADDING " not in desc_upper: return False
    safe_words = [r"\bWATER\b", r"\bGST\b", r"\bCPOH\b", r"\bCESS\b", r"\bPROFIT\b", r"\bOVERHEAD\b"]
    return any(re.search(w, desc_upper) for w in safe_words)

def is_deduction(desc_upper):
    if re.search(r'\bDEDUCT\b', desc_upper): return True
    
    if re.search(r'\bLESS\b', desc_upper):
        # Ignore material specifications that use the word "less"
        exclusions = [r'\bNOT LESS\b', r'\bLESS THAN\b', r'\bBOLT\s*LESS\b']
        if not any(re.search(ex, desc_upper) for ex in exclusions):
            return True
            
    return False

def calculate_hidden_algebra(desc_upper, algebra_memory, running_components):
    if "I.E." not in desc_upper and "I.E " not in desc_upper and "%" not in desc_upper and "EXTRA" not in desc_upper: return None
    
    m1 = re.search(r'\b([PMRWXYZABC])\s*[X\*]\s*(0\.\d+|1\.\d+)', desc_upper)
    if m1: return cpwd_round(algebra_memory.get(m1.group(1), 0.0) * float(m1.group(2)))
    
    # Isolate the final calculation formula (everything after the '=' sign)
    calc_str = desc_upper.split('=')[-1] if '=' in desc_upper else desc_upper
    
    # Find ALL instances of percentage algebra (e.g., "5% OF E", "+ 3% OF F", "- 30% OF H")
    pct_matches = re.findall(r'([+-]?)\s*([\d\.]+)\s*(?:%|PER\s*CENT)\s*(?:OF|ON)\s+([A-Z])\b', calc_str)
    
    if pct_matches:
        total_amt = 0.0
        for sign_str, pct_str, var_char in pct_matches:
            val = cpwd_pct_and_round(algebra_memory.get(var_char, 0.0), pct_str)
            if val is not None:
                # Apply the correct algebraic sign before aggregating
                if sign_str.strip() == '-':
                    total_amt -= val
                else:
                    total_amt += val
        if total_amt != 0.0:
            return total_amt
            
    # Fallback for single percentage logic if the compound logic above misses
    m2 = re.search(r'([\d\.]+)\s*(?:%|PER\s*CENT).*?(?:OF|ON)\s+([A-Z])(?:$|\s|["\'])', desc_upper)
    if m2: return cpwd_pct_and_round(algebra_memory.get(m2.group(2), 0.0), m2.group(1))
        
    m3 = re.search(r'(\d+)/(\d+)\s+OF\s+.*?\b([A-Z])\s*$', desc_upper)
    if m3 and float(m3.group(2)) != 0: 
        return cpwd_divide_and_round(algebra_memory.get(m3.group(3), 0.0) * float(m3.group(1)), m3.group(2))

    if "EXTRA" in desc_upper and "%" in desc_upper:
        m4 = re.search(r'@\s*([\d\.]+)\s*%', desc_upper)
        if m4: return cpwd_pct_and_round(running_components, m4.group(1))
        
    return None

def load_dsr_and_basic_rates():
    print(f"Loading {DSR_FILE} for Parent Items and Bulk Divisors...")
    xls = pd.ExcelFile(DSR_FILE)
    dsr_dict = {}

    sheet_names = xls.sheet_names
    normal_sheets = [s for s in sheet_names if "upd" not in s.lower() and "ext" not in s.lower()]
    upd_sheets = [s for s in sheet_names if "upd" in s.lower() or "ext" in s.lower()]
    ordered_sheets = normal_sheets + upd_sheets

    for sheet_name in ordered_sheets:
        last_minor = 0
        last_major = 0
        
        df_sheet = pd.read_excel(xls, sheet_name=sheet_name, dtype=str)
        df_sheet = df_sheet.dropna(how='all')
        if df_sheet.empty or len(df_sheet.columns) < 4: continue
            
        for _, row in df_sheet.iterrows():
            raw_code = clean_text(row.iloc[0])
            if not raw_code or 'item' in raw_code.lower() or 'code' in raw_code.lower(): continue
            
            code, last_minor, last_major = fix_cpwd_code(raw_code, last_minor, last_major)
            
            raw_divisor = row.iloc[5] if len(row) > 5 else None
            divisor = clean_num(raw_divisor)
            has_explicit = pd.notna(raw_divisor) and str(raw_divisor).strip() != ''
            
            if divisor is None or divisor == 0: divisor = 1.0

            dsr_dict[code] = {
                'desc': clean_text(row.iloc[1]),
                'unit': clean_text(row.iloc[2]),
                'rate': clean_num(row.iloc[3]),
                'divisor': divisor,
                'has_explicit_divisor': has_explicit
            }
    return dsr_dict

def cpwd_round(val):
    if val is None: return None
    d = decimal.Decimal(str(round(val, 5)))
    rounded = d.quantize(decimal.Decimal('.01'), rounding=decimal.ROUND_HALF_UP)
    return float(rounded)

def cpwd_multiply_and_round(qty, rate):
    if qty is None or rate is None: return None
    d_qty = decimal.Decimal(str(qty))
    d_rate = decimal.Decimal(str(rate))
    rounded = (d_qty * d_rate).quantize(decimal.Decimal('.01'), rounding=decimal.ROUND_HALF_UP)
    return float(rounded)

def cpwd_pct_and_round(base_val, pct_val):
    if base_val is None or pct_val is None: return None
    d_base = decimal.Decimal(str(round(base_val, 5))) 
    d_pct = decimal.Decimal(str(pct_val)) / decimal.Decimal('100')
    rounded = (d_base * d_pct).quantize(decimal.Decimal('.01'), rounding=decimal.ROUND_HALF_UP)
    return float(rounded)

def cpwd_divide_and_round(numerator, denominator):
    if numerator is None or denominator in (None, 0, 0.0): return None
    d_num = decimal.Decimal(str(round(numerator, 5)))
    d_den = decimal.Decimal(str(denominator))
    rounded = (d_num / d_den).quantize(decimal.Decimal('.01'), rounding=decimal.ROUND_HALF_UP)
    return float(rounded)

def cpwd_say(val): 
    if val is None: return None
    d = decimal.Decimal(str(round(val, 5))) * decimal.Decimal('20')
    rounded = d.quantize(decimal.Decimal('1'), rounding=decimal.ROUND_HALF_UP)
    return float(rounded) / 20.0

def is_cpwd_sub_ar(code):
    code = str(code).strip().replace(" ", "")
    return bool(re.match(r'^[\w\.\(\)]+$', code)) and ('.' in code or not code.isdigit())

def build_database():
    conn = setup_database()
    cursor = conn.cursor()
    dsr_dict = load_dsr_and_basic_rates()

    print(f"Parsing Structured AR data from {DAR_FILE} across all sheets...")
    xls_dar = pd.ExcelFile(DAR_FILE)

    sheet_names = xls_dar.sheet_names
    normal_sheets = [s for s in sheet_names if "upd" not in s.lower() and "ext" not in s.lower()]
    upd_sheets = [s for s in sheet_names if "upd" in s.lower() or "ext" in s.lower()]
    ordered_dar_sheets = normal_sheets + upd_sheets

    dar_memory_buffer = {}
    
    for sheet_name in ordered_dar_sheets:
        last_minor = 0
        last_major = 0
        
        df_dar = pd.read_excel(xls_dar, sheet_name=sheet_name, dtype=str)
        df_dar = df_dar.dropna(how='all')
        if df_dar.empty: continue

        active_item_code = None
        current_item_data = None
        current_ar_rows = []
        current_algebra = {}

        running_components = 0.0
        dynamic_divisor = 1.0 
        active_divisor = 1.0
        has_explicit_divisor = False
        ar_finished = False
        seq_counter = 1

        for idx, row in df_dar.iterrows():
            raw_code = clean_text(row.iloc[0]) if len(row) > 0 else ""
            desc = clean_text(row.iloc[1]) if len(row) > 1 else ""
            unit = clean_text(row.iloc[2]) if len(row) > 2 else ""
            qty = clean_num(row.iloc[3]) if len(row) > 3 else None
            rate = clean_num(row.iloc[4]) if len(row) > 4 else None
            mark = clean_text(row.iloc[6]) if len(row) > 6 else ""
            
            amt_str_raw = str(row.iloc[5]).strip() if len(row) > 5 and pd.notna(row.iloc[5]) else ""
            amt_parsed = clean_num(row.iloc[5]) if len(row) > 5 else None
            desc_upper = desc.upper()
            
            # --- NEW MEMORY TRAP ---
            if "USING" in desc_upper and "TIMES" in desc_upper:
                m_times = re.search(r'USING\s+(\d+)\s+TIMES', desc_upper)
                if m_times:
                    dynamic_divisor = float(m_times.group(1))
            # -----------------------

            if raw_code.upper() == 'CODE' or desc_upper == 'DESCRIPTION': continue
            if not raw_code and not desc: continue
            code = raw_code
            
            # CROSS-REFERENCE SHIELD: Ensure we don't treat external references as main items
            is_header = is_true_ar_header(code, desc, qty, amt_parsed)
            if is_header:
                parts = code.split('.')
                temp_major = int(parts[0]) if parts[0].isdigit() else 0
                # If the item belongs to a different major subhead, it is a reference, not a header
                if last_major != 0 and temp_major != 0 and temp_major != last_major:
                    is_header = False

            if is_header:
                if active_item_code:
                    has_math = any(r[1] == 'CR' or r[7] is not None for r in current_ar_rows)
                    if has_math or active_item_code not in dar_memory_buffer:
                        dar_memory_buffer[active_item_code] = {
                            'item_data': current_item_data,
                            'ar_rows': current_ar_rows,
                            'algebra': current_algebra
                        }
                    else:
                        dar_memory_buffer[active_item_code]['item_data'] = current_item_data

                code, last_minor, last_major = fix_cpwd_code(raw_code, last_minor, last_major)
                
                parts = code.split('.')
                desc_tree = []
                for i in range(1, len(parts) + 1):
                    sub_code = ".".join(parts[:i])
                    if sub_code in dsr_dict and dsr_dict[sub_code]['desc']:
                        node_desc = f"{sub_code} {dsr_dict[sub_code]['desc']}"
                        if node_desc not in desc_tree: desc_tree.append(node_desc)
                
                main_info = dsr_dict.get(code)
                item_unit = main_info['unit'] if main_info else unit
                
                active_divisor = main_info['divisor'] if main_info else 1.0
                has_explicit_divisor = main_info['has_explicit_divisor'] if main_info else False
                
                if not desc_tree:
                    full_desc = f"{code} {desc}"
                    item_rate = rate if rate is not None else 0.0
                else:
                    full_desc = "\n\n".join(desc_tree)
                    item_rate = main_info['rate'] if main_info else 0.0

                active_item_code = code
                current_item_data = (code, full_desc, item_unit, item_rate, sheet_name)
                current_ar_rows = []
                current_algebra = {}
                
                seq_counter = 1
                running_components = 0.0
                dynamic_divisor = 1.0
                ar_finished = False
                continue

            if not active_item_code: continue
            if ar_finished: continue
            
            if "RECOVERABLE SEPARATELY" in desc_upper:
                current_item_data = (
                    current_item_data[0],
                    f"{current_item_data[1]}\n\nNote: {desc}",
                    current_item_data[2],
                    current_item_data[3],
                    current_item_data[4]
                )
                continue

            row_type = 'NCR' 
            amt = None
            amount_str = ""
            is_sub_ar = is_cpwd_sub_ar(code) if code else False

            hidden_algebra = calculate_hidden_algebra(desc_upper, current_algebra, running_components)
            
            if "%" in amt_str_raw and amt_parsed is not None:
                row_type = 'NCR'
                amt = amt_parsed
                amount_str = amt_str_raw
                running_components = amt

            # --- NEW BLOCK: Algebraic Division Assignment (e.g., "= S/40") ---
            elif re.search(r'=\s*([A-Z])\s*/\s*(\d+(?:\.\d+)?)\b', desc_upper) and re.search(r'=\s*([A-Z])\s*/\s*(\d+(?:\.\d+)?)\b', desc_upper).group(1) in current_algebra and "ADD " not in desc_upper and "DEDUCT " not in desc_upper:
                m_assign = re.search(r'=\s*([A-Z])\s*/\s*(\d+(?:\.\d+)?)\b', desc_upper)
                row_type = 'NCR' 
                amt = cpwd_divide_and_round(current_algebra.get(m_assign.group(1), 0.0), float(m_assign.group(2)))
                # Hard reset the running components to this new value
                running_components = amt
                
                # Check if it also defines a new bulk quantity (like "cost of 2.5 metre")
                m_bulk = re.search(r'(?:COST|RATE)\s+(?:OF|FOR)\s+(\d+(?:\.\d+)?)', desc_upper)
                if m_bulk:
                    dynamic_divisor = float(m_bulk.group(1))
                else:
                    dynamic_divisor = 1.0
                    active_divisor = 1.0

            elif hidden_algebra is not None:
                row_type = 'CR'
                amt = hidden_algebra
                if is_deduction(desc_upper): amt = -abs(amt)
                running_components += amt

            elif code: 
                # Removed the restrictive "TOTAL" ban so legitimate materials like 7309 calculate normally
                row_type = 'CR' 
                if qty is not None and rate is None: rate = 0.0 
                if qty is not None and rate is not None:
                    amt = cpwd_multiply_and_round(qty, rate)
                    if is_deduction(desc_upper): amt = -abs(amt)
                    running_components += amt

            elif is_financial_add(desc_upper):
                row_type = 'NCR'
                pct = re.search(r'([\d\.]+)\s*%', desc_upper)
                factor = re.search(r'(?:FACTOR|@)\s*([\d\.]+)', desc_upper, re.IGNORECASE)
                
                target_match = re.search(r'ON\s*["“”\']?([A-Z\-]+)["“”\']?', desc_upper)
                base_val = running_components
                
                if target_match:
                    formula = target_match.group(1)
                    if "-" in formula:
                        parts = formula.split("-")
                        base_val = current_algebra.get(parts[0], running_components)
                        for part in parts[1:]:
                            base_val -= current_algebra.get(part, 0.0)
                    else:
                        base_val = current_algebra.get(formula, running_components)

                if pct: amt = cpwd_pct_and_round(base_val, pct.group(1))
                elif factor: amt = cpwd_round(base_val * float(factor.group(1)))
                if amt is not None: running_components += amt

            elif "TOTAL" in desc_upper and not any(x in desc_upper for x in ["ADD", "COST", "RATE", "DETAIL", "FOR", "I.E.", "BOLT"]):
                # Added "I.E." and "BOLT" to exclusion list to prevent descriptive texts 
                # like "(i.e. total of seam and J bolts)" from triggering a running subtotal dump.
                if "=" not in desc_upper and "CUM" not in desc_upper and "SQM" not in desc_upper and "KG" not in desc_upper:
                    row_type = 'NCR'
                    amt = running_components

            # Modified regex: "FOR" must be followed by a number to prevent descriptive text dumps
            # Excludes text rows containing explicit inline math equations (e.g., "= 3765") from triggering the final rate dump
            elif (re.search(r'^(?:TOTAL\s+)?(?:COST|DETAIL|RATE)\b', desc_upper) or re.search(r'^(?:TOTAL\s+)?FOR\s+(?:A\s+)?\d+', desc_upper)) and not re.search(r'=\s*\d', desc_upper):
                qty_in_desc = None
                
                if "QUINTAL" in desc_upper or "QTL" in desc_upper:
                    qty_in_desc = 100.0
                elif "MT " in desc_upper or "TONNE" in desc_upper:
                    qty_in_desc = 1000.0
                
                if qty_in_desc is None:
                    m = re.search(r'(?:COST\s+(?:OF|FOR)|DETAIL(?:S)?\s+OF\s+COST\s+FOR|TOTAL\s+FOR)\s+A?\s*(\d+(?:\.\d+)?)', desc_upper)
                    if m: 
                        qty_in_desc = float(m.group(1))
                    # Added USING ONCE so the engine knows to divide by the captured dynamic_divisor
                    elif re.search(r'(?:COST|RATE)\s+(?:PER|OF)\s+(?:KG|KGS|SQM|CUM|METRE|MTR|M\b|NO|NOS|SET|EACH|LITRE|USING\s+ONCE)', desc_upper):
                        qty_in_desc = 1.0

                if qty_in_desc is not None:
                    row_type = 'NCR'
                    if qty_in_desc != 1.0:
                        dynamic_divisor = qty_in_desc
                        amt = cpwd_round(running_components)
                    elif qty_in_desc == 1.0:
                        div = active_divisor if has_explicit_divisor else (dynamic_divisor if dynamic_divisor not in [1.0, 0.0] else active_divisor)
                        
                        if div not in [1.0, 0.0, None]:
                            running_components = cpwd_divide_and_round(running_components, div)
                            active_divisor = 1.0
                            has_explicit_divisor = False
                            dynamic_divisor = 1.0
                            
                        amt = cpwd_round(running_components)
                else:
                    row_type = 'NCR'
                    amt = cpwd_round(running_components)

            elif desc.strip().upper().startswith("SAY") or re.search(r'^(?:RATE|COST)\s+PER\s+(?:KG|SQM|CUM|EACH|METRE|MTR|NO|NOS|SET|LITRE)', desc_upper):
                row_type = 'NCR'
                
                div = active_divisor if has_explicit_divisor else (dynamic_divisor if dynamic_divisor not in [1.0, 0.0] else active_divisor)
                    
                if div not in [1.0, 0.0, None]:
                    running_components = cpwd_divide_and_round(running_components, div)
                    active_divisor = 1.0
                    has_explicit_divisor = False
                    dynamic_divisor = 1.0
                
                if desc.strip().upper().startswith("SAY"):
                    amt = cpwd_say(running_components)
                else:
                    amt = cpwd_round(running_components)

                running_components = 0.0 
                ar_finished = True

            elif qty is not None and rate is not None:
                row_type = 'CR'
                amt = cpwd_multiply_and_round(qty, rate)
                if is_deduction(desc_upper): amt = -abs(amt)
                running_components += amt

            if row_type == 'NCR' and not code and qty is None and rate is None:
                if desc_upper.startswith("DETAIL") or "TOTAL QUANTITY" in desc_upper or "SLOPE ASSUMED" in desc_upper:
                    amt = None
            elif not code and qty is None and rate is None and amt is None:
                row_type = 'NCR'
                amt = None

            if mark and amt is not None: 
                mark_upper = mark.strip().upper()
                if mark_upper in current_algebra:
                    current_algebra[mark_upper] += amt
                else:
                    current_algebra[mark_upper] = amt

            current_ar_rows.append(
                (seq_counter, row_type, code, desc, unit, qty, rate, amt, amount_str, mark, is_sub_ar)
            )
            seq_counter += 1

        if active_item_code:
            has_math = any(r[1] == 'CR' or r[7] is not None for r in current_ar_rows)
            if has_math or active_item_code not in dar_memory_buffer:
                dar_memory_buffer[active_item_code] = {
                    'item_data': current_item_data,
                    'ar_rows': current_ar_rows,
                    'algebra': current_algebra
                }
            else:
                dar_memory_buffer[active_item_code]['item_data'] = current_item_data

    for final_code, data in dar_memory_buffer.items():
        cursor.execute("INSERT INTO dar_items (item_code, description, unit, dar_rate, source_sheet) VALUES (?, ?, ?, ?, ?)", data['item_data'])
        db_item_id = cursor.lastrowid
        
        for row in data['ar_rows']:
            cursor.execute("""
                INSERT INTO rate_analysis 
                (dar_item_id, component_sequence, row_type, component_code, description, unit, quantity, rate, amount, amount_str, calc_mark, is_sub_ar)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (db_item_id, *row))
            
        for m_key, m_val in data['algebra'].items():
            cursor.execute("INSERT INTO algebra_memory (dar_item_id, mark, amount) VALUES (?, ?, ?)", (db_item_id, m_key, m_val))

    conn.commit()
    print(f"\n✅ EXCEL ENGINE COMPLETE! Database structured and saved.")
    conn.close()

if __name__ == "__main__":
    build_database()