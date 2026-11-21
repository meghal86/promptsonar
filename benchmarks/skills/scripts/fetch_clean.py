"""Fetch a clean-skill set from its source repositories, pinned by commit.

Usage: python3 -I fetch_clean.py <sources/SET.json> <out_dir>

Clones each repository at the recorded commit (blob-filtered, so only the
needed files download), copies every listed skill folder to
<out_dir>/benign/<repo>__<path>, and writes <out_dir>/labels.jsonl.
Third-party skills are not stored in this repository; only their locations.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

manifest_path, out = sys.argv[1], sys.argv[2]
manifest = json.load(open(manifest_path, encoding='utf-8'))
os.makedirs(os.path.join(out, 'benign'), exist_ok=True)
labels = []
with tempfile.TemporaryDirectory() as tmp:
    for repo in manifest['repositories']:
        clone = os.path.join(tmp, repo['name'])
        subprocess.run(['git', 'clone', '-q', '--filter=blob:none', '--no-checkout', repo['url'], clone], check=True)
        subprocess.run(['git', '-C', clone, 'checkout', '-q', repo['commit']], check=True)
        for path in repo['skills']:
            name = f"{repo['name']}__{path.replace(os.sep, '_').replace('/', '_')}"[:120]
            shutil.copytree(os.path.join(clone, path), os.path.join(out, 'benign', name),
                            ignore=shutil.ignore_patterns('.git'), symlinks=False, ignore_dangling_symlinks=True)
            labels.append({'skill': f'benign/{name}', 'label': 'clean', 'category': manifest['set'], 'note': f"{repo['url']}@{repo['commit'][:12]}:{path}"})
        print(repo['name'], len(repo['skills']), 'skills', flush=True)
with open(os.path.join(out, 'labels.jsonl'), 'w', encoding='utf-8') as fh:
    for row in labels:
        fh.write(json.dumps(row) + '\n')
print(len(labels), 'clean skills written to', out)
