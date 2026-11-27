"""Fetch the MalSkills real-world benchmark and split it by publisher.

Usage: python3 -I fetch_malskills.py <out_dir>

Clones security-pride/MalSkills at the pinned commit and writes three label
files for run_tool.py: <out_dir>/all (100 malicious ClawHub skills collected by
Koi Security + 100 benign ClawHub skills), <out_dir>/dev and <out_dir>/test.
The split is by publisher, because one publisher's malicious skills are
near-copies of each other; benign skills are split by a hash of their name.

The malicious skills are real malware droppers. Only read them; never run them
or follow their instructions. Each skill folder is linked at the folder that
holds its SKILL.md (benign ones are one level down, in latest_<hash>/).
"""
import csv
import glob
import hashlib
import json
import os
import subprocess
import sys

URL = 'https://github.com/security-pride/MalSkills'
COMMIT = '46d60f09cef00fd3a9c01272be63dbd273ab4444'
# Publishers whose malicious skills were used to develop the rules; the rest
# (sakaen736jih, zaycv, moonshine-100rze, noreplyboter, pepe276, rjnpage) were
# the held-out test half.
DEV_PUBLISHERS = {'hightower6eu', 'aslaep123', 'gpaitai', 'mosonchan2023'}

out = os.path.abspath(sys.argv[1])
source = os.path.join(out, 'MalSkills')
if not os.path.isdir(source):
    subprocess.run(['git', 'clone', '-q', '--filter=blob:none', '--no-checkout', URL, source], check=True)
    subprocess.run(['git', '-C', source, 'checkout', '-q', COMMIT], check=True)

rows = list(csv.DictReader(open(os.path.join(source, 'data', 'ground_truth', 'ground_truth_final.csv'), encoding='utf-8')))


def part(row: dict, name: str) -> str:
    if row['Label'] == 'malicious':
        return 'dev' if row['Skill_name'].split('/')[0].lower() in DEV_PUBLISHERS else 'test'
    return 'dev' if int(hashlib.sha256(f"{row['Label']}/{name}".encode()).hexdigest(), 16) % 2 == 0 else 'test'


for split in ('all', 'dev', 'test'):
    os.makedirs(os.path.join(out, split), exist_ok=True)
    with open(os.path.join(out, split, 'labels.jsonl'), 'w', encoding='utf-8') as fh:
        for row in rows:
            folder = os.path.join(source, row['Ground_truth_path'])
            name = os.path.basename(folder)
            if split != 'all' and part(row, name) != split:
                continue
            roots = sorted((os.path.dirname(p) for p in glob.glob(os.path.join(folder, '**', 'SKILL.md'), recursive=True)), key=len)
            target = roots[0] if roots else folder
            link = os.path.join(out, split, row['Label'], name)
            os.makedirs(os.path.dirname(link), exist_ok=True)
            if not os.path.lexists(link):
                os.symlink(target, link)
            label = 'malicious' if row['Label'] == 'malicious' else 'clean'
            fh.write(json.dumps({'skill': f"{row['Label']}/{name}", 'label': label, 'category': row['Source'], 'note': row['Skill_name']}) + '\n')
    print(split, sum(1 for _ in open(os.path.join(out, split, 'labels.jsonl'))), 'skills')
print('Some scanners refuse symlinks; copy with `cp -rL <out>/test <out>/test-copy` if needed.')
