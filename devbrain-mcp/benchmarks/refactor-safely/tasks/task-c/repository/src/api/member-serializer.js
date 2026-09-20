// Public JSON shape. Field names here are the external API contract and must not change with storage details.
export function serializeMemberRow(row) {
  return { id: row.id, displayName: row.display_name, joinedAt: row.joined_at };
}

export function serializeMember(member) {
  return { id: member.id, displayName: member.displayName, joinedAt: member.joinedAt };
}
