# token-tracker — Claude Code Plugin

Displays a running count of input and output tokens after every Claude response, with an estimated session cost.

## What you see

After each response, this appears in your Claude Code terminal:

```
┌─ Token Usage ────────────────────────────────────────┐
│  Input  :        4,821   Output :        1,203  │
│  Cache↑ :            0   Cache↓ :            0  │
│  Total  :        6,024 tokens       ~  $0.0326  │
└──────────────────────────────────────────────────────┘
```

At session end, it shows the same box labelled **Session Final**.

---

## Installation

### Option A — Load for one session (no install needed)

```bash
claude --plugin-dir /path/to/claudecode-plugin-token-usage-status-bar
```

### Option B — Install from GitHub

In Claude Code, run:

```
/plugin marketplace add grant-unwin/claudecode-plugin-token-usage-status-bar
/plugin install token-tracker@Token Usage Status Bar
```

---

## Slash command

Use `/token-tracker:tokens` at any time to display the current session totals inline.

---

## tmux Status Bar (optional)

Add to `~/.tmux.conf`:

```tmux
set -g status-interval 2
set -g status-right '#(cat ~/.claude/token-stats.txt.compact 2>/dev/null || echo "–") | %H:%M '
```

Then reload: `tmux source-file ~/.tmux.conf`

---

## Watch pane (no tmux)

Run in a split terminal pane for a live updating view:

```bash
watch -n 1 cat ~/.claude/token-stats.txt
```

---

## Pricing

Defaults to **Claude Sonnet 4.5** rates. Edit the `PRICING` constant in `scripts/token-tracker.mjs`:

```js
const PRICING = {
  input:        3.00,   // per 1M tokens
  output:      15.00,
  cache_write:  3.75,
  cache_read:   0.30,
};
```

| Model       | Input  | Output |
|-------------|--------|--------|
| Opus 4.5    | $15    | $75    |
| Sonnet 4.5  | $3     | $15    |
| Haiku 4.5   | $0.80  | $4     |

---

## Uninstall

```
/plugin uninstall token-tracker
```

Clean up status files:

```bash
rm -rf ~/.claude/token-tracker ~/.claude/token-stats.txt ~/.claude/token-stats.txt.compact
```
