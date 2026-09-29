import { beforeAll, describe, expect, it } from 'vitest';
import {
    analyzeFetchedFiles,
    analyzeRepositoryArtifactsFromFiles,
    detectFileSensitiveActions,
    detectSensitiveActions,
    loadCodeCapabilityGrammars,
} from '../src';

/**
 * Metamorphic and near-miss tests for capability detection:
 *
 *   - detectSensitiveActions()  (repository/analyzer.ts)   — keyword detection of
 *     what an AI artifact can do; strips negated clauses first. Used for prose
 *     (prompts, markdown, configs) and as the fallback for code.
 *   - detectFileSensitiveActions() (repository/analyzer.ts) — reads supported
 *     source code (TS/JS/Python) from its syntax tree, else falls back to the
 *     keyword detector.
 *   - analyzeFetchedFiles()     (repository/contentDiscovery.ts) — capability and
 *     control signals used to rank and connect files during discovery; also
 *     syntax-tree based for supported source code.
 *
 * Near-miss negatives pair a real capability with a look-alike that has none.
 * Metamorphic cases change a file in a way that must not change the answer
 * (renaming a wrapper) or must remove it (the keyword only in a comment).
 *
 * `it` cases record behaviour that is correct today and must not regress.
 * `it.fails` cases record known gaps where the keyword detector matches words
 * rather than behaviour; the syntax-tree path closes them for source code. Each holds exactly one expectation so that fixing one gap
 * makes exactly one test "unexpectedly pass" — vitest then fails the suite,
 * which is the cue to turn that case into a plain `it` regression test.
 *
 * Reason codes:
 *   FP_KEYWORD_COLLISION  capability word used for something else
 *   FP_COMMENT_MENTION    word appears only in a comment
 *   FP_STRING_LITERAL     word appears only inside a string (log/message)
 *   FP_DOCSTRING          word appears only in documentation text
 *   FP_NEGATION_IGNORED   a prohibition is read as a capability
 *   FP_CONTROL_PROXIMITY  a control word is credited without enforcing anything
 *   FN_ALIASED_CALL       real call missed because it is reached via an alias
 *   FN_UNLISTED_SINK      real capability missed because its API is not listed
 */

const EXEC_WRAPPER = (name: string) =>
    `import { exec } from 'child_process';\nexport function ${name}(cmd) { exec(cmd); }`;

const TEXT = {
    defensiveShellValidator: 'def validate_shell_command(cmd):\n    if cmd not in ALLOWED:\n        raise PermissionError(cmd)\n    return cmd',
    shellEscape: 'def shell_escape(value):\n    return shlex.quote(value)',
    apiKeyRegex: 'const API_KEY_PATTERN = /api[_-]?key/i;',
    negatedComment: '// Never call exec() or spawn() here; this module only formats text.\nfunction fmt(s) { return s.trim(); }',
    neutralComment: '// See the exec() docs for background.\nfunction fmt(s) { return s.trim(); }',
    logString: 'logger.info("shell access disabled for this agent");',
    docstring: 'def fmt(s):\n    """Formats text. Unlike the shell tool, this never touches the filesystem."""\n    return s.strip()',
    tokenBudgetProse: 'The token budget for this prompt is 4096.',
    nodeEnvRead: "const mode = process.env.NODE_ENV || 'development';",
    permissionErrorThenExec: "throw new Error('permission denied');\nexec(userInput);",
    aliasedExecSync: "import * as cp from 'child_process';\nexport function go(c) { cp.execSync(c); }",
    osSystem: 'import os\ndef handle(x):\n    os.system(x)',
    subprocessRun: 'import subprocess\ndef handle(x):\n    subprocess.run(x, shell=True)',
    denoCommand: 'const p = new Deno.Command(cmd, { args });\nawait p.output();',
};

const PYTHON_FIXTURES = new Set<string>([
    TEXT.defensiveShellValidator, TEXT.shellEscape, TEXT.docstring, TEXT.osSystem, TEXT.subprocessRun,
]);

/** The file name a fixture would have in a real repository. */
function pathFor(content: string): string {
    return PYTHON_FIXTURES.has(content) ? 'src/module.py' : 'src/module.ts';
}

function discovery(content: string) {
    const [file] = analyzeFetchedFiles([{ path: pathFor(content), content }]).successful;
    return { capabilities: file.capabilitySignals, controls: file.controlSignals };
}

function fileActions(content: string) {
    return detectFileSensitiveActions(pathFor(content), content);
}

beforeAll(async () => {
    await loadCodeCapabilityGrammars();
});

describe('detectSensitiveActions — behaviour that holds today', () => {
    it('keeps Shell when the exec wrapper is renamed (metamorphic)', () => {
        expect(detectSensitiveActions(EXEC_WRAPPER('runShell'))).toContain('Shell');
        expect(detectSensitiveActions(EXEC_WRAPPER('performAction')))
            .toEqual(detectSensitiveActions(EXEC_WRAPPER('runShell')));
    });

    it('detects subprocess.run as Shell', () => {
        expect(detectSensitiveActions(TEXT.subprocessRun)).toContain('Shell');
    });

    it('still detects a real exec() next to a "permission denied" message', () => {
        expect(detectSensitiveActions(TEXT.permissionErrorThenExec)).toContain('Shell');
    });

    it('does not grant Shell for a negated comment', () => {
        expect(detectSensitiveActions(TEXT.negatedComment)).not.toContain('Shell');
    });

    it('does not read LLM token-budget prose as Secrets', () => {
        expect(detectSensitiveActions(TEXT.tokenBudgetProse)).not.toContain('Secrets');
    });

    it('does not read a NODE_ENV lookup as Secrets', () => {
        expect(detectSensitiveActions(TEXT.nodeEnvRead)).not.toContain('Secrets');
    });
});

describe('detectSensitiveActions — known keyword gaps (prose and fallback only)', () => {
    it.fails('FP_KEYWORD_COLLISION: a shell-command validator is not Shell', () => {
        expect(detectSensitiveActions(TEXT.defensiveShellValidator)).not.toContain('Shell');
    });

    it.fails('FP_KEYWORD_COLLISION: shell_escape() is not Shell', () => {
        expect(detectSensitiveActions(TEXT.shellEscape)).not.toContain('Shell');
    });

    it.fails('FP_KEYWORD_COLLISION: a regex that recognises API keys is not Secrets', () => {
        expect(detectSensitiveActions(TEXT.apiKeyRegex)).not.toContain('Secrets');
    });

    it.fails('FP_COMMENT_MENTION: exec() mentioned only in a comment is not Shell', () => {
        expect(detectSensitiveActions(TEXT.neutralComment)).not.toContain('Shell');
    });

    it.fails('FP_STRING_LITERAL: a log message about shell access is not Shell', () => {
        expect(detectSensitiveActions(TEXT.logString)).not.toContain('Shell');
    });

    it.fails('FP_DOCSTRING: "shell" in a docstring is not Shell', () => {
        expect(detectSensitiveActions(TEXT.docstring)).not.toContain('Shell');
    });

    it.fails('FN_ALIASED_CALL: cp.execSync() through a namespace import is Shell', () => {
        expect(detectSensitiveActions(TEXT.aliasedExecSync)).toContain('Shell');
    });

    it.fails('FN_UNLISTED_SINK: os.system() is Shell', () => {
        expect(detectSensitiveActions(TEXT.osSystem)).toContain('Shell');
    });

    it.fails('FN_UNLISTED_SINK: Deno.Command is Shell', () => {
        expect(detectSensitiveActions(TEXT.denoCommand)).toContain('Shell');
    });
});

describe('detectFileSensitiveActions — syntax tree closes the keyword gaps for source code', () => {
    it('keeps Shell when the exec wrapper is renamed (metamorphic)', () => {
        expect(detectFileSensitiveActions('src/a.ts', EXEC_WRAPPER('runShell'))).toContain('Shell');
        expect(detectFileSensitiveActions('src/a.ts', EXEC_WRAPPER('performAction')))
            .toEqual(detectFileSensitiveActions('src/a.ts', EXEC_WRAPPER('runShell')));
    });

    it('detects subprocess.run as Shell', () => {
        expect(fileActions(TEXT.subprocessRun)).toContain('Shell');
    });

    it('FP_KEYWORD_COLLISION: a shell-command validator is not Shell', () => {
        expect(fileActions(TEXT.defensiveShellValidator)).not.toContain('Shell');
    });

    it('FP_KEYWORD_COLLISION: shell_escape() is not Shell', () => {
        expect(fileActions(TEXT.shellEscape)).not.toContain('Shell');
    });

    it('FP_KEYWORD_COLLISION: a regex that recognises API keys is not Secrets', () => {
        expect(fileActions(TEXT.apiKeyRegex)).not.toContain('Secrets');
    });

    it('FP_KEYWORD_COLLISION: reading NODE_ENV is not Secrets', () => {
        expect(fileActions(TEXT.nodeEnvRead)).not.toContain('Secrets');
    });

    it('FP_NEGATION_IGNORED / FP_COMMENT_MENTION: exec() in a comment is not Shell', () => {
        expect(fileActions(TEXT.negatedComment)).not.toContain('Shell');
        expect(fileActions(TEXT.neutralComment)).not.toContain('Shell');
    });

    it('FP_STRING_LITERAL: a log message about shell access is not Shell', () => {
        expect(fileActions(TEXT.logString)).not.toContain('Shell');
    });

    it('FP_DOCSTRING: "shell" in a docstring is not Shell', () => {
        expect(fileActions(TEXT.docstring)).not.toContain('Shell');
    });

    it('FN_ALIASED_CALL: cp.execSync() through a namespace import is Shell', () => {
        expect(fileActions(TEXT.aliasedExecSync)).toContain('Shell');
    });

    it('FN_UNLISTED_SINK: os.system() and Deno.Command are Shell', () => {
        expect(fileActions(TEXT.osSystem)).toContain('Shell');
        expect(fileActions(TEXT.denoCommand)).toContain('Shell');
    });

    it('reads a tool description with the natural-language rules', () => {
        const tool = "export const tool = { name: 'run', description: 'Run shell commands in the workspace' };";
        expect(detectFileSensitiveActions('src/tools.ts', tool)).toEqual(expect.arrayContaining(['Shell', 'Filesystem']));
    });

    it('falls back to keyword detection for prose and unsupported languages', () => {
        const prose = 'Use the shell tool to run commands.';
        expect(detectFileSensitiveActions('SKILL.md', prose)).toEqual(detectSensitiveActions(prose));
        expect(detectFileSensitiveActions('main.go', 'exec.Command("sh")')).toEqual(detectSensitiveActions('exec.Command("sh")'));
    });

    it('falls back to keyword detection when the file does not parse cleanly', () => {
        const broken = "import { exec } from 'child_process';\nexec(cmd, {";
        expect(detectFileSensitiveActions('src/a.ts', broken)).toEqual(detectSensitiveActions(broken));
    });
});

describe('discovery signals — behaviour that holds today', () => {
    it('keeps the shell signal when the exec wrapper is renamed (metamorphic)', () => {
        expect(discovery(EXEC_WRAPPER('runShell')).capabilities).toContain('shell');
        expect(discovery(EXEC_WRAPPER('performAction')).capabilities)
            .toEqual(discovery(EXEC_WRAPPER('runShell')).capabilities);
    });

    it('detects cp.execSync through a namespace import', () => {
        expect(discovery(TEXT.aliasedExecSync).capabilities).toContain('shell');
    });

    it('detects os.system', () => {
        expect(discovery(TEXT.osSystem).capabilities).toContain('shell');
    });

    it('does not flag a shell-command validator as a shell capability', () => {
        expect(discovery(TEXT.defensiveShellValidator).capabilities).not.toContain('shell');
    });

    it('does not flag a regex that recognises API keys as a secret capability', () => {
        expect(discovery(TEXT.apiKeyRegex).capabilities).not.toContain('secret');
    });
});

describe('discovery signals — keyword gaps closed by the syntax tree', () => {
    it('FP_NEGATION_IGNORED: "never call exec()" is not a shell capability', () => {
        expect(discovery(TEXT.negatedComment).capabilities).not.toContain('shell');
    });

    it('FP_COMMENT_MENTION: exec() mentioned only in a comment is not a shell capability', () => {
        expect(discovery(TEXT.neutralComment).capabilities).not.toContain('shell');
    });

    it('FP_STRING_LITERAL: a log message about shell access is not a shell capability', () => {
        expect(discovery(TEXT.logString).capabilities).not.toContain('shell');
    });

    it('FP_DOCSTRING: "shell" in a docstring is not a shell capability', () => {
        expect(discovery(TEXT.docstring).capabilities).not.toContain('shell');
    });

    it('FP_KEYWORD_COLLISION: LLM token-budget prose is not a secret capability (keyword fallback)', () => {
        expect(discovery(TEXT.tokenBudgetProse).capabilities).not.toContain('secret');
    });

    it('FP_KEYWORD_COLLISION: reading NODE_ENV is not a secret capability', () => {
        expect(discovery(TEXT.nodeEnvRead).capabilities).not.toContain('secret');
    });

    it('FP_CONTROL_PROXIMITY: a "permission denied" message is not an allowlist control', () => {
        // exec(userInput) right after it is unconstrained; the word "permission"
        // inside an error message must not be credited as an enforcing control.
        expect(discovery(TEXT.permissionErrorThenExec).controls).not.toContain('allowlist');
    });

    it('FN_UNLISTED_SINK: Deno.Command is a shell capability', () => {
        expect(discovery(TEXT.denoCommand).capabilities).toContain('shell');
    });
});

describe('discovery signals — syntax tree keeps real controls', () => {
    it('credits a control named in code or configured as a value', () => {
        expect(discovery("import { exec } from 'child_process';\nif (!allowlist.has(cmd)) throw new Error('no');\nexec(cmd);").controls).toContain('allowlist');
        expect(discovery("export const config = { mode: 'sandbox' };").controls).toContain('sandbox');
    });

    it('does not credit a control mentioned only in a comment', () => {
        expect(discovery('// TODO: add an allowlist\nexport const x = 1;').controls).not.toContain('allowlist');
    });
});

describe('repository pipeline invariants', () => {
    it('adding a documentation file does not change production artifacts or their actions', () => {
        const productionView = (files: Array<{ path: string; content: string }>) =>
            analyzeRepositoryArtifactsFromFiles('/repo', files).artifacts
                .filter(artifact => artifact.provenance === 'production')
                .map(artifact => `${artifact.relativePath}:${artifact.type}:${JSON.stringify(artifact.metadata?.sensitiveActions || [])}`)
                .sort();

        const base = [{ path: 'SKILL.md', content: 'Summarize pull requests for reviewers. Keep answers short.' }];
        const withDocs = [
            ...base,
            { path: 'docs/architecture.md', content: 'The shell tool runs arbitrary commands and can read secrets from the filesystem.' },
        ];

        expect(productionView(withDocs)).toEqual(productionView(base));
    });
});
