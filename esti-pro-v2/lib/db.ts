import Database from 'better-sqlite3';
import path from 'path';

// Point directly to the backend folder
const dbPath = path.resolve(process.cwd(), 'backend', 'CPWD_Software_Backend.db');

// Open the database in readonly mode
const db = new Database(dbPath, { readonly: true });

export default db;