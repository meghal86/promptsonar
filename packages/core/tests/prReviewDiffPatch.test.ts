import { describe, expect, it } from 'vitest';
import { extractChangedLinesFromGitHubPatch } from '../src/pr-review/diff';

describe('GitHub patch changed-line extraction', () => {
    it('extracts added line numbers on the right side', () => {
        const patch = [
            '@@ -1,3 +1,5 @@',
            ' line1',
            '+added1',
            ' line2',
            '+added2',
            ' line3',
        ].join('\n');

        expect(Array.from(extractChangedLinesFromGitHubPatch(patch)).sort((a, b) => a - b)).toEqual([2, 4]);
    });
});

