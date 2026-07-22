sap.ui.define(["sap/m/MessageBox"], function (MessageBox) {
  "use strict";

  /**
   * Placeholder handler for the document chat section.
   *
   * This is generator scaffolding, not a feature. The RAG chat this section is
   * meant to host is not implemented: the modules it would need
   * (`srv/lib/embedder.js`, `srv/lib/vector_search.js`) were removed on this
   * branch, and the live AI stack (`srv/ai/`) targets the `sourcing` namespace,
   * not the Phase 0 `workspace` one this app reads from.
   *
   * Kept — rather than deleted — because `docs/solution-architecture.md` §29
   * keeps this app as the template for the intake pattern. See TASK-UX.md for
   * the full picture and the options for its future.
   */
  return {
    /**
     * Explains that chat is unimplemented, instead of the generator's
     * "Custom handler invoked" toast, which read like a working feature.
     *
     * @param {sap.ui.base.Event} oEvent the button press event
     */
    onPress: function (oEvent) {
      var oBundle = oEvent.getSource().getModel("i18n").getResourceBundle();
      MessageBox.information(oBundle.getText("chatNotImplementedDetail"), {
        title: oBundle.getText("chatNotImplementedTitle")
      });
    }
  };
});
