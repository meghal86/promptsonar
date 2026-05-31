export function extractChangedLinesFromGitHubPatch(patch: string): Set<number> {
    const changed = new Set<number>();
    const lines = patch.split(/\r?\n/);

    let inHunk = false;
    let newLine = 0;

    for (const line of lines) {
        if (line.startsWith('@@')) {
            // Example: @@ -12,7 +12,9 @@
            const match = line.match(/\+\s*(\d+)(?:,(\d+))?\s+@@/);
            if (!match) {
                inHunk = false;
                continue;
            }
            inHunk = true;
            newLine = Number(match[1]);
            continue;
        }

        if (!inHunk) continue;

        if (line.startsWith('+++') || line.startsWith('---')) continue;

        if (line.startsWith('+')) {
            changed.add(newLine);
            newLine += 1;
            continue;
        }

        if (line.startsWith('-')) {
            continue;
        }

        // Context line
        newLine += 1;
    }

    return changed;
}

