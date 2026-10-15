# member-directory

Dependency-free member directory. The schema in `db/schema.sql` is authoritative: the in-memory database
rejects reads and writes that name a column the schema does not declare.

- `db/schema.sql`, `db/seed.sql` — table declaration and seed rows.
- `src/db/memory-database.js` — loads the SQL files into schema-checked in-memory tables.
- `src/members/member-repository.js` — row mapper and persistence operations.
- `src/members/member-service.js` — application operations.
- `src/api/member-serializer.js` — public JSON shape (`id`, `displayName`, `joinedAt`).
- `src/http/member-route.js` — `GET /members/:id`.

## Scripts

```sh
npm test            # full regression (node:test)
npm run test:targeted
npm run lint        # syntax check every module
npm run build       # load every module to catch broken imports
```
