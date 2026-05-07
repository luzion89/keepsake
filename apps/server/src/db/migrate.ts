import { openDb } from './open.js';

const { db, close } = openDb();
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all() as Array<{name:string}>;
console.log('[migrate] tables:', tables.map(t => t.name).join(', '));
close();
