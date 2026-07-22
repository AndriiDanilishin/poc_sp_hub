sap.ui.define(
  ["sap/ui/core/Item", "sap/ui/model/Filter", "sap/ui/model/FilterOperator"],
  function (Item, Filter, FilterOperator) {
    "use strict";

    /**
     * Shared helper for the "pick a target workspace" control used by both the
     * upload dialog and the change-workspace dialog.
     *
     * Consolidates three previously-duplicated pieces:
     *  - the OPEN-only, newest-first binding over /RequirementWorkspaces
     *  - the select-a-just-created-workspace dance (see selectById below)
     *  - the empty-selection guard
     */
    return {
      /**
       * Bind a Select to the OPEN workspaces, newest first.
       *
       * Only OPEN workspaces are offered: ARCHIVED ones have already been
       * promoted to a Sourcing Project, so adding documents to them would strand
       * the resulting requirements outside the promoted set.
       *
       * @param {sap.m.Select} oSelect the select to bind
       */
      bindOpenWorkspaces: function (oSelect) {
        oSelect.bindItems({
          path: "/RequirementWorkspaces",
          parameters: { $orderby: "createdAt desc" },
          filters: [new Filter("status", FilterOperator.EQ, "OPEN")],
          template: new Item({ key: "{ID}", text: "{title}" })
        });
      },

      /**
       * Select a workspace by ID, tolerating items that have not arrived yet.
       *
       * A freshly-created workspace is NOT in the Select's items synchronously
       * after refresh(), so `setSelectedItem` would find nothing and leave the
       * visual selection stale while the model already points at the new row.
       * Selecting by KEY works because the Select re-resolves the key when its
       * items arrive; the dataReceived re-apply covers the refresh case.
       *
       * @param {sap.m.Select} oSelect the bound select
       * @param {string} sId the workspace ID to select
       */
      selectById: function (oSelect, sId) {
        oSelect.setSelectedKey(sId);
        var oBinding = oSelect.getBinding("items");
        if (!oBinding) {
          return;
        }
        var fnPick = function () {
          oSelect.setSelectedKey(sId);
          oBinding.detachDataReceived(fnPick);
        };
        oBinding.attachDataReceived(fnPick);
        oBinding.refresh();
      }
    };
  }
);
