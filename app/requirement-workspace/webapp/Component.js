sap.ui.define(
    ["sap/ui/core/UIComponent"],
    function (UIComponent) {
        "use strict";

        return UIComponent.extend("poc.sp.hub.requirementworkspace.Component", {
            metadata: {
                manifest: "json",
                interfaces: ["sap.ui.core.IAsyncContentCreation"]
            }
        });
    }
);
