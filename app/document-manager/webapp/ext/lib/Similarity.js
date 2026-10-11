sap.ui.define([], function () {
  "use strict";

  /**
   * Cosine-similarity thresholds for retrieval scores, in one place. Two different
   * questions use the same score:
   *  - relevance (Ask dialog): is this document a useful grounding source for the
   *    query? Query-to-document scores are low in absolute terms (a strong match
   *    with text-embedding-3-large is typically 0.4–0.6).
   *  - duplication (Similar Documents): is this document nearly the same as the
   *    one on screen? Document-to-document scores are much higher; above ~0.85 two
   *    documents usually say the same thing.
   */
  var RELEVANT = 0.5;
  var WEAKLY_RELEVANT = 0.3;
  var LIKELY_DUPLICATE = 0.85;

  return {
    RELEVANT: RELEVANT,
    WEAKLY_RELEVANT: WEAKLY_RELEVANT,
    LIKELY_DUPLICATE: LIKELY_DUPLICATE,

    /** 0.4321 → "43.2 %" */
    percent: function (fScore) {
      return typeof fScore === "number" ? (fScore * 100).toFixed(1) + " %" : "";
    },

    relevanceState: function (fScore) {
      if (fScore >= RELEVANT) {
        return "Success";
      }
      return fScore >= WEAKLY_RELEVANT ? "Warning" : "None";
    },

    duplicateState: function (fScore) {
      return fScore >= LIKELY_DUPLICATE ? "Warning" : "None";
    },

    /** "Guideline · POL-001 — excerpt", without a dangling separator. */
    hitDescription: function (sCategory, sSourceRef, sExcerpt) {
      return (sCategory || "") + (sSourceRef ? " · " + sSourceRef : "") + (sExcerpt ? " — " + sExcerpt : "");
    }
  };
});
