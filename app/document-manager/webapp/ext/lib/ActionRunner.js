sap.ui.define([], function () {
  "use strict";

  /**
   * Invoke KnowledgeService's unbound operations from custom Fiori Elements
   * extensions, and turn their errors into one readable line.
   *
   * Same contract as intake-hub's ext/lib/ActionRunner.js (where the reasoning
   * for $direct and the error filtering is recorded); kept as a per-app copy
   * because each Fiori app is deployed as its own HTML5 module and cannot load
   * another app's resources.
   */
  function execute(oModel, sPath, mParameters) {
    // $direct: inside the default $auto batch, UI5's V4 model does not reliably
    // attach CAP's error body to the rejection, so the user would see "Bad
    // Request" instead of the server's explanation.
    var oOperation = oModel.bindContext("/" + sPath + "(...)", null, {
      $$groupId: "$direct"
    });
    Object.keys(mParameters || {}).forEach(function (sKey) {
      if (mParameters[sKey] !== undefined) {
        oOperation.setParameter(sKey, mParameters[sKey]);
      }
    });
    return oOperation.execute().then(function () {
      var oBoundContext = oOperation.getBoundContext();
      return oBoundContext ? oBoundContext.getObject() : undefined;
    });
  }

  return {
    /**
     * Invoke an unbound action or function and resolve with its return value.
     * Collection results resolve to a plain array.
     *
     * @param {sap.ui.model.odata.v4.ODataModel} oModel the OData model
     * @param {string} sName unqualified operation name, e.g. 'askKnowledge'
     * @param {object} [mParameters] parameters as name/value pairs; undefined values are omitted
     * @returns {Promise<object|object[]|undefined>} the operation's return value
     */
    invoke: function (oModel, sName, mParameters) {
      return execute(oModel, sName, mParameters).then(function (vResult) {
        if (vResult && Array.isArray(vResult.value)) {
          return vResult.value;
        }
        return vResult;
      });
    },

    /**
     * Reduce an OData/UI5 error to a single human-readable line. CAP's own
     * req.reject(...) texts are user-facing and pass through; transport noise
     * and 5xx internals fall back to the caller's text. A 403 gets its own
     * message: every write in this app is curator-only.
     *
     * @param {Error|object} oError the rejection value
     * @param {string} sFallback message when nothing usable is found
     * @param {string} [sForbidden] message for HTTP 403
     * @returns {string} a message safe to show
     */
    describeError: function (oError, sFallback, sForbidden) {
      if (!oError) {
        return sFallback;
      }
      var iStatus = Number(oError.status || (oError.error && oError.error.code));
      if (iStatus === 403 && sForbidden) {
        return sForbidden;
      }
      if (iStatus >= 500) {
        return sFallback;
      }
      var vMessage = oError.message;
      if (oError.error) {
        vMessage = oError.error.message || vMessage;
      }
      if (vMessage && typeof vMessage === "object") {
        vMessage = vMessage.value;
      }
      if (typeof vMessage !== "string" || !vMessage.trim()) {
        return sFallback;
      }
      var sTrimmed = vMessage.trim();
      if (
        /^(Network Error|Request failed|HTTP request failed)/i.test(sTrimmed) ||
        /^(Not Found|Bad Request|Unauthorized|Conflict|Internal Server Error)$/i.test(sTrimmed)
      ) {
        return sFallback;
      }
      if (/^Forbidden$/i.test(sTrimmed)) {
        return sForbidden || sFallback;
      }
      return vMessage;
    }
  };
});
