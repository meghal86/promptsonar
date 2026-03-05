// Test: Template passes raw PII fields without masking
interface UserData { ssn: string; cardNumber: string; email: string; }

const buildPrompt = (user: UserData) => `
  Process this user: SSN ${user.ssn}, Card ${user.cardNumber}
`;
// Should flag: SSN and card number interpolated directly