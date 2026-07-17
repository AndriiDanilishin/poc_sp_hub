sap.ui.define(
    ["sap/ui/core/UIComponent", "sap/ui/model/json/JSONModel"],
    function (UIComponent, JSONModel) {
        "use strict";

        return UIComponent.extend("poc.sp.hub.requirementworkspace.Component", {
            metadata: {
                manifest: "json",
                interfaces: ["sap.ui.core.IAsyncContentCreation"]
            },

            init: function () {
                // Create the ui state model BEFORE the root view is created, so the
                // view controller's onInit can rely on it being present.
                this.setModel(
                    new JSONModel({
                        workspaceId: null,
                        workspaceStatus: "",
                        selCount: 0
                    }),
                    "ui"
                );
                UIComponent.prototype.init.apply(this, arguments);
            }
        });
    }
);
