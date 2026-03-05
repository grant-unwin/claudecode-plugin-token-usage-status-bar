# token-tracker — Claude Code Plugin

Displays a running count of input and output tokens after every Claude response, with an estimated session cost.

## What you see

After each response, this appears in your Claude Code terminal:

```
┌─ Token Usage ────────────────────────────────────────┐
│  Model  : Opus 4.6                                   │
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
/plugin install token-tracker@token-usage-status-bar
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

The plugin automatically detects which Claude model is being used and applies the correct pricing. Prices are per 1M tokens (source: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)):

| Model       | Input  | Output | Cache Write | Cache Read |
|-------------|--------|--------|-------------|------------|
| Opus 4.6    | $5     | $25    | $6.25       | $0.50      |
| Opus 4.5    | $5     | $25    | $6.25       | $0.50      |
| Opus 4.1    | $15    | $75    | $18.75      | $1.50      |
| Sonnet 4.6  | $3     | $15    | $3.75       | $0.30      |
| Sonnet 4.5  | $3     | $15    | $3.75       | $0.30      |
| Haiku 4.5   | $1     | $5     | $1.25       | $0.10      |

If the model can't be detected, Sonnet pricing is used as a fallback.

---

## Uninstall

```
/plugin uninstall token-tracker
```

Clean up status files:

```bash
rm -rf ~/.claude/token-tracker ~/.claude/token-stats.txt ~/.claude/token-stats.txt.compact
```
