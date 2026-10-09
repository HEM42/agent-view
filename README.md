# Agent View

A cyberpunk pixel-art office for your [herdr](https://herdr.dev) agents,
built on [Electrobun](https://github.com/blackboardsh/electrobun).

![Agent View](docs/screenshot.png)

Every AI agent running in herdr appears as a little pixel person in a shared
neon-lit room. One glance at the window tells you who is working, who is
stuck waiting for you, and who is slacking off in front of the TV.

| herdr status | in the room |
|---|---|
| `working` | sits at their desk, typing at an angled holo-screen |
| `blocked` (waiting for your input) | stands up, raises a hand, jumps — `!` |
| `idle` | couch & TV first; ramen bar when the couch is full; bed after ~5 min |
| `unknown` | stands around confused — `?` |
| pane closed | walks out through the sliding door |
| subagent running (Claude Code) | a small drone swarms above the parent's desk; 6 max, then `+N` |

## Install

```sh
brew install --cask jgwesterlund/tap/agent-view
```

Apple Silicon, macOS 14+. The app is ad-hoc signed but not notarized; the
cask clears the quarantine flag for you. If macOS still blocks the first
launch, run `xattr -dr com.apple.quarantine "/Applications/Agent View.app"`.

You'll also need [herdr](https://herdr.dev) installed and running — Agent
View reads its agent list from herdr through the Agent View daemon. The app
installs and upgrades that daemon itself on launch (see [Daemon](#daemon)), so
there is nothing extra to set up.

## The room

- **Characters walk** between spots along walk lanes — no teleporting. New
  agents file in through the sliding door one by one.
- **Every agent owns a desk** (assigned on first sight, freed when the pane
  closes) and always returns to the same seat.
- **Idle chain:** 3 couch seats (the TV switches on), then a 4-seat ramen
  bar — steaming noodle bowls in each guest's project color — then loiter
  spots. After ~5 minutes idle they climb into the bunk bed (zZz).
- **Colors are collision-free:** 5 agent outfit colors and 5 project accent
  colors, handed out first-come-first-served and persisted in localStorage.
  Same project = same accent (scarf, nametag, blanket stripe, mug, bowl).
- **Name tags** render on a fixed-size HUD layer above the pixel scene, so
  they stay small and crisp at any window size. The herdr-focused pane gets
  a bobbing yellow caret.
- **Ambience:** rain and parallax skyline in the window, a 24h wall clock,
  scanlines + vignette, steam, dust, TV light pools — and a HERDR neon sign
  whose second R keeps dying.
- **Daemon the cat** wanders, naps on the couch arm, and if you ignore a
  blocked agent for more than a minute, walks to that desk and stares at you.
- **Offline is explicit:** if herdr or the daemon is down you get a blacked-out room and a
  flickering OFFLINE banner — never silently stale data.
- **Subagents** (Claude Code only, needs the hook below) swarm as drones
  above their parent's desk — and stay there when the parent goes lounging,
  so the desk's screen reads "work still running". Hover a drone for its
  type, task and runtime.

## Interaction

The window is a frameless neon widget: drag it by the title strip, `◎` pins
it always-on-top, `×` quits. Hover a character for status details;
double-click to focus that agent's pane in herdr.

## Subagents

Agent View learns about Claude Code subagents from a small hook script. Install it from a checkout:

```bash
bun run install:hook     # copies the hook, adds 5 entries to ~/.claude/settings.json (backup: settings.json.agent-view.bak)
bun run uninstall:hook   # removes exactly those entries, the script and its data
```

The hook only runs inside herdr panes (it keys on `HERDR_PANE_ID`), writes to
`~/Library/Application Support/Agent View/subagents/`, and never blocks Claude. The daemon reads those pane directories on
every herdr poll and sends each agent's subagents with its snapshot, so the drones show in both the app and the screensaver.
Without the hook, the room works as before, with no drones.

Run `bun run uninstall:hook` before deleting the app or its Application Support folder; otherwise every Claude tool call runs
a missing hook command.

## Screensaver

The same room is also available as a macOS screensaver. Live data comes from
the Agent View daemon over a WebSocket on `127.0.0.1:47371` (needs
`bun run install:daemon`, or `bun run daemon` in the foreground). Without the
daemon, or while herdr is down, the saver shows the demo loop (marked `DEMO`)
and never an offline banner.

Building the saver needs the Xcode Command Line Tools (`swiftc`):

```bash
bun run build:saver     # → build/Agent View.saver
bun run install:saver   # → ~/Library/Screen Savers/
```

Then pick **Agent View** under System Settings → Wallpaper → Other
(older macOS: System Settings → Screen Saver). Connection transitions are
logged in the `daemon` category — look for `daemon: connected`:
`log show --last 10m --predicate 'subsystem == "com.cygnisec.agentview.saver"'`.

To uninstall, remove `~/Library/Screen Savers/Agent View.saver`. A leftover
`~/Library/Application Support/Agent View/agents.json` from older builds can
be deleted too.

## Run from source

```bash
bun install
bun run daemon       # foreground daemon (or bun run install:daemon once)
bun start            # live herdr data, via the daemon
bun run dev          # live + watch mode, via the daemon
bun run fake         # HERDR_FAKE=1 — deterministic 90s demo loop, no herdr needed
bun run chaos        # randomized soak test
bun test             # data-layer unit tests
```

## Daemon

Agent View's office lives in a small background daemon. It polls herdr and serves the room to the app and the
screensaver over a WebSocket on `127.0.0.1:47371`. The app installs and upgrades the daemon itself on launch, so a
normal install needs nothing extra. For source checkouts and development, install it by hand:

```sh
bun run install:daemon     # bundle, install as a LaunchAgent, start at login
bun run uninstall:daemon   # stop and remove (keeps saved state and the log)
```

- Log: `~/Library/Logs/Agent View/daemon.log`
- Check: `curl -s 127.0.0.1:47371/v1/health` and `curl -s 127.0.0.1:47371/v1/world`
- Restart: `launchctl kickstart -k gui/$UID/com.cygnisec.agentview.daemon`
- From a source checkout, re-run `bun run install:daemon` after pulling changes.
- The install bundles the daemon next to a copy of bun, so it needs neither this checkout nor bun on PATH.
- Removing it when you only have the app: `launchctl bootout gui/$UID/com.cygnisec.agentview.daemon`, then delete
  `~/Library/LaunchAgents/com.cygnisec.agentview.daemon.plist` and `~/Library/Application Support/Agent View/daemon`.
  Source checkouts: `bun run uninstall:daemon`.

For development, `bun run daemon` runs it in the foreground (set `AGENT_VIEW_PORT` to stay off the installed one).
`bun run fake` / `bun run chaos` start their own in-process daemon on port 47372 and need nothing installed.

## How it works

- **Daemon** (`src/daemon/`) runs the herdr poller (`HerdrPoller` in
  `src/shared/herdr-core.ts`), which normalizes and debounces statuses (2 consecutive
  polls to change, except `blocked` which is instant — the raised hand is the
  whole point), and pushes full world snapshots to clients over a WebSocket on
  `127.0.0.1:47371`. Each poll also joins Claude agents' running subagents
  from the hook's pane directories (`src/bun/subagents.ts`).
- **Bun process** (`src/bun/`) connects to the daemon (`src/bun/daemon-client.ts`)
  and forwards each snapshot to the webview over Electrobun's typed RPC.
- **Webview** (`src/mainview/`) is a 384x216 canvas scene scaled by integer
  factors (WKWebView, `image-rendering: pixelated`). Characters are driven
  by a small state machine over walk lanes; everything y-sorts for depth.
  Effects never use `ctx.filter`/`shadowBlur` in the frame loop — glow is
  pre-rendered and stamped with `globalCompositeOperation: "lighter"`.
- **All pixel art is code** — string rows + palette maps in
  `src/mainview/sprites/sheets/`, no binary assets. Sprites bake to
  OffscreenCanvases once at boot.
- **Shared contract** lives in `src/shared/types.ts`.

### Art tooling

Render any sprite sheet (or the 3x5 bitmap font) to a PNG contact sheet:

```bash
bun tools/preview.ts src/mainview/sprites/sheets/character.ts /tmp/preview.png 10
```

### Dev frame dumps

Launch with `AGENTVIEW_SHOT=/tmp/shot.png` and the app writes its rendered
frame there a few seconds after load and every 10s (or press `s`). Handy for
checking the scene without screen-recording permissions.

### Note on first build

Electrobun's CLI downloads its native binaries from GitHub Releases on first
build. If that fails with a certificate error, fetch manually:

```bash
curl -sL -o /tmp/eb-core.tar.gz https://github.com/blackboardsh/electrobun/releases/download/v1.18.1/electrobun-core-darwin-arm64.tar.gz
mkdir -p node_modules/electrobun/dist-macos-arm64
tar -xzf /tmp/eb-core.tar.gz -C node_modules/electrobun/dist-macos-arm64
```
