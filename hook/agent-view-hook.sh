#!/bin/sh
# Agent View subagent hook for Claude Code (installed by `bun run install:hook`).
#
#   agent-view-hook.sh <HookEvent>    payload JSON on stdin
#
# Keeps one directory per herdr pane with one file per running subagent and
# one per Claude session (a nested `claude` in the pane gets its own); the
# Agent View app reads it (src/bun/subagents.ts). Runs on every tool call, so:
# no JSON parser, no output, and always exit 0 — exit 2 would block Claude.

event="${1:-}"
pane="${HERDR_PANE_ID:-}"
[ -n "$pane" ] || exit 0

# filename-safe, byte for byte like sanitizePaneId in src/bun/subagents.ts
safe() {
	printf '%s' "$1" | LC_ALL=C tr -c 'A-Za-z0-9._-' '_'
}

root="$HOME/Library/Application Support/Agent View/subagents"
dir="$root/$(safe "$pane")"
payload=$(cat) || exit 0

# Claude sends compact JSON: the only unescaped match is the top-level key.
agent_id() {
	printf '%s' "$payload" | grep -o '"agent_id":"[0-9a-f]*"' | head -n 1 | cut -d '"' -f 4
}

# session_id is the first key of every payload
session_id() {
	printf '%s' "$payload" | grep -o '"session_id":"[^"]*"' | head -n 1 | cut -d '"' -f 4
}

# save <name>: atomic write of the payload into the pane directory
save() {
	mkdir -p "$dir" 2>/dev/null || return 0
	tmp="$dir/.$1.$$"
	printf '%s\n' "$payload" >"$tmp" 2>/dev/null && mv -f "$tmp" "$dir/$1" 2>/dev/null
	rm -f "$tmp" 2>/dev/null
	return 0
}

case "$event" in
SessionStart)
	sid=$(session_id)
	[ -n "$sid" ] && save "session-$(safe "$sid").json"
	;;
SessionEnd)
	# only this session's files: a parent session may still be running in the pane
	sid=$(session_id)
	[ -n "$sid" ] || exit 0
	rm -f "$dir/session-$(safe "$sid").json" 2>/dev/null
	for f in "$dir"/*.start.json; do
		[ -f "$f" ] && grep -qF "\"session_id\":\"$sid\"" "$f" 2>/dev/null &&
			rm -f "$f" "${f%.start.json}.alive" 2>/dev/null
	done
	rmdir "$dir" 2>/dev/null
	;;
SubagentStart)
	id=$(agent_id)
	[ -n "$id" ] && save "$id.start.json"
	;;
SubagentStop)
	id=$(agent_id)
	save last-stop.json
	[ -n "$id" ] && rm -f "$dir/$id.start.json" "$dir/$id.alive" 2>/dev/null
	;;
PreToolUse)
	id=$(agent_id)
	[ -n "$id" ] && [ -f "$dir/$id.start.json" ] && touch "$dir/$id.alive" 2>/dev/null
	;;
esac
exit 0
