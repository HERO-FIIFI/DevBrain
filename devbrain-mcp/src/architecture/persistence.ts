import path from 'node:path';
import { readRepositoryText, redactRepositoryText } from '../context/repository.js';
import { callArguments } from './adapters.js';
import type { RepositoryModel } from './graph.js';
import type { Classification, Confidence, Relationship } from './model.js';

export interface ColumnRecord { name: string; type: string; nullable?: boolean; primaryKey?: boolean }
export interface TableRecord { name: string; model?: string; columns: ColumnRecord[]; indexes: { name?: string; columns: string[]; unique?: boolean }[]; foreignKeys: { column: string; referencesTable: string; referencesColumn?: string }[]; source: { type: string; file: string; line: number }; origin: 'declared' | 'migration_derived' | 'inferred_model_mapping'; classification: Classification; confidence: Confidence; resolutionMethod: string }
export interface DatasourceRecord { provider?: string; file: string; line: number; configuration: string; redacted: boolean }
export interface SchemaResult { tables: TableRecord[]; datasources: DatasourceRecord[]; adapters: string[] }
export interface TableReference { file: string; line: number; table: string; relationship: Relationship; method: string; classification: Classification; confidence: Confidence }
export interface MigrationOperation { type: 'migration_creates' | 'migration_alters' | 'migration_drops'; table: string; line: number }
export interface MigrationRecord { id: string; name: string; file: string; order: number; dependsOn?: string[]; operations: MigrationOperation[] }
export interface MigrationChain { framework: string; directory: string; migrations: MigrationRecord[]; latest?: string; findings: { type: string; detail: string; files: string[] }[]; status: 'consistent' | 'findings' | 'unknown'; classification: Classification; confidence: Confidence; resolutionMethod: string }

const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length;
const datasourceProvider = (value: string) => /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|sqlite)\b/i.exec(value)?.[1].toLowerCase().replace(/^postgres$/, 'postgresql');
const table = (partial: Partial<TableRecord> & Pick<TableRecord, 'name' | 'source' | 'origin' | 'confidence' | 'resolutionMethod'>): TableRecord => ({ columns: [], indexes: [], foreignKeys: [], classification: partial.origin === 'inferred_model_mapping' ? 'inferred' : 'observed', ...partial });
const migrationPath = (file: string) => /(?:^|\/)migrat\w*\//i.test(file);
const chainPath = (file: string) => /(?:^|\/)(?:migrat\w*|db|sql|postgres\w*|mysql|sqlite|schema)\//i.test(file);

function sqlTables(file: string, text: string, origin: TableRecord['origin']): { tables: TableRecord[]; operations: MigrationOperation[] } {
  const tables: TableRecord[] = [], operations: MigrationOperation[] = [], byName = new Map<string, TableRecord>();
  for (const match of text.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?\w+"?\.)?"?(\w+)"?\s*\(/gi)) {
    const { args } = callArguments(text, match.index! + match[0].length - 1), record = table({ name: match[1], source: { type: 'sql_ddl', file, line: lineAt(text, match.index!) }, origin, confidence: 'high', resolutionMethod: 'sql_ddl_parse' });
    for (const raw of args) {
      const item = raw.replace(/\s+/g, ' ').trim(), foreign = /FOREIGN\s+KEY\s*\(\s*"?(\w+)"?\s*\)\s*REFERENCES\s+"?(\w+)"?\s*(?:\(\s*"?(\w+)"?\s*\))?/i.exec(item), unique = /^(?:CONSTRAINT\s+"?\w+"?\s+)?UNIQUE\s*\(([^)]*)\)/i.exec(item), primary = /^(?:CONSTRAINT\s+"?\w+"?\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(item);
      if (foreign) { record.foreignKeys.push({ column: foreign[1], referencesTable: foreign[2], ...(foreign[3] ? { referencesColumn: foreign[3] } : {}) }); continue; }
      if (unique) { record.indexes.push({ columns: unique[1].split(',').map((column) => column.replace(/"/g, '').trim()), unique: true }); continue; }
      if (primary) { for (const column of primary[1].split(',')) { const found = record.columns.find((entry) => entry.name === column.replace(/"/g, '').trim()); if (found) found.primaryKey = true; } continue; }
      if (/^(?:CONSTRAINT|CHECK|INDEX|KEY)\b/i.test(item)) continue;
      const column = /^"?(\w+)"?\s+([\w]+(?:\s*\([^)]*\))?(?:\[\])?)(.*)$/.exec(item); if (!column) continue;
      const references = /REFERENCES\s+"?(\w+)"?\s*(?:\(\s*"?(\w+)"?\s*\))?/i.exec(column[3]);
      record.columns.push({ name: column[1], type: column[2].toLowerCase(), nullable: !/NOT\s+NULL|PRIMARY\s+KEY/i.test(column[3]), ...(/PRIMARY\s+KEY/i.test(column[3]) ? { primaryKey: true } : {}) });
      if (references) record.foreignKeys.push({ column: column[1], referencesTable: references[1], ...(references[2] ? { referencesColumn: references[2] } : {}) });
    }
    tables.push(record); byName.set(record.name, record); operations.push({ type: 'migration_creates', table: record.name, line: record.source.line });
  }
  for (const match of text.matchAll(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:CONCURRENTLY\s+)?"?(\w+)"?\s+ON\s+(?:ONLY\s+)?"?(\w+)"?\s*(?:USING\s+\w+\s*)?\(([^)]*)\)/gi)) { const target = byName.get(match[3]); const index = { name: match[2], columns: match[4].split(',').map((column) => column.replace(/"/g, '').trim().split(' ')[0]), unique: Boolean(match[1]) }; if (target) target.indexes.push(index); operations.push({ type: 'migration_alters', table: match[3], line: lineAt(text, match.index!) }); }
  for (const match of text.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:"?\w+"?\.)?"?(\w+)"?/gi)) operations.push({ type: 'migration_alters', table: match[1], line: lineAt(text, match.index!) });
  for (const match of text.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:"?\w+"?\.)?"?(\w+)"?/gi)) operations.push({ type: 'migration_drops', table: match[1], line: lineAt(text, match.index!) });
  return { tables, operations };
}

function prismaSchema(file: string, text: string): { tables: TableRecord[]; datasources: DatasourceRecord[] } {
  const tables: TableRecord[] = [], mapping = new Map<string, string>(), datasources: DatasourceRecord[] = [];
  for (const match of text.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) mapping.set(match[1], /@@map\(\s*"([^"]+)"\s*\)/.exec(match[2])?.[1] ?? match[1]);
  for (const match of text.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    const record = table({ name: mapping.get(match[1])!, model: match[1], source: { type: 'prisma_schema', file, line: lineAt(text, match.index!) }, origin: 'declared', confidence: 'high', resolutionMethod: 'prisma_schema_parse' });
    for (const line of match[2].split('\n')) {
      const block = /^\s*@@(index|unique)\(\s*\[([^\]]*)\]/.exec(line); if (block) { record.indexes.push({ columns: block[2].split(',').map((column) => column.trim()), unique: block[1] === 'unique' }); continue; }
      const field = /^\s*(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line); if (!field || field[1].startsWith('@')) continue;
      const relation = /@relation\(([^)]*)\)/.exec(field[5]);
      if (mapping.has(field[2])) { const fields = /fields\s*:\s*\[([^\]]*)\]/.exec(relation?.[1] ?? '')?.[1], references = /references\s*:\s*\[([^\]]*)\]/.exec(relation?.[1] ?? '')?.[1]; if (fields) record.foreignKeys.push({ column: fields.split(',')[0].trim(), referencesTable: mapping.get(field[2])!, ...(references ? { referencesColumn: references.split(',')[0].trim() } : {}) }); continue; }
      record.columns.push({ name: field[1], type: field[2].toLowerCase() + (field[3] ?? ''), nullable: Boolean(field[4]), ...(/@id\b/.test(field[5]) ? { primaryKey: true } : {}) });
      if (/@unique\b/.test(field[5])) record.indexes.push({ columns: [field[1]], unique: true });
    }
    tables.push(record);
  }
  for (const match of text.matchAll(/datasource\s+\w+\s*\{([\s\S]*?)\n\}/g)) { const provider = /provider\s*=\s*"([^"]+)"/.exec(match[1])?.[1], url = /url\s*=\s*(.+)/.exec(match[1])?.[1].trim() ?? '', safe = redactRepositoryText(url); datasources.push({ ...(provider ? { provider } : {}), file, line: lineAt(text, match.index!), configuration: safe.text, redacted: safe.redacted }); }
  return { tables, datasources };
}

function classBody(text: string, index: number): string { const lines = text.slice(index).split('\n'), indent = lines[0].match(/^\s*/)![0].length, body: string[] = [lines[0]]; for (const line of lines.slice(1)) { if (line.trim() && (line.match(/^\s*/)![0].length <= indent)) break; body.push(line); } return body.join('\n'); }

function pythonModels(file: string, text: string): TableRecord[] {
  const tables: TableRecord[] = [], app = path.posix.basename(path.posix.dirname(file)) || 'app';
  for (const match of text.matchAll(/^[ \t]*class\s+(\w+)\s*\(([^)]*)\)\s*:/gm)) {
    const bases = match[2], body = classBody(text, match.index!), line = lineAt(text, match.index!);
    if (/models\.Model\b/.test(bases)) {
      const explicit = /db_table\s*=\s*['"]([^'"]+)['"]/.exec(body)?.[1], record = table({ name: explicit ?? `${app}_${match[1].toLowerCase()}`, model: match[1], source: { type: 'django_model', file, line }, origin: explicit ? 'declared' : 'inferred_model_mapping', confidence: 'medium', resolutionMethod: 'django_model_heuristic' });
      for (const field of body.matchAll(/^\s+(\w+)\s*=\s*models\.(\w+)\(([^\n]*)\)/gm)) {
        if (field[2] === 'ManyToManyField') continue;
        const target = /^\s*['"]?([\w.]+)['"]?/.exec(field[3])?.[1];
        if (/ForeignKey|OneToOneField/.test(field[2]) && target) record.foreignKeys.push({ column: `${field[1]}_id`, referencesTable: target === 'self' ? record.name : target.split('.').at(-1)!, referencesColumn: 'id' }); // model name; mapped to its table after all models are parsed
        record.columns.push({ name: /ForeignKey|OneToOneField/.test(field[2]) ? `${field[1]}_id` : field[1], type: field[2].replace(/Field$/, '').toLowerCase(), nullable: /null\s*=\s*True/.test(field[3]), ...(/primary_key\s*=\s*True/.test(field[3]) ? { primaryKey: true } : {}) });
        if (/unique\s*=\s*True/.test(field[3]) || /db_index\s*=\s*True/.test(field[3])) record.indexes.push({ columns: [field[1]], unique: /unique\s*=\s*True/.test(field[3]) });
      }
      if (!record.columns.some((column) => column.primaryKey)) record.columns.unshift({ name: 'id', type: 'autofield', nullable: false, primaryKey: true });
      tables.push(record);
    } else if (/\bBase\b|db\.Model|DeclarativeBase/.test(bases) && /__tablename__|Column\(|mapped_column\(/.test(body)) {
      const name = /__tablename__\s*=\s*['"]([^'"]+)['"]/.exec(body)?.[1], record = table({ name: name ?? match[1].toLowerCase(), model: match[1], source: { type: 'sqlalchemy_model', file, line }, origin: name ? 'declared' : 'inferred_model_mapping', confidence: 'medium', resolutionMethod: 'sqlalchemy_model_heuristic' });
      for (const column of body.matchAll(/^\s+(\w+)\s*(?::\s*Mapped\[[^\]]+\])?\s*=\s*(?:sa\.|db\.)?(?:Column|mapped_column)\(([^\n]*)\)/gm)) {
        const foreign = /ForeignKey\(\s*['"]([\w]+)\.(\w+)['"]/.exec(column[2]), type = /^\s*(?:['"]\w+['"]\s*,\s*)?(?:sa\.|db\.)?([A-Z]\w*(?:\([^)]*\))?)/.exec(column[2])?.[1] ?? 'unknown';
        record.columns.push({ name: column[1], type: type.toLowerCase(), nullable: !/nullable\s*=\s*False|primary_key\s*=\s*True/.test(column[2]), ...(/primary_key\s*=\s*True/.test(column[2]) ? { primaryKey: true } : {}) });
        if (foreign) record.foreignKeys.push({ column: column[1], referencesTable: foreign[1], referencesColumn: foreign[2] });
        if (/index\s*=\s*True|unique\s*=\s*True/.test(column[2])) record.indexes.push({ columns: [column[1]], unique: /unique\s*=\s*True/.test(column[2]) });
      }
      for (const index of body.matchAll(/Index\(\s*['"](\w+)['"]\s*,\s*([^)]*)\)/g)) record.indexes.push({ name: index[1], columns: [...index[2].matchAll(/['"](\w+)['"]/g)].map((item) => item[1]) });
      tables.push(record);
    }
  }
  return tables;
}

function typescriptModels(file: string, text: string): TableRecord[] {
  const tables: TableRecord[] = [];
  for (const match of text.matchAll(/@Entity\(\s*(?:['"](\w+)['"])?[^)]*\)\s*(?:export\s+)?(?:default\s+)?class\s+(\w+)/g)) {
    const record = table({ name: match[1] ?? match[2], model: match[2], source: { type: 'typeorm_entity', file, line: lineAt(text, match.index!) }, origin: match[1] ? 'declared' : 'inferred_model_mapping', confidence: 'medium', resolutionMethod: 'typeorm_decorator_heuristic' });
    const body = text.slice(match.index!, text.indexOf('\n}', match.index!) + 2);
    for (const column of body.matchAll(/@(PrimaryGeneratedColumn|PrimaryColumn|Column|CreateDateColumn|UpdateDateColumn)\(([^)]*)\)\s*(?:@\w+\([^)]*\)\s*)*(?:readonly\s+)?(\w+)(\?)?\s*(?::\s*([\w[\]|<>]+))?/g)) record.columns.push({ name: column[3], type: (/type\s*:\s*['"](\w+)['"]/.exec(column[2])?.[1] ?? column[5] ?? 'unknown').toLowerCase(), nullable: Boolean(column[4]) || /nullable\s*:\s*true/.test(column[2]), ...(column[1].startsWith('Primary') ? { primaryKey: true } : {}) });
    for (const relation of body.matchAll(/@(?:ManyToOne|OneToOne)\(\s*\(\)\s*=>\s*(\w+)[^)]*\)\s*(?:@JoinColumn\([^)]*\)\s*)?(\w+)/g)) record.foreignKeys.push({ column: `${relation[2]}Id`, referencesTable: relation[1], referencesColumn: 'id' });
    for (const index of text.slice(Math.max(0, match.index! - 400), match.index!).matchAll(/@Index\(\s*(?:['"](\w+)['"]\s*,\s*)?\[([^\]]*)\]/g)) record.indexes.push({ ...(index[1] ? { name: index[1] } : {}), columns: index[2].split(',').map((column) => column.replace(/['"\s]/g, '')) });
    tables.push(record);
  }
  for (const match of text.matchAll(/(?:\w+\.define\(\s*['"](\w+)['"]\s*,\s*\{|(\w+)\.init\(\s*\{)/g)) {
    const { args } = callArguments(text, match.index! + match[0].length - 1), body = args.join(','), explicit = match[1] ?? /tableName\s*:\s*['"](\w+)['"]/.exec(text.slice(match.index!, match.index! + body.length + 400))?.[1];
    const record = table({ name: explicit ?? match[2], model: match[2] ?? match[1], source: { type: 'sequelize_model', file, line: lineAt(text, match.index!) }, origin: explicit ? 'declared' : 'inferred_model_mapping', confidence: 'medium', resolutionMethod: 'sequelize_definition_heuristic' });
    for (const column of body.matchAll(/(\w+)\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) { if (!/type\s*:/.test(column[2])) continue; const reference = /references\s*:\s*\{[^}]*model\s*:\s*['"](\w+)['"](?:[^}]*key\s*:\s*['"](\w+)['"])?/.exec(column[2]); record.columns.push({ name: column[1], type: (/DataTypes\.(\w+)|Sequelize\.(\w+)/.exec(column[2])?.[1] ?? 'unknown').toLowerCase(), nullable: !/allowNull\s*:\s*false|primaryKey\s*:\s*true/.test(column[2]), ...(/primaryKey\s*:\s*true/.test(column[2]) ? { primaryKey: true } : {}) }); if (reference) record.foreignKeys.push({ column: column[1], referencesTable: reference[1], ...(reference[2] ? { referencesColumn: reference[2] } : {}) }); if (/unique\s*:\s*true/.test(column[2])) record.indexes.push({ columns: [column[1]], unique: true }); }
    tables.push(record);
  }
  const modelToTable = new Map(tables.filter((record) => record.model).map((record) => [record.model!, record.name]));
  for (const record of tables) for (const key of record.foreignKeys) key.referencesTable = modelToTable.get(key.referencesTable) ?? key.referencesTable;
  return tables;
}

export async function repositorySchema(model: RepositoryModel): Promise<SchemaResult> {
  const tables: TableRecord[] = [], datasources: DatasourceRecord[] = [], adapters = new Set<string>();
  for (const file of model.allFiles.filter((candidate) => candidate.endsWith('.prisma') || candidate.endsWith('.sql'))) {
    try { const text = (await readRepositoryText(model.root, file, 500_000)).text; if (file.endsWith('.prisma')) { const parsed = prismaSchema(file, text); if (parsed.tables.length || parsed.datasources.length) adapters.add('prisma'); tables.push(...parsed.tables); datasources.push(...parsed.datasources); } else { const parsed = sqlTables(file, text, migrationPath(file) ? 'migration_derived' : 'declared'); if (parsed.tables.length) adapters.add('sql'); tables.push(...parsed.tables); } } catch { /* unreadable schema file skipped */ }
  }
  for (const module of model.modules.values()) {
    if (module.test) continue;
    const found = module.language === 'python' ? pythonModels(module.file, module.text) : typescriptModels(module.file, module.text);
    for (const record of found) adapters.add(record.source.type.replace(/_(?:model|entity)$/, ''));
    tables.push(...found);
  }
  const known = new Set(tables.map((record) => record.name));
  for (const record of tables) for (const key of record.foreignKeys) if (!known.has(key.referencesTable)) { const target = tables.find((candidate) => candidate.model === key.referencesTable); if (target) key.referencesTable = target.name; }
  for (const file of model.allFiles.filter((candidate) => /(?:^|\/)(?:alembic\.ini|ormconfig\.(?:json|js|ts)|knexfile\.[jt]s|\.sequelizerc|settings\.py|database\.(?:yml|yaml|json))$/.test(candidate))) {
    try { const text = (await readRepositoryText(model.root, file, 200_000)).text, match = /(?:sqlalchemy\.url|DATABASE_URL|url|host|ENGINE|client|dialect)\s*[:=]\s*(.+)/i.exec(text); if (match) { const safe = redactRepositoryText(match[0].slice(0, 200)), provider = datasourceProvider(match[0]); datasources.push({ ...(provider ? { provider } : {}), file, line: lineAt(text, match.index!), configuration: safe.text, redacted: safe.redacted }); } } catch { /* skip */ }
  }
  return { tables: tables.sort((a, b) => a.name.localeCompare(b.name) || a.source.file.localeCompare(b.source.file)), datasources, adapters: [...adapters].sort() };
}

export function tableReferences(model: RepositoryModel, schema: SchemaResult): TableReference[] {
  const references: TableReference[] = [], modelToTable = new Map(schema.tables.filter((record) => record.model).map((record) => [record.model!, record.name])), tables = new Set(schema.tables.map((record) => record.name));
  const add = (file: string, line: number, name: string, relationship: Relationship, method: string, confidence: Confidence) => references.push({ file, line, table: modelToTable.get(name) ?? name, relationship, method, classification: 'observed', confidence });
  const SQL_NOISE = /^(?:select|where|values|dual|set|on|as|and|or|not|null|true|false|only|lateral|unnest)$/i;
  for (const module of model.modules.values()) {
    const text = module.text;
    // SQL is only recognised inside string literals so prose such as "read from the users table" is not evidence.
    for (const literal of text.matchAll(/"""[\s\S]*?"""|'''[\s\S]*?'''|`[\s\S]*?`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g)) {
      if (!/\b(?:select|insert|update|delete)\b/i.test(literal[0])) continue;
      for (const match of literal[0].matchAll(/\b(?:from|join)\s+"?([a-z_]\w*)"?/gi)) if (!SQL_NOISE.test(match[1])) add(module.file, lineAt(text, literal.index! + match.index!), match[1], 'reads_table', 'sql_string', 'medium');
      for (const match of literal[0].matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+"?([a-z_]\w*)"?/gi)) if (!SQL_NOISE.test(match[1])) add(module.file, lineAt(text, literal.index! + match.index!), match[1], 'writes_table', 'sql_string', 'medium');
    }
    for (const match of text.matchAll(/\bprisma\.(\w+)\.(findMany|findUnique|findFirst|count|aggregate|groupBy|create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g)) add(module.file, lineAt(text, match.index!), match[1].charAt(0).toUpperCase() + match[1].slice(1), /^(?:find|count|aggregate|groupBy)/.test(match[2]) ? 'reads_table' : 'writes_table', 'prisma_client_call', 'medium');
    for (const match of text.matchAll(/\b([A-Z]\w+)\.objects\.(filter|get|all|first|last|count|exists|values|create|update|delete|bulk_create|get_or_create|update_or_create)\b/g)) add(module.file, lineAt(text, match.index!), match[1], /create|update|delete/.test(match[2]) ? 'writes_table' : 'reads_table', 'django_orm_call', 'medium');
    for (const match of text.matchAll(/\b(?:session\.query|select|getRepository|Repository<)\(?\s*([A-Z]\w+)\b/g)) if (modelToTable.has(match[1])) add(module.file, lineAt(text, match.index!), match[1], 'references_table', 'orm_model_reference', 'medium');
    for (const match of text.matchAll(/\b([A-Z]\w+)\.(findAll|findOne|findByPk|findAndCountAll|create|bulkCreate|update|destroy|upsert)\(/g)) if (modelToTable.has(match[1])) add(module.file, lineAt(text, match.index!), match[1], /find/.test(match[2]) ? 'reads_table' : 'writes_table', 'sequelize_model_call', 'medium');
  }
  return references.filter((reference, index, all) => all.findIndex((other) => other.file === reference.file && other.line === reference.line && other.table === reference.table && other.relationship === reference.relationship) === index).map((reference) => tables.has(reference.table) ? reference : { ...reference, classification: 'inferred', confidence: 'low' });
}

function pythonOperations(text: string): MigrationOperation[] {
  const operations: MigrationOperation[] = [];
  for (const match of text.matchAll(/op\.(create_table|add_column|alter_column|drop_column|drop_table|create_index|drop_index|rename_table)\(\s*(?:['"]\w+['"]\s*,\s*)?['"](\w+)['"]/g)) operations.push({ type: match[1] === 'create_table' ? 'migration_creates' : match[1] === 'drop_table' ? 'migration_drops' : 'migration_alters', table: match[2], line: lineAt(text, match.index!) });
  for (const match of text.matchAll(/migrations\.(CreateModel|DeleteModel|AddField|AlterField|RemoveField|RenameField|AlterModelTable|AddIndex|RemoveIndex)\(\s*(?:name|model_name)\s*=\s*['"](\w+)['"]/g)) operations.push({ type: match[1] === 'CreateModel' ? 'migration_creates' : match[1] === 'DeleteModel' ? 'migration_drops' : 'migration_alters', table: match[2].toLowerCase(), line: lineAt(text, match.index!) });
  return operations;
}
const javascriptOperations = (text: string): MigrationOperation[] => [...text.matchAll(/\.(createTable|dropTable|alterTable|addColumn|removeColumn|renameColumn|changeColumn|addIndex|removeIndex)\(\s*['"](\w+)['"]/g)].map((match) => ({ type: match[1] === 'createTable' ? 'migration_creates' as const : match[1] === 'dropTable' ? 'migration_drops' as const : 'migration_alters' as const, table: match[2], line: lineAt(text, match.index!) }));

export async function migrationChains(model: RepositoryModel): Promise<MigrationChain[]> {
  const read = async (file: string) => { try { return (await readRepositoryText(model.root, file, 500_000)).text; } catch { return ''; } };
  const chains: MigrationChain[] = [], claimed = new Set<string>();
  const finish = (framework: string, directory: string, migrations: MigrationRecord[], findings: MigrationChain['findings'], confidence: Confidence, resolutionMethod: string): MigrationChain => ({ framework, directory, migrations: migrations.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)), ...(migrations.length ? { latest: migrations.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).at(-1)!.id } : {}), findings, status: !migrations.length ? 'unknown' : findings.length ? 'findings' : 'consistent', classification: 'observed', confidence, resolutionMethod });
  const duplicates = (migrations: MigrationRecord[], key: (item: MigrationRecord) => string): MigrationChain['findings'] => { const groups = new Map<string, MigrationRecord[]>(); for (const item of migrations) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]); return [...groups.entries()].filter(([, items]) => items.length > 1).map(([id, items]) => ({ type: 'duplicate_identifier', detail: `identifier ${id} appears ${items.length} times`, files: items.map((item) => item.file) })); };
  const gaps = (migrations: MigrationRecord[]): MigrationChain['findings'] => { const orders = [...new Set(migrations.map((item) => item.order))].sort((a, b) => a - b); if (!orders.length || orders.at(-1)! > 100_000) return []; const missing = []; for (let expected = orders[0]; expected <= orders.at(-1)!; expected++) if (!orders.includes(expected)) missing.push(expected); return missing.length ? [{ type: 'gap', detail: `sequence skips ${missing.join(', ')}`, files: migrations.map((item) => item.file) }] : []; };

  const prisma = model.allFiles.filter((file) => /(?:^|\/)prisma\/migrations\/(\d{14})_[^/]+\/migration\.sql$/.test(file));
  if (prisma.length) { const migrations: MigrationRecord[] = []; for (const file of prisma) { const match = /(\d{14})_([^/]+)\/migration\.sql$/.exec(file)!; claimed.add(file); migrations.push({ id: `${match[1]}_${match[2]}`, name: match[2], file, order: Number(match[1]), operations: sqlTables(file, await read(file), 'migration_derived').operations }); } chains.push(finish('prisma', path.posix.dirname(path.posix.dirname(prisma[0])), migrations, duplicates(migrations, (item) => String(item.order)), 'high', 'prisma_migration_directory')); }

  const alembic: MigrationRecord[] = [];
  for (const file of model.allFiles.filter((candidate) => /(?:^|\/)versions\/[^/]+\.py$/.test(candidate))) { const text = await read(file), revision = /^\s*revision\s*(?::\s*[\w[\]|, ]+)?=\s*['"]([\w]+)['"]/m.exec(text)?.[1]; if (!revision) continue; claimed.add(file); const down = /^\s*down_revision\s*(?::[^=]+)?=\s*(.+)$/m.exec(text)?.[1] ?? 'None', dependsOn = [...down.matchAll(/['"](\w+)['"]/g)].map((match) => match[1]); alembic.push({ id: revision, name: path.posix.basename(file, '.py'), file, order: 0, dependsOn, operations: pythonOperations(text) }); }
  if (alembic.length) {
    const ids = new Set(alembic.map((item) => item.id)), findings = duplicates(alembic, (item) => item.id), referenced = new Set(alembic.flatMap((item) => item.dependsOn ?? []));
    for (const item of alembic) for (const parent of item.dependsOn ?? []) if (!ids.has(parent)) findings.push({ type: 'missing_dependency', detail: `${item.id} depends on unknown revision ${parent}`, files: [item.file] });
    const heads = alembic.filter((item) => !referenced.has(item.id)); if (heads.length > 1) findings.push({ type: 'multiple_heads', detail: `revisions ${heads.map((item) => item.id).join(', ')} are all heads; the chain branches`, files: heads.map((item) => item.file) });
    let order = 0; const placedFiles = new Set<string>(), placedIds = new Set<string>(); let progressed = true;
    while (progressed) { progressed = false; for (const item of alembic.sort((a, b) => a.id.localeCompare(b.id) || a.file.localeCompare(b.file))) if (!placedFiles.has(item.file) && (item.dependsOn ?? []).every((parent) => placedIds.has(parent))) { item.order = ++order; placedFiles.add(item.file); placedIds.add(item.id); progressed = true; } }
    for (const item of alembic) if (!placedFiles.has(item.file) && (item.dependsOn ?? []).some((parent) => !ids.has(parent))) { item.order = ++order; placedFiles.add(item.file); }
    for (const item of alembic) if (!placedFiles.has(item.file)) { item.order = ++order; findings.push({ type: 'cycle', detail: `${item.id} participates in a dependency cycle`, files: [item.file] }); }
    chains.push(finish('alembic', path.posix.dirname(alembic[0].file), alembic, findings, 'high', 'alembic_revision_parse'));
  }

  const django = new Map<string, MigrationRecord[]>();
  for (const file of model.allFiles.filter((candidate) => /(?:^|\/)migrations\/\d{4}_\w+\.py$/.test(candidate))) { const match = /(?:^|\/)([\w]+)\/migrations\/(\d{4})_(\w+)\.py$/.exec(file)!, text = await read(file); claimed.add(file); django.set(match[1], [...(django.get(match[1]) ?? []), { id: `${match[1]}/${match[2]}_${match[3]}`, name: `${match[2]}_${match[3]}`, file, order: Number(match[2]), dependsOn: [...text.matchAll(/\(\s*['"](\w+)['"]\s*,\s*['"](\w+)['"]\s*\)/g)].map((dependency) => `${dependency[1]}/${dependency[2]}`), operations: pythonOperations(text) }]); }
  if (django.size) { const migrations = [...django.values()].flat(), ids = new Set(migrations.map((item) => item.id)), findings = [...django.entries()].flatMap(([app, items]) => [...duplicates(items, (item) => `${app}/${String(item.order).padStart(4, '0')}`), ...gaps(items)]); for (const item of migrations) for (const parent of item.dependsOn ?? []) if (!ids.has(parent) && !parent.startsWith('__')) findings.push({ type: 'missing_dependency', detail: `${item.id} depends on unknown migration ${parent}`, files: [item.file] }); chains.push(finish('django', [...django.keys()].map((app) => `${app}/migrations`).join(','), migrations, findings, 'high', 'django_migration_directory')); }

  const generic = model.allFiles.filter((file) => !claimed.has(file) && chainPath(file) && /(?:^|\/)(?:V?(\d+)[-_.]|(\d{8,}))[^/]*\.(?:sql|[cm]?[jt]s)$/.test(file));
  if (generic.length) {
    const migrations: MigrationRecord[] = []; let framework = 'sql';
    for (const file of generic) { const text = await read(file), match = /(?:^|\/)V?(\d+)[-_.]?([^/]*)\.(sql|[cm]?[jt]s)$/.exec(file)!; if (match[3] !== 'sql') framework = /MigrationInterface/.test(text) ? 'typeorm' : /queryInterface/.test(text) ? 'sequelize' : /knex/i.test(text) ? 'knex' : 'javascript'; migrations.push({ id: path.posix.basename(file), name: match[2] || path.posix.basename(file), file, order: Number(match[1]), operations: match[3] === 'sql' ? sqlTables(file, text, 'migration_derived').operations : javascriptOperations(text) }); }
    chains.push(finish(framework, path.posix.dirname(generic[0]), migrations, [...duplicates(migrations, (item) => String(item.order)), ...gaps(migrations)], 'medium', 'numbered_migration_files'));
  }
  return chains;
}
