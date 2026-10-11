sap.ui.define(
  [
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/base/Log",
    "poc/sp/hub/documentmanager/ext/lib/ActionRunner",
    "poc/sp/hub/documentmanager/ext/lib/Navigation"
  ],
  function (JSONModel, MessageBox, Log, ActionRunner, Navigation) {
    "use strict";

    var FRAGMENT_ID = "kbAskDialogFrag";

    function createController(oExtensionAPI) {
      var oDialog = null;
      var oState = new JSONModel({
        question: "",
        category: "",
        topK: 5,
        categories: [],
        // "" before the first run, then "search" or "ask" — drives what shows.
        mode: "",
        answer: "",
        answered: false,
        citations: [],
        hits: []
      });

      function i18n(sKey, aArgs) {
        return oExtensionAPI.getModel("i18n").getResourceBundle().getText(sKey, aArgs);
      }

      function run(sName, mParams, fnApply) {
        oDialog.setBusy(true);
        return ActionRunner.invoke(oExtensionAPI.getModel(), sName, mParams)
          .then(fnApply)
          .catch(function (oError) {
            MessageBox.error(ActionRunner.describeError(oError, i18n("askFailed")));
          })
          .finally(function () {
            if (oDialog) {
              oDialog.setBusy(false);
            }
          });
      }

      function commonParams() {
        return {
          category: oState.getProperty("/category") || undefined,
          topK: Number(oState.getProperty("/topK")) || 5
        };
      }

      var oController = {
        model: oState,

        setDialog: function (oDlg) {
          oDialog = oDlg;
        },

        /** Category picker: "All categories" plus the server's code list. */
        loadCategories: function () {
          return oExtensionAPI
            .getModel()
            .bindList("/KnowledgeCategories")
            .requestContexts(0, 50)
            .then(function (aContexts) {
              oState.setProperty(
                "/categories",
                [{ code: "", description: i18n("askAllCategories") }].concat(
                  aContexts.map(function (oContext) {
                    return oContext.getObject();
                  })
                )
              );
            });
        },

        /** Retrieval test: what RAG would ground on — one embedding, no LLM. */
        onSearch: function () {
          var mParams = commonParams();
          mParams.query = oState.getProperty("/question").trim();
          return run("searchKnowledge", mParams, function (aHits) {
            oState.setProperty("/mode", "search");
            oState.setProperty("/hits", aHits || []);
            oState.setProperty("/citations", []);
          });
        },

        /** Grounded answer; citations are restricted to retrieved documents. */
        onAsk: function () {
          var mParams = commonParams();
          mParams.question = oState.getProperty("/question").trim();
          return run("askKnowledge", mParams, function (oResult) {
            oState.setProperty("/mode", "ask");
            oState.setProperty("/answer", oResult.answer);
            oState.setProperty("/answered", Boolean(oResult.answered));
            oState.setProperty("/citations", oResult.citations || []);
            oState.setProperty("/hits", oResult.retrieved || []);
          });
        },

        onOpenHit: function (oEvent) {
          var sId = oEvent.getSource().getBindingContext("ask").getProperty("ID");
          oDialog.close();
          Navigation.openDocument(oExtensionAPI, sId);
        },

        onClose: function () {
          oDialog.close();
        },

        onDialogClosed: function () {
          if (oDialog) {
            oDialog.destroy();
            oDialog = null;
          }
        }
      };
      return oController;
    }

    return {
      /** List Report toolbar action (`this` is the ListReport ExtensionAPI). */
      onOpenAsk: function () {
        var oExtensionAPI = this;
        var oController = createController(oExtensionAPI);
        oExtensionAPI
          .loadFragment({
            id: FRAGMENT_ID,
            name: "poc.sp.hub.documentmanager.ext.fragment.AskDialog",
            controller: oController
          })
          .then(function (oControl) {
            var oDialog = Array.isArray(oControl) ? oControl[0] : oControl;
            oController.setDialog(oDialog);
            oDialog.setModel(oController.model, "ask");
            oDialog.attachAfterClose(oController.onDialogClosed);
            oDialog.open();
            return oController.loadCategories().catch(function () {
              // The category list is a convenience; the dialog works without it.
            });
          })
          .catch(function (oError) {
            // The dialog itself could not be created — say so instead of doing nothing.
            Log.error("Ask dialog could not be opened", oError);
            MessageBox.error(oExtensionAPI.getModel("i18n").getResourceBundle().getText("askOpenFailed"));
          });
      }
    };
  }
);
