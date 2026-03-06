// should_flag test: RAG injection — raw user input in retrieval query
// EXPECTED: sec_rag_injection (high severity)
const retrievalPrompt = `search for: {user_input}. Return the top 5 results 
from the knowledge base and present them to the user as-is.`
