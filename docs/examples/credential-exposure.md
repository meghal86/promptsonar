# Credential Exposure

## Overview

Retrieved context and memory expose a credential path that can be forwarded over the network.

## Attack Description

The prompt allows token material to move from credential storage through memory and network access to an external API.

## Execution Path

Retrieved Context -> Agent Memory -> Tool Router -> Credential Store -> Network Access -> External API

Expected findings: `sec_workflow_escalation`, `sec_privileged_sink_access`, `sec_owasp_llm02_pii`
Confidence range: 55-65%

## Replay Summary

Replay emits 6 deterministic events: MEMORY_READ -> MEMORY_WRITE -> TOOL_ROUTER -> FILESYSTEM -> NETWORK -> NETWORK.

## Root Cause Explanation

Workflow Escalation is represented by `sec_workflow_escalation`. Supporting findings: Sensitive Context Exposure, Network Exfiltration Path.

## Remediation Walkthrough

Keep secrets outside prompt context, redact credentials, prevent memory persistence of secret values, and block external forwarding.

Expected risk reduction: 95%.
