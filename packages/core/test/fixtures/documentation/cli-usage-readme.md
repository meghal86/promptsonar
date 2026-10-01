# demo-mcp-client

Run the client against a local model:

```bash
democli --host http://localhost:11434 --model llama3
```

Use a hosted provider:

```bash
democli --provider openai --api-key $OPENAI_API_KEY --model gpt-5
# Or any compatible endpoint:
democli --provider other --api-key $OTHER_API_KEY -m other/free
```

Connect to an MCP server over HTTP and let the agent run tools:

```bash
democli --mcp-server-url http://localhost:8000/sse --auto-approve --shell
```
