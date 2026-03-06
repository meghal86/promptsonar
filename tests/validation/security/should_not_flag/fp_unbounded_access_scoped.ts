// should_not_flag test: Scoped access — has scope limitation keywords
// EXPECTED: No sec_unbounded_access finding
const scopedAccess = `Read from /safe/read-only path only. No write access permitted. 
You are restricted to the user_preferences table and sandboxed from all other data.`
