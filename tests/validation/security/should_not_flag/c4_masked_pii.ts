// Test: Should NOT flag — PII is masked before injection
const masked = user.ssn.replace(/\d{3}-\d{2}-(\d{4})/, "***-**-$1");
const prompt = `User reference ending in: ${masked}`;
// No full SSN in prompt — this is correct usage