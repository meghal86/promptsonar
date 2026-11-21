"""Run one scanner over every skill in labels.jsonl and record its verdict.

Usage: python3 -I run_tool.py <tool> <data_dir> <out_dir> [--label NAME]

Tools: promptsonar-scan, promptsonar-repo, cisco, cisco-behavioral, skillspector,
skillscan, antivirus, skillguard. Each must be installed separately; see README.

Every tool is reduced to the same verdict: the worst severity it reports for
the skill. A skill counts as flagged when that is HIGH or CRITICAL. Raw output
is kept per skill so the reduction can be audited.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

TOOL, DATA, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
# --label NAME stores results under another name (e.g. to compare two builds).
LABEL = sys.argv[sys.argv.index('--label') + 1] if '--label' in sys.argv else TOOL
HERE = os.path.dirname(os.path.abspath(__file__))
# The PromptSonar CLI to test: PROMPTSONAR_CLI, else this checkout's build.
PROMPTSONAR = os.environ.get('PROMPTSONAR_CLI') or os.path.normpath(os.path.join(HERE, '..', '..', '..', 'packages', 'cli', 'dist', 'cli.js'))
# claude-skill-antivirus is installed with npm; point SKILL_ANTIVIRUS at its skill-install binary.
ANTIVIRUS = os.environ.get('SKILL_ANTIVIRUS', 'skill-install')
RANK = {'NONE': 0, 'INFO': 0, 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3, 'CRITICAL': 4}
ANSI = re.compile(r'\x1b\[[0-9;]*m')


def worst(severities):
    best = 'NONE'
    for sev in severities:
        sev = str(sev or 'NONE').upper()
        if RANK.get(sev, 0) > RANK[best]:
            best = sev
    return best


def run(cmd, cwd=None, env=None):
    proc = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=300)
    return proc.returncode, proc.stdout, proc.stderr


def scan(skill_dir, raw_base):
    if TOOL == 'promptsonar-scan':
        code, out, err = run(['node', PROMPTSONAR, 'scan', '.', '--json'], cwd=skill_dir)
        data = json.loads(out)
        # A directory with one scannable file reports a single result object.
        results = data if isinstance(data, list) else data.get('results', [data])
        sevs = [f['severity'] for r in results for f in r.get('findings', []) if not f.get('waived')]
        return worst(sevs), out
    if TOOL == 'promptsonar-repo':
        code, out, err = run(['node', PROMPTSONAR, 'repo', '.', '--json'], cwd=skill_dir)
        summary = json.loads(out)['issueSummary']
        return worst([s for s in ('critical', 'high', 'medium', 'low') if summary.get(s)]), out
    if TOOL in ('cisco', 'cisco-behavioral'):
        report = raw_base + '.report.json'
        cmd = ['skill-scanner', 'scan', skill_dir, '--format', 'json', '--output', report]
        if TOOL == 'cisco-behavioral':
            cmd.append('--use-behavioral')
        code, out, err = run(cmd)
        data = json.load(open(report))
        return worst([f['severity'] for f in data.get('findings', [])]), json.dumps(data)
    if TOOL == 'skillspector':
        report = raw_base + '.report.json'
        code, out, err = run(['skillspector', 'scan', skill_dir, '--no-llm', '--format', 'json', '--output', report])
        data = json.load(open(report))
        return worst([i.get('severity') for i in data.get('issues', [])]), json.dumps(data)
    if TOOL == 'skillscan':
        code, out, err = run(['skillscan', 'audit', os.path.join(skill_dir, 'SKILL.md'), '--format', 'json'])
        data = json.loads(out)
        return worst([f.get('severity') for f in data.get('findings', [])]), out
    if TOOL == 'antivirus':
        code, out, err = run([ANTIVIRUS, skill_dir, '--scan-only'])
        text = ANSI.sub('', out + err)
        match = re.search(r'Risk Level:\s*([A-Z]+)', text)
        counts = {k: int(v) for k, v in re.findall(r'^\s*(Critical|High|Medium|Low):\s*(\d+)', text, re.M)}
        if not match:
            raise RuntimeError('no risk level in output')
        return worst([k for k, v in counts.items() if v > 0]), text
    if TOOL == 'skillguard':
        with tempfile.TemporaryDirectory() as tmp:
            project = os.path.join(tmp, 'proj')
            os.makedirs(os.path.join(tmp, 'home'))
            shutil.copytree(skill_dir, os.path.join(project, '.claude', 'skills', os.path.basename(skill_dir)))
            env = dict(os.environ, HOME=os.path.join(tmp, 'home'))
            code, out, err = run(['skillguard', '--scope', 'local', '--target', 'skills', '--format', 'json'], cwd=project, env=env)
        data = json.loads(out)
        return worst([s.get('max_severity') for s in data.get('skills', [])]), out
    raise SystemExit(f'unknown tool {TOOL}')


os.makedirs(os.path.join(OUT, LABEL), exist_ok=True)
rows = []
for line in open(os.path.join(DATA, 'labels.jsonl')):
    entry = json.loads(line)
    skill_dir = os.path.join(DATA, entry['skill'])
    raw_base = os.path.join(OUT, LABEL, entry['skill'].replace('/', '__'))
    started = time.time()
    try:
        severity, raw = scan(skill_dir, raw_base)
        error = None
    except Exception as exc:  # a tool crash is recorded, not hidden
        severity, raw, error = 'ERROR', '', f'{type(exc).__name__}: {exc}'[:300]
    elapsed = round(time.time() - started, 2)
    with open(raw_base + '.raw.txt', 'w', encoding='utf-8') as fh:
        fh.write(raw)
    rows.append({**entry, 'tool': LABEL, 'severity': severity, 'flagged': severity in ('HIGH', 'CRITICAL'), 'seconds': elapsed, 'error': error})
    print(LABEL, entry['skill'], severity, elapsed, error or '', flush=True)

with open(os.path.join(OUT, f'{LABEL}.jsonl'), 'w') as fh:
    for row in rows:
        fh.write(json.dumps(row) + '\n')
