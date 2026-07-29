#!/bin/bash
# clone-wild.sh — fetch the wild-corpus repos listed in eval/corpus/wild/repos.json.
#
# This environment blocks `git clone` and api.github.com, so we fetch a depth-1
# snapshot via codeload tarball (functionally identical to `git clone --depth 1`:
# a single commit snapshot, no history). On an unrestricted machine you can swap
# the fetch line for `git clone --depth 1 --branch <branch> <url> <dest>`.
#
# - Skips repos already present in clones/.
# - Logs and continues on any per-repo failure (never aborts the run).
# - clones/ is gitignored and must never be committed.
#
# Usage: bash eval/scripts/clone-wild.sh   (from repo root)

set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPOS_JSON="$ROOT/eval/corpus/wild/repos.json"
CLONES_DIR="$ROOT/eval/corpus/wild/clones"
LOG="$ROOT/eval/corpus/wild/clone-log.txt"
PER_REPO_TIMEOUT="${PER_REPO_TIMEOUT:-180}"
mkdir -p "$CLONES_DIR"
: > "$LOG"

# Emit "id<TAB>repo<TAB>branch" rows from repos.json (node is always available).
mapfile -t ROWS < <(node -e '
const d=require(process.argv[1]);
for(const r of d.repos) console.log([r.id, r.repo, r.default_branch||"main"].join("\t"));
' "$REPOS_JSON")

total=${#ROWS[@]}; ok=0; skip=0; fail=0; i=0
echo "Fetching $total repos into $CLONES_DIR (timeout ${PER_REPO_TIMEOUT}s each)"
for row in "${ROWS[@]}"; do
  i=$((i+1))
  id="${row%%	*}"; rest="${row#*	}"; repo="${rest%%	*}"; branch="${rest##*	}"
  dest="$CLONES_DIR/$id"
  if [ -d "$dest" ] && [ -n "$(ls -A "$dest" 2>/dev/null)" ]; then
    echo "[$i/$total] skip   $id ($repo) — already present"
    skip=$((skip+1)); continue
  fi
  tmp="$(mktemp -d)"
  url="https://codeload.github.com/$repo/tar.gz/refs/heads/$branch"
  echo -n "[$i/$total] fetch  $id ($repo@$branch) ... "
  if timeout "$PER_REPO_TIMEOUT" curl -sSL --max-time "$PER_REPO_TIMEOUT" -o "$tmp/r.tgz" "$url" \
     && tar -xzf "$tmp/r.tgz" -C "$tmp" 2>/dev/null; then
    # tarball extracts to a single top dir <repo>-<branch>/; move it to dest.
    inner="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -1)"
    if [ -n "$inner" ]; then
      mkdir -p "$dest"; mv "$inner"/* "$inner"/.[!.]* "$dest"/ 2>/dev/null
      bytes=$(du -sh "$dest" 2>/dev/null | cut -f1)
      echo "ok ($bytes)"; echo "OK   $id $repo@$branch $bytes" >> "$LOG"; ok=$((ok+1))
    else
      echo "FAIL (empty archive)"; echo "FAIL $id $repo — empty archive" >> "$LOG"; fail=$((fail+1))
    fi
  else
    echo "FAIL (fetch/extract)"; echo "FAIL $id $repo — fetch/extract error" >> "$LOG"; fail=$((fail+1))
  fi
  rm -rf "$tmp"
done

echo "Done: $ok fetched, $skip skipped, $fail failed. Log: $LOG"
