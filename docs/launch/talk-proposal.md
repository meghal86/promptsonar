# Talk Proposal Draft

## Title

MCP Config Is the New Agent Supply-Chain Attack Surface

## Abstract

AI agents increasingly rely on tool servers configured through Model Context Protocol (MCP) files. These configs can define local commands, remote endpoints, filesystem access, environment variables, and tool descriptions exposed to the model. That makes MCP config a practical trust boundary and a new supply-chain review surface.

This talk presents a local-first static analysis approach for auditing MCP configs before an agent trusts them. We will walk through common risk patterns: unencrypted or raw-IP endpoints, broad shell/filesystem/admin scope, missing authentication indicators, hardcoded secrets, unknown remote domains, and prompt-injection text inside tool descriptions. We will also show how these findings can be exported as JSON/SARIF and wired into CI.

The talk is based on PromptSonar, an open-source scanner for AI prompts and MCP configs.

## Audience

- AI security engineers.
- AppSec teams reviewing agent tooling.
- Developers using Claude Desktop, Cursor, or MCP servers.
- Security platform teams adding AI guardrails to CI.

## Outline

1. MCP as an agent trust boundary.
2. How config snippets become supply-chain inputs.
3. Seven MCP risk classes.
4. Live demo with vulnerable and safe configs.
5. CI/SARIF integration.
6. Limits of static analysis and next research work.

## Evidence Checklist

- [ ] Submit to AI security/AppSec meetup.
- [ ] Save submission confirmation screenshot to `/evidence/`.
- [ ] If accepted, save event page screenshot and recording link.
- [ ] Log event in `ADOPTION.md`.
