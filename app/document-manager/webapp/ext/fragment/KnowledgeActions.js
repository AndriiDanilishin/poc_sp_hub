sap.ui.define(
  [
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/BusyIndicator",
    "poc/sp/hub/documentmanager/ext/lib/ActionRunner"
  ],
  function (MessageToast, MessageBox, BusyIndicator, ActionRunner) {
    "use strict";

    // One run at a time: embedding the whole corpus can take a while, and a second
    // press would only queue the same documents again.
    var bRunning = false;

    return {
      /**
       * List Report toolbar action: embed every document that is not INDEXED
       * yet (new, edited while the provider was down, or FAILED). `this` is the
       * ListReport ExtensionAPI. Documents already indexed are skipped, so this
       * costs nothing on a healthy corpus.
       */
      onReindexMissing: function () {
        if (bRunning) {
          return;
        }
        var oExtensionAPI = this;
        var oBundle = oExtensionAPI.getModel("i18n").getResourceBundle();
        bRunning = true;
        BusyIndicator.show(0);
        ActionRunner.invoke(oExtensionAPI.getModel(), "reindex", { onlyMissing: true })
          .then(function (oResult) {
            var iDone = (oResult && oResult.documentsQueued) || 0;
            var iFailed = (oResult && oResult.failed) || 0;
            if (iFailed > 0) {
              MessageBox.warning(oBundle.getText("reindexPartial", [iDone, iFailed]));
            } else {
              MessageToast.show(oBundle.getText("reindexDone", [iDone]));
            }
            oExtensionAPI.refresh();
          })
          .catch(function (oError) {
            MessageBox.error(
              ActionRunner.describeError(
                oError,
                oBundle.getText("reindexFailed"),
                oBundle.getText("notCurator")
              )
            );
          })
          .finally(function () {
            bRunning = false;
            BusyIndicator.hide();
          });
      }
    };
  }
);
