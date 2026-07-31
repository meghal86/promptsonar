import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { auditDiscoveredMcpConfigs, discoverMcpConfigPathsInDir } from '../src/mcp';

// Regression: `audit-mcp <dir>` used to crash with EISDIR because the directory
// path was handed straight to fs.readFileSync. A directory argument must be
// scanned for MCP config files, and an empty scan must return [] (surfaced as a
// friendly CLI message), never throw.
describe('auditDiscoveredMcpConfigs with a directory argument', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-mcp-dir-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('does not throw EISDIR when a directory is passed', () => {
        expect(() => auditDiscoveredMcpConfigs(tmpDir)).not.toThrow();
    });

    it('returns an empty result set for a directory with no MCP configs', () => {
        expect(auditDiscoveredMcpConfigs(tmpDir)).toEqual([]);
        expect(discoverMcpConfigPathsInDir(tmpDir)).toEqual([]);
    });

    it('scans a directory and audits an mcp.json it contains', () => {
        const configPath = path.join(tmpDir, 'mcp.json');
        fs.writeFileSync(configPath, JSON.stringify({
            mcpServers: {
                dangerous: {
                    url: 'http://203.0.113.10:8787/mcp',
                    headers: { Authorization: 'Bearer ${TOKEN}' },
                },
            },
        }), 'utf-8');

        const discovered = discoverMcpConfigPathsInDir(tmpDir);
        expect(discovered).toContain(configPath);

        const results = auditDiscoveredMcpConfigs(tmpDir);
        expect(results).toHaveLength(1);
        expect(results[0].filePath).toBe(configPath);
        expect(results[0].findings.length).toBeGreaterThan(0);
    });

    it('finds a .cursor/mcp.json nested in the directory', () => {
        const cursorDir = path.join(tmpDir, '.cursor');
        fs.mkdirSync(cursorDir, { recursive: true });
        const configPath = path.join(cursorDir, 'mcp.json');
        fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {} }), 'utf-8');

        expect(discoverMcpConfigPathsInDir(tmpDir)).toContain(configPath);
    });

    it('still reads a config when a file path (not a directory) is passed', () => {
        const configPath = path.join(tmpDir, 'mcp.json');
        fs.writeFileSync(configPath, JSON.stringify({ mcpServers: {} }), 'utf-8');

        const results = auditDiscoveredMcpConfigs(configPath);
        expect(results).toHaveLength(1);
        expect(results[0].filePath).toBe(path.resolve(configPath));
    });

    it('throws a clear error (not EISDIR) for a path that does not exist', () => {
        const missing = path.join(tmpDir, 'nope', 'does-not-exist');
        expect(() => auditDiscoveredMcpConfigs(missing)).toThrow(/path not found/);
    });
});
