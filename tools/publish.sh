#!/usr/bin/env bash
# publish.sh - export the committed workspace to the public repo (main) and the noindex Pages preview (gh-pages).
#   KEYS_DIR=<folder outside the project holding hf.key> MSYS_NO_PATHCONV=1 bash tools/publish.sh "<commit message>"
# Never pushes the workspace repo itself (it holds the raw crawl). Both public copies are secret-scanned against the
# real key value, and grepped for account, credit and spend lines, before any push.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_URL="https://github.com/mikko-creator/d2cpeptides-redesign.git"
KEYS="${KEYS_DIR:?set KEYS_DIR to the folder holding hf.key (outside the project)}"
MSG="${1:-Update}"
TRAILER=$'\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'

[ -z "$(git status --porcelain)" ] || { echo "workspace not clean: commit first"; exit 1; }
node src/build.mjs --strict
node tools/parity.mjs
[ -z "$(git status --porcelain -- dist)" ] || { echo "dist/ differs from the committed build: rebuild and commit first"; exit 1; }

# ---- repo export (main) ----
mkdir -p publish/repo
if [ ! -d publish/repo/.git ]; then git -C publish/repo init -q -b main; git -C publish/repo remote add origin "$REPO_URL"; fi
find publish/repo -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git archive HEAD | tar -x -C publish/repo
node tools/secret-scan.mjs --dir publish/repo --keys "$KEYS/hf.key"
if grep -r -i -l -E "credits? (left|balance|remaining)|\bbalance\b.*credit|subscription_plan|per-call price|\\\$[0-9]+(\.[0-9]+)? (spent|total spend)" publish/repo --exclude-dir=.git --exclude-dir=dist --exclude=publish.sh; then echo "account or spend line in the repo export"; exit 1; fi
git -C publish/repo add -A
git -C publish/repo -c user.name="mikko-creator" -c user.email="mikko@dispenza.com" commit -q -m "$MSG$TRAILER" || echo "repo: nothing to commit"
git -C publish/repo push -q -u origin main

# ---- preview (gh-pages) ----
node tools/make-preview.mjs --out preview
node tools/secret-scan.mjs --dir preview --keys "$KEYS/hf.key"
if [ ! -d preview/.git ]; then git -C preview init -q -b gh-pages; git -C preview remote add origin "$REPO_URL"; fi
git -C preview add -A
git -C preview -c user.name="mikko-creator" -c user.email="mikko@dispenza.com" commit -q -m "Preview: $MSG$TRAILER" || echo "preview: nothing to commit"
git -C preview push -q -u origin gh-pages
echo "published: repo $(git -C publish/repo rev-parse --short HEAD), preview $(git -C preview rev-parse --short HEAD)"
