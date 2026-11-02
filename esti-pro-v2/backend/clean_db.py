import sqlite3

def clean_database():
    # Connect to your database (ensure the file name matches)
    conn = sqlite3.connect('CPWD_Software_Backend.db')
    cursor = conn.cursor()
    
    # 1. First, let's reverse the damage from the previous SQL error
    cursor.execute("UPDATE dar_items SET description = REPLACE(description, '± 1', ' 1')")
    cursor.execute("UPDATE dar_items SET description = REPLACE(description, '± 2', ' 2')")
    cursor.execute("UPDATE dar_items SET description = REPLACE(description, '± 5', ' 5')")
    
    # 2. Fetch only the rows containing the corrupted character (\ufffd)
    cursor.execute("SELECT dar_item_id, description FROM dar_items WHERE description LIKE '%\ufffd%'")
    rows = cursor.fetchall()
    
    fixed_count = 0
    
    for row_id, desc in rows:
        fixed_desc = desc
        
        # --- SAFE, CONTEXT-AWARE REPLACEMENTS ---
        
        # Fractions
        fixed_desc = fixed_desc.replace('1:1\ufffd:3', '1:1½:3')
        fixed_desc = fixed_desc.replace('1\ufffd coarse', '1½ coarse')
        fixed_desc = fixed_desc.replace('1\ufffd manufactured', '1½ manufactured')
        fixed_desc = fixed_desc.replace('1:2:3\ufffd:9', '1:2:3½:9')
        fixed_desc = fixed_desc.replace('3\ufffd coarse', '3½ coarse')
        fixed_desc = fixed_desc.replace('3\ufffd manufactured', '3½ manufactured')
        fixed_desc = fixed_desc.replace('1:2\ufffd:4:11', '1:2½:4:11')
        fixed_desc = fixed_desc.replace('2\ufffd fly', '2½ fly')
        fixed_desc = fixed_desc.replace('\ufffd tonne', '½ tonne')
        
        # Tolerances (Brackets)
        fixed_desc = fixed_desc.replace('(\ufffd 0.1', '(± 0.1')
        fixed_desc = fixed_desc.replace('(\ufffd 0.2', '(± 0.2')
        fixed_desc = fixed_desc.replace('(\ufffd 0.3', '(± 0.3')
        fixed_desc = fixed_desc.replace('(\ufffd 1', '(± 1')
        fixed_desc = fixed_desc.replace('(\ufffd 2', '(± 2')
        fixed_desc = fixed_desc.replace('(\ufffd 5', '(± 5')
        fixed_desc = fixed_desc.replace('(\ufffd0.2', '(±0.2')
        fixed_desc = fixed_desc.replace('(\ufffd1', '(±1')
        fixed_desc = fixed_desc.replace('(\ufffd2', '(±2')
        fixed_desc = fixed_desc.replace('(\ufffd5', '(±5')
        
        # Tolerances (Inline)
        fixed_desc = fixed_desc.replace('\ufffd10%', '±10%')
        fixed_desc = fixed_desc.replace('\ufffd 10%', '± 10%')
        fixed_desc = fixed_desc.replace('\ufffd 2%', '± 2%')
        fixed_desc = fixed_desc.replace('\ufffd2%', '±2%')
        fixed_desc = fixed_desc.replace('\ufffd1mm', '±1mm')
        fixed_desc = fixed_desc.replace('\ufffd 1mm', '± 1mm')
        fixed_desc = fixed_desc.replace('\ufffd 0.1', '± 0.1')
        fixed_desc = fixed_desc.replace('\ufffd 0.2', '± 0.2')
        fixed_desc = fixed_desc.replace('\ufffd 0.3', '± 0.3')
        
        # Degrees
        fixed_desc = fixed_desc.replace('90\ufffd', '90°')
        fixed_desc = fixed_desc.replace('45\ufffd', '45°')
        fixed_desc = fixed_desc.replace('15\ufffd', '15°')
        fixed_desc = fixed_desc.replace('23\ufffdC', '23°C')
        fixed_desc = fixed_desc.replace('25\ufffdC', '25°C')
        fixed_desc = fixed_desc.replace('150\ufffdC', '150°C')
        fixed_desc = fixed_desc.replace('80\ufffdC', '80°C')
        fixed_desc = fixed_desc.replace('-2\ufffdC', '-2°C')
        fixed_desc = fixed_desc.replace('87.5\ufffd', '87.5°')
        
        # Squares and Cubes
        fixed_desc = fixed_desc.replace('gm/ m\ufffd', 'gm/ m²')
        fixed_desc = fixed_desc.replace('gm/m\ufffd', 'gm/m²')
        fixed_desc = fixed_desc.replace('N/mm\ufffd', 'N/mm²')
        fixed_desc = fixed_desc.replace('kg/cm\ufffd', 'kg/cm²')
        fixed_desc = fixed_desc.replace('kg/m\ufffd', 'kg/m³')
        
        # Quotation Marks & Apostrophes
        fixed_desc = fixed_desc.replace('\ufffdW\ufffd', "'W'")
        fixed_desc = fixed_desc.replace('\ufffdC\ufffd', "'C'")
        fixed_desc = fixed_desc.replace('\ufffdT\ufffd', "'T'")
        fixed_desc = fixed_desc.replace('\ufffdA\ufffd', "'A'")
        fixed_desc = fixed_desc.replace('\ufffdB\ufffd', "'B'")
        fixed_desc = fixed_desc.replace('ture\ufffds', "ture's")
        fixed_desc = fixed_desc.replace('turer\ufffds', "turer's")
        fixed_desc = fixed_desc.replace('frame\ufffds', "frame's")
        fixed_desc = fixed_desc.replace('ation\ufffd,', "ation',")
        fixed_desc = fixed_desc.replace('on \ufffdReinf', "on 'Reinf")
        
        # French Words & Formatting
        fixed_desc = fixed_desc.replace('fa\ufffdade', 'façade')
        fixed_desc = fixed_desc.replace('em*).\ufffd(i)', 'em*). (i)')
        fixed_desc = fixed_desc.replace('mm)} \ufffd with', 'mm)} - with')
        fixed_desc = fixed_desc.replace('\ufffd The ', '- The ')
        fixed_desc = fixed_desc.replace('\ufffd Afte', '- Afte')
        fixed_desc = fixed_desc.replace('Pipe \ufffd20mm', 'Pipe Ø20mm')
        fixed_desc = fixed_desc.replace('sher \ufffd16', 'sher Ø16')
        fixed_desc = fixed_desc.replace('Nut \ufffd100', 'Nut Ø100')
        
        # Update row if changes were made
        if fixed_desc != desc:
            cursor.execute("UPDATE dar_items SET description = ? WHERE dar_item_id = ?", (fixed_desc, row_id))
            fixed_count += 1
            
    conn.commit()
    conn.close()
    print(f"Database cleaned perfectly! Fixed {fixed_count} corrupted rows.")

if __name__ == "__main__":
    clean_database()