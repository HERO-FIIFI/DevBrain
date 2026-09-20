export class MemberService {
  constructor(repository) {
    this.repository = repository;
  }

  getMember(id) {
    return this.repository.findById(id);
  }

  /** Exact-name lookup; the column filter is passed through to the repository. */
  findByDisplayName(displayName) {
    return this.repository.findWhere({ display_name: displayName });
  }

  renameMember(id, displayName) {
    if (typeof displayName !== 'string' || displayName.trim().length === 0) throw new TypeError('displayName must be a non-empty string');
    if (!this.repository.rename(id, displayName.trim())) return null;
    return this.repository.findById(id);
  }
}
