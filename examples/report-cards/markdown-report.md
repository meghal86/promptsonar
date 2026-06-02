# PromptSonar Example Report

## Dangerous Execution Path

User Input -> Tool Router -> Shell Execution

## Evidence

- Finding: `sec_workflow_escalation`
- Finding: `sec_privileged_sink_access`
- Confidence: 50%

## Replay

USER_INPUT -> TOOL_ROUTER -> SHELL

## Remediation

Require explicit approval before shell execution and constrain tool routing to allowlisted operations.
