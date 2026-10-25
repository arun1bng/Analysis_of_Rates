import { NextResponse } from 'next/server';
import db from '../../../lib/db';

export async function GET() {
  try {
    const stmt = db.prepare(`
      SELECT 
        item_code as code, 
        source_sheet as category, 
        description, 
        unit, 
        dar_rate as rate 
      FROM dar_items
    `);
    
    const rows = stmt.all();

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Database Error:", error);
    return NextResponse.json({ error: "Failed to fetch basic rates" }, { status: 500 });
  }
}