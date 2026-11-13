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
    
    const rows = stmt.all() as Array<{ code: string; category: string; description: string; unit: string | null; rate: number | null }>;

    // SH 49 headings are rate-analysis records rather than priced DSR line
    // items, so dar_items.unit/dar_rate are intentionally empty. Derive the
    // display unit and payable rate from each item's own saved analysis.
    const specialARAnalyses = db.prepare(`
      SELECT ra.dar_item_id, ra.description, ra.unit, ra.amount, ra.rate
      FROM rate_analysis ra
      JOIN dar_items d ON d.dar_item_id = ra.dar_item_id
      WHERE d.item_code LIKE '49.%'
      ORDER BY ra.dar_item_id, ra.component_sequence
    `).all() as Array<{ dar_item_id: number; description: string; unit: string | null; amount: number | null; rate: number | null }>;
    const specialARById = new Map<number, typeof specialARAnalyses>();
    for (const row of specialARAnalyses) {
      const grouped = specialARById.get(row.dar_item_id) ?? [];
      grouped.push(row);
      specialARById.set(row.dar_item_id, grouped);
    }

    const specialARIds = db.prepare(`
      SELECT dar_item_id, item_code FROM dar_items
      WHERE item_code LIKE '49.%'
    `).all() as Array<{ dar_item_id: number; item_code: string }>;
    const specialARMetadata = new Map(specialARIds.map(item => {
      const analysisRows = specialARById.get(item.dar_item_id) ?? [];
      const savedUnit = analysisRows.find(row => String(row.unit ?? '').trim())?.unit?.trim() ?? '';
      const detailText = analysisRows.find(row => /^Details of Cost for\b/i.test(String(row.description ?? '')))?.description ?? '';
      const unitRateText = analysisRows.find(row => /^Cost of 1(?:\.0+)?\s+/i.test(String(row.description ?? '')))?.description ?? '';
      const unitMatch = String(detailText).match(/^Details of Cost for\s+[\d,.]+\s+(.+?)\s*$/i)
        ?? String(unitRateText).match(/^Cost of 1(?:\.0+)?\s+(.+?)\s*$/i);
      const sayRow = [...analysisRows].reverse().find(row => String(row.description ?? '').trim().toLowerCase() === 'say' && row.amount != null);
      const costOfOneRow = [...analysisRows].reverse().find(row => /^Cost of 1(?:\.0+)?\s+/i.test(String(row.description ?? '')) && row.amount != null);
      const analysisRate = sayRow?.amount ?? costOfOneRow?.amount;
      return [item.item_code, { unit: unitMatch?.[1]?.trim() || savedUnit, rate: analysisRate == null ? null : Number(analysisRate) }] as const;
    }));

    const enrichedRows = rows.map(row => {
      const specialAR = specialARMetadata.get(row.code);
      if (!specialAR) return row;
      return {
        ...row,
        unit: row.unit || specialAR.unit || null,
        rate: row.rate ?? specialAR.rate,
      };
    });

    return NextResponse.json(enrichedRows);
  } catch (error) {
    console.error("Database Error:", error);
    return NextResponse.json({ error: "Failed to fetch basic rates" }, { status: 500 });
  }
}
