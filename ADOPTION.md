# PromptSonar Adoption and Recognition Log

Track public evidence here for open-source adoption, enterprise use, and field recognition.

## Metrics Snapshots

| Date | GitHub Stars | Forks | npm Weekly Downloads | VS Code Installs | Notes |
|---|---:|---:|---:|---:|---|
| 2026-05-20 | 4 | 0 | 5 | 25 | Baseline before MCP audit launch; captured from GitHub, npm downloads API, and VS Code Marketplace API |

## Enterprise / Team Usage

| Date | Organization | Public? | Use Case | Evidence |
|---|---|---|---|---|
| TBD | TBD | No | CI prompt/MCP scanning pilot | Email/testimonial/link pending |

## External Mentions

| Date | Source | Type | Link | Screenshot Saved? | Notes |
|---|---|---|---|---|---|
| 2026-03-12 | AI:PRODUCTIVITY | Third-party article | https://aiproductivity.ai/news/promptsonar-static-analysis-llm-prompt-security/ | Yes | Independent article about PromptSonar static analysis for LLM prompt security. Screenshot: `evidence/2026-05-20_aiproductivity_promptsonar_article.png`. |
| 2026-03 | Medium | Authored technical article | https://medium.com/@meghal86/detecting-unicode-homoglyph-and-zero-width-character-evasion-in-llm-prompt-injection-attacks-5b2df4d46989 | Yes | Article 1: evasion detection. Screenshot: `evidence/2026-05-20_medium_evasion_detection.png`. |
| 2026-03 | Medium | Authored technical article | https://medium.com/@meghal86/7cd35b32a914 | Yes | Article 2: static analysis methodology. Screenshot: `evidence/2026-05-20_medium_static_analysis_methodology.png`. |
| 2026-03 | DEV Community | Authored technical article | https://dev.to/meghal_parikh_b8c5c6e3244/detecting-unicode-homoglyph-and-zero-width-character-evasion-in-llm-prompt-injection-attacks-1e69 | Yes | Article 1: evasion detection. Canonical URL found after supplied URL returned 404. Screenshots: `evidence/2026-05-20_devto_evasion_detection_corrected.png` and `evidence/2026-05-20_devto_evasion_detection.png` for the 404 URL. |
| 2026-05-10 | DEV Community | Authored technical article | https://dev.to/meghal_parikh_b8c5c6e3244/static-analysis-for-llm-prompt-security-a-methodology-for-pre-deploy-vulnerability-detection-48oc | Yes | Article 2: static analysis methodology; useful as publication evidence, not independent press. Screenshot: `evidence/2026-05-20_devto_static_analysis_methodology.png`. |
| 2026-03 | Hacker News | Launch/discussion post | https://news.ycombinator.com/item?id=47350257 | Yes | Original HN post. User-reported status: 1 point, 0 comments, posted 68 days before 2026-05-20. Repost planned after MCP audit launch with benchmark data. Screenshot: `evidence/2026-05-20_hackernews_original_post.png`. |

## Community Proof

| Date | Evidence | Link | Notes |
|---|---|---|---|
| TBD | User issue / PR / discussion | TBD | Pending |

## Release Milestones

| Date | Version | Milestone | Evidence |
|---|---|---|---|
| 2026-05-20 | v1.0.28 | npm publish verified | `npm view @promptsonar/cli version` and `npx @promptsonar/cli --version` both returned `1.0.28` |
| 2026-05-20 | v1.0.28 | MCP benchmark baseline | `npm run benchmark:mcp` passed 6/6 synthetic MCP fixtures. Evidence: `benchmarks/mcp/results/2026-05-20-mcp-benchmark.md` and `.json`. |
| TBD | v1.1.0 | Release notes draft prepared | Draft: `docs/release/v1.1.0-mcp-audit.md`. |
| TBD | v1.1.0 | MCP audit launch | Release notes pending |

## Community / Standards Outreach

| Date | Community | Status | Evidence |
|---|---|---|---|
| TBD | OWASP GenAI / MCP | Draft prepared; submission pending | `docs/community/owasp-genai-mcp-submission.md` |
| TBD | Design partners | Outreach draft prepared; replies pending | `docs/community/design-partner-outreach.md` |

## Baseline Project Links

| Property | URL | Screenshot Saved? | Notes |
|---|---|---|---|
| GitHub | https://github.com/meghal86/promptsonar | Yes | Baseline repository before MCP audit launch. Screenshot: `evidence/2026-05-20_github_promptsonar_baseline.png`. |
| npm | https://www.npmjs.com/package/@promptsonar/cli | Yes | Published CLI package. Screenshot: `evidence/2026-05-20_npm_promptsonar_cli_baseline.png`. |
| VS Code Marketplace | https://marketplace.visualstudio.com/items?itemName=promptsonar-tools.promptsonar | Yes | Published extension listing. Screenshot: `evidence/2026-05-20_vscode_promptsonar_baseline.png`. |

## EB-1A-Relevant Evidence Checklist

- [x] Public adoption metrics captured monthly.
- [x] Independent third-party coverage archived.
- [ ] Enterprise testimonials collected with permission.
- [ ] Technical talks or panels documented.
- [ ] Contributions to standards/community groups documented.
- [ ] Significant user issues/PRs archived.
- [x] Screenshots of all current external mentions saved to `/evidence/` folder with date prefix.
- [ ] arXiv preprint URL captured and logged.
- [ ] npm and VS Code install counts screenshotted monthly on the first Monday of each month.

This file is an internal evidence tracker, not immigration legal advice.
