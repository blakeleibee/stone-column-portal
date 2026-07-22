"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div style={{ padding: 32, fontFamily: "sans-serif", color: "#8B7F6C" }}>
      <h1 style={{ fontSize: 18, marginBottom: 8, color: "#3A3A3A" }}>Something went wrong</h1>
      <p style={{ marginBottom: 16 }}>
        This screen hit an unexpected error. The rest of the portal is unaffected — try again, or navigate
        elsewhere from the menu.
      </p>
      <button onClick={() => reset()} style={{ padding: "8px 14px" }}>
        Try again
      </button>
    </div>
  );
}