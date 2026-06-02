### PromptSonar execution-path finding

A critical path routes untrusted content into a privileged sink:

```text
User Input -> Tool Router -> Shell Execution
```

Root cause: `sec_workflow_escalation`
Confidence: 50%
Replay ready: yes
Expected remediation impact: 95% risk reduction

Recommendation: add an approval boundary before shell execution and restrict tool-router capabilities.
