// Framework-free `GET /members/:id` handler. Reads a row directly and serializes it for the public API.
import { serializeMemberRow } from '../api/member-serializer.js';

const MEMBER_PATH = /^\/members\/([^/]+)$/;

export function createMemberRoute(database) {
  return function handle(request) {
    const match = MEMBER_PATH.exec(request.url ?? '');
    if (!match) return { status: 404, body: { error: 'not_found' } };
    if (request.method !== 'GET') return { status: 405, body: { error: 'method_not_allowed' } };
    const [row] = database.select('members', { id: decodeURIComponent(match[1]) });
    if (!row) return { status: 404, body: { error: 'member_not_found' } };
    return { status: 200, body: serializeMemberRow(row) };
  };
}
