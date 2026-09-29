import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeCodeCapabilities, loadCodeCapabilityGrammars } from '../src';

beforeAll(async () => {
    await loadCodeCapabilityGrammars();
});

function caps(path: string, content: string) {
    const result = analyzeCodeCapabilities(path, content);
    expect(result).toBeDefined();
    return result!.capabilities;
}

describe('analyzeCodeCapabilities — script sinks', () => {
    it('detects exec through a named import', () => {
        expect(caps('a.ts', "import { exec } from 'child_process';\nexec(cmd);")).toEqual(['shell']);
    });

    it('detects execSync through a namespace import', () => {
        expect(caps('a.ts', "import * as cp from 'child_process';\ncp.execSync(c);")).toEqual(['shell']);
    });

    it('detects an aliased named import and the node: prefix', () => {
        expect(caps('a.js', "import { spawn as run } from 'node:child_process';\nrun('ls');")).toEqual(['shell']);
    });

    it('detects require() with destructuring and direct require calls', () => {
        expect(caps('a.js', "const { exec: sh } = require('child_process');\nsh(x);")).toEqual(['shell']);
        expect(caps('a.js', "require('child_process').exec(x);")).toEqual(['shell']);
    });

    it('detects Deno.Command', () => {
        expect(caps('a.ts', 'const p = new Deno.Command(cmd, { args });')).toEqual(['shell']);
    });

    it('detects fs/promises and fetch', () => {
        expect(caps('a.ts', "import { readFile } from 'fs/promises';\nawait readFile(p);\nawait fetch(url);"))
            .toEqual(['filesystem', 'network']);
    });

    it('detects VS Code workspace.fs access through either import style', () => {
        expect(caps('a.ts', "import { workspace } from 'vscode';\nawait workspace.fs.readFile(uri);")).toEqual(['filesystem']);
        expect(caps('a.ts', "import * as vscode from 'vscode';\nawait vscode.workspace.fs.writeFile(uri, data);")).toEqual(['filesystem']);
    });

    it('detects credential environment reads but not NODE_ENV or MAX_TOKENS', () => {
        expect(caps('a.ts', 'const t = process.env.GITHUB_TOKEN;')).toEqual(['secret']);
        expect(caps('a.ts', "const k = process.env['OPENAI_API_KEY'];")).toEqual(['secret']);
        expect(caps('a.ts', "const mode = process.env.NODE_ENV || 'development';\nconst n = process.env.MAX_TOKENS;")).toEqual([]);
    });

    it('ignores comments, strings and look-alike local functions', () => {
        expect(caps('a.ts', '// Never call exec() or spawn() here.\nfunction fmt(s) { return s.trim(); }')).toEqual([]);
        expect(caps('a.ts', 'logger.info("shell access disabled for this agent");')).toEqual([]);
        expect(caps('a.ts', 'function exec(x) { return x; }\nexec(1);')).toEqual([]);
        expect(caps('a.ts', 'const API_KEY_PATTERN = /api[_-]?key/i;')).toEqual([]);
    });

    it('returns tool descriptions as declaration text, not as capabilities', () => {
        const result = analyzeCodeCapabilities('a.ts', "server.tool({ name: 'run', description: 'Runs shell commands' });");
        expect(result?.capabilities).toEqual([]);
        expect(result?.declarationText).toBe('Runs shell commands');
    });
});

describe('analyzeCodeCapabilities — python sinks', () => {
    it('detects os.system and subprocess.run', () => {
        expect(caps('a.py', 'import os\ndef handle(x):\n    os.system(x)')).toEqual(['shell']);
        expect(caps('a.py', 'import subprocess\nsubprocess.run(x, shell=True)')).toEqual(['shell']);
    });

    it('resolves import aliases', () => {
        expect(caps('a.py', 'import subprocess as sp\nsp.check_output(x)')).toEqual(['shell']);
        expect(caps('a.py', 'from os import system as run\nrun(x)')).toEqual(['shell']);
    });

    it('detects credential environment reads', () => {
        expect(caps('a.py', "import os\nk = os.environ['OPENAI_API_KEY']")).toEqual(['secret']);
        expect(caps('a.py', "import os\nk = os.getenv('DB_PASSWORD')")).toEqual(['secret']);
        expect(caps('a.py', "import os\nk = os.getenv('HOME')")).toEqual([]);
    });

    it('ignores validators, escapers and docstrings', () => {
        expect(caps('a.py', 'def validate_shell_command(cmd):\n    if cmd not in ALLOWED:\n        raise PermissionError(cmd)\n    return cmd')).toEqual([]);
        expect(caps('a.py', 'def shell_escape(value):\n    return shlex.quote(value)')).toEqual([]);
        expect(caps('a.py', 'def fmt(s):\n    """Unlike the shell tool, this never touches the filesystem."""\n    return s.strip()')).toEqual([]);
    });

    it('returns an @tool docstring as declaration text', () => {
        const result = analyzeCodeCapabilities('a.py', '@tool\ndef run(cmd):\n    """Run a shell command."""\n    return cmd');
        expect(result?.capabilities).toEqual([]);
        expect(result?.declarationText).toBe('Run a shell command.');
    });
});

describe('analyzeCodeCapabilities — unsupported input', () => {
    it('returns undefined for languages it does not analyze', () => {
        expect(analyzeCodeCapabilities('SKILL.md', 'Run shell commands.')).toBeUndefined();
        expect(analyzeCodeCapabilities('main.go', 'package main')).toBeUndefined();
    });
});
