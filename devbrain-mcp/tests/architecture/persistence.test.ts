import { afterEach, describe, expect, it } from 'vitest';
import { databaseSchema } from '../../src/tools/database-schema.js';
import { migrationStatus } from '../../src/tools/migration-status.js';
import { fixture, type Fixture } from './fixture.js';

let current: Fixture | undefined;
afterEach(async () => { await current?.cleanup(); current = undefined; });
const tableNamed = (result: Awaited<ReturnType<typeof databaseSchema>>, name: string) => ('tables' in result ? result.tables : undefined)?.find((table) => table.name === name);

describe('database schema', () => {
  it('normalizes a Prisma schema with relations, indexes, mapped names, and a redacted datasource', async () => {
    current = await fixture({
      'package.json': JSON.stringify({ name: 'shop', dependencies: { '@prisma/client': '5.0.0' } }),
      'prisma/schema.prisma': `datasource db {\n  provider = "postgresql"\n  url      = "postgresql://shop:s3cr3tvalue@db.internal:5432/shop"\n}\n\nmodel User {\n  id    String @id @default(uuid())\n  email String @unique\n  posts Post[]\n}\n\nmodel Post {\n  id       Int     @id @default(autoincrement())\n  title    String?\n  authorId String\n  author   User    @relation(fields: [authorId], references: [id])\n\n  @@index([authorId])\n  @@map("posts")\n}\n`,
      'src/repo.ts': `export const list = () => prisma.post.findMany();\nexport const add = () => prisma.user.create({ data: {} });\n`,
    });
    const result = await databaseSchema({ path: current.repo });
    expect(result).toMatchObject({ status: 'complete', adapters: ['prisma'], totalTables: 2, databaseState: 'repository_declared_only', boundary: { runtime: 'not_observed' } });
    expect(tableNamed(result, 'posts')).toMatchObject({ model: 'Post', origin: 'declared', classification: 'observed', confidence: 'high', source: { type: 'prisma_schema', file: 'prisma/schema.prisma' }, columns: [{ name: 'id', type: 'int', nullable: false, primaryKey: true }, { name: 'title', type: 'string', nullable: true }, { name: 'authorId', type: 'string', nullable: false }], foreignKeys: [{ column: 'authorId', referencesTable: 'User', referencesColumn: 'id' }], indexes: [{ columns: ['authorId'], unique: false }] });
    expect(tableNamed(result, 'User')).toMatchObject({ indexes: [{ columns: ['email'], unique: true }] });
    expect('datasources' in result && result.datasources).toEqual([{ provider: 'postgresql', file: 'prisma/schema.prisma', line: 1, configuration: '"postgresql://shop:[REDACTED]@db.internal:5432/shop"', redacted: true }]);
    expect(JSON.stringify(result)).not.toContain('s3cr3tvalue');
    expect('references' in result && result.references).toEqual(expect.arrayContaining([expect.objectContaining({ file: 'src/repo.ts', line: 1, table: 'posts', relationship: 'reads_table', method: 'prisma_client_call', classification: 'observed', confidence: 'medium' }), expect.objectContaining({ line: 2, table: 'User', relationship: 'writes_table' })]));
  });

  it('parses SQL DDL, SQLAlchemy, Django, TypeORM, and Sequelize definitions with explicit origins', async () => {
    current = await fixture({
      'db/schema.sql': `CREATE TABLE users (\n  id uuid PRIMARY KEY,\n  email text NOT NULL,\n  created_at timestamptz DEFAULT now()\n);\nCREATE TABLE IF NOT EXISTS "orders" (\n  id serial PRIMARY KEY,\n  user_id uuid NOT NULL REFERENCES users(id),\n  total numeric(10, 2),\n  CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users (id)\n);\nCREATE UNIQUE INDEX orders_user_idx ON orders (user_id);\n`,
      'app/models.py': `from sqlalchemy import Column, ForeignKey, Integer, String\nfrom .base import Base\n\nclass Account(Base):\n    __tablename__ = 'accounts'\n    id = Column(Integer, primary_key=True)\n    email = Column(String(120), nullable=False, unique=True)\n\nclass Invoice(Base):\n    __tablename__ = 'invoices'\n    id = Column(Integer, primary_key=True)\n    account_id = Column(Integer, ForeignKey('accounts.id'), index=True)\n`,
      'blog/models.py': `from django.db import models\n\nclass Author(models.Model):\n    name = models.CharField(max_length=80)\n\n    class Meta:\n        db_table = 'authors'\n\nclass Post(models.Model):\n    title = models.CharField(max_length=120, db_index=True)\n    author = models.ForeignKey('Author', on_delete=models.CASCADE)\n    body = models.TextField(null=True)\n`,
      'src/entities.ts': `import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';\n@Entity('accounts_ts')\nexport class Account {\n  @PrimaryGeneratedColumn() id: number;\n  @Column({ nullable: true }) name?: string;\n}\n@Index(['ownerId'])\n@Entity()\nexport class Wallet {\n  @PrimaryGeneratedColumn() id: number;\n  @Column({ type: 'decimal' }) balance: string;\n  @ManyToOne(() => Account) owner: Account;\n}\n`,
      'src/sequelize.js': `const Customer = sequelize.define('customers', {\n  id: { type: DataTypes.UUID, primaryKey: true },\n  email: { type: DataTypes.STRING, allowNull: false, unique: true },\n  accountId: { type: DataTypes.INTEGER, references: { model: 'accounts_ts', key: 'id' } },\n});\nmodule.exports = { Customer };\n`,
      'src/queries.py': `def load(conn):\n    return conn.fetch("""\n        select id, email from accounts where id = $1\n    """)\n\ndef save(conn):\n    conn.execute("INSERT INTO invoices (id) VALUES ($1)")\n    # prose: read from the users table is not evidence\n    return Post.objects.filter(title='x')\n`,
    });
    const result = await databaseSchema({ path: current.repo });
    expect(result).toMatchObject({ status: 'complete', adapters: ['django', 'sequelize', 'sql', 'sqlalchemy', 'typeorm'], totalTables: 9 });
    expect(tableNamed(result, 'orders')).toMatchObject({ origin: 'declared', confidence: 'high', source: { type: 'sql_ddl' }, columns: [{ name: 'id', type: 'serial', nullable: false, primaryKey: true }, { name: 'user_id', type: 'uuid', nullable: false }, { name: 'total', type: 'numeric(10, 2)', nullable: true }], foreignKeys: [{ column: 'user_id', referencesTable: 'users', referencesColumn: 'id' }, { column: 'user_id', referencesTable: 'users', referencesColumn: 'id' }], indexes: [{ name: 'orders_user_idx', columns: ['user_id'], unique: true }] });
    expect(tableNamed(result, 'invoices')).toMatchObject({ model: 'Invoice', origin: 'declared', confidence: 'medium', source: { type: 'sqlalchemy_model' }, foreignKeys: [{ column: 'account_id', referencesTable: 'accounts', referencesColumn: 'id' }], indexes: [{ columns: ['account_id'], unique: false }] });
    expect(tableNamed(result, 'authors')).toMatchObject({ model: 'Author', origin: 'declared', columns: [{ name: 'id', type: 'autofield', primaryKey: true }, { name: 'name', type: 'char', nullable: false }] });
    expect(tableNamed(result, 'blog_post')).toMatchObject({ model: 'Post', origin: 'inferred_model_mapping', classification: 'inferred', foreignKeys: [{ column: 'author_id', referencesTable: 'authors', referencesColumn: 'id' }], indexes: [{ columns: ['title'], unique: false }] });
    expect(tableNamed(result, 'Wallet')).toMatchObject({ origin: 'inferred_model_mapping', source: { type: 'typeorm_entity' }, columns: [{ name: 'id', primaryKey: true }, { name: 'balance', type: 'decimal' }], foreignKeys: [{ column: 'ownerId', referencesTable: 'accounts_ts' }], indexes: [{ columns: ['ownerId'] }] });
    expect(tableNamed(result, 'customers')).toMatchObject({ origin: 'declared', source: { type: 'sequelize_model' }, columns: [{ name: 'id', type: 'uuid', primaryKey: true }, { name: 'email', type: 'string', nullable: false }, { name: 'accountId', type: 'integer', nullable: true }], foreignKeys: [{ column: 'accountId', referencesTable: 'accounts_ts', referencesColumn: 'id' }] });
    const references = 'references' in result ? result.references ?? [] : [];
    expect(references).toEqual(expect.arrayContaining([expect.objectContaining({ file: 'src/queries.py', table: 'accounts', relationship: 'reads_table', method: 'sql_string' }), expect.objectContaining({ table: 'invoices', relationship: 'writes_table' }), expect.objectContaining({ table: 'blog_post', relationship: 'reads_table', method: 'django_orm_call' })]));
    expect(references.some((reference) => reference.table === 'users')).toBe(false);
  });

  it('reports unsupported when no schema evidence exists', async () => {
    current = await fixture({ 'src/index.ts': 'export const x = 1;\n' });
    expect(await databaseSchema({ path: current.repo })).toMatchObject({ status: 'unsupported', tables: [], adapters: [], message: expect.stringContaining('no schema is claimed') });
  });

  it('reports datasource providers while redacting repository credentials', async () => {
    current = await fixture({ 'alembic.ini': 'sqlalchemy.url = postgresql://alice:supersecretvalue@db.internal/app\n' });
    const result = await databaseSchema({ path: current.repo });
    expect(result).toMatchObject({ status: 'complete', tables: [], datasources: [{ provider: 'postgresql', file: 'alembic.ini', configuration: 'sqlalchemy.url = postgresql://alice:[REDACTED]@db.internal/app', redacted: true }] });
    expect(JSON.stringify(result)).not.toContain('supersecretvalue');
  });
});

describe('migration status', () => {
  it('orders Prisma migrations and derives migration operations', async () => {
    current = await fixture({
      'prisma/migrations/20240101000000_init/migration.sql': `CREATE TABLE "users" ("id" TEXT NOT NULL PRIMARY KEY);\n`,
      'prisma/migrations/20240215000000_add_posts/migration.sql': `CREATE TABLE "posts" ("id" SERIAL PRIMARY KEY);\nALTER TABLE "users" ADD COLUMN "name" TEXT;\nCREATE INDEX "posts_idx" ON "posts" ("id");\n`,
    });
    const result = await migrationStatus({ path: current.repo });
    expect(result).toMatchObject({ status: 'complete', frameworks: ['prisma'], repositoryChainStatus: 'consistent', totalMigrations: 2, databaseState: 'not_observed', summary: expect.stringContaining('appears consistent') });
    expect('chains' in result && result.chains?.[0]).toMatchObject({ framework: 'prisma', latest: '20240215000000_add_posts', status: 'consistent', findings: [], confidence: 'high', migrations: [expect.objectContaining({ id: '20240101000000_init', operations: [{ type: 'migration_creates', table: 'users', line: 1 }] }), expect.objectContaining({ operations: expect.arrayContaining([{ type: 'migration_creates', table: 'posts', line: 1 }, { type: 'migration_alters', table: 'users', line: 2 }, { type: 'migration_alters', table: 'posts', line: 3 }]) })] });
    const schema = await databaseSchema({ path: current.repo });
    expect(tableNamed(schema, 'posts')).toMatchObject({ origin: 'migration_derived', source: { type: 'sql_ddl' } });
  });

  it('detects Alembic duplicates, missing dependencies, and multiple heads, and Django gaps and duplicates', async () => {
    current = await fixture({
      'alembic/env.py': '',
      'alembic/versions/a1_init.py': `revision = 'a1'\ndown_revision = None\n\ndef upgrade():\n    op.create_table('users')\n`,
      'alembic/versions/b2_more.py': `revision = 'b2'\ndown_revision = 'a1'\n\ndef upgrade():\n    op.add_column('users', sa.Column('name'))\n`,
      'alembic/versions/b2_dup.py': `revision = 'b2'\ndown_revision = 'a1'\n`,
      'alembic/versions/c3_branch.py': `revision = 'c3'\ndown_revision = 'zz'\n`,
      'shop/migrations/0001_initial.py': `operations = [migrations.CreateModel(name='Order', fields=[])]\n`,
      'shop/migrations/0002_add_total.py': `dependencies = [('shop', '0001_initial')]\noperations = [migrations.AddField(model_name='order', name='total')]\n`,
      'shop/migrations/0002_add_status.py': `dependencies = [('shop', '0001_initial')]\n`,
      'shop/migrations/0004_later.py': `dependencies = [('shop', '0003_missing')]\n`,
    });
    const result = await migrationStatus({ path: current.repo });
    expect(result).toMatchObject({ frameworks: ['alembic', 'django'], repositoryChainStatus: 'findings', totalMigrations: 8, summary: expect.stringContaining('findings') });
    if (!('chains' in result) || !result.chains) throw new Error('missing chains');
    const alembic = result.chains.find((chain) => chain.framework === 'alembic')!, django = result.chains.find((chain) => chain.framework === 'django')!;
    expect(alembic.findings.map((finding) => finding.type).sort()).toEqual(['duplicate_identifier', 'missing_dependency', 'multiple_heads']);
    expect(alembic.migrations.map((migration) => migration.id)).toEqual(['a1', 'b2', 'b2', 'c3']);
    expect(alembic.migrations[0].operations).toEqual([{ type: 'migration_creates', table: 'users', line: 5 }]);
    expect(django.findings.map((finding) => finding.type).sort()).toEqual(['duplicate_identifier', 'gap', 'missing_dependency']);
    expect(django).toMatchObject({ latest: 'shop/0004_later', migrations: expect.arrayContaining([expect.objectContaining({ id: 'shop/0001_initial', operations: [{ type: 'migration_creates', table: 'order', line: 1 }] })]) });
  });

  it('handles numbered SQL and Knex chains, and reports unknown when no migrations exist', async () => {
    current = await fixture({
      'migrations/001_init.sql': `CREATE TABLE users (id int PRIMARY KEY);\n`,
      'migrations/002_orders.sql': `CREATE TABLE orders (id int PRIMARY KEY);\nDROP TABLE legacy;\n`,
      'migrations/003_widgets.js': `exports.up = (knex) => knex.schema.createTable('widgets', (t) => t.increments());\nexports.down = (knex) => knex.schema.dropTable('widgets');\n`,
    });
    const result = await migrationStatus({ path: current.repo });
    expect(result).toMatchObject({ repositoryChainStatus: 'consistent', totalMigrations: 3 });
    expect('chains' in result && result.chains?.[0]).toMatchObject({ framework: 'knex', directory: 'migrations', latest: '003_widgets.js', confidence: 'medium', migrations: [expect.objectContaining({ id: '001_init.sql', order: 1 }), expect.objectContaining({ operations: [{ type: 'migration_creates', table: 'orders', line: 1 }, { type: 'migration_drops', table: 'legacy', line: 2 }] }), expect.objectContaining({ operations: [{ type: 'migration_creates', table: 'widgets', line: 1 }, { type: 'migration_drops', table: 'widgets', line: 2 }] })] });
    await current.cleanup();
    current = await fixture({ 'src/index.ts': 'export const x = 1;\n' });
    expect(await migrationStatus({ path: current.repo })).toMatchObject({ status: 'complete', frameworks: [], chains: [], totalMigrations: 0, repositoryChainStatus: 'unknown', summary: expect.stringContaining('unknown') });
  });

  it('terminates cyclic Alembic revisions and reports each unresolved revision', async () => {
    current = await fixture({
      'alembic/versions/a_cycle.py': `revision = 'a'\ndown_revision = 'b'\n`,
      'alembic/versions/b_cycle.py': `revision = 'b'\ndown_revision = 'a'\n`,
    });
    const result = await migrationStatus({ path: current.repo });
    expect(result).toMatchObject({ repositoryChainStatus: 'findings', totalMigrations: 2 });
    if (!('chains' in result) || !result.chains) throw new Error('missing chains');
    expect(result.chains[0].findings.filter((finding) => finding.type === 'cycle').map((finding) => finding.files[0]).sort()).toEqual(['alembic/versions/a_cycle.py', 'alembic/versions/b_cycle.py']);
  });
});
