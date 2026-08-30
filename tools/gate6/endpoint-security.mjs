const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base) throw new Error("missing staging base URL");

const cases = [];

async function record(name, expected, request) {
  const started = performance.now();
  try {
    const response = await request();
    const responseBody = response.status >= 400
      ? await response.text().catch(() => "")
      : "";
    cases.push({
      name,
      expected,
      actual: response.status,
      passed: expected.includes(response.status),
      durationMs: Math.round(performance.now() - started),
      locationPath: response.headers.get("location")
        ? new URL(response.headers.get("location"), base).pathname
        : null,
      responseMessage: responseBody
        ? (() => {
          try {
            return JSON.parse(responseBody).message ?? "";
          } catch {
            return responseBody.slice(0, 120);
          }
        })()
        : null,
    });
  } catch (error) {
    cases.push({
      name,
      expected,
      actual: 0,
      passed: false,
      durationMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

await record("public schedule remains readable", [200], () => fetch(
  `${base}/api/public/schedule?eventId=event-mt8f43vq`,
  { signal: AbortSignal.timeout(10_000) },
));
await record("admin page redirects without session", [307, 308], () => fetch(
  `${base}/admin/events/event-mt8f43vq/schedule`,
  { redirect: "manual", signal: AbortSignal.timeout(10_000) },
));
await record("admin write rejects foreign origin", [403], () => fetch(
  `${base}/api/admin/upload`,
  { method: "POST", headers: { Origin: "https://invalid.example" }, signal: AbortSignal.timeout(10_000) },
));
await record("admin write rejects missing origin", [403], () => fetch(
  `${base}/api/admin/upload`,
  { method: "POST", signal: AbortSignal.timeout(10_000) },
));
await record("admin write requires session", [401], () => fetch(
  `${base}/api/admin/upload`,
  { method: "POST", headers: { Origin: base }, signal: AbortSignal.timeout(10_000) },
));
await record("health endpoint reports dependencies", [200], () => fetch(
  `${base}/api/health`,
  { signal: AbortSignal.timeout(10_000) },
));

const passed = cases.every((item) => item.passed)
  && cases.find((item) => item.name === "admin page redirects without session")?.locationPath === "/login";
const report = {
  recordedAt: new Date().toISOString(),
  base,
  cases,
  passed,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!passed) process.exitCode = 2;
