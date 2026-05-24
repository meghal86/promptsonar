# PromptSonar Virality Implementation Plan

## Goal

Turn the playground from a security dashboard into a shareable prompt-security moment:

1. Paste or load a prompt.
2. Scan runs.
3. User sees a dramatic report card immediately.
4. User can share the card, badge, public URL, or PNG.

## Implemented Launch Loop

- Prompt Security Report Card embedded in `/playground`.
- Automatic scroll to the report card after every successful scan.
- Jailbreak verdict: `Protected`, `Needs hardening`, or `Likely jailbreakable`.
- OWASP LLM labels for security findings.
- Before/after prompt hardening preview.
- Benchmark headline: `PromptSonar caught X/10 adversarial attack patterns`.
- Copyable report text.
- Copyable GitHub badge markdown.
- Public report URL via `/report-card`.
- Share links for X and LinkedIn.
- Downloadable PNG report card generated client-side with Canvas.
- Open Graph and Twitter metadata for public report pages.

## Product Positioning

The viral artifact should be framed as:

> "Paste your prompt. See if it can be jailbroken. Share the security report."

The public message is intentionally simpler than the enterprise dashboard. The dashboard remains useful for credibility, but the share loop starts with the report card.

## Next Launch Considerations

- Deploy the dashboard publicly so `/report-card` links are no longer localhost URLs.
- Add a generated OG image endpoint if public social previews need the exact score image instead of metadata text.
- Add analytics events for `scan_completed`, `report_copied`, `badge_copied`, `png_downloaded`, and `share_clicked`.
- Consider moving the report card above findings if conversion analytics show users miss it.
