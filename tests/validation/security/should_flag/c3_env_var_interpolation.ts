// Test: Environment variable containing key interpolated into prompt
const systemPrompt = `Use API key ${process.env.OPENAI_API_KEY} for all requests.`;
// NOTE: This should flag because the key is being passed INTO the prompt string
// even though the key itself is in an env var.