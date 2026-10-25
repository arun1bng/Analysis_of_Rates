import { NextResponse } from "next/server";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

// Connect to your existing database
async function openDb() {
  return open({
    filename: "./backend/CPWD_Software_Backend.db",
    driver: sqlite3.Database,
  });
}

// GET: Fetches all custom items when the application loads
export async function GET() {
  try {
    const db = await openDb();
    
    // Automatically create the table if it is the first time running
    await db.exec(`
      CREATE TABLE IF NOT EXISTS custom_rates (
        code TEXT PRIMARY KEY,
        description TEXT,
        unit TEXT,
        rate REAL,
        analysisRows TEXT
      )
    `);

    const items = await db.all("SELECT * FROM custom_rates");
    
    // Parse the saved JSON analysis rows back into arrays for the frontend
    const formattedItems = items.map(item => ({
      ...item,
      analysisRows: item.analysisRows ? JSON.parse(item.analysisRows) : []
    }));

    return NextResponse.json(formattedItems);
  } catch (error) {
    console.error("GET custom-rates error:", error);
    return NextResponse.json({ error: "Failed to fetch custom rates" }, { status: 500 });
  }
}

// POST: Saves a new custom item or updates an existing one (Edit NSR)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { code, description, unit, rate, analysisRows } = body;

    const db = await openDb();
    
    // Ensure table exists before inserting
    await db.exec(`
      CREATE TABLE IF NOT EXISTS custom_rates (
        code TEXT PRIMARY KEY,
        description TEXT,
        unit TEXT,
        rate REAL,
        analysisRows TEXT
      )
    `);

    // UPSERT: Insert the new item, or overwrite it if the code already exists
    await db.run(`
      INSERT INTO custom_rates (code, description, unit, rate, analysisRows)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        description = excluded.description,
        unit = excluded.unit,
        rate = excluded.rate,
        analysisRows = excluded.analysisRows
    `, [
      code, 
      description, 
      unit, 
      rate, 
      JSON.stringify(analysisRows || [])
    ]);

    return NextResponse.json({ success: true, message: "Custom item saved successfully!" });
  } catch (error) {
    console.error("POST custom-rates error:", error);
    return NextResponse.json({ error: "Failed to save custom rate" }, { status: 500 });
  }
}
// DELETE: Removes a custom item from the database
export async function DELETE(request: Request) {
  try {
    const { code } = await request.json();
    const db = await openDb();
    
    await db.run("DELETE FROM custom_rates WHERE code = ?", [code]);

    return NextResponse.json({ success: true, message: "Custom item deleted." });
  } catch (error) {
    console.error("DELETE custom-rates error:", error);
    return NextResponse.json({ error: "Failed to delete custom rate" }, { status: 500 });
  }
}