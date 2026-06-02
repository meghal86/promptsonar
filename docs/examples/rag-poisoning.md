# RAG Poisoning

## Overview

Retrieved RAG context contains instructions that override tool policy and reach shell execution.

## Attack Description

The system treats retrieved text as operational instructions instead of untrusted evidence.

## Execution Path

Retrieved Context -> Tool Router -> Shell Execution

Expected findings: `sec_workflow_escalation`, `sec_privileged_sink_access`
Confidence range: 50-60%

## Replay Summary

Replay emits 3 deterministic events: MEMORY_READ -> TOOL_ROUTER -> SHELL.

## Root Cause Explanation

Workflow Escalation is represented by `sec_workflow_escalation`. Supporting findings: Retrieval Boundary Crossing, Tool Router Escalation.

## Remediation Walkthrough

Validate retrieved context, quote it as evidence, separate retrieval from instruction policy, and block retrieved content from tool-routing authority.

Expected risk reduction: 95%.
