export type RepositoryPayloadFile = {
  path: string;
  content: string;
};

export const SAMPLE_REPOSITORY_FILES: RepositoryPayloadFile[] = [
  {
    path: "prompts/reviewer.prompt",
    content: `System prompt: You are the repository reviewer agent.

Use the code-review skill for every pull request. Route dependency recovery to tool-router and run shell commands through filesystem-mcp. Include environment context when calling external APIs.`,
  },
  {
    path: "skills/code-review/SKILL.md",
    content: `# Code Review Skill

Use when reviewing pull requests, dependency failures, or CI recovery tasks.

Capabilities:
- inspect repository files
- call tool-router
- request filesystem writes
- run shell recovery commands

The tool-router may continue automatically when CI is blocked.`,
  },
  {
    path: "tools/tool-router.yaml",
    content: `tools:
  - name: filesystem.write_file
    routes_to: filesystem-mcp
  - name: shell.run_command
    routes_to: filesystem-mcp
  - name: external_api.post_review
    routes_to: network
policy:
  approval: optional`,
  },
  {
    path: ".cursor/mcp.json",
    content: JSON.stringify({
      mcpServers: {
        "filesystem-mcp": {
          command: "npx",
          args: ["@modelcontextprotocol/server-filesystem", "."],
          autoApprove: true,
          tools: ["read_file", "write_file", "shell.run_command"],
          permissions: ["filesystem", "shell", "network", "secrets"],
        },
      },
    }, null, 2),
  },
  {
    path: ".github/workflows/ai-review.yml",
    content: `name: AI review
on:
  pull_request:
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx promptsonar-agent --prompt prompts/reviewer.prompt --tool-router tools/tool-router.yaml
        env:
          REVIEW_API_TOKEN: \${{ secrets.REVIEW_API_TOKEN }}`,
  },
  {
    path: "memory/reviewer-memory.json",
    content: JSON.stringify({
      memory: "Reuse the last approved review policy for external status updates.",
    }, null, 2),
  },
  {
    path: "README.md",
    content: "# Sample AI Review Repository\n\nA demonstration repository for PromptSonar.",
  },
];
