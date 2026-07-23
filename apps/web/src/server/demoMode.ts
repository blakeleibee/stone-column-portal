// Single source of truth for the DEMO_MODE flag. Absence of the env
// var means false (real auth required) -- never silently true.
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}
