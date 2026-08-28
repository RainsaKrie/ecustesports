export function isHostedRuntime(): boolean {
  return process.env.REQUIRE_PRODUCTION_SECRETS === "1" || Boolean(process.env.VERCEL_ENV);
}
