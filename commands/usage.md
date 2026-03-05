---
description: Show current session token usage and estimated cost
---

Read the file at ~/.claude/token-stats.txt and display its contents to the user verbatim.

If the file does not exist, tell the user that no token data is available yet for this session — the tracker updates after each response.

Note: This shows the stats from the most recently active session. If you have multiple concurrent sessions, the data reflects whichever session last completed a response.
