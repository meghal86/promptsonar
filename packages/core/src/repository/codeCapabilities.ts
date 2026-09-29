import { grammarForPath, loadGrammars, parseWithLoadedGrammar } from '../parser';

/**
 * Syntax-tree capability detection for source code.
 *
 * The repository analyzer and discovery used to infer capabilities by matching
 * words anywhere in a file ("shell", "exec", "token"...). That flags defensive
 * code (validate_shell_command), comments, log messages and docstrings, and
 * misses real calls reached through an alias (cp.execSync) or an API not in the
 * word list (os.system).
 *
 * For supported languages this instead reports a capability only when the code
 * calls a known sink, resolving import aliases first. Comments, docstrings and
 * ordinary strings are never read as capabilities. Strings that *declare* a
 * capability — a tool's `description`, an agent's `instructions`, the docstring
 * of an `@tool` function — are returned separately as `declarationText`, so each
 * caller can interpret that prose with its own natural-language rules.
 *
 * Parsing is synchronous once grammars are loaded. Call
 * loadCodeCapabilityGrammars() before synchronous analysis; if the grammars are
 * not loaded, analyzeCodeCapabilities() returns undefined and callers fall back
 * to keyword matching.
 */

export type CodeCapability = 'shell' | 'filesystem' | 'network' | 'secret';

export interface CodeCapabilityEvidence {
    capability: CodeCapability;
    /** The resolved call or access, e.g. "child_process.execSync". */
    via: string;
    line: number;
}

export interface CodeCapabilityAnalysis {
    capabilities: CodeCapability[];
    evidence: CodeCapabilityEvidence[];
    /** Capability-declaring strings (tool descriptions, instructions), newline-joined. */
    declarationText: string;
    /**
     * The source with comments and message strings blanked out (same length
     * and line layout). Strings that are configuration values — the value of
     * an object key or keyword argument — are kept, so `mode: 'sandbox'`
     * still reads as a sandbox while `new Error('permission denied')` does not.
     */
    executableText: string;
}

const CODE_CAPABILITY_GRAMMARS = ['typescript', 'python'];

/** Load the grammars used for capability detection. Safe to call repeatedly. */
export async function loadCodeCapabilityGrammars(): Promise<void> {
    try {
        await loadGrammars(CODE_CAPABILITY_GRAMMARS);
    } catch {
        // Grammars unavailable (e.g. assets missing from a bundle): analysis
        // falls back to keyword matching rather than failing the scan.
    }
}

const FS_METHODS = [
    'readFile', 'readFileSync', 'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync',
    'unlink', 'unlinkSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'mkdir', 'mkdirSync',
    'rename', 'renameSync', 'copyFile', 'copyFileSync', 'cp', 'cpSync', 'readdir', 'readdirSync',
    'createReadStream', 'createWriteStream', 'open', 'openSync',
];
const VSCODE_FS_METHODS = ['readFile', 'writeFile', 'delete', 'rename', 'copy', 'createDirectory', 'readDirectory'];
const HTTP_VERBS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'request'];

const SCRIPT_SINKS: Record<CodeCapability, Set<string>> = {
    shell: new Set([
        'child_process.exec', 'child_process.execSync', 'child_process.execFile', 'child_process.execFileSync',
        'child_process.spawn', 'child_process.spawnSync', 'child_process.fork',
        'Deno.Command', 'Deno.run', 'Bun.spawn', 'Bun.spawnSync',
    ]),
    filesystem: new Set([
        ...FS_METHODS.map(method => `fs.${method}`),
        // VS Code extensions reach the filesystem through workspace.fs.
        ...VSCODE_FS_METHODS.map(method => `vscode.workspace.fs.${method}`),
    ]),
    network: new Set([
        'fetch', 'axios', ...HTTP_VERBS.map(verb => `axios.${verb}`),
        'http.get', 'http.request', 'https.get', 'https.request',
        'net.connect', 'net.createConnection', 'WebSocket',
    ]),
    secret: new Set(),
};

const PYTHON_SINKS: Record<CodeCapability, Set<string>> = {
    shell: new Set([
        'subprocess.run', 'subprocess.call', 'subprocess.check_call', 'subprocess.check_output',
        'subprocess.Popen', 'subprocess.getoutput', 'subprocess.getstatusoutput',
        'os.system', 'os.popen', 'os.execv', 'os.execve', 'os.execvp', 'os.execvpe',
        'os.execl', 'os.execle', 'os.execlp', 'os.spawnl', 'os.spawnv', 'os.spawnvp',
    ]),
    filesystem: new Set([
        'open', 'os.remove', 'os.unlink', 'os.rmdir', 'os.mkdir', 'os.makedirs', 'os.rename', 'os.replace',
        'shutil.rmtree', 'shutil.copy', 'shutil.copyfile', 'shutil.copytree', 'shutil.move',
    ]),
    network: new Set([
        ...HTTP_VERBS.map(verb => `requests.${verb}`), 'requests.Session',
        ...HTTP_VERBS.map(verb => `httpx.${verb}`), 'httpx.Client', 'httpx.AsyncClient',
        'urllib.request.urlopen', 'aiohttp.ClientSession', 'socket.create_connection',
    ]),
    secret: new Set(),
};

const DECLARATION_KEYS = new Set(['description', 'instructions', 'prompt', 'system', 'system_prompt', 'systemPrompt']);

/**
 * An environment variable name that holds a credential. Matched on whole
 * words, so GITHUB_TOKEN and OPENAI_API_KEY qualify but MAX_TOKENS does not.
 */
function isCredentialName(name: string): boolean {
    const words = name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    const has = (word: string) => words.includes(word);
    const pair = (a: string, b: string) => words.some((word, i) => word === a && words[i + 1] === b);
    return has('SECRET') || has('PASSWORD') || has('PASSWD') || has('CREDENTIAL') || has('CREDENTIALS')
        || has('TOKEN') || has('APIKEY') || pair('API', 'KEY') || pair('PRIVATE', 'KEY') || pair('ACCESS', 'KEY');
}

function normalizeModule(name: string): string {
    return name.replace(/^node:/, '').replace(/^fs\/promises$/, 'fs');
}

function normalizeCallee(name: string): string {
    return name.replace(/^node:/, '').replace(/^fs\.promises\./, 'fs.').replace(/^fs\/promises\./, 'fs.');
}

function stringValue(node: any): string {
    // string -> string_fragment (script) / string_content (python); template_string -> raw text.
    const parts = (node.namedChildren || [])
        .filter((child: any) => child.type === 'string_fragment' || child.type === 'string_content')
        .map((child: any) => child.text);
    if (parts.length > 0) return parts.join('');
    return String(node.text || '').replace(/^[`'"]+|[`'"]+$/g, '');
}

function isStringNode(node: any): boolean {
    return node?.type === 'string' || node?.type === 'template_string';
}

function walk(node: any, visit: (node: any) => void): void {
    visit(node);
    for (const child of node.namedChildren || []) walk(child, visit);
}

/** Dotted path of a callee/object node, or undefined if it is not a plain name chain. */
function dottedPath(node: any): string | undefined {
    if (!node) return undefined;
    if (node.type === 'identifier' || node.type === 'property_identifier') return node.text;
    if (node.type === 'member_expression') {
        const object = dottedPath(node.childForFieldName('object'));
        const property = node.childForFieldName('property');
        return object && property ? `${object}.${property.text}` : undefined;
    }
    if (node.type === 'attribute') {
        const object = dottedPath(node.childForFieldName('object'));
        const attribute = node.childForFieldName('attribute');
        return object && attribute ? `${object}.${attribute.text}` : undefined;
    }
    // require('child_process').exec(...)
    if (node.type === 'call_expression') {
        const fn = node.childForFieldName('function');
        const args = node.childForFieldName('arguments');
        const first = args?.namedChildren?.[0];
        if (fn?.type === 'identifier' && fn.text === 'require' && isStringNode(first)) {
            return normalizeModule(stringValue(first));
        }
    }
    return undefined;
}

function resolve(path: string, aliases: Map<string, string>): string {
    const [head, ...rest] = path.split('.');
    const mapped = aliases.get(head);
    return normalizeCallee(mapped ? [mapped, ...rest].join('.') : path);
}

class Collector {
    readonly evidence: CodeCapabilityEvidence[] = [];
    readonly declarations: string[] = [];

    constructor(private readonly sinks: Record<CodeCapability, Set<string>>) {}

    call(fqn: string, node: any): void {
        for (const capability of Object.keys(this.sinks) as CodeCapability[]) {
            if (this.sinks[capability].has(fqn)) this.add(capability, fqn, node);
        }
    }

    add(capability: CodeCapability, via: string, node: any): void {
        this.evidence.push({ capability, via, line: node.startPosition.row + 1 });
    }

    result(executableText: string): CodeCapabilityAnalysis {
        const evidence = this.evidence
            .sort((a, b) => a.line - b.line || a.via.localeCompare(b.via) || a.capability.localeCompare(b.capability));
        return {
            capabilities: Array.from(new Set(evidence.map(item => item.capability))).sort(),
            evidence,
            declarationText: this.declarations.join('\n'),
            executableText,
        };
    }
}

function scriptAliases(root: any): Map<string, string> {
    const aliases = new Map<string, string>();
    walk(root, node => {
        if (node.type === 'import_statement') {
            const source = node.childForFieldName('source');
            if (!source) return;
            const moduleName = normalizeModule(stringValue(source));
            walk(node, child => {
                if (child.type === 'namespace_import') {
                    const id = child.namedChildren.find((c: any) => c.type === 'identifier');
                    if (id) aliases.set(id.text, moduleName);
                } else if (child.type === 'import_clause') {
                    const id = child.namedChildren.find((c: any) => c.type === 'identifier');
                    if (id) aliases.set(id.text, moduleName); // default import
                } else if (child.type === 'import_specifier') {
                    const name = child.childForFieldName('name');
                    const alias = child.childForFieldName('alias');
                    if (name) aliases.set((alias || name).text, `${moduleName}.${name.text}`);
                }
            });
        } else if (node.type === 'variable_declarator') {
            const value = node.childForFieldName('value');
            const moduleName = value ? dottedPath(value) : undefined;
            if (!moduleName || value.type !== 'call_expression') return; // only require('x')
            const name = node.childForFieldName('name');
            if (name?.type === 'identifier') {
                aliases.set(name.text, moduleName);
            } else if (name?.type === 'object_pattern') {
                for (const property of name.namedChildren) {
                    if (property.type === 'shorthand_property_identifier_pattern') {
                        aliases.set(property.text, `${moduleName}.${property.text}`);
                    } else if (property.type === 'pair_pattern') {
                        const key = property.childForFieldName('key');
                        const local = property.childForFieldName('value');
                        if (key && local?.type === 'identifier') aliases.set(local.text, `${moduleName}.${key.text}`);
                    }
                }
            }
        }
    });
    return aliases;
}

function analyzeScript(root: any, content: string): CodeCapabilityAnalysis {
    const aliases = scriptAliases(root);
    const collector = new Collector(SCRIPT_SINKS);

    walk(root, node => {
        if (node.type === 'call_expression' || node.type === 'new_expression') {
            const callee = node.childForFieldName(node.type === 'call_expression' ? 'function' : 'constructor');
            const path = dottedPath(callee);
            if (path) collector.call(resolve(path, aliases), node);
        } else if (node.type === 'member_expression' || node.type === 'subscript_expression') {
            // process.env.GITHUB_TOKEN / process.env['OPENAI_API_KEY']
            if (dottedPath(node.childForFieldName('object')) !== 'process.env') return;
            const key = node.type === 'member_expression'
                ? node.childForFieldName('property')?.text
                : (isStringNode(node.childForFieldName('index')) ? stringValue(node.childForFieldName('index')) : undefined);
            if (key && isCredentialName(key)) collector.add('secret', `process.env.${key}`, node);
        } else if (node.type === 'pair') {
            const key = node.childForFieldName('key');
            const value = node.childForFieldName('value');
            const keyName = key ? (isStringNode(key) ? stringValue(key) : key.text) : '';
            if (DECLARATION_KEYS.has(keyName) && isStringNode(value)) collector.declarations.push(stringValue(value));
        }
    });

    return collector.result(executableText(root, content));
}

function pythonAliases(root: any): Map<string, string> {
    const aliases = new Map<string, string>();
    walk(root, node => {
        if (node.type === 'import_statement') {
            for (const child of node.namedChildren) {
                if (child.type === 'aliased_import') {
                    const name = child.childForFieldName('name');
                    const alias = child.childForFieldName('alias');
                    if (name && alias) aliases.set(alias.text, name.text);
                }
            }
        } else if (node.type === 'import_from_statement') {
            const moduleName = node.childForFieldName('module_name')?.text;
            if (!moduleName) return;
            for (const child of node.namedChildren) {
                if (child === node.childForFieldName('module_name')) continue;
                if (child.type === 'dotted_name') {
                    aliases.set(child.text, `${moduleName}.${child.text}`);
                } else if (child.type === 'aliased_import') {
                    const name = child.childForFieldName('name');
                    const alias = child.childForFieldName('alias');
                    if (name && alias) aliases.set(alias.text, `${moduleName}.${name.text}`);
                }
            }
        }
    });
    return aliases;
}

function isToolDecorator(decorator: any): boolean {
    const target = decorator.namedChildren?.[0];
    const expression = target?.type === 'call' ? target.childForFieldName('function') : target;
    const path = dottedPath(expression);
    return Boolean(path && (path === 'tool' || path.endsWith('.tool')));
}

function docstring(functionNode: any): string | undefined {
    const first = functionNode.childForFieldName('body')?.namedChildren?.[0];
    const expr = first?.type === 'expression_statement' ? first.namedChildren?.[0] : undefined;
    return expr?.type === 'string' ? stringValue(expr) : undefined;
}

function analyzePython(root: any, content: string): CodeCapabilityAnalysis {
    const aliases = pythonAliases(root);
    const collector = new Collector(PYTHON_SINKS);

    walk(root, node => {
        if (node.type === 'call') {
            const path = dottedPath(node.childForFieldName('function'));
            if (!path) return;
            const fqn = resolve(path, aliases);
            collector.call(fqn, node);
            // os.getenv('API_KEY') / os.environ.get('API_KEY')
            if (fqn === 'os.getenv' || fqn === 'os.environ.get') {
                const first = node.childForFieldName('arguments')?.namedChildren?.[0];
                if (isStringNode(first) && isCredentialName(stringValue(first))) {
                    collector.add('secret', `${fqn}('${stringValue(first)}')`, node);
                }
            }
        } else if (node.type === 'subscript') {
            // os.environ['API_KEY']
            const value = dottedPath(node.childForFieldName('value'));
            const key = node.childForFieldName('subscript');
            if (value && resolve(value, aliases) === 'os.environ' && isStringNode(key) && isCredentialName(stringValue(key))) {
                collector.add('secret', `os.environ['${stringValue(key)}']`, node);
            }
        } else if (node.type === 'keyword_argument') {
            const name = node.childForFieldName('name')?.text || '';
            const value = node.childForFieldName('value');
            if (DECLARATION_KEYS.has(name) && isStringNode(value)) collector.declarations.push(stringValue(value));
        } else if (node.type === 'pair') {
            const key = node.childForFieldName('key');
            const value = node.childForFieldName('value');
            if (isStringNode(key) && DECLARATION_KEYS.has(stringValue(key)) && isStringNode(value)) {
                collector.declarations.push(stringValue(value));
            }
        } else if (node.type === 'decorated_definition') {
            // A @tool function's docstring is its tool description.
            const definition = node.childForFieldName('definition');
            const decorators = node.namedChildren.filter((child: any) => child.type === 'decorator');
            if (definition?.type === 'function_definition' && decorators.some(isToolDecorator)) {
                const doc = docstring(definition);
                if (doc) collector.declarations.push(doc);
            }
        }
    });

    return collector.result(executableText(root, content));
}

/** A string that is a configuration value: `key: 'value'` or `key='value'`. */
function isConfigValue(node: any): boolean {
    const parent = node.parent;
    if (!parent) return false;
    if (parent.type !== 'pair' && parent.type !== 'keyword_argument') return false;
    const value = parent.childForFieldName('value');
    return Boolean(value && value.startIndex === node.startIndex && value.endIndex === node.endIndex);
}

// Tree indices are UTF-16 offsets into the parsed string, so they index `source` directly.
function executableText(root: any, source: string): string {
    const blanked: Array<[number, number]> = [];
    walk(root, node => {
        if (node.type === 'comment' || (isStringNode(node) && !isConfigValue(node))) {
            blanked.push([node.startIndex, node.endIndex]);
        }
    });
    if (blanked.length === 0) return source;
    const chars = source.split('');
    for (const [start, end] of blanked) {
        for (let i = start; i < end && i < chars.length; i++) {
            if (chars[i] !== '\n') chars[i] = ' ';
        }
    }
    return chars.join('');
}

function hasSyntaxError(root: any): boolean {
    return typeof root.hasError === 'function' ? root.hasError() : Boolean(root.hasError);
}

/**
 * Syntax-tree capability analysis for a source file. Returns undefined when the
 * language is not supported, its grammar has not been loaded, or the file does
 * not parse cleanly (e.g. JSX, or prose in a code file); callers then keep
 * their keyword-based behaviour rather than trusting a partial tree.
 */
export function analyzeCodeCapabilities(filePath: string, content: string): CodeCapabilityAnalysis | undefined {
    const grammar = grammarForPath(filePath);
    if (!grammar || !CODE_CAPABILITY_GRAMMARS.includes(grammar)) return undefined;
    const tree = parseWithLoadedGrammar(grammar, content);
    if (!tree) return undefined;
    try {
        if (hasSyntaxError(tree.rootNode)) return undefined;
        return grammar === 'python' ? analyzePython(tree.rootNode, content) : analyzeScript(tree.rootNode, content);
    } finally {
        tree.delete();
    }
}
