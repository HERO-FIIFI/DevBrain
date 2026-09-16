import { describe, expect, it } from 'vitest';
import { parsePorcelainV2 } from '../src/lib/git.js';

describe('git parsing', () => {
  it('parses branch, divergence and dirty counts', () => {
    const parsed = parsePorcelainV2('# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -3\n1 M. N... 0 0 0 a a file\n1 .M N... 0 0 0 a a other\n? new.txt');
    expect(parsed).toMatchObject({ branch: 'main', detached: false, upstream: 'origin/main', ahead: 2, behind: 3, staged: 1, unstaged: 1, untracked: 1 });
  });
  it('parses detached head', () => expect(parsePorcelainV2('# branch.head (detached)').detached).toBe(true));
});
