import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryDatabase } from '../../src/db/memory-database.js';
import { MemberRepository, rowToMember } from '../../src/members/member-repository.js';
import { MemberService } from '../../src/members/member-service.js';

test('schema declares the members columns and seed rows load', () => {
  const db = new MemoryDatabase();
  assert.deepEqual(db.schema.get('members'), ['id', 'display_name', 'joined_at']);
  assert.equal(db.select('members').length, 3);
  assert.deepEqual(db.select('members', { id: 'm-1' }), [{ id: 'm-1', display_name: 'Ada Lovelace', joined_at: '2024-01-05' }]);
});

test('rowToMember maps storage columns to the domain shape', () => {
  assert.deepEqual(rowToMember({ id: 'm-9', display_name: 'Edsger Dijkstra', joined_at: '2024-05-01' }), { id: 'm-9', displayName: 'Edsger Dijkstra', joinedAt: '2024-05-01' });
});

test('repository finds by id and by column filter', () => {
  const repository = new MemberRepository(new MemoryDatabase());
  assert.deepEqual(repository.findById('m-2'), { id: 'm-2', displayName: 'Grace Hopper', joinedAt: '2024-02-11' });
  assert.equal(repository.findById('m-404'), null);
  assert.deepEqual(repository.findWhere({ display_name: 'Ada Lovelace' }).map((member) => member.id), ['m-1', 'm-3']);
});

test('rename persists to the storage column', () => {
  const db = new MemoryDatabase();
  const service = new MemberService(new MemberRepository(db));
  assert.deepEqual(service.renameMember('m-2', '  Grace B. Hopper '), { id: 'm-2', displayName: 'Grace B. Hopper', joinedAt: '2024-02-11' });
  assert.deepEqual(db.select('members', { id: 'm-2' }), [{ id: 'm-2', display_name: 'Grace B. Hopper', joined_at: '2024-02-11' }]);
  assert.equal(service.renameMember('m-404', 'Nobody'), null);
  assert.throws(() => service.renameMember('m-1', '  '), TypeError);
});

test('the database rejects columns the schema does not declare', () => {
  const db = new MemoryDatabase();
  assert.throws(() => db.select('members', { nickname: 'x' }), /unknown column members\.nickname/);
  assert.throws(() => db.update('members', { id: 'm-1' }, { nickname: 'x' }), /unknown column members\.nickname/);
});
