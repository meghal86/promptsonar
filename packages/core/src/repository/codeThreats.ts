import { grammarForPath, parseWithLoadedGrammar } from '../parser';
import {
    PYTHON_SINKS,
    SCRIPT_SINKS,
    dottedPath,
    hasSyntaxError,
    isStringNode,
    normalizeModule,
    pythonAliases,
    resolve,
    scriptAliases,
    stringValue,
    walk,
} from './codeCapabilities';

/**
 * Behaviour-level threats in scripts that ship with agent skills, MCP servers
 * and prompts. Capability detection alone says a script *can* read files and
 * reach the network; these rules report the combinations that are almost never
 * legitimate in an agent's helper script:
 *
 * - sec_credential_exfiltration: a credential store (~/.ssh, ~/.aws, .npmrc,
 *   .netrc, .git-credentials, docker/kube config, /etc/shadow) is read, or the
 *   whole environment is dumped, in a file that also makes a network call.
 *   Reading one named API key from the environment and calling an API is the
 *   normal client pattern and is not reported.
 * - sec_remote_code_execution: code downloaded at runtime is executed
 *   (exec/eval/new Function of a network response, or a download piped into
 *   a shell).
 *
 * Detection resolves import aliases, __import__/getattr indirection and
 * string building ("." + "aw" + "s", ["ht", "tps"].join("")), because those are
 * how this kind of payload hides from keyword scanners. It stays deterministic:
 * no execution, no network, no LLM.
 */

export type CodeThreatRuleId = 'sec_credential_exfiltration' | 'sec_remote_code_execution';

export const CODE_THREAT_RULE_IDS: ReadonlySet<string> = new Set<CodeThreatRuleId>([
    'sec_credential_exfiltration',
    'sec_remote_code_execution',
]);

export interface CodeThreat {
    ruleId: CodeThreatRuleId;
    severity: 'critical';
    line: number;
    column: number;
    message: string;
    /** The source (what is read) and the sink (where it goes), as resolved. */
    source: string;
    sink: string;
}

// Credential stores whose presence in a file that also talks to the network is
// the exfiltration signal. Matched against every constant string in the file,
// after folding string concatenation.
const CREDENTIAL_PATH = /(?:^|[\\/~])\.(?:ssh|aws|gnupg|kube|docker)(?:[\\/]|$)|^\.(?:ssh|aws|gnupg)$|\bid_(?:rsa|dsa|ecdsa|ed25519)\b|(?:^|[\\/])\.(?:npmrc|netrc|pypirc|git-credentials)$|aws[\\/]credentials|\.docker[\\/]config\.json|\.kube[\\/]config|\/etc\/(?:shadow|passwd)\b|(?:^|[\\/])(?:Login Data|Cookies|wallet\.dat)$/;

const DOWNLOAD_TO_SHELL = /\b(?:curl|wget)\b[^|\n;]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b|\bbase64\s+(?:-d|--decode)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/;
const REVERSE_SHELL = /\b(?:ba)?sh\s+-i\s*>&?\s*\/dev\/tcp\/|\bnc\b[^\n]*\s-e\s+\/bin\/(?:ba)?sh/;
const SHELL_NETWORK = /\b(?:curl|wget|nc|ncat|nslookup|dig|scp|rsync|ftp)\b/;

const SHELL_EXTENSIONS = new Set(['.sh', '.bash', '.zsh']);

function extensionOf(filePath: string): string {
    const match = /\.[^./\\]+$/.exec(filePath);
    return match ? match[0].toLowerCase() : '';
}

/** Constant value of a string expression, folding concatenation and joins. */
function constantString(node: any): string | undefined {
    if (!node) return undefined;
    if (isStringNode(node)) {
        if (node.type === 'template_string' && (node.namedChildren || []).some((c: any) => c.type === 'template_substitution')) {
            return undefined;
        }
        return stringValue(node);
    }
    if (node.type === 'parenthesized_expression') return constantString(node.namedChildren[0]);
    if (node.type === 'concatenated_string') {
        const parts = node.namedChildren.map(constantString);
        return parts.every((part: string | undefined) => part !== undefined) ? parts.join('') : undefined;
    }
    if (node.type === 'binary_expression' || node.type === 'binary_operator') {
        const operator = node.childForFieldName('operator')?.text;
        if (operator !== '+') return undefined;
        const left = constantString(node.childForFieldName('left'));
        const right = constantString(node.childForFieldName('right'));
        return left !== undefined && right !== undefined ? left + right : undefined;
    }
    if (node.type === 'call_expression' || node.type === 'call') {
        // JS: ["a", "b"].join("")   Python: "".join(["a", "b"])
        const fn = node.childForFieldName('function');
        const args = node.childForFieldName('arguments')?.namedChildren || [];
        const property = fn?.childForFieldName(fn.type === 'attribute' ? 'attribute' : 'property');
        if (!fn || property?.text !== 'join') return undefined;
        const receiver = fn.childForFieldName('object');
        const list = fn.type === 'attribute' ? args[0] : receiver;
        const separator = fn.type === 'attribute' ? constantString(receiver) : (args[0] ? constantString(args[0]) : ',');
        if (separator === undefined || !list || !['array', 'list', 'tuple'].includes(list.type)) return undefined;
        const parts = list.namedChildren.map(constantString);
        return parts.every((part: string | undefined) => part !== undefined) ? parts.join(separator) : undefined;
    }
    return undefined;
}

function position(node: any): { line: number; column: number } {
    return { line: node.startPosition.row + 1, column: node.startPosition.column + 1 };
}

// Calls that turn the whole environment into data that can be sent.
const PYTHON_SERIALIZERS = new Set(['json.dumps', 'str', 'repr', 'pickle.dumps', 'yaml.dump', 'yaml.safe_dump', 'urllib.parse.urlencode', 'base64.b64encode']);
const SCRIPT_SERIALIZERS = new Set(['JSON.stringify', 'Object.entries', 'Object.keys', 'Object.values', 'String', 'Buffer.from', 'btoa', 'querystring.stringify', 'URLSearchParams']);

/**
 * True when `node` is (inside) an argument of a call matching `isTarget`,
 * within the same statement: JSON.stringify(process.env), json.dumps(dict(os.environ)).
 * Saving the environment in a variable for later use is not a dump.
 */
function flowsIntoCall(node: any, isTarget: (call: any) => boolean): boolean {
    for (let current = node.parent; current; current = current.parent) {
        if (/statement|declaration|definition|^program$|^module$|^block$/.test(current.type) && !/expression/.test(current.type)) return false;
        if ((current.type === 'call' || current.type === 'call_expression' || current.type === 'new_expression') && isTarget(current)) return true;
    }
    return false;
}

function hasDescendant(node: any, predicate: (node: any) => boolean): boolean {
    let found = false;
    walk(node, child => { if (!found && child !== node && predicate(child)) found = true; });
    return found;
}

interface FileFacts {
    credentialSources: Array<{ text: string; node: any }>;
    envDump?: { text: string; node: any };
    networkCalls: Array<{ callee: string; node: any }>;
    threats: CodeThreat[];
}

function exfiltrationThreat(facts: FileFacts): CodeThreat | undefined {
    const source = facts.credentialSources[0] || facts.envDump;
    const sink = facts.networkCalls[0];
    if (!source || !sink) return undefined;
    return {
        ruleId: 'sec_credential_exfiltration',
        severity: 'critical',
        ...position(sink.node),
        source: source.text,
        sink: sink.callee,
        message: `Reads ${source.text} and sends data over the network (${sink.callee}) in the same file. Credentials or the whole environment can leave the machine.`,
    };
}

// --- Python -----------------------------------------------------------------

/** Resolve a Python callee, following __import__("m") and getattr(x, "name"). */
function pythonCallee(node: any, aliases: Map<string, string>): string | undefined {
    if (!node) return undefined;
    if (node.type === 'call') {
        const fn = node.childForFieldName('function');
        const args = node.childForFieldName('arguments')?.namedChildren || [];
        if (fn?.text === '__import__' && args[0]) {
            const name = constantString(args[0]);
            return name ? normalizeModule(name) : undefined;
        }
        if (fn?.text === 'getattr' && args.length >= 2) {
            const base = pythonCallee(args[0], aliases);
            const attribute = constantString(args[1]);
            return base && attribute ? `${base}.${attribute}` : undefined;
        }
        return undefined;
    }
    if (node.type === 'attribute') {
        const object = pythonCallee(node.childForFieldName('object'), aliases);
        const attribute = node.childForFieldName('attribute')?.text;
        return object && attribute ? `${object}.${attribute}` : undefined;
    }
    const path = dottedPath(node);
    return path ? resolve(path, aliases) : undefined;
}

function pythonDynamicAliases(root: any, aliases: Map<string, string>): void {
    // m = __import__("urllib.request")   o = getattr(__import__("os"), "path")
    walk(root, node => {
        if (node.type !== 'assignment') return;
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (left?.type !== 'identifier' || right?.type !== 'call') return;
        const target = pythonCallee(right, aliases);
        if (target) aliases.set(left.text, target);
    });
}

const PYTHON_NETWORK = PYTHON_SINKS.network;
const PYTHON_EXEC = new Set(['exec', 'eval', 'compile', 'builtins.exec', 'builtins.eval']);
const PYTHON_SHELL = PYTHON_SINKS.shell;

function isPythonNetworkCall(node: any, aliases: Map<string, string>): boolean {
    if (node.type !== 'call') return false;
    const callee = pythonCallee(node.childForFieldName('function'), aliases);
    return Boolean(callee && (PYTHON_NETWORK.has(callee) || /^(?:requests|httpx)\.\w+$/.test(callee)));
}

function analyzePythonThreats(root: any): CodeThreat[] {
    const aliases = pythonAliases(root);
    pythonDynamicAliases(root, aliases);
    const facts: FileFacts = { credentialSources: [], networkCalls: [], threats: [] };

    walk(root, node => {
        const constant = (isStringNode(node) || node.type === 'binary_operator' || node.type === 'call' || node.type === 'concatenated_string')
            ? constantString(node)
            : undefined;
        if (constant && CREDENTIAL_PATH.test(constant)) facts.credentialSources.push({ text: constant, node });

        if (node.type === 'attribute' || node.type === 'identifier') {
            // The whole environment as a value: dict(os.environ), json.dumps(os.environ), os.environ.copy()
            const parent = node.parent;
            // Only when it goes straight into serialisation or a network call;
            // saving it (env = dict(os.environ)) or passing it to a child
            // process (env=os.environ) is ordinary.
            if (pythonCallee(node, aliases) === 'os.environ' && parent?.type !== 'subscript'
                && parent?.type !== 'keyword_argument' && parent?.type !== 'dictionary_splat'
                && !(parent?.type === 'attribute' && ['get', 'setdefault', 'pop'].includes(parent.childForFieldName('attribute')?.text))
                && !(node.type === 'identifier' && parent?.type === 'attribute')
                && flowsIntoCall(node, call => {
                    const callee = pythonCallee(call.childForFieldName('function'), aliases);
                    return Boolean(callee && (PYTHON_SERIALIZERS.has(callee) || isPythonNetworkCall(call, aliases)));
                })) {
                facts.envDump = facts.envDump || { text: 'the whole environment (os.environ)', node };
            }
        }

        if (node.type !== 'call') return;
        const callee = pythonCallee(node.childForFieldName('function'), aliases);
        if (!callee) return;
        if (isPythonNetworkCall(node, aliases)) facts.networkCalls.push({ callee, node });

        const args = node.childForFieldName('arguments');
        if (PYTHON_EXEC.has(callee) && args && hasDescendant(args, child => isPythonNetworkCall(child, aliases))) {
            facts.threats.push({
                ruleId: 'sec_remote_code_execution', severity: 'critical', ...position(node),
                source: 'a network download', sink: callee,
                message: `Executes code downloaded at runtime (${callee} of a network response). Whoever controls that URL controls this machine.`,
            });
        }
        if (PYTHON_SHELL.has(callee) && args) {
            const command = constantString(args.namedChildren[0]);
            if (command && (DOWNLOAD_TO_SHELL.test(command) || REVERSE_SHELL.test(command))) {
                facts.threats.push({
                    ruleId: 'sec_remote_code_execution', severity: 'critical', ...position(node),
                    source: 'a remote download or shell', sink: callee,
                    message: `Runs a shell command that pipes a download into a shell or opens a remote shell (${callee}).`,
                });
            }
        }
    });

    const exfil = exfiltrationThreat(facts);
    return exfil ? [...facts.threats, exfil] : facts.threats;
}

// --- JavaScript / TypeScript --------------------------------------------------

const SCRIPT_NETWORK = SCRIPT_SINKS.network;
const SCRIPT_SHELL = SCRIPT_SINKS.shell;

function scriptCallee(node: any, aliases: Map<string, string>): string | undefined {
    const path = dottedPath(node);
    return path ? resolve(path, aliases) : undefined;
}

function isScriptNetworkCall(node: any, aliases: Map<string, string>): boolean {
    if (node.type !== 'call_expression' && node.type !== 'new_expression') return false;
    const callee = scriptCallee(node.childForFieldName(node.type === 'call_expression' ? 'function' : 'constructor'), aliases);
    return Boolean(callee && SCRIPT_NETWORK.has(callee));
}

function analyzeScriptThreats(root: any): CodeThreat[] {
    const aliases = scriptAliases(root);
    const facts: FileFacts = { credentialSources: [], networkCalls: [], threats: [] };

    walk(root, node => {
        const constant = ['string', 'template_string', 'binary_expression', 'call_expression'].includes(node.type)
            ? constantString(node)
            : undefined;
        if (constant && CREDENTIAL_PATH.test(constant)) facts.credentialSources.push({ text: constant, node });

        if (node.type === 'member_expression' && dottedPath(node) === 'process.env') {
            // The whole environment as a value, e.g. JSON.stringify(process.env)
            const parent = node.parent;
            const accessed = (parent?.type === 'member_expression' || parent?.type === 'subscript_expression')
                && parent.childForFieldName('object')?.id === node.id;
            // Passing it on to a child process ({ env: process.env }, {...process.env}) is not a dump.
            const passedOn = parent?.type === 'spread_element'
                || (parent?.type === 'pair' && parent.childForFieldName('key')?.text === 'env');
            const serialized = flowsIntoCall(node, call => {
                const callee = scriptCallee(call.childForFieldName(call.type === 'call_expression' ? 'function' : 'constructor'), aliases);
                return Boolean(callee && (SCRIPT_SERIALIZERS.has(callee) || isScriptNetworkCall(call, aliases)));
            });
            if (!accessed && !passedOn && serialized) facts.envDump = facts.envDump || { text: 'the whole environment (process.env)', node };
        }

        if (node.type !== 'call_expression' && node.type !== 'new_expression') return;
        const callee = scriptCallee(node.childForFieldName(node.type === 'call_expression' ? 'function' : 'constructor'), aliases);
        if (!callee) return;
        if (isScriptNetworkCall(node, aliases)) facts.networkCalls.push({ callee, node });

        const args = node.childForFieldName('arguments');
        if ((callee === 'eval' || callee === 'Function') && args && hasDescendant(args, child => isScriptNetworkCall(child, aliases))) {
            facts.threats.push({
                ruleId: 'sec_remote_code_execution', severity: 'critical', ...position(node),
                source: 'a network download', sink: callee,
                message: `Executes code downloaded at runtime (${callee} of a network response). Whoever controls that URL controls this machine.`,
            });
        }
        if (SCRIPT_SHELL.has(callee) && args) {
            const command = constantString(args.namedChildren[0]);
            if (command && (DOWNLOAD_TO_SHELL.test(command) || REVERSE_SHELL.test(command))) {
                facts.threats.push({
                    ruleId: 'sec_remote_code_execution', severity: 'critical', ...position(node),
                    source: 'a remote download or shell', sink: callee,
                    message: `Runs a shell command that pipes a download into a shell or opens a remote shell (${callee}).`,
                });
            }
        }
    });

    const exfil = exfiltrationThreat(facts);
    return exfil ? [...facts.threats, exfil] : facts.threats;
}

// --- Shell scripts --------------------------------------------------------------

function analyzeShellThreats(content: string): CodeThreat[] {
    const threats: CodeThreat[] = [];
    const lines = content.split(/\r?\n/);
    let credential: { text: string; line: number } | undefined;
    let network: { text: string; line: number } | undefined;
    lines.forEach((raw, index) => {
        const line = raw.replace(/(^|\s)#.*$/, '$1');
        if (!line.trim()) return;
        if (DOWNLOAD_TO_SHELL.test(line) || REVERSE_SHELL.test(line)) {
            threats.push({
                ruleId: 'sec_remote_code_execution', severity: 'critical', line: index + 1, column: 1,
                source: 'a remote download or shell', sink: 'shell',
                message: 'Pipes downloaded or decoded content into a shell, or opens a remote shell.',
            });
        }
        const credentialMatch = line.split(/\s+/).find(token => CREDENTIAL_PATH.test(token.replace(/^["'$({]+|["')}]+$/g, '')));
        if (credentialMatch && !credential) credential = { text: credentialMatch, line: index + 1 };
        const networkMatch = SHELL_NETWORK.exec(line);
        if (networkMatch && !network) network = { text: networkMatch[0], line: index + 1 };
    });
    if (credential && network) {
        threats.push({
            ruleId: 'sec_credential_exfiltration', severity: 'critical', line: network.line, column: 1,
            source: credential.text, sink: network.text,
            message: `Reads ${credential.text} and sends data over the network (${network.text}) in the same script.`,
        });
    }
    return threats;
}

/**
 * Behaviour-level threats in a script. Returns [] for files it does not
 * analyse, files that do not parse, or when grammars are not loaded (call
 * loadCodeCapabilityGrammars() first for Python and JS/TS).
 */
export function scanCodeForThreats(filePath: string, content: string): CodeThreat[] {
    if (SHELL_EXTENSIONS.has(extensionOf(filePath))) return analyzeShellThreats(content);
    const grammar = grammarForPath(filePath);
    if (grammar !== 'python' && grammar !== 'typescript') return [];
    const tree = parseWithLoadedGrammar(grammar, content);
    if (!tree) return [];
    try {
        if (hasSyntaxError(tree.rootNode)) return [];
        return grammar === 'python' ? analyzePythonThreats(tree.rootNode) : analyzeScriptThreats(tree.rootNode);
    } finally {
        tree.delete();
    }
}
