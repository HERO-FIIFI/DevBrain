import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serializeMember } from '../../src/api/member-serializer.js';
import { MemoryDatabase } from '../../src/db/memory-database.js';
import { createMemberRoute } from '../../src/http/member-route.js';
import { MemberRepository } from '../../src/members/member-repository.js';
import { MemberService } from '../../src/members/member-service.js';

test('GET /members/:id returns the public member shape', () => {
  const handle = createMemberRoute(new MemoryDatabase());
  assert.deepEqual(handle({ method: 'GET', url: '/members/m-1' }), { status: 200, body: { id: 'm-1', displayName: 'Ada Lovelace', joinedAt: '2024-01-05' } });
  assert.deepEqual(handle({ method: 'GET', url: '/members/m-404' }), { status: 404, body: { error: 'member_not_found' } });
  assert.deepEqual(handle({ method: 'DELETE', url: '/members/m-1' }), { status: 405, body: { error: 'method_not_allowed' } });
  assert.deepEqual(handle({ method: 'GET', url: '/teams/t-1' }), { status: 404, body: { error: 'not_found' } });
});

test('service lookups serialize to the same public shape', () => {
  const service = new MemberService(new MemberRepository(new MemoryDatabase()));
  assert.deepEqual(serializeMember(service.getMember('m-2')), { id: 'm-2', displayName: 'Grace Hopper', joinedAt: '2024-02-11' });
  assert.deepEqual(service.findByDisplayName('Ada Lovelace').map(serializeMember).map((member) => member.id), ['m-1', 'm-3']);
});
