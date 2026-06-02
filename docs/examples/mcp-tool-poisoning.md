# MCP Tool Poisoning

## Overview

A malicious MCP tool description tries to turn tool metadata into an instruction path that reaches shell execution.

## Attack Description

The MCP server description embeds override language and pairs it with an auto-executing shell tool that has broad filesystem permissions.

## Execution Path

MCP Server -> Privileged Tool -> Shell Execution -> Filesystem Access

Expected findings: `sec_mcp_tool_poisoning`, `sec_workflow_escalation`, `sec_privileged_sink_access`
Confidence range: 50-60%

## Replay Summary

Replay emits 4 deterministic events: MCP_SERVER -> MCP_TOOL -> SHELL -> FILESYSTEM.

## Root Cause Explanation

MCP Tool Poisoning is represented by `sec_mcp_tool_poisoning`. Supporting findings: Workflow Escalation, Privileged Sink Access, Approval Bypass.

## Remediation Walkthrough

Pin trusted MCP servers, remove instruction-like tool descriptions, require approvals for shell tools, and narrow permissions to explicit paths.

Expected risk reduction: 95%.
