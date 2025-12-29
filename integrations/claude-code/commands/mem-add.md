---
description: Add a memory object to Alexandria
argument-hint: "<content>" --type <type>
---

Add a new memory object to Alexandria.

Types:
- `decision` - Explicit choice with rationale
- `preference` - Developer style/workflow choice
- `convention` - Pattern the codebase follows
- `known_fix` - Solution that worked
- `constraint` - Hard limit that must not be violated
- `failed_attempt` - Something that didn't work
- `environment` - Configs, versions, paths

```bash
alex add "$ARGUMENTS" --approve
```
