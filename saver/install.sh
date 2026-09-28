#!/bin/sh
# Install the built saver for the current user. The running saver host
# caches the old bundle, so it is restarted to pick up the new one.
set -eu
cd "$(dirname "$0")/.."

SRC="build/Agent View.saver"
DEST="$HOME/Library/Screen Savers/Agent View.saver"
[ -d "$SRC" ] || { echo "run 'bun run build:saver' first" >&2; exit 1; }
mkdir -p "$HOME/Library/Screen Savers"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
killall legacyScreenSaver 2>/dev/null || true
echo "installed $DEST"
