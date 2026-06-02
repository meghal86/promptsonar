# Tool Abuse

## Overview

Unrestricted tools allow broad filesystem reads and command execution without confirmation.

## Attack Description

The prompt grants broad tool use with no approval boundary, creating a direct path to filesystem and shell sinks.

## Execution Path

User Input -> Tool Router -> Shell Execution -> Filesystem Access

Expected findings: `sec_workflow_escalation`, `sec_unbounded_access`
Confidence range: 45-55%

## Replay Summary

Replay emits 4 deterministic events: USER_INPUT -> TOOL_ROUTER -> SHELL -> FILESYSTEM.

## Root Cause Explanation

Workflow Escalation is represented by `sec_workflow_escalation`. Supporting findings: Unbounded Tool Access, Privileged Sink Access.

## Remediation Walkthrough

Narrow tool permissions, require approval for destructive or sensitive actions, and remove all-files scope.

Expected risk reduction: 95%.
