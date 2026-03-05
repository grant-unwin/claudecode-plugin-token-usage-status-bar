---
description: Install a tmux status bar showing live token usage
---

Run the following commands to set up a tmux status bar that displays live token usage:

1. First check if tmux is installed by running: `which tmux`
2. If tmux is not installed, install it automatically:
   - On macOS: `brew install tmux`
   - On Ubuntu/Debian: `sudo apt install -y tmux`
   - On other Linux: `sudo yum install -y tmux` or `sudo pacman -S tmux`
   If the install fails, tell the user what went wrong and ask them to install tmux manually.
3. Once tmux is installed, append these lines to `~/.tmux.conf` (create the file if it doesn't exist), but ONLY if they are not already present:

```
# Claude Code Token Tracker
set -g status-interval 2
set -g status-right '#(cat ~/.claude/token-stats.txt.compact 2>/dev/null || echo "no data") | %H:%M '
set -g status-right-length 80
```

4. If tmux is currently running, reload the config by running: `tmux source-file ~/.tmux.conf`
5. Tell the user the status bar is installed. They will see a compact token usage display in the bottom-right of their tmux status bar that updates every 2 seconds.
6. If the user is not currently in a tmux session, remind them they need to run `tmux` to start one.
