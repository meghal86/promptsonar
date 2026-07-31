function redactPii(text: string): string {
  return text.replace(/\d{3}-\d{2}-\d{4}/g, '[REDACTED]');
}
