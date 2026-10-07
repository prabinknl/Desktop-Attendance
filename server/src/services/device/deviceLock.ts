/**
 * Serializes operations that log in to the attendance machine (automatic
 * reconnects, Connect, Test Connection) so they never overlap. Overlapping
 * failed logins can trigger the terminal's illegal-login lockout.
 */
let chain: Promise<unknown> = Promise.resolve();

export function withDeviceLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
