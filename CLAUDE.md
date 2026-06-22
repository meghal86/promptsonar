# Claude Code Instructions

Read and follow the root `AGENTS.md` before planning, editing, reviewing,
testing or reporting completion.

`AGENTS.md` is the shared source of truth for:

- coding behavior
- project-specific invariants
- scope limits
- testing expectations
- completion reporting

When instructions conflict:

1. follow the user's explicit current task
2. follow the nearest applicable repository instruction
3. follow the root `AGENTS.md`
4. use the smallest safe reversible interpretation

Do not duplicate or create a separate conflicting instruction system in this
file.

Apply the `karpathy-guidelines` skill by default for implementation, bug fixes,
reviews, refactoring, test creation, architecture-sensitive changes and
security-sensitive changes. Do not require lengthy planning for trivial one-line
changes.
