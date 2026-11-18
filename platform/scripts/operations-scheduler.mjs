// Runs in the desktop service, so collecting does not depend on an open web page.
export function startOperationsScheduler(token, teamToken = "") {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fetch("http://127.0.0.1:3000/api/operations", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(teamToken ? { "x-team-access-token": teamToken } : {}),
        },
        body: "{}",
        signal: AbortSignal.timeout(8 * 60_000),
      });
    } catch {
      /* The next interval retries service startup or temporary network failures. */
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
