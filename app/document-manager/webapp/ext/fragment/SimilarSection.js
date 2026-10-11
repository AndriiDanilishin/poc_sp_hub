sap.ui.define(
  [
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "poc/sp/hub/documentmanager/ext/lib/ActionRunner",
    "poc/sp/hub/documentmanager/ext/lib/Navigation"
  ],
  function (JSONModel, MessageBox, ActionRunner, Navigation) {
    "use strict";

    // How much of the document to embed as the query. Matches the embedder's
    // own budget order of magnitude without sending whole files.
    var QUERY_CHARS = 1500;
    var TOP_K = 6;
    var MODEL = "similar";

    function emptyState(sForPath) {
      // forPath: the document the hits belong to; searched: show the list
      // (also when empty, so "No similar documents found" appears).
      return { forPath: sForPath || "", searched: false, hits: [] };
    }

    /** The section's state model, created on first use and owned by the box. */
    function stateOf(oBox) {
      var oModel = oBox.getModel(MODEL);
      if (!oModel) {
        oModel = new JSONModel(emptyState());
        oBox.setModel(oModel, MODEL);
      }
      return oModel;
    }

    function boxOf(oControl) {
      var oCurrent = oControl;
      while (oCurrent && oCurrent.getId().indexOf("similarSectionBox") === -1) {
        oCurrent = oCurrent.getParent();
      }
      return oCurrent;
    }

    return {
      /**
       * FE reuses the Object Page view for every document (and swaps the context
       * on Edit), so results computed for one document must not survive the
       * switch to another.
       *
       * @param {sap.ui.base.Event} oEvent modelContextChange of the section box
       */
      onContextChange: function (oEvent) {
        var oBox = oEvent.getSource();
        var oContext = oBox.getBindingContext();
        var sPath = oContext ? oContext.getPath() : "";
        var oState = stateOf(oBox);
        if (oState.getProperty("/forPath") !== sPath) {
          oState.setData(emptyState(sPath));
        }
      },

      /**
       * Search the corpus with this document's own text and list the nearest
       * other documents with their similarity score.
       *
       * @param {sap.ui.base.Event} oEvent press of the section's button
       */
      onFindSimilar: function (oEvent) {
        var oButton = oEvent.getSource();
        var oBox = boxOf(oButton);
        var oContext = oButton.getBindingContext();
        var oBundle = oButton.getModel("i18n").getResourceBundle();
        if (!oContext || !oBox) {
          return;
        }
        var sPath = oContext.getPath();
        var oState = stateOf(oBox);
        if (oState.getProperty("/forPath") !== sPath) {
          oState.setData(emptyState(sPath));
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
            // The user may have moved to another document while this ran.
            if (oState.getProperty("/forPath") === sPath) {
              oState.setData({ forPath: sPath, searched: true, hits: aHits });
            }
          })
          .catch(function (oError) {
            MessageBox.error(ActionRunner.describeError(oError, oBundle.getText("similarFailed")));
          })
          .finally(function () {
            oBox.setBusy(false);
          });
      },

      onOpenHit: function (oEvent) {
        var oItem = oEvent.getSource();
        Navigation.openDocument(oItem, oItem.getBindingContext(MODEL).getProperty("ID"));
      }
    };
  }
);
