/**
 * Maps a rule id to its OWASP LLM Top 10 (2025) identifier, e.g. "LLM06", or
 * "" when the rule has no OWASP mapping.
 *
 * This is the single source of truth for the CLI, the GitHub Action and the
 * SARIF formatter. Each used to keep its own copy of this table, and the copies
 * drifted — the Action kept the 2023 "LLM07" and never gained LLM06/LLM10.
 */
export function owaspRefForRule(ruleId: string): string {
    if (
        ruleId.startsWith('sec_owasp_llm01') ||
        ruleId.startsWith('sec_unicode') ||
        ruleId === 'sec_unbounded_persona' ||
        ruleId === 'sec_user_concealment' ||
        ruleId === 'sec_base64_encoded_payload' ||
        ruleId === 'sec_homoglyph_evasion' ||
        ruleId === 'sec_zero_width_injection'
    ) return 'LLM01';
    if (ruleId.startsWith('sec_owasp_llm02') || ruleId === 'sec_credential_exfiltration') return 'LLM02';
    // LLM03 Supply Chain: code fetched and executed at runtime is unverified.
    if (ruleId === 'sec_remote_code_execution' || ruleId === 'sec_unpinned_remote_install') return 'LLM03';
    // LLM06 Excessive Agency covers untrusted input reaching privileged
    // execution, tools acting without approval, and over-broad tool/data access.
    if (
        ruleId === 'sec_workflow_escalation' ||
        ruleId === 'sec_privileged_sink_access' ||
        ruleId === 'sec_mcp_tool_poisoning' ||
        ruleId === 'sec_unbounded_access' ||
        ruleId === 'sec_destructive_command' ||
        ruleId === 'sec_approval_bypass' ||
        ruleId === 'sec_wildcard_tool_permission'
    ) return 'LLM06';
    // LLM08 Vector and Embedding Weaknesses: untrusted input steering retrieval.
    if (ruleId === 'sec_rag_injection') return 'LLM08';
    // LLM10 Unbounded Consumption: prompt size beyond the configured budget.
    if (ruleId === 'eff_token_budget' || ruleId === 'eff_token_bloat') return 'LLM10';
    return '';
}
