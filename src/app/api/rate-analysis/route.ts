import Database from 'better-sqlite3';
import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export async function POST(request: Request) {
  try {
    const { itemCodes } = await request.json();

    if (!Array.isArray(itemCodes)) {
      return NextResponse.json({ error: "itemCodes must be an array" }, { status: 400 });
    }

    // Try multiple common locations for the DB file to ensure it's found
    const rootPath = process.cwd();
    const possiblePaths = [
      path.resolve(rootPath, 'CPWD_Software_Backend.db'),
      path.resolve(rootPath, 'public', 'CPWD_Software_Backend.db'),
      path.resolve(rootPath, 'data', 'CPWD_Software_Backend.db'),
      path.resolve(rootPath, 'src', 'CPWD_Software_Backend.db')
    ];

    let dbPath = '';
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        dbPath = p;
        break;
      }
    }

    if (!dbPath) {
      console.error("CRITICAL ERROR: CPWD_Software_Backend.db file not found in project.");
      return NextResponse.json({ error: "Database file not found" }, { status: 500 });
    }

    const db = new Database(dbPath, { readonly: true });

    // Fetch all rows to bypass SQLite's 999 parameter limit
    const components = db.prepare(`SELECT * FROM item_components`).all();
    const darItems = db.prepare(`SELECT * FROM dar_items`).all();
    
    db.close();

    // Construct the exact shape the frontend expects
    const responseData = {
        analyses: {} as Record<string, any>,
        allSubAnalyses: [],
        allSubComponents: []
    };

    const codeSet = new Set(itemCodes);

    // Group the DAR base items
    darItems.forEach((d: any) => {
        if (codeSet.has(d.item_code)) {
            responseData.analyses[d.item_code] = {
                darItem: d,
                components: [],
                subAnalysis: null,
                subComponents: []
            };
        }
    });

    // Group the calculated components
    components.forEach((c: any) => {
        if (codeSet.has(c.item_code)) {
            if (!responseData.analyses[c.item_code]) {
                responseData.analyses[c.item_code] = {
                    darItem: null,
                    components: [],
                    subAnalysis: null,
                    subComponents: []
                };
            }
            responseData.analyses[c.item_code].components.push(c);
        }
    });

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Database Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch DB components", details: error instanceof Error ? error.message : String(error) }, 
      { status: 500 }
    );
  }
}