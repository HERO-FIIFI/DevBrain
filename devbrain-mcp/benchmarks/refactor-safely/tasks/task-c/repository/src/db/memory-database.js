// A tiny schema-checked in-memory database. It understands exactly the SQL subset in `db/`:
// `CREATE TABLE name (col type ..., ...)` and `INSERT INTO name (cols) VALUES (...), (...);`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DB_DIR = fileURLToPath(new URL('../../db/', import.meta.url));
const CREATE = /CREATE TABLE\s+(\w+)\s*\(([^;]*)\)\s*;/gi;
const INSERT = /INSERT INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*([^;]*);/gi;
const ROW = /\(([^)]*)\)/g;

const stripComments = (sql) => sql.replace(/--[^\n]*/g, '');
const parseValue = (raw) => { const text = raw.trim(); return text.startsWith("'") ? text.slice(1, -1).replace(/''/g, "'") : Number(text); };

export class MemoryDatabase {
  constructor({ schema = readFileSync(path.join(DB_DIR, 'schema.sql'), 'utf8'), seed = readFileSync(path.join(DB_DIR, 'seed.sql'), 'utf8') } = {}) {
    this.schema = new Map();
    this.tables = new Map();
    for (const [, table, body] of stripComments(schema).matchAll(CREATE)) {
      const columns = body.split(',').map((column) => column.trim().split(/\s+/)[0]).filter(Boolean);
      this.schema.set(table, columns);
      this.tables.set(table, []);
    }
    for (const [, table, columnList, values] of stripComments(seed).matchAll(INSERT)) {
      const columns = columnList.split(',').map((column) => column.trim());
      for (const [, tuple] of values.matchAll(ROW)) this.insert(table, Object.fromEntries(columns.map((column, index) => [column, parseValue(tuple.split(',')[index])])));
    }
  }

  assertColumns(table, columns) {
    const declared = this.schema.get(table);
    if (!declared) throw new Error(`unknown table ${table}`);
    for (const column of columns) if (!declared.includes(column)) throw new Error(`unknown column ${table}.${column}`);
  }

  insert(table, row) {
    this.assertColumns(table, Object.keys(row));
    this.tables.get(table).push({ ...row });
  }

  /** @returns {object[]} copies of rows matching every `where` column exactly */
  select(table, where = {}) {
    this.assertColumns(table, Object.keys(where));
    return this.tables.get(table).filter((row) => Object.entries(where).every(([column, value]) => row[column] === value)).map((row) => ({ ...row }));
  }

  /** @returns {number} rows changed */
  update(table, where, patch) {
    this.assertColumns(table, [...Object.keys(where), ...Object.keys(patch)]);
    let changed = 0;
    for (const row of this.tables.get(table)) if (Object.entries(where).every(([column, value]) => row[column] === value)) { Object.assign(row, patch); changed += 1; }
    return changed;
  }
}
