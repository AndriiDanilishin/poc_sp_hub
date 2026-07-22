sap.ui.define(
  [
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "poc/sp/hub/intakehub/ext/lib/ActionRunner",
    "poc/sp/hub/intakehub/ext/lib/WorkspacePicker"
  ],
  function (Fragment, MessageBox, MessageToast, ActionRunner, WorkspacePicker) {
    "use strict";

    var CHANGE_WS_FRAGMENT_ID = "changeWorkspaceFrag";

    // Poll getExtractionStatus while a document sits in EXTRACTING, so the page
    // reflects EXTRACTED/FAILED without a manual reload. Extraction is a single
    // synchronous action today, so this only matters when another client (or a
    // second tab) started it — hence the short, bounded schedule.
    var POLL_INTERVAL_MS = 1500;
    var POLL_MAX_ATTEMPTS = 20;

    // Handle of the in-flight poll, so navigating away mid-poll doesn't leave up
    // to POLL_MAX_ATTEMPTS calls firing against a destroyed context.
    var iPollTimer = null;

    function stopPolling() {
      if (iPollTimer) {
        window.clearTimeout(iPollTimer);
        iPollTimer = null;
      }
    }

    /**
     * These handlers are declared as Object Page HEADER actions in manifest.json,
     * so `this` is the ObjectPage ExtensionAPI and the bound context arrives as
     * the event's `contexts` parameter (FE passes the selected/page context).
     * Falls back to the ExtensionAPI's own binding context.
     *
     * @param {sap.ui.base.Event} oEvent the press event
     * @param {object} oExtensionAPI the ExtensionAPI (`this` in the handler)
     * @returns {sap.ui.model.odata.v4.Context} the document's context
     */
    function contextOf(oEvent, oExtensionAPI) {
      var aContexts = oEvent && oEvent.getParameter && oEvent.getParameter("contexts");
      if (aContexts && aContexts.length) {
        return aContexts[0];
      }
      return oExtensionAPI.getBindingContext();
    }

    function bundleOf(oExtensionAPI) {
      return oExtensionAPI.getModel("i18n").getResourceBundle();
    }

    return {
      /**
       * Calls IntakeService.extractRequirements(documentId) for the document
       * currently shown on the Object Page, then refreshes it so the updated
       * status/errorMsg are visible without a manual page reload.
       *
       * FE gates this button on status via the manifest's `enabled` expression
       * (UPLOADED or FAILED only), so there is no in-handler status pre-check.
       */
      onExtract: function (oEvent) {
        var oExtensionAPI = this;
        var oContext = contextOf(oEvent, oExtensionAPI);
        var oModel = oContext.getModel();
        var oBundle = bundleOf(oExtensionAPI);
        var sDocumentId = oContext.getProperty("ID");

        // requestProperty, not getProperty: FE only $selects the fields its
        // annotations reference, and workspace_ID is not among them — the
        // synchronous read returned undefined and logged a drill-down failure,
        // silently disabling the "Open Workspace" hand-off. requestProperty
        // fetches the field when it is missing from the cache.
        return oContext
          .requestProperty("workspace_ID")
          .then(function (sWorkspaceId) {
            return ActionRunner.invoke(oModel, "extractRequirements", {
              documentId: sDocumentId
            }).then(function (oResult) {
              if (oResult.status === "FAILED") {
                MessageBox.error(oBundle.getText("extractFailedStatus"));
              } else if (oResult.status === "EXTRACTED") {
                // Hand off to the Requirement Workspace, deep-linked to this
                // document's workspace so all its new requirements are in view.
                MessageBox.success(oBundle.getText("extractSuccess", [oResult.itemsCreated]), {
                  title: oBundle.getText("extractedTitle"),
                  actions: [oBundle.getText("openWorkspaceAction"), MessageBox.Action.CLOSE],
                  emphasizedAction: oBundle.getText("openWorkspaceAction"),
                  onClose: function (sAction) {
                    if (sAction === oBundle.getText("openWorkspaceAction") && sWorkspaceId) {
                      window.open(
                        "/poc.sp.hub.requirementworkspace/index.html?workspace=" + sWorkspaceId,
                        "_blank"
                      );
                    }
                  }
                });
              }
              return oContext.requestRefresh();
            });
          })
          .catch(function (oError) {
            MessageBox.error(ActionRunner.describeError(oError, oBundle.getText("extractFailed")));
          });
      },

      /**
       * Poll getExtractionStatus until the document leaves EXTRACTING, refreshing
       * the page context when it settles. The manifest only shows this button
       * while the document IS in EXTRACTING, so there is no terminal-state
       * shortcut here any more.
       */
      onRefreshStatus: function (oEvent) {
        var oExtensionAPI = this;
        var oContext = contextOf(oEvent, oExtensionAPI);
        var oModel = oContext.getModel();
        var oBundle = bundleOf(oExtensionAPI);
        var sDocumentId = oContext.getProperty("ID");
        var iAttempts = 0;

        stopPolling();

        var fnPoll = function () {
          iAttempts += 1;
          ActionRunner.invoke(oModel, "getExtractionStatus", { documentId: sDocumentId })
            .then(function (oStatus) {
              if (oStatus.status !== "EXTRACTING" || iAttempts >= POLL_MAX_ATTEMPTS) {
                stopPolling();
                return oContext.requestRefresh();
              }
              iPollTimer = window.setTimeout(fnPoll, POLL_INTERVAL_MS);
              return null;
            })
            .catch(function (oError) {
              stopPolling();
              MessageBox.error(
                ActionRunner.describeError(oError, oBundle.getText("extractFailed"))
              );
            });
        };

        fnPoll();
      },

      /**
       * Opens a dialog to move this document to a different (OPEN) workspace via
       * IntakeService.changeWorkspace.
       *
       * The backend's 409 remains the authoritative gate. The button itself is
       * now disabled by the manifest's `enabled` expression once the document is
       * EXTRACTED, which replaced an in-handler MessageBox pre-check that let the
       * user press a button only to be told they shouldn't have.
       */
      onChangeWorkspace: function (oEvent) {
        var oExtensionAPI = this;
        var oContext = contextOf(oEvent, oExtensionAPI);
        var oModel = oContext.getModel();
        var oBundle = bundleOf(oExtensionAPI);
        var oI18nModel = oExtensionAPI.getModel("i18n");
        var oDialog;
        // Same drill-down caveat as onExtract: workspace_ID is not in FE's
        // $select, so read it asynchronously. Only used for the same-target
        // check, which simply doesn't fire if the value is unavailable — the
        // backend rejects a same-workspace move regardless.
        var sCurrentWs = null;
        oContext.requestProperty("workspace_ID").then(function (sId) {
          sCurrentWs = sId;
        });

        var oDialogController = {
          onCancelChangeWorkspace: function () {
            oDialog.close();
          },

          onConfirmChangeWorkspace: function () {
            var oSelect = Fragment.byId(CHANGE_WS_FRAGMENT_ID, "changeWorkspaceSelect");
            var sNewWs = oSelect.getSelectedKey();

            // Inline value state rather than a modal: the problem is with this
            // one field and the user can fix it without dismissing anything.
            if (!sNewWs) {
              oSelect.setValueState("Error");
              oSelect.setValueStateText(oBundle.getText("validationNoWorkspace"));
              return;
            }
            if (sNewWs === sCurrentWs) {
              oSelect.setValueState("Error");
              oSelect.setValueStateText(oBundle.getText("changeWorkspaceSameTarget"));
              return;
            }
            oSelect.setValueState("None");
            oDialog.close();

            ActionRunner.invoke(oModel, "changeWorkspace", {
              documentId: oContext.getProperty("ID"),
              newWorkspaceId: sNewWs
            })
              .then(function () {
                MessageToast.show(oBundle.getText("changeWorkspaceSuccess"));
                return oContext.requestRefresh();
              })
              .catch(function (oError) {
                MessageBox.error(
                  ActionRunner.describeError(oError, oBundle.getText("changeWorkspaceFailed"))
                );
              });
          }
        };

        return Fragment.load({
          id: CHANGE_WS_FRAGMENT_ID,
          name: "poc.sp.hub.intakehub.ext.fragment.ChangeWorkspaceDialog",
          controller: oDialogController
        }).then(function (oControl) {
          oDialog = Array.isArray(oControl) ? oControl[0] : oControl;
          oDialog.setModel(oModel);
          oDialog.setModel(oI18nModel, "i18n");
          oDialog.attachAfterClose(function () {
            oDialog.destroy();
          });
          WorkspacePicker.bindOpenWorkspaces(
            Fragment.byId(CHANGE_WS_FRAGMENT_ID, "changeWorkspaceSelect")
          );
          oDialog.open();
        });
      }
    };
  }
);
