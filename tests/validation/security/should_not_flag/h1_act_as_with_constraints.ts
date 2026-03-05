// Test: Should NOT flag — act as WITH behavioral constraints
const goodPrompt = `You are a senior financial analyst who ONLY analyzes
balance sheets. You NEVER provide investment advice. You ONLY reference
data from the documents provided.

Example:
Input: Revenue? Output: {"revenue": 100}

Format as JSON. Think step-by-step. Provide exactly 1 sentence.`;

const alsoGood = `Act as a customer support agent who handles only
product questions. You never discuss competitors, pricing not on our
website, or internal company processes.

Example:
User: Help
Assistant: {"status": "ok"}

Respond in JSON. Think step-by-step. Keep summary to exactly 2 paragraphs.`;