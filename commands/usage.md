---
description: Show current session token usage and estimated cost
---

Run the following command and display its output to the user verbatim:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/token-tracker.mjs --query
```

If the output says "No transcript data found", tell the user that no token data is available yet.
