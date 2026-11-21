"""Score run_tool.py results. Usage: python3 -I score.py <out_dir>

For every <tool>.jsonl in out_dir: malicious skills caught, clean skills
flagged (a skill counts as flagged when the tool's worst finding is HIGH or
CRITICAL), tool errors and median seconds per skill. Then the worst severity
per malicious skill, for each tool.
"""
import glob
import json
import os
import statistics
import sys

OUT = sys.argv[1]
SYMBOL = {'CRITICAL': 'C', 'HIGH': 'H', 'MEDIUM': 'm', 'LOW': 'l', 'NONE': '.', 'INFO': '.', 'ERROR': 'E'}

rows = {}
for path in sorted(glob.glob(os.path.join(OUT, '*.jsonl'))):
    tool = os.path.basename(path)[:-len('.jsonl')]
    rows[tool] = [json.loads(line) for line in open(path, encoding='utf-8')]


def is_malicious(row):
    return row['label'] == 'malicious'


print('| Tool | Malicious caught | Clean flagged | Errors | Median s/skill |')
print('|---|---|---|---|---|')
for tool, results in rows.items():
    malicious = [r for r in results if is_malicious(r)]
    clean = [r for r in results if not is_malicious(r)]
    caught = sum(r['flagged'] for r in malicious)
    flagged = sum(r['flagged'] for r in clean)
    errors = sum(r['severity'] == 'ERROR' for r in results)
    median = statistics.median(r['seconds'] for r in results) if results else 0
    rate = f' ({100 * flagged / len(clean):.1f}%)' if clean else ''
    print(f"| {tool} | {caught}/{len(malicious)} | {flagged}/{len(clean)}{rate} | {errors} | {median:.2f} |")

malicious_skills = sorted({r['skill'] for results in rows.values() for r in results if is_malicious(r)})
if malicious_skills:
    print('\nWorst severity per malicious skill (C critical, H high, m medium, l low, . none, E error)\n')
    tools = list(rows)
    print('skill'.ljust(40) + ''.join(t[:10].rjust(11) for t in tools))
    by_tool = {t: {r['skill']: r['severity'] for r in rows[t]} for t in tools}
    for skill in malicious_skills:
        print(skill.split('/', 1)[1][:39].ljust(40) + ''.join(SYMBOL.get(by_tool[t].get(skill, '?'), '?').rjust(11) for t in tools))
