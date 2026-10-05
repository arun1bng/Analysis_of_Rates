import pandas as pd

excel_path = "dsr_2023_master.xlsx"
excel_file = pd.ExcelFile(excel_path)
print("📄 Sheets found:", excel_file.sheet_names)

df = pd.read_excel(excel_path, sheet_name=0)
print("📊 Columns in Sheet 0:", df.columns.tolist())