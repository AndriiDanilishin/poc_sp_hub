sap.ui.define(["sap/ui/core/mvc/ControllerExtension"], function (ControllerExtension) {
    "use strict";

    // Object Page controller extension for the Sourcing Project app.
    //
    // Why this exists: `generateDraft` rewrites the project's Risks and Suggested
    // Suppliers composition tables on the server, but FE's declarative
    // `@Common.SideEffects.TargetEntities` does not reliably re-fetch those Object Page
    // table sections in UI5 1.150 — they stay showing "no entries" until a manual page
    // reload. This extension explicitly refreshes the whole Object Page after any bound
    // action completes, so the tables repopulate in place (belt-and-braces alongside the
    // SideEffects annotation, which still handles the header fields).
    //
    // Registered via manifest sap.ui5/extends/extensions/sap.ui.controllerExtensions on
    // sap.fe.templates.ObjectPage.ObjectPageController. The file MUST be named
    // *.controller.js for FE to load it as an extension controller.
    return ControllerExtension.extend("poc.sp.hub.sourcingproject.ext.controller.ObjectPageExt", {
        override: {
            editFlow: {
                // Fires after a bound action (generateDraft / approve / submitToS4)
                // completes. Refreshing after any of them is harmless; the one that
                // needs it is generateDraft (it rewrites risks + suppliers).
                onAfterActionExecution: function () {
                    try {
                        var oExtensionAPI = this.base && this.base.getExtensionAPI && this.base.getExtensionAPI();
                        if (oExtensionAPI && oExtensionAPI.refresh) {
                            // No args → refresh the bound context and its dependents
                            // (header + all Object Page tables).
                            oExtensionAPI.refresh();
                        }
                    } catch (e) {
                        // The backend write already succeeded; a refresh hiccup must never
                        // surface as an action failure. Swallow and rely on the user's next
                        // navigation/reload as a fallback.
                        if (window.console && window.console.warn) {
                            window.console.warn("ObjectPageExt: post-action refresh failed", e);
                        }
                    }
                }
            }
        }
    });
});
