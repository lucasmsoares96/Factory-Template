/** Better Auth's defaults, written down: sign-up, password reset and the bootstrap's accounts all apply them. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Why `password` would be refused at sign-up, or `undefined` when it is acceptable. */
export function passwordProblem(password: string): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH) return `The password needs at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `The password takes at most ${PASSWORD_MAX_LENGTH} characters.`;
  return undefined;
}
