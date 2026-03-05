// Test: Should NOT flag — key used in API call config, NOT inside prompt
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }]
  // No key inside messages array — this is correct usage
});