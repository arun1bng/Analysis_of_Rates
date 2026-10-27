import Database from 'better-sqlite3';
import path from 'path';

// Point directly to the backend folder we created in Step 1
const dbPath = path.resolve(process.cwd(), 'backend', 'CPWD_Software_Backend.db');

// Open the database in readonly mode for safety and speed
const db = new Database(dbPath, { readonly: true });

export default db;