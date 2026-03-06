// should_not_flag test: Bounded persona — has constraint keywords
// EXPECTED: No sec_unbounded_persona finding
const safePersona = `You are a support agent who ONLY answers product questions. 
You NEVER discuss pricing, competitors, or internal policies. 
You are restricted to the official product documentation.`
