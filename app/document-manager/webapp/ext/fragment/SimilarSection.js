sap.ui.define(
  [
    "sap/m/StandardListItem",
    "sap/m/MessageBox",
    "sap/ui/core/routing/HashChanger",
    "poc/sp/hub/documentmanager/ext/lib/ActionRunner"
  ],
  function (StandardListItem, MessageBox, HashChanger, ActionRunner) {
    "use strict";

    // How much of the document to embed as the query. Matches the embedder's
    // own budget order of magnitude without sending whole files.
    var QUERY_CHARS = 1500;
    var TOP_K = 6;

    function findView(oControl) {
      var oCurrent = oControl;
      while (oCurrent && !oCurrent.isA("sap.ui.core.mvc.View")) {
        oCurrent = oCurrent.getParent();
      }
      return oCurrent;
    }

    /**
     * Navigate through FE's routing (works inside an FLP/Work Zone shell, where
     * the hash also carries the app intent); the app-local hash is the fallback.
     */
    function openDocument(oControl, sId) {
      var sKey = "ID=" + sId + ",IsActiveEntity=true";
      var oView = findView(oControl);
      var oController = oView && oView.getController();
      var oExtensionAPI = oController && oController.getExtensionAPI && oController.getExtensionAPI();
      if (oExtensionAPI && oExtensionAPI.routing) {
        oExtensionAPI.routing.navigateToRoute("KnowledgeDocumentsObjectPage", { key: sKey });
      } else {
        HashChanger.getInstance().setHash("KnowledgeDocuments(" + sKey + ")");
      }
    }

    return {
      /**
       * Search the corpus with this document's own text and list the nearest
       * other documents with their similarity score.
       *
       * @param {sap.ui.base.Event} oEvent press of the section's button
       */
      onFindSimilar: function (oEvent) {
        var oButton = oEvent.getSource();
        var oBox = oButton.getParent();
        var oList = oBox.getItems().filter(function (oItem) {
          return oItem.isA("sap.m.List");
        })[0];
        var oContext = oButton.getBindingContext();
        var oBundle = oButton.getModel("i18n").getResourceBundle();
        if (!oContext) {
          return;
        }

        oBox.setBusy(true);
        Promise.all([
          oContext.requestProperty("ID"),
          oContext.requestProperty("title"),
          oContext.requestProperty("content")
        ])
          .then(function (aValues) {
            var sId = aValues[0];
            var sQuery = [aValues[1], String(aValues[2] || "").slice(0, QUERY_CHARS)]
              .filter(Boolean)
              .join("\n");
            if (!sQuery.trim()) {
              throw new Error(oBundle.getText("similarNoContent"));
            }
            return ActionRunner.invoke(oContext.getModel(), "searchKnowledge", {
              query: sQuery,
              // One extra, because the document itself is normally the top hit.
              topK: TOP_K + 1,
              minScore: 0
            }).then(function (aHits) {
              return (aHits || [])
                .filter(function (oHit) {
                  return oHit.ID !== sId;
                })
                .slice(0, TOP_K);
            });
          })
          .then(function (aHits) {
            oList.destroyItems();
            aHits.forEach(function (oHit) {
              var oItem = new StandardListItem({
                title: oHit.title,
                description: oHit.category + " · " + (oHit.sourceRef || "") + " — " + oHit.excerpt,
                info: (oHit.score * 100).toFixed(1) + " %",
                // Above ~0.85 two documents are usually near-duplicates.
                infoState: oHit.score >= 0.85 ? "Warning" : "None",
                wrapping: true,
                type: "Navigation"
              });
              oItem.attachPress(function () {
                openDocument(oButton, oHit.ID);
              });
              oList.addItem(oItem);
            });
            oList.setVisible(true);
          })
          .catch(function (oError) {
            MessageBox.error(ActionRunner.describeError(oError, oBundle.getText("similarFailed")));
          })
          .finally(function () {
            oBox.setBusy(false);
          });
      }
    };
  }
);
