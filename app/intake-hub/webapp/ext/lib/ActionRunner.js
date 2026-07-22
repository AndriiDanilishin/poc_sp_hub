sap.ui.define([], function () {
  "use strict";

  /**
   * Shared helper for invoking IntakeService's UNBOUND actions from custom
   * Fiori Elements extensions.
   *
   * The five call sites in this app each used to hand-roll the same three steps
   * (bind the action, set parameters, execute) plus their own copy of
   * `MessageBox.error('… ' + (oError.message || oError))`, which leaks raw OData
   * error payloads on a 500 or a network drop. Centralising it keeps the error
   * text consistent and gives one place to improve error normalisation.
   */
  return {
    /**
     * Invoke an unbound OData V4 action and resolve with its return value.
     *
     * @param {sap.ui.model.odata.v4.ODataModel} oModel the OData model
     * @param {string} sActionName unqualified action name, e.g. 'uploadDocument'
     * @param {object} [mParameters] action parameters as name/value pairs
     * @returns {Promise<object|undefined>} the action's returned entity/complex value
     */
    invoke: function (oModel, sActionName, mParameters) {
      var oAction = oModel.bindContext("/" + sActionName + "(...)");
      Object.keys(mParameters || {}).forEach(function (sKey) {
        oAction.setParameter(sKey, mParameters[sKey]);
      });
      return oAction.execute().then(function () {
        var oBoundContext = oAction.getBoundContext();
        return oBoundContext ? oBoundContext.getObject() : undefined;
      });
    },

    /**
     * Reduce an OData/UI5 error to a single human-readable line.
     *
     * CAP's own `req.reject(...)` messages are good and deliberately
     * user-facing (e.g. the §18 change-workspace 409, the §19 promotion gate),
     * so they are surfaced as-is. Everything else — transport failures, 500s,
     * anything with no usable message — falls back to the caller's text so the
     * user never sees a raw payload or "[object Object]".
     *
     * @param {Error|object} oError the rejection value from an action execute()
     * @param {string} sFallback message to show when no usable text is found
     * @returns {string} a message safe to put in a MessageBox
     */
    describeError: function (oError, sFallback) {
      if (!oError) {
        return sFallback;
      }
      // A 5xx message is an internal detail (stack fragments, SQL, driver text)
      // and never actionable for the user. CAP's deliberate 4xx messages are
      // user-facing by design and still pass through below.
      var iStatus = Number(oError.status || (oError.error && oError.error.code));
      if (iStatus >= 500) {
        return sFallback;
      }
      // CAP surfaces the server message on `.message`; nested OData errors put
      // it on `.error.message` (sometimes as { value: '...' }).
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
      // A bare HTTP status line carries no information the fallback doesn't.
      if (/^(Network Error|Request failed|HTTP request failed)/i.test(vMessage)) {
        return sFallback;
      }
      return vMessage;
    }
  };
});
