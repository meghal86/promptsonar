// Test: Business logic with words that overlap pattern keywords
// Should NOT produce false positives

// "act as" in normal business context
function actAsProxy(request: Request): Response {
  return proxyRequest(request);
}

// "ignore" in error handling — not a jailbreak
function processData(data: unknown) {
  if (!data) {
    console.log("Ignore this error for now, non-critical");
    return;
  }
}

// "all files" in legitimate build script context
const allFiles = glob.sync("**/*.ts");
const processAllFiles = (files: string[]) => files.map(compile);

// "forget" in legitimate UI context
const forgetPassword = async (email: string) => {
  await sendResetEmail(email);
};