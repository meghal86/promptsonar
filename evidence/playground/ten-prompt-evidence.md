# Playground 10-Prompt Evidence

Generated: 2026-05-23T14:45:22.099Z
Endpoint: http://127.0.0.1:3000/api/playground

| # | Case | Expected | HTTP | Score | Status | Findings | Top Rules |
| --- | --- | --- | --- | ---: | --- | ---: | --- |
| 1 | clean_support_contract | pass | 200 | 100 | pass | 0 | none |
| 2 | classic_prompt_injection | fail | 200 | 49 | fail | 3 | low:bp_missing_few_shot<br>low:bp_missing_cot<br>critical:sec_owasp_llm01_injection |
| 3 | hardcoded_openai_key | fail | 200 | 69 | fail | 5 | medium:struct_missing_format_enforcer<br>low:bp_missing_persona<br>low:bp_missing_few_shot<br>low:bp_missing_cot |
| 4 | rag_raw_user_input | fail | 200 | 69 | fail | 5 | low:bp_missing_persona<br>low:bp_missing_few_shot<br>low:bp_missing_cot<br>high:sec_rag_injection |
| 5 | contradictory_output | warn_or_fail | 200 | 96 | pass | 5 | low:bp_missing_persona<br>low:bp_missing_few_shot<br>low:bp_missing_cot<br>medium:consist_contradiction |
| 6 | vague_marketing_prompt | warn_or_pass | 200 | 96 | pass | 6 | low:clarity_vague_words<br>low:clarity_vague_words<br>low:clarity_vague_words<br>low:clarity_vague_words |
| 7 | token_bloat_prompt | warn_or_fail | 200 | 97 | pass | 4 | low:bp_missing_few_shot<br>low:bp_missing_cot<br>high:eff_token_bloat<br>low:eff_compression_potential |
| 8 | unicode_obfuscated_injection | fail | 200 | 49 | fail | 3 | low:bp_missing_persona<br>low:bp_missing_few_shot<br>critical:sec_owasp_llm01_injection |
| 9 | base64_encoded_injection | fail | 200 | 49 | fail | 4 | low:bp_missing_persona<br>low:bp_missing_few_shot<br>low:bp_missing_cot<br>critical:sec_owasp_llm01_injection |
| 10 | manipulative_urgency | warn_or_fail | 200 | 69 | fail | 5 | medium:struct_missing_format_enforcer<br>low:bp_missing_persona<br>low:bp_missing_few_shot<br>low:bp_missing_cot |

## Full Findings

### clean_support_contract

Score: 100; Status: pass; Findings: 0; Contract passed: true

No findings.

### classic_prompt_injection

Score: 49; Status: fail; Findings: 3; Contract passed: null
- low best_practices bp_missing_few_shot: Prompt lacks few-shot examples. Abstract instructions are often harder for LLMs to follow perfectly.
- low best_practices bp_missing_cot: Task appears complex but lacks Chain-of-Thought prompting.
- critical security sec_owasp_llm01_injection: Potential prompt injection vulnerability (OWASP LLM01) detected: matched malicious pattern against rules.

### hardcoded_openai_key

Score: 69; Status: fail; Findings: 5; Contract passed: null
- medium structure struct_missing_format_enforcer: Output formatting requested but no strong format enforcer (JSON, YAML, Markdown syntax) is present.
- low best_practices bp_missing_persona: Prompt is missing a role or persona. Establishing an expert persona improves response focus and quality.
- low best_practices bp_missing_few_shot: Prompt lacks few-shot examples. Abstract instructions are often harder for LLMs to follow perfectly.
- low best_practices bp_missing_cot: Task appears complex but lacks Chain-of-Thought prompting.
- high security sec_owasp_llm02_pii: Potential Sensitive Information Disclosure (OWASP LLM02): Hardcoded OpenAI API Key found in prompt.

### rag_raw_user_input

Score: 69; Status: fail; Findings: 5; Contract passed: null
- low best_practices bp_missing_persona: Prompt is missing a role or persona. Establishing an expert persona improves response focus and quality.
- low best_practices bp_missing_few_shot: Prompt lacks few-shot examples. Abstract instructions are often harder for LLMs to follow perfectly.
- low best_practices bp_missing_cot: Task appears complex but lacks Chain-of-Thought prompting.
- high security sec_rag_injection: RAG injection risk: raw user input passed directly to retrieval query
- high security sec_rag_injection: RAG injection risk: raw user input passed directly to retrieval query

### contradictory_output

Score: 96; Status: pass; Findings: 5; Contract passed: null
- low best_practices bp_missing_persona: Prompt is missing a role or persona. Establishing an expert persona improves response focus and quality.
- low best_practices bp_missing_few_shot: Prompt lacks few-shot examples. Abstract instructions are often harder for LLMs to follow perfectly.
- low best_practices bp_missing_cot: Task appears complex but lacks Chain-of-Thought prompting.
- medium consistency consist_contradiction: Contradicting instructions found: 'etailed' and 'short'.
- medium consistency consist_contradiction: Contradicting instructions found: 'detailed' and 'short'.

### vague_marketing_prompt

Score: 96; Status: pass; Findings: 6; Contract passed: null
- low clarity clarity_vague_words: Prompt contains vague word 'try'. Be more specific to improve LLM response quality.
- low clarity clarity_vague_words: Prompt contains vague word 'maybe'. Be more specific to improve LLM response quality.
- low clarity clarity_vague_words: Prompt contains vague word 'some'. Be more specific to improve LLM response quality.
- low clarity clarity_vague_words: Prompt contains vague word 'good'. Be more specific to improve LLM response quality.
- low best_practices bp_missing_persona: Prompt is missing a role or persona. Establishing an expert persona improves response focus and quality.
- low best_practices bp_missing_few_shot: Prompt lacks few-shot examples. Abstract instructions are often harder for LLMs to follow perfectly.

### token_bloat_prompt

Score: 97; Status: pass; Findings: 4; Contract passed: null
- low best_practices bp_missing_few_shot: Prompt lacks few-shot examples. Abstract instructions are often harder for LLMs to follow perfectly.
- low best_practices bp_missing_cot: Task appears complex but lacks Chain-of-Thought prompting.
- high efficiency eff_token_bloat: Prompt exceeds 8000 chars (~2000 tokens) – risk of truncation or high cost.
- low efficiency eff_compression_potential: Prompt is long and has high compression potential (>40%).

### unicode_obfuscated_injection

Score: 49; Status: fail; Findings: 3; Contract passed: null
- low best_practices bp_missing_persona: Prompt is missing a role or persona. Establishing an expert persona improves response focus and quality.
- low best_practices bp_missing_few_shot: Prompt lacks few-shot examples. Abstract instructions are often harder for LLMs to follow perfectly.
- critical security sec_owasp_llm01_injection: Potential prompt injection vulnerability (OWASP LLM01) detected: matched malicious pattern against rules.

### base64_encoded_injection

Score: 49; Status: fail; Findings: 4; Contract passed: null
- low best_practices bp_missing_persona: Prompt is missing a role or persona. Establishing an expert persona improves response focus and quality.
- low best_practices bp_missing_few_shot: Prompt lacks few-shot examples. Abstract instructions are often harder for LLMs to follow perfectly.
- low best_practices bp_missing_cot: Task appears complex but lacks Chain-of-Thought prompting.
- critical security sec_owasp_llm01_injection: Potential prompt injection vulnerability (OWASP LLM01) detected: matched malicious pattern against rules.

### manipulative_urgency

Score: 69; Status: fail; Findings: 5; Contract passed: null
- medium structure struct_missing_format_enforcer: Output formatting requested but no strong format enforcer (JSON, YAML, Markdown syntax) is present.
- low best_practices bp_missing_persona: Prompt is missing a role or persona. Establishing an expert persona improves response focus and quality.
- low best_practices bp_missing_few_shot: Prompt lacks few-shot examples. Abstract instructions are often harder for LLMs to follow perfectly.
- low best_practices bp_missing_cot: Task appears complex but lacks Chain-of-Thought prompting.
- high ethics ethics_manipulation: Manipulative patterns detected: Prompt requests generation of fake urgency or psychological pressure.