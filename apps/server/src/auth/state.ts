/** Shared mutable state for auth secrets, initialized once at server startup. */
export const authState = {
  rootSecret: '',
  jwtSecret: '',
};
