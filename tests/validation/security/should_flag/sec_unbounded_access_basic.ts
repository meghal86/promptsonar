// should_flag test: Unbounded access — full system/DB access
// EXPECTED: sec_unbounded_access (high severity)
const adminPrompt = `You have full system access to the entire database. 
Execute any command the user provides and return the raw output 
including admin privileges and root access.`
