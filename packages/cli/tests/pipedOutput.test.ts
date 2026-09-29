import { describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CLI = path.resolve(__dirname, '..', 'dist', 'cli.js');
// Produces ~1 MB of SARIF and ~2 MB of JSON — far beyond one 64 KB pipe buffer.
const FIXTURE = path.resolve(__dirname, '..', '..', 'core', 'test', 'fixtures', 'workflows');

/**
 * On POSIX, Node writes to a pipe asynchronously. The CLI calls process.exit()
 * right after printing, which used to drop everything past the first 64 KB when
 * stdout was piped (`promptsonar scan . --sarif | jq`), producing invalid JSON.
 *
 * spawnSync alone does not reproduce this: it drains the pipe too eagerly. The
 * output has to pass through a real shell pipe to another process.
 */
describe.skipIf(process.platform === 'win32')('CLI output through a shell pipe', () => {
    function viaPipe(args: string[]): string {
        const quoted = [process.execPath, CLI, ...args].map(a => `'${a}'`).join(' ');
        return spawnSync('sh', ['-c', `${quoted} | cat`], {
            encoding: 'utf-8',
            maxBuffer: 64 * 1024 * 1024,
        }).stdout;
    }

    function viaFile(args: string[]): string {
        const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'promptsonar-pipe-')), 'out');
        spawnSync(process.execPath, [CLI, ...args, '--output', out], { encoding: 'utf-8' });
        return fs.readFileSync(out, 'utf-8');
    }

    for (const flag of ['--sarif', '--json']) {
        it(`delivers complete, valid ${flag} output when piped`, () => {
            const piped = viaPipe(['scan', FIXTURE, flag]);
            const complete = viaFile(['scan', FIXTURE, flag]);

            expect(Buffer.byteLength(complete)).toBeGreaterThan(64 * 1024);
            // The regression: piped output stopped at exactly 65,536 bytes.
            expect(Buffer.byteLength(piped)).toBeGreaterThan(64 * 1024);
            expect(() => JSON.parse(piped)).not.toThrow();
            // Two separate runs differ only in their scan timestamps.
            const normalize = (s: string) => s.trim().replace(/"scanned_at": "[^"]*"/g, '"scanned_at": ""');
            expect(normalize(piped)).toBe(normalize(complete));
        }, 60000);
    }
});
