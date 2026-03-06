// should_not_flag test: Validated RAG input — has sanitization indicator
// EXPECTED: No sec_rag_injection finding
const validatedRetrieval = `search for: {validated_query}. Input is sanitized before retrieval. 
All user input is validated and escaped before being passed to the knowledge base.`
