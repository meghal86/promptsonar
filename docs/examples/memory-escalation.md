# Memory Escalation

## Overview

Retrieved content is persisted into memory, then reused later as authority for shell execution.

## Attack Description

Untrusted retrieved content crosses into persistent memory and later influences the tool router.

## Execution Path

Retrieved Context -> Agent Memory -> Tool Router -> Shell Execution

Expected findings: `sec_workflow_escalation`, `sec_privileged_sink_access`, `sec_owasp_llm01_injection`
Confidence range: 60-70%

## Replay Summary

Replay emits 4 deterministic events: MEMORY_READ -> MEMORY_WRITE -> TOOL_ROUTER -> SHELL.

## Root Cause Explanation

Workflow Escalation is represented by `sec_workflow_escalation`. Supporting findings: Persistent Context Abuse, Tool Router Escalation.

## Remediation Walkthrough

Bound memory writes, mark retrieved content as untrusted, require validation before recall, and block memory-originated shell actions.

Expected risk reduction: 95%.
