sap.ui.define(
  [
    'sap/m/MessageBox',
    'sap/m/MessageToast',
    'sap/m/Dialog',
    'sap/m/Button',
    'sap/m/Select',
    'sap/ui/core/Item',
    'sap/m/Label',
    'sap/m/VBox',
    'sap/ui/model/Filter',
    'sap/ui/model/FilterOperator',
  ],
  function (
    MessageBox,
    MessageToast,
    Dialog,
    Button,
    Select,
    Item,
    Label,
    VBox,
    Filter,
    FilterOperator,
  ) {
    'use strict';

    return {
    /**
     * Enables "Change Workspace" only before extraction. Once a document is
     * EXTRACTED its requirements already live in the current workspace, so the
     * backend blocks the move (§18) — mirror that in the button state.
     */
    formatMoveEnabled: function (sStatus) {
      return sStatus !== 'EXTRACTED';
    },

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
      var sWorkspaceId = oContext.getProperty('workspace_ID');

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
            // Hand off to the Requirement Workspace, deep-linked to this
            // document's workspace so all its new requirements are in view.
            MessageBox.success(
              oResult.itemsCreated + ' requirement(s) created in the Workspace.',
              {
                title: 'Extracted',
                actions: ['Open Workspace', MessageBox.Action.CLOSE],
                emphasizedAction: 'Open Workspace',
                onClose: function (sAction) {
                  if (sAction === 'Open Workspace' && sWorkspaceId) {
                    window.open(
                      '/poc.sp.hub.requirementworkspace/index.html?workspace=' + sWorkspaceId,
                      '_blank',
                    );
                  }
                },
              },
            );
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

    /**
     * Opens a dialog to move this document to a different (OPEN) workspace via
     * IntakeService.changeWorkspace. The backend blocks the move once the document
     * is EXTRACTED; the button is also disabled in that state, so this is the
     * pre-extraction affordance.
     */
    onChangeWorkspace: function (oEvent) {
      var oContext = oEvent.getSource().getBindingContext();
      var oModel = oContext.getModel();
      var sDocumentId = oContext.getProperty('ID');
      var sCurrentWs = oContext.getProperty('workspace_ID');

      // Guard up front (the button's `enabled` binding isn't reliably applied by
      // FE for custom-section fragments, so check here too). The backend enforces
      // this as well — this is just for an immediate, clear message.
      if (oContext.getProperty('status') === 'EXTRACTED') {
        MessageBox.information(
          'This document is already extracted — its requirements live in the current ' +
            'workspace. Delete them in the Requirement Workspace first, then move the document.',
        );
        return;
      }

      var oSelect = new Select({ width: '100%', forceSelection: false });
      oSelect.setModel(oModel);
      oSelect.bindItems({
        path: '/RequirementWorkspaces',
        parameters: { $orderby: 'createdAt desc' },
        filters: [new Filter('status', FilterOperator.EQ, 'OPEN')],
        template: new Item({ key: '{ID}', text: '{title}' }),
      });

      var oDialog = new Dialog({
        title: 'Change Workspace',
        contentWidth: '26rem',
        content: [
          new VBox({
            items: [
              new Label({ text: 'Move to workspace', labelFor: oSelect, required: true }),
              oSelect,
            ],
          }).addStyleClass('sapUiSmallMargin'),
        ],
        beginButton: new Button({
          text: 'Move',
          type: 'Emphasized',
          press: function () {
            var sNewWs = oSelect.getSelectedKey();
            if (!sNewWs) {
              MessageBox.error('Please choose a target workspace.');
              return;
            }
            if (sNewWs === sCurrentWs) {
              MessageBox.information('The document is already in that workspace.');
              return;
            }
            oDialog.close();
            var oAction = oModel.bindContext('/changeWorkspace(...)');
            oAction.setParameter('documentId', sDocumentId);
            oAction.setParameter('newWorkspaceId', sNewWs);
            oAction
              .execute()
              .then(function () {
                MessageToast.show('Document moved to the selected workspace.');
                return oContext.requestRefresh();
              })
              .catch(function (oError) {
                MessageBox.error('Could not move document: ' + (oError.message || oError));
              });
          },
        }),
        endButton: new Button({
          text: 'Cancel',
          press: function () {
            oDialog.close();
          },
        }),
        afterClose: function () {
          oDialog.destroy();
        },
      });
      oDialog.setModel(oModel);
      oDialog.open();
    },
  };
  }
);
