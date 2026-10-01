# Architecture Decision Records

One file per durable, hard-to-reverse decision, numbered sequentially:
`NNNN-kebab-case-title.md`.

Template:

```markdown
# ADR NNNN: Title

- Status: Proposed | Accepted | Superseded by ADR NNNN
- Date: YYYY-MM-DD

## Context

What problem or constraint forced this decision.

## Decision

What was decided, and why the alternatives were rejected.
```

Record a decision here when it would be expensive to reverse or when a
future contributor would otherwise re-litigate it — not for routine
implementation choices already covered by [`AGENTS.md`](../../AGENTS.md) or
[`CONTEXT.md`](../../CONTEXT.md).
