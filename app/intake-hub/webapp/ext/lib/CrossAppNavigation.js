sap.ui.define([], function () {
  "use strict";

  /**
   * Deep-links between the four sourcing Fiori apps must not hardcode an
   * HTML5-repo-runtime path (e.g. "/poc.sp.hub.requirementworkspace/index.html").
   * That only resolves when the standalone approuter (or html5-apps-repo
   * directly) serves the app at its own root. Under the SAP Build Work Zone
   * managed launchpad, apps are only reachable via FLP semantic-object/action
   * intents (e.g. "#RequirementWorkspace-manage"), so a raw path 404s there.
   *
   * This helper resolves the shell's CrossApplicationNavigation service when
   * running inside a launchpad (Work Zone or any FLP) and falls back to the
   * old direct path only when no shell container is present (e.g. local
   * `cds watch` dev testing outside any launchpad).
   */
  return {
    /**
     * Opens a blank tab SYNCHRONOUSLY. Call this FIRST, directly inside the
     * click/press handler, before any async work (an OData read, a service
     * lookup, a MessageBox callback) — then pass the returned handle to
     * openIntent() once the target URL is known. Some browsers silently drop
     * (rather than block) a `window.open(url)` called after even one
     * promise-tick removed from the original user gesture: a tab opens but is
     * never navigated, hanging on "about:blank" forever (verified live).
     * Opening blank while still inside the handler's synchronous call stack
     * keeps the window handle valid for a later `.location.href` assignment
     * regardless of how much async work happens in between.
     *
     * @returns {Window|null} the new tab's window handle, or null if the
     *   browser blocked the popup outright (openIntent falls back to a plain
     *   window.open(url) in that case, which at least gives the user a
     *   permission prompt instead of silently doing nothing).
     */
    openBlankTab: function () {
      return window.open("", "_blank");
    },

    /**
     * Navigate to another app's semantic-object/action intent, opened in a
     * new browser tab/window (matches the previous window.open behaviour).
     *
     * @param {string} sSemanticObject e.g. "RequirementWorkspace"
     * @param {string} sAction e.g. "manage"
     * @param {object} [mParams] navigation parameters, e.g. { workspace: sId }
     * @param {string} sFallbackPath direct HTML5 path used when no shell container
     *   is present, e.g. "/poc.sp.hub.requirementworkspace/index.html?workspace=..."
     * @param {Window} [oNewTab] a tab opened earlier via openBlankTab(), still
     *   inside the same user gesture. When omitted, a plain window.open(url)
     *   is used instead — safe only when openIntent itself runs synchronously
     *   from the press handler with no prior async work.
     */
    openIntent: function (sSemanticObject, sAction, mParams, sFallbackPath, oNewTab) {
      if (sap.ushell && sap.ushell.Container) {
        sap.ushell.Container.getServiceAsync("CrossApplicationNavigation").then(function (oService) {
          var sHash = oService.hrefForExternal({
            target: { semanticObject: sSemanticObject, action: sAction },
            params: mParams || {}
          });
          // hrefForExternal returns just the shell-relative hash (e.g.
          // "#RequirementWorkspace-manage?workspace=..."), meant to be applied to
          // the CURRENT window's location. A fresh tab has no shell state to
          // resolve it against.
          //
          // window.location.pathname is NOT a usable site root: this app itself
          // is loaded at "/cp.portal/ui5appruntime.html" (the app-runtime iframe
          // route), never at the real site entry point ("/site?siteId=..."), so
          // reusing the current path opened a fresh, contextless app-runtime page
          // that 500'd (verified live). The real entry point is "/site", with the
          // siteId carried as a query parameter on every page Work Zone renders
          // (app-runtime included) — read it off the current URL instead.
          var sSiteId = new URLSearchParams(window.location.search).get("siteId");
          var sSiteUrl =
            window.location.origin + "/site" + (sSiteId ? "?siteId=" + encodeURIComponent(sSiteId) : "");
          if (oNewTab) {
            oNewTab.location.href = sSiteUrl + sHash;
          } else {
            window.open(sSiteUrl + sHash, "_blank");
          }
        });
        return;
      }
      if (oNewTab) {
        oNewTab.location.href = sFallbackPath;
      } else {
        window.open(sFallbackPath, "_blank");
      }
    }
  };
});
