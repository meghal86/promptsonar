---
name: karpathy-guidelines
description: Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, debugging, testing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.
license: MIT
---

# Karpathy Guidelines

These guidelines favor correctness, clarity and controlled scope over speed.

## Think Before Coding

- Read relevant code and tests before editing.
- Identify the root cause.
- State material assumptions.
- Compare materially different approaches.
- Choose the smallest safe implementation.
- Ask only when ambiguity could materially affect architecture, security, data, contracts or externally visible behavior.
- For minor ambiguity, state the safest reversible assumption and continue.

## Simplicity First

- Implement only what was requested.
- Avoid speculative features.
- Avoid premature abstractions.
- Avoid unnecessary configuration.
- Prefer clear code over compressed code.
- Match existing repository patterns.
- Add defensive handling at real external and untrusted boundaries.

## Surgical Changes

- Touch only files necessary for the task.
- Do not refactor adjacent code without necessity.
- Do not reformat unrelated files.
- Remove only code made unused by the current change.
- Every changed line must trace to the requested result or its verification.

## Goal-Driven Execution

- Define observable success criteria before implementation.
- For bugs, reproduce the issue first.
- Add regression tests for behavior changes.
- Run targeted checks, then broader relevant checks.
- Inspect the final diff.
- Continue until the success criteria are verified or a real blocker is found.

## Evidence-Based Completion

- Never claim a command passed unless it was executed.
- Never claim behavior is correct from compilation alone.
- Never infer backend correctness from UI appearance.
- Never hide failed checks.
- Distinguish verified facts from assumptions.
- Report exact commands, results and remaining limitations.
