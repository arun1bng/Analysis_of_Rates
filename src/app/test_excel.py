import os
import pandas as pd

# Automatically search for dsr_2023_master.xlsx anywhere in the current project folder
target_file = "dsr_2023_master.xlsx"
found_path = None

for root, dirs, files in os.walk("."):
  if target_file in files:
    found_path = os.path.join(root, target_file)
    break

if not found_path:
  print(
      f"❌ Could not find '{target_file}' in any subfolder of current directory!"
  )
  print(
      "Please drag and drop 'dsr_2023_master.xlsx' directly into the main"
      " 'esti-pro' folder view."
  )
else:
  print(f"✅ Found Excel file at: {found_path}")
  excel_file = pd.ExcelFile(found_path)
  print("📄 Sheets found:", excel_file.sheet_names)

  df = pd.read_excel(found_path, sheet_name=0)
  print("📊 Columns in Sheet 0:", df.columns.tolist())