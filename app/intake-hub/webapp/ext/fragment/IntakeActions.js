sap.ui.define(['sap/m/MessageToast', 'sap/m/MessageBox'], function (MessageToast, MessageBox) {
  'use strict';

  return {
    /**
     * Calls IntakeService.extractRequirements(documentId) for the document
     * currently shown on the Object Page, then refreshes it so the updated
     * status/errorMsg are visible without a manual page reload.
     */
    onExtract: function (oEvent) {
      var oButton = oEvent.getSource();
      var oContext = oButton.getBindingContext();
      var oModel = oContext.getModel();
      var sDocumentId = oContext.getProperty('ID');

      oButton.setEnabled(false);

      var oActionBinding = oModel.bindContext('/extractRequirements(...)');
      oActionBinding.setParameter('documentId', sDocumentId);

      oActionBinding
        .execute()
        .then(function () {
          var oResult = oActionBinding.getBoundContext().getObject();
          if (oResult.status === 'FAILED') {
            MessageBox.error(
              'Extraction failed. See the Status field below for the error message.',
            );
          } else if (oResult.status === 'EXTRACTED') {
            MessageToast.show(oResult.itemsCreated + ' requirement(s) created in the Workspace.');
          }
          return oContext.requestRefresh();
        })
        .catch(function (oError) {
          MessageBox.error('Extraction failed: ' + (oError.message || oError));
        })
        .finally(function () {
          oButton.setEnabled(true);
        });
    },
  };
});
