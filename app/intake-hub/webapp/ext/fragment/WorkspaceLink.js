sap.ui.define(
  ["poc/sp/hub/intakehub/ext/lib/CrossAppNavigation"],
  function (CrossAppNavigation) {
    "use strict";

    return {
      /**
       * Opens this document's workspace in the Requirement Workspace app, in a
       * new tab, via the FLP intent (CrossAppNavigation). `this` is the Link
       * control (the fragment's press handler), so its binding context is the
       * SourceDocuments row FE bound the custom facet to.
       */
      onPress: function (oEvent) {
        var oContext = oEvent.getSource().getBindingContext();
        // Opened synchronously, before the async requestProperty below, so the
        // browser still associates it with this click — see the note on
        // CrossAppNavigation.openBlankTab.
        var oNewTab = CrossAppNavigation.openBlankTab();

        // Same drill-down caveat as IntakeActions.onExtract: FE only $selects
        // fields its annotations reference, and workspace_ID is not among them
        // now that it moved out of the FieldGroup — requestProperty fetches it
        // when missing from the cache.
        oContext.requestProperty("workspace_ID").then(function (sWorkspaceId) {
          if (!sWorkspaceId) {
            if (oNewTab) {
              oNewTab.close();
            }
            return;
          }
          CrossAppNavigation.openIntent(
            "RequirementWorkspace",
            "manage",
            { workspace: sWorkspaceId },
            "/poc.sp.hub.requirementworkspace/index.html?workspace=" + sWorkspaceId,
            oNewTab
          );
        });
      }
    };
  }
);
