# Executive Summary

PromptSonar identified a critical execution path where untrusted input can propagate through a tool router into shell execution. The reusable report card highlights affected path count, root cause, confidence, replay readiness, and remediation impact.

- Top path: User Input -> Tool Router -> Shell Execution
- Root cause: Workflow Escalation
- Replay ready: Yes
- Expected risk reduction after remediation: 95%
