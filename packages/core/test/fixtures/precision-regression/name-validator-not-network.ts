function validateName(name: string): boolean {
  return /^[a-zA-Z\s]+$/.test(name);
}
