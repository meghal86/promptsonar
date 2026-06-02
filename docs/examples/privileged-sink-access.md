# Privileged Sink Access

## Overview

A prompt template forwards injected user instructions to a shell command tool.

## Attack Description

The injected instruction is not isolated from the template, allowing it to become a shell execution request.

## Execution Path

User Input -> Tool Router -> Shell Execution

Expected findings: `sec_owasp_llm01_injection`, `sec_privileged_sink_access`
Confidence range: 45-55%

## Replay Summary

Replay emits 3 deterministic events: USER_INPUT -> TOOL_ROUTER -> SHELL.

## Root Cause Explanation

Workflow Escalation is represented by `sec_workflow_escalation`. Supporting findings: Prompt Injection, Privileged Sink Access.

## Remediation Walkthrough

Quote and classify user input, refuse instruction overrides, and require approvals before privileged sinks are reachable.

Expected risk reduction: 95%.
