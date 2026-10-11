sap.ui.define(["sap/ui/core/routing/HashChanger"], function (HashChanger) {
  "use strict";

  /**
   * Navigation to a knowledge document's Object Page, shared by the Ask dialog
   * (List Report) and the Similar Documents section (Object Page).
   */

  function findExtensionAPI(oControl) {
    var oCurrent = oControl;
    while (oCurrent && !oCurrent.isA("sap.ui.core.mvc.View")) {
      oCurrent = oCurrent.getParent();
    }
    var oController = oCurrent && oCurrent.getController();
    return oController && oController.getExtensionAPI ? oController.getExtensionAPI() : null;
  }

  return {
    /**
     * Open the saved (active) version of a document. FE's routing works inside
     * an FLP/Work Zone shell, where the hash also carries the app intent; the
     * app-local hash is the fallback.
     *
     * @param {object|sap.ui.core.Control} vSource an FE ExtensionAPI, or a control inside an FE view
     * @param {string} sId the document's ID
     */
    openDocument: function (vSource, sId) {
      var oExtensionAPI = vSource && vSource.isA && vSource.isA("sap.ui.core.Control") ? findExtensionAPI(vSource) : vSource;
      var sKey = "ID=" + sId + ",IsActiveEntity=true";
      if (oExtensionAPI && oExtensionAPI.routing && oExtensionAPI.routing.navigateToRoute) {
        oExtensionAPI.routing.navigateToRoute("KnowledgeDocumentsObjectPage", { key: sKey });
      } else {
        HashChanger.getInstance().setHash("KnowledgeDocuments(" + sKey + ")");
      }
    }
  };
});
