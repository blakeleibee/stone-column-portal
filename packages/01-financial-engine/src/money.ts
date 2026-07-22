import { Cents, BasisPoints } from "./types";

/** Throws if the value is not a safe integer. Every function in this
 *  module runs input/output through this — it is the enforcement point
 *  for "never use floating-point money math." */
export function assertInt(value: number, label = "amount"): asserts value is Cents {
  if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer number of cents, got ${value}`);
  }
}

/** Basis points denominator is always 10,000 (1500 bp = 15.00%). Fixed
 *  and exported so every caller uses the same constant rather than a
 *  magic number, and so the whole calculation stays integer/BigInt end
 *  to end — this is what review item 6 requires: rates are never
 *  converted to a JS float like 0.15 anywhere in this codebase. */
export const BASIS_POINT_DENOMINATOR = 10_000n;

export function assertBasisPoints(value: number, label = "basisPoints"): asserts value is BasisPoints {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer number of basis points, got ${value}`);
  }
}

export function addCents(...values: Cents[]): Cents {
  values.forEach((v, i) => assertInt(v, `addCents arg[${i}]`));
  const sum = values.reduce((s, v) => s + v, 0);
  assertInt(sum, "addCents result");
  return sum;
}

export function subtractCents(a: Cents, b: Cents): Cents {
  assertInt(a, "subtractCents a");
  assertInt(b, "subtractCents b");
  const result = a - b;
  assertInt(result, "subtractCents result");
  return result;
}

/** ROUNDING POLICY (CORRECTIONS.md / CORRECTIONS_V2.md have the full
 *  writeup): round-half-away-from-zero on an exact BigInt division —
 *  0.5 rounds up in magnitude regardless of sign. Rounding happens once
 *  per cost category, applied to that category's summed eligible-
 *  actual-cost basis — never per-transaction, never at the project-
 *  total level. Project totals are always the sum of the already-
 *  rounded per-category amounts. Once an invoice exists (Package 4),
 *  the fee amount attached to it is frozen at issuance and never
 *  recomputed. */
function divideRoundHalfAwayFromZeroBigInt(numerator: bigint, denominator: bigint): bigint {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;
  const quotient = absNum / absDen;
  const remainder = absNum % absDen;
  const roundedAbs = remainder * 2n >= absDen ? quotient + 1n : quotient;
  return negative ? -roundedAbs : roundedAbs;
}

/** Multiply an integer cents amount by a rate expressed as INTEGER
 *  BASIS POINTS (1500 = 15.00%) over BASIS_POINT_DENOMINATOR (10,000).
 *
 *  CORRECTION (independent review item 6): the previous version of this
 *  function took a JS float percentage (0.15) and did `cents *
 *  percentage` in floating point before rounding — that is exactly the
 *  "does not satisfy exact integer financial arithmetic" problem flagged
 *  in review. This version never produces or touches a float at any
 *  point: `cents` and `basisPoints` are both converted to BigInt, the
 *  product is computed exactly (BigInt multiplication has no precision
 *  limit), and the division by 10,000 is done with explicit
 *  round-half-away-from-zero integer division — no `Math.round`, no
 *  float division, anywhere in this path. */
export function multiplyCentsByBasisPoints(
  cents: Cents,
  basisPoints: BasisPoints,
  denominator: bigint = BASIS_POINT_DENOMINATOR
): Cents {
  assertInt(cents, "multiplyCentsByBasisPoints cents");
  assertBasisPoints(basisPoints, "multiplyCentsByBasisPoints basisPoints");

  const centsBig = BigInt(cents);
  const bpBig = BigInt(basisPoints);
  const exactProduct = centsBig * bpBig; // exact — BigInt has no precision ceiling
  const roundedBig = divideRoundHalfAwayFromZeroBigInt(exactProduct, denominator);

  // Convert back to a JS number only at the very end, and verify it's
  // still a safe integer — if a value were ever large enough to lose
  // precision here, this throws rather than silently rounding wrong.
  const result = Number(roundedBig);
  assertInt(result, "multiplyCentsByBasisPoints result");
  return result;
}

export function formatCents(cents: Cents): string {
  assertInt(cents, "formatCents");
  const negative = cents < 0;
  const dollars = Math.abs(cents) / 100;
  const formatted = dollars.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (negative ? "-$" : "$") + formatted;
}

/** BIGINT SAFETY (see CORRECTIONS.md item 5 for the full writeup):
 *
 *  Postgres `bigint` columns can hold values far beyond
 *  Number.MAX_SAFE_INTEGER (2^53 - 1 = 9,007,199,254,740,991, i.e.
 *  ~$90 trillion in cents — not a real concern for a residential
 *  contractor's budgets, but the guard costs nothing and the failure
 *  mode if it were ever hit is silent precision loss, which is exactly
 *  the class of bug this whole engine exists to prevent).
 *
 *  How values arrive matters: node-postgres (and by extension anything
 *  built on it) returns `int8`/bigint columns as JavaScript STRINGS by
 *  default specifically to avoid coercing them through float64. Some
 *  PostgREST/Supabase configurations instead serialize bigint as a JSON
 *  NUMBER, which silently loses precision above the safe-integer limit
 *  before this code ever sees it — that step happens outside our
 *  control, in the API layer. RECOMMENDATION: expose money columns to
 *  PostgREST cast to `text` in any view/RPC that crosses the wire (e.g.
 *  `amount_cents::text as amount_cents`), OR verify your Supabase
 *  client is configured to keep bigint as string, and ALWAYS pass
 *  values through parseCentsFromApi() below rather than using a raw API
 *  response number directly in a calculation. */
export function parseCentsFromApi(value: string | number, label = "amount"): Cents {
  if (typeof value === "number") {
    assertInt(value, `${label} (received as number)`);
    return value;
  }
  if (typeof value === "string") {
    if (!/^-?\d+$/.test(value)) {
      throw new Error(`${label} must be a string of digits (bigint from Postgres), got "${value}"`);
    }
    const n = Number(value);
    if (!Number.isSafeInteger(n)) {
      throw new Error(
        `${label} value "${value}" exceeds Number.MAX_SAFE_INTEGER and cannot be safely represented as a JS number.`
      );
    }
    return n;
  }
  throw new Error(`${label} must be a string or number, got ${typeof value}`);
}

/** Serialize a cents value for sending back over the wire to a Postgres
 *  bigint column. Always send as a numeric string, not a JSON number —
 *  this sidesteps any ambiguity in how the receiving layer parses JSON
 *  numbers and matches how int8 values are conventionally round-tripped
 *  through PostgREST. */
export function serializeCentsForApi(cents: Cents): string {
  assertInt(cents, "serializeCentsForApi");
  return String(cents);
}
