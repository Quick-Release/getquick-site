# Architecture Decision Records

One file per durable, hard-to-reverse decision about the blueprint,
numbered sequentially: `NNNN-kebab-case-title.md`.

Template:

```markdown
# ADR NNNN: Title

- Status: Proposed | Accepted | Superseded by ADR NNNN
- Date: YYYY-MM-DD

## Context

What problem or constraint forced this decision.

## Decision

What was decided.

## Considered options

Optional: the alternatives worth remembering, and why each was rejected.

## Consequences

Optional: downstream effects that aren't obvious from the decision.
```

Record a decision here when it would be expensive to reverse or when a
future contributor would otherwise re-litigate it — not for routine
implementation choices already covered by [`AGENTS.md`](../../AGENTS.md) or
[`GLOSSARY.md`](../../GLOSSARY.md). A site's decision to follow the
blueprint belongs in that site's own ADRs, linking here.
