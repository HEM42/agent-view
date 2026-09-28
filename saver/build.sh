#!/bin/sh
# Build build/Agent View.saver: bun-bundled page + swiftc-compiled shell.
set -eu
cd "$(dirname "$0")/.."

OUT="build/Agent View.saver"
WEB="$OUT/Contents/Resources/web"
rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$WEB"

bun build src/saver/index.ts --target browser --format iife --outfile "$WEB/saver.js"
cp src/saver/saver.html src/saver/saver.css "$WEB/"
cp saver/Info.plist "$OUT/Contents/Info.plist"

swiftc -swift-version 5 -O \
	-target arm64-apple-macos14.0 \
	-module-name AgentViewSaver \
	-emit-library \
	-framework ScreenSaver -framework WebKit -framework AppKit \
	saver/AgentViewSaverView.swift saver/HerdrBridge.swift \
	-o "$OUT/Contents/MacOS/AgentViewSaver"

codesign --force --sign - "$OUT"
echo "built $OUT"
