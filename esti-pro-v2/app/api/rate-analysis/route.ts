import { NextResponse } from 'next/server';
import db from '../../../lib/db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });

  try {
    // 1. Get the internal database ID for this item code
    const itemInfo = db.prepare(`SELECT rowid, * FROM dar_items WHERE TRIM(item_code) = ?`).get(code.trim()) as any;
    
    if (!itemInfo) {
      return NextResponse.json([]);
    }

    // 2. The Python script might have named the primary key 'id' or 'dar_item_id'. We check both.
    const primaryKey = itemInfo.id || itemInfo.dar_item_id || itemInfo.rowid;

    // 3. Fetch the mathematical breakdown using the correct relational ID and sort by sequence!
    const components = db.prepare(`
      SELECT component_sequence, row_type, component_code, description, unit, quantity, rate, amount, calc_mark
      FROM rate_analysis 
      WHERE dar_item_id = ?
      ORDER BY component_sequence ASC
    `).all(primaryKey);

    return NextResponse.json(components);
  } catch (error) {
    console.error("Database Relational Error:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}