# Workflow Escalation

## Overview

User input is routed directly through a tool router into automatic shell execution.

## Attack Description

The workflow grants user-controlled content a direct route to command execution without an approval boundary.

## Execution Path

User Input -> Tool Router -> Shell Execution

Expected findings: `sec_workflow_escalation`, `sec_privileged_sink_access`
Confidence range: 45-55%

## Replay Summary

Replay emits 3 deterministic events: USER_INPUT -> TOOL_ROUTER -> SHELL.

## Root Cause Explanation

Workflow Escalation is represented by `sec_workflow_escalation`. Supporting findings: Tool Router Escalation, Privileged Sink Access.

## Remediation Walkthrough

Separate user input from tool authority, require approval for shell operations, and constrain the tool router to allowlisted operations.

Expected risk reduction: 95%.
