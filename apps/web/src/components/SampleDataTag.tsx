import React from "react";

/** Shown at the top of every screen's content in the real app (see
 *  App.tsx) so preview data is never mistaken for something real —
 *  extracted into its own component so the test suite can compose the
 *  exact same output App.tsx renders, rather than a hand-duplicated
 *  string that could drift out of sync with it. */
export function SampleDataTag() {
  return (
    <>
      <div className="sc-sample-data-tag">Sample data — Hawks Ridge Residence is a fictional demo project</div>
      <style>{`.sc-sample-data-tag { display: inline-block; font-size: 11px; color: #8B7F6C; background: #EFEAE1; padding: 3px 10px; border-radius: 999px; margin-bottom: 16px; }`}</style>
    </>
  );
}
