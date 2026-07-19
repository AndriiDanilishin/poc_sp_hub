sap.ui.define(
  ['sap/ui/core/Fragment', 'sap/m/MessageToast', 'sap/m/MessageBox'],
  function (Fragment, MessageToast, MessageBox) {
    'use strict';

    var FRAGMENT_ID = 'uploadDialogFrag';

    // The List Report custom action is invoked with `this` = the FE
    // ListReport.ExtensionAPI (no getView; it exposes getModel/byId/loadFragment/
    // refresh). loadFragment binds the fragment against the ExtensionAPI, which
    // does NOT own our dialog button handlers — so we pass an explicit controller
    // object (oDialogController) that does, and address children through it.
    var oExtensionAPI;
    var oDialog;

    var oDialogController = {
      byId: function (sLocalId) {
        // Children of a fragment loaded with id FRAGMENT_ID are addressed via
        // Fragment.byId, not the ExtensionAPI's view-scoped byId.
        return Fragment.byId(FRAGMENT_ID, sLocalId);
      },

      onCancelUpload: function () {
        if (oDialog) {
          oDialog.close();
        }
      },

      onConfirmUpload: function () {
        var oModel = oExtensionAPI.getModel();

        var sWorkspaceId = this.byId('uploadWorkspaceSelect').getSelectedKey();
        var sOriginType = this.byId('uploadOriginType').getSelectedKey();
        var sFileName = (this.byId('uploadFileName').getValue() || '').trim();
        var sFileType = (this.byId('uploadFileType').getValue() || '').trim();
        var sContent = this.byId('uploadContent').getValue();

        if (!sWorkspaceId) {
          MessageBox.error('Please choose a target workspace.');
          return;
        }
        if (!sFileName) {
          MessageBox.error('Please enter a file name.');
          return;
        }

        var oConfirmBtn = this.byId('uploadConfirmBtn');
        oConfirmBtn.setEnabled(false);

        var oAction = oModel.bindContext('/uploadDocument(...)');
        oAction.setParameter('workspaceId', sWorkspaceId);
        oAction.setParameter('originType', sOriginType);
        oAction.setParameter('fileName', sFileName);
        oAction.setParameter('fileType', sFileType);
        oAction.setParameter('content', sContent);

        oAction
          .execute()
          .then(function () {
            MessageToast.show('Document uploaded. Open it to run extraction.');
            if (oDialog) {
              oDialog.close();
            }
            oExtensionAPI.refresh();
          })
          .catch(function (oError) {
            MessageBox.error('Upload failed: ' + (oError.message || oError));
          })
          .finally(function () {
            oConfirmBtn.setEnabled(true);
          });
      }
    };

    return {
      /**
       * List Report toolbar action. Opens the upload dialog, whose workspace
       * Select is populated from IntakeService.RequirementWorkspaces so the user
       * picks the target workspace for uploadDocument(workspaceId, …).
       */
      onOpenUpload: function () {
        oExtensionAPI = this;

        var pDialog = oDialog
          ? Promise.resolve(oDialog)
          : this.loadFragment({
              id: FRAGMENT_ID,
              name: 'poc.sp.hub.intakehub.ext.fragment.UploadDialog',
              controller: oDialogController
            }).then(function (oControl) {
              oDialog = Array.isArray(oControl) ? oControl[0] : oControl;
              return oDialog;
            });

        pDialog.then(function (oDlg) {
          oDlg.open();
        });
      }
    };
  }
);
