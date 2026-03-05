// Test: Hardcoded API key interpolated into prompt
const apiKey = "sk-proj-abc123def456ghi789jkl012mno345pqr678stu";
const systemPrompt = `You have access to OpenAI. Use key: ${apiKey} to call the API.`;

// Test: Key in template string directly
const prompt2 = `API Key: sk-1234567890abcdefghijklmnopqrstuvwx`;