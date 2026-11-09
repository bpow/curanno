/**
 * The address of a request as it is logged: the secret in an account link
 * (`/account/reset?token=…`) is single-use, but a live one must not sit in a log.
 */
export function logUrl(url: string): string {
  return url.replace(/([?&]token=)[^&#]*/g, '$1[redacted]');
}
