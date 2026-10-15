// Row mapper and persistence operations for members. Column names live here and in the SQL files.
const TABLE = 'members';

/** @returns {{ id: string, displayName: string, joinedAt: string }} */
export function rowToMember(row) {
  return { id: row.id, displayName: row.display_name, joinedAt: row.joined_at };
}

export class MemberRepository {
  constructor(database) {
    this.database = database;
  }

  findById(id) {
    const [row] = this.database.select(TABLE, { id });
    return row ? rowToMember(row) : null;
  }

  /** @param {object} columns exact column matches, e.g. `{ display_name: 'Ada Lovelace' }` */
  findWhere(columns) {
    return this.database.select(TABLE, columns).map(rowToMember);
  }

  rename(id, displayName) {
    return this.database.update(TABLE, { id }, { display_name: displayName }) === 1;
  }
}
