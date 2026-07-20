sap.ui.define(
  [
    'sap/ui/core/Fragment',
    'sap/m/MessageToast',
    'sap/m/MessageBox',
    'sap/m/Dialog',
    'sap/m/Button',
    'sap/m/Input',
    'sap/m/Label',
    'sap/m/VBox'
  ],
  function (Fragment, MessageToast, MessageBox, Dialog, Button, Input, Label, VBox) {
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

      // Create a new OPEN workspace inline (via IntakeService.createWorkspace)
      // without leaving the Intake Hub, then select it in the upload dialog's
      // picker. The RequirementWorkspaces projection is @readonly, so creation
      // goes through the action — mirroring how uploadDocument works.
      onNewWorkspace: function () {
        var oExt = oExtensionAPI;
        var oCtl = this;
        var oTitleInput = new Input({ placeholder: 'e.g. Q4 Lab Equipment', width: '100%' });

        var oCreateBtn = new Button({
          text: 'Create',
          type: 'Emphasized',
          enabled: false,
          press: function () {
            var sTitle = (oTitleInput.getValue() || '').trim();
            oCreateBtn.setEnabled(false);

            var oAction = oExt.getModel().bindContext('/createWorkspace(...)');
            oAction.setParameter('title', sTitle);
            oAction
              .execute()
              .then(function () {
                var oResult = oAction.getBoundContext().getObject();
                MessageToast.show('Workspace "' + sTitle + '" created.');
                oNewWsDialog.close();
                // The picker is bound to OPEN workspaces; refresh so the new row
                // appears, then select it by key once its item resolves.
                oCtl._selectNewWorkspace(oResult.ID);
              })
              .catch(function (oError) {
                MessageBox.error('Could not create workspace: ' + (oError.message || oError));
                oCreateBtn.setEnabled(true);
              });
          }
        });
        // Guardrail: a workspace must have a non-empty title.
        oTitleInput.attachLiveChange(function () {
          oCreateBtn.setEnabled((oTitleInput.getValue() || '').trim().length > 0);
        });

        var oNewWsDialog = new Dialog({
          title: 'New Requirement Workspace',
          contentWidth: '26rem',
          content: [
            new VBox({
              items: [
                new Label({ text: 'Title', labelFor: oTitleInput, required: true }),
                oTitleInput
              ]
            }).addStyleClass('sapUiSmallMargin')
          ],
          beginButton: oCreateBtn,
          endButton: new Button({
            text: 'Cancel',
            press: function () {
              oNewWsDialog.close();
            }
          }),
          afterClose: function () {
            oNewWsDialog.destroy();
          }
        });
        oNewWsDialog.open();
      },

      // Select the freshly-created workspace in the picker. The new row isn't in
      // the Select's items synchronously after refresh(), so select by KEY (the
      // Select re-resolves it when items arrive) and re-apply on dataReceived.
      _selectNewWorkspace: function (sId) {
        var oSelect = this.byId('uploadWorkspaceSelect');
        var oBinding = oSelect.getBinding('items');
        oSelect.setSelectedKey(sId);
        if (oBinding) {
          var fnPick = function () {
            oSelect.setSelectedKey(sId);
            oBinding.detachDataReceived(fnPick);
          };
          oBinding.attachDataReceived(fnPick);
          oBinding.refresh();
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
