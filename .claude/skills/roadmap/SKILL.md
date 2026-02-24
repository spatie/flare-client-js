---
name: roadmap
description: Show the current roadmap status from CLAUDE.md — what's done, in progress, and what's next.
disable-model-invocation: true
allowed-tools: Read
---

# Roadmap Status

Read the `CLAUDE.md` file in the repo root and produce a concise status overview of all projects in the roadmap.

## Output format

For each project, show:

- **Project name**
- **Progress**: X of Y tasks complete
- **Status**: Not started / In progress / Complete
- **Remaining items**: list the unchecked `[ ]` items (if any)

Then show an overall summary:

```
Overall: X of Y total tasks complete across Z projects
Next up: [the first unchecked item from the highest-priority incomplete project]
```

Keep it concise — this is a quick status check, not a deep analysis.
