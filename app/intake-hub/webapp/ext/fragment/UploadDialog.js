sap.ui.define(
  [
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "poc/sp/hub/intakehub/ext/lib/ActionRunner",
    "poc/sp/hub/intakehub/ext/lib/WorkspacePicker"
  ],
  function (Fragment, MessageToast, MessageBox, ActionRunner, WorkspacePicker) {
    "use strict";

    var UPLOAD_FRAGMENT_ID = "uploadDialogFrag";
    var NEW_WS_FRAGMENT_ID = "newWorkspaceFrag";

    // Must match MAX_UPLOAD_BYTES in srv/intake-service.js and the FileUploader's
    // maximumFileSize in the fragment. The client check is a UX affordance; the
    // server is the actual control.
    var MAX_UPLOAD_MB = 10;

    // Extensions the FileUploader accepts. Single source of truth: the
    // FileUploader's `fileType`, the hint text and the maps below must all agree,
    // or picking a listed-but-unaccepted file fires typeMissmatch and the user
    // gets an error about a file they were told was supported.
    //
    // Deliberately absent: xlsx/xls (the npm `xlsx` package is abandoned with two
    // unfixed high-severity advisories — see TASK.md; binary Excel fails with a
    // "re-save as CSV" message) and images (OCR is a Phase-2 stub, §17).
    var ACCEPTED_EXTENSIONS = ["pdf", "csv", "tsv", "eml", "json", "txt", "md", "xml"];

    // Extension → originType used to pre-fill the form from the picked file.
    // The user can still override every field afterwards.
    var ORIGIN_BY_EXTENSION = {
      eml: "Email",
      csv: "Excel",
      tsv: "Excel",
      json: "RestApi",
      pdf: "Pdf",
      txt: "Text",
      md: "Text",
      xml: "Text"
    };

    // Formats we send as bytes rather than text. Everything else is read in the
    // browser as text and posted through uploadDocument's `content` parameter,
    // which also lets the Object Page show a content preview.
    var BINARY_EXTENSIONS = ["pdf"];

    function extensionOf(sFileName) {
      var iDot = (sFileName || "").lastIndexOf(".");
      return iDot > -1 ? sFileName.slice(iDot + 1).toLowerCase() : "";
    }

    /**
     * Build a controller for one upload dialog, bound to one ExtensionAPI.
     *
     * This module is a singleton shared by the whole component, so neither the
     * dialog nor the ExtensionAPI may live at module scope: the ExtensionAPI
     * belongs to a single List Report instance, and a cached dialog could outlive
     * the view it was built against (leaving refresh() pointed at a destroyed
     * view). Everything below is therefore per-invocation, and the dialog is
     * destroyed on close.
     */
    function createController(oExtensionAPI) {
      var oDialog = null;
      var oNewWsDialog = null;
      var oPickedFile = null;

      function i18n(sKey, aArgs) {
        return oExtensionAPI
          .getModel("i18n")
          .getResourceBundle()
          .getText(sKey, aArgs);
      }

      var oController = {
        // Children of a fragment loaded with an id are addressed via Fragment.byId,
        // not the ExtensionAPI's view-scoped byId.
        byId: function (sLocalId) {
          return Fragment.byId(UPLOAD_FRAGMENT_ID, sLocalId);
        },

        /** Exposes the bundle to the opener, which fills in the size-cap hint. */
        getText: function (sKey, aArgs) {
          return i18n(sKey, aArgs);
        },

        newWsById: function (sLocalId) {
          return Fragment.byId(NEW_WS_FRAGMENT_ID, sLocalId);
        },

        setDialog: function (oDlg) {
          oDialog = oDlg;
        },

        onCancelUpload: function () {
          if (oDialog) {
            oDialog.close();
          }
        },

        // -- file picking ----------------------------------------------------

        /**
         * Pre-fill file name, file type and origin type from the picked file, so
         * the user does not retype what the browser already knows (and cannot
         * mistype them into a parser mismatch).
         */
        onFileSelected: function (oEvent) {
          var aFiles = oEvent.getParameter("files");
          oPickedFile = aFiles && aFiles.length ? aFiles[0] : null;
          if (!oPickedFile) {
            return;
          }
          var sExt = extensionOf(oPickedFile.name);
          oController.byId("uploadFileName").setValue(oPickedFile.name);
          oController.byId("uploadFileType").setValue(sExt);
          if (ORIGIN_BY_EXTENSION[sExt]) {
            oController.byId("uploadOriginType").setSelectedKey(ORIGIN_BY_EXTENSION[sExt]);
          }
        },

        onFileTypeMissmatch: function () {
          oPickedFile = null;
          // Its own message: reusing the size error here told the user their file
          // was too large when the real problem was the extension.
          MessageBox.error(
            i18n("validationFileTypeUnsupported", [ACCEPTED_EXTENSIONS.join(", ")])
          );
        },

        onFileSizeExceed: function () {
          oPickedFile = null;
          MessageBox.error(i18n("validationFileTooLarge", [MAX_UPLOAD_MB]));
        },

        // -- inline workspace creation ---------------------------------------

        onNewWorkspace: function () {
          var pDialog = oNewWsDialog
            ? Promise.resolve(oNewWsDialog)
            : oExtensionAPI
                .loadFragment({
                  id: NEW_WS_FRAGMENT_ID,
                  name: "poc.sp.hub.intakehub.ext.fragment.NewWorkspaceDialog",
                  controller: oController
                })
                .then(function (oControl) {
                  oNewWsDialog = Array.isArray(oControl) ? oControl[0] : oControl;
                  return oNewWsDialog;
                });

          pDialog.then(function (oDlg) {
            oController.newWsById("newWorkspaceTitle").setValue("");
            oController.newWsById("newWorkspaceCreateBtn").setEnabled(false);
            oDlg.open();
          });
        },

        onNewWorkspaceTitleChange: function (oEvent) {
          var sTitle = (oEvent.getParameter("value") || "").trim();
          oController.newWsById("newWorkspaceCreateBtn").setEnabled(sTitle.length > 0);
        },

        onCancelNewWorkspace: function () {
          if (oNewWsDialog) {
            oNewWsDialog.close();
          }
        },

        /**
         * Create an OPEN workspace via IntakeService.createWorkspace without
         * leaving the Intake Hub, then select it in the upload dialog's picker.
         * The RequirementWorkspaces projection blocks raw POSTs, so creation goes
         * through the action — mirroring how uploadDocument works.
         */
        onConfirmNewWorkspace: function () {
          var sTitle = (oController.newWsById("newWorkspaceTitle").getValue() || "").trim();
          var oCreateBtn = oController.newWsById("newWorkspaceCreateBtn");
          oCreateBtn.setEnabled(false);

          ActionRunner.invoke(oExtensionAPI.getModel(), "createWorkspace", { title: sTitle })
            .then(function (oResult) {
              MessageToast.show(i18n("newWorkspaceCreated", [sTitle]));
              oNewWsDialog.close();
              WorkspacePicker.selectById(oController.byId("uploadWorkspaceSelect"), oResult.ID);
            })
            .catch(function (oError) {
              MessageBox.error(ActionRunner.describeError(oError, i18n("newWorkspaceFailed")));
              oCreateBtn.setEnabled(true);
            });
        },

        // -- upload ----------------------------------------------------------

        /**
         * Clear a field's error state as soon as the user types in it, so a
         * corrected field stops looking wrong before they resubmit.
         */
        onFieldChange: function (oEvent) {
          oEvent.getSource().setValueState("None");
        },

        /**
         * Validate inline, at the field, rather than through a chain of modal
         * MessageBoxes — three empty fields used to cost three dismissals, and a
         * MessageBox cannot point at which field is wrong. Focuses the first
         * offender so keyboard users land on the problem.
         *
         * @returns {boolean} true when the form may be submitted
         */
        _validate: function (bHasContent) {
          var aChecks = [
            ["uploadWorkspaceSelect", "getSelectedKey", "validationNoWorkspace"],
            ["uploadFileName", "getValue", "validationNoFileName"]
          ];
          var aInvalid = [];

          aChecks.forEach(function (aCheck) {
            var oControl = oController.byId(aCheck[0]);
            if (!(oControl[aCheck[1]]() || "").trim()) {
              oControl.setValueState("Error");
              oControl.setValueStateText(i18n(aCheck[2]));
              aInvalid.push(oControl);
            } else {
              oControl.setValueState("None");
            }
          });

          // Content has no single owning field — it comes from either the file
          // picker or the text area — so it stays a message, flagged on the
          // text area as the field the user can act on directly.
          if (!bHasContent) {
            var oContentArea = oController.byId("uploadContent");
            oContentArea.setValueState("Error");
            oContentArea.setValueStateText(i18n("validationNoContent"));
            aInvalid.push(oContentArea);
          }

          if (aInvalid.length) {
            aInvalid[0].focus();
            return false;
          }
          return true;
        },

        onConfirmUpload: function () {
          var oModel = oExtensionAPI.getModel();
          var sWorkspaceId = oController.byId("uploadWorkspaceSelect").getSelectedKey();
          var sOriginType = oController.byId("uploadOriginType").getSelectedKey();
          var sFileName = (oController.byId("uploadFileName").getValue() || "").trim();
          var sFileType = (oController.byId("uploadFileType").getValue() || "").trim();
          var sContent = oController.byId("uploadContent").getValue();
          var bAutoExtract = oController.byId("uploadAutoExtract").getSelected();

          if (!oController._validate(Boolean(oPickedFile || sContent))) {
            return;
          }

          var oConfirmBtn = oController.byId("uploadConfirmBtn");
          var bSucceeded = false;
          oConfirmBtn.setEnabled(false);
          oDialog.setBusy(true);

          // A picked file is read here so text formats can travel through the
          // action's `content` (giving the Object Page a preview), while binary
          // formats are PUT to the media stream after the row exists.
          oController
            ._resolveContent(sContent)
            .then(function (mContent) {
              return ActionRunner.invoke(oModel, "uploadDocument", {
                workspaceId: sWorkspaceId,
                originType: sOriginType,
                fileName: sFileName,
                fileType: sFileType,
                content: mContent.text,
                fileSize: oPickedFile ? oPickedFile.size : null
              }).then(function (oDocument) {
                if (!mContent.binary) {
                  return oDocument;
                }
                return oController
                  ._putBinary(oDocument.ID, mContent.binary, oPickedFile.type || sFileType)
                  .then(function () {
                    return oDocument;
                  });
              });
            })
            .then(function (oDocument) {
              if (bAutoExtract) {
                return oController._extract(oModel, oDocument);
              }
              MessageToast.show(i18n("uploadSuccess"));
              return null;
            })
            .then(function () {
              bSucceeded = true;
              oExtensionAPI.refresh();
            })
            .catch(function (oError) {
              MessageBox.error(ActionRunner.describeError(oError, i18n("uploadFailed")));
            })
            .finally(function () {
              // Reset busy state BEFORE closing: close() fires afterClose, which
              // destroys the dialog and nulls `oDialog`. Touching it afterwards
              // was an order-dependent race that the `if (oDialog)` guard only
              // hid. On failure the dialog stays open so the user can correct
              // and retry without re-entering everything.
              oConfirmBtn.setEnabled(true);
              if (oDialog) {
                oDialog.setBusy(false);
                if (bSucceeded) {
                  oDialog.close();
                }
              }
            });
        },

        /**
         * Decide how the picked file travels: text formats are decoded here and
         * sent through the action; binary formats are returned as an ArrayBuffer
         * for the media-stream PUT. With no file, the pasted text is used as-is.
         */
        _resolveContent: function (sPastedText) {
          if (!oPickedFile) {
            return Promise.resolve({ text: sPastedText, binary: null });
          }
          var bBinary = BINARY_EXTENSIONS.indexOf(extensionOf(oPickedFile.name)) > -1;
          return new Promise(function (resolve, reject) {
            var oReader = new FileReader();
            oReader.onerror = function () {
              reject(oReader.error);
            };
            oReader.onload = function () {
              resolve(
                bBinary
                  ? { text: null, binary: oReader.result }
                  : { text: oReader.result, binary: null }
              );
            };
            if (bBinary) {
              oReader.readAsArrayBuffer(oPickedFile);
            } else {
              oReader.readAsText(oPickedFile);
            }
          });
        },

        /**
         * PUT the raw bytes to the document's OData media stream. Uses fetch
         * rather than the OData model because V4 has no client API for stream
         * properties; the CSRF token is taken from the model's existing session
         * so this stays inside CAP's auth handling.
         */
        _putBinary: function (sDocumentId, oArrayBuffer, sContentType) {
          var sUrl =
            "/api/intake/SourceDocuments(" + sDocumentId + ")/contentBinary";

          // Fetch a real token first. getHttpHeaders() returns the model's
          // CONFIGURED headers, not the token it holds at runtime, so the old
          // code effectively always sent the literal "Fetch" — which asks for a
          // token rather than presenting one. Harmless against this server (it
          // issues no CSRF token today, which is why binary upload worked), but
          // it would fail the moment CSRF is enforced in production.
          return fetch("/api/intake/", {
            method: "HEAD",
            headers: { "X-CSRF-Token": "Fetch" },
            credentials: "same-origin"
          })
            .then(function (oHead) {
              return oHead.headers.get("X-CSRF-Token") || "";
            })
            .catch(function () {
              return "";
            })
            .then(function (sToken) {
              var mHeaders = {
                "Content-Type": sContentType || "application/octet-stream"
              };
              if (sToken) {
                mHeaders["X-CSRF-Token"] = sToken;
              }
              return fetch(sUrl, {
                method: "PUT",
                headers: mHeaders,
                body: oArrayBuffer,
                credentials: "same-origin"
              });
            })
            .then(function (oResponse) {
              if (oResponse.ok) {
                return null;
              }
              return oResponse.text().then(function (sBody) {
                var sMessage = sBody;
                try {
                  sMessage = JSON.parse(sBody).error.message;
                } catch {
                  // Non-JSON error body — fall back to the raw text.
                }
                throw new Error(sMessage);
              });
            });
        },

        /** Run extraction immediately after upload (opt-in checkbox). */
        _extract: function (oModel, oDocument) {
          return ActionRunner.invoke(oModel, "extractRequirements", {
            documentId: oDocument.ID
          }).then(function (oResult) {
            if (oResult.status === "FAILED") {
              MessageBox.error(i18n("extractFailedStatus"));
            } else {
              MessageToast.show(i18n("extractSuccess", [oResult.itemsCreated]));
            }
          });
        },

        /** Called when the upload dialog closes; releases both dialogs. */
        onDialogClosed: function () {
          oPickedFile = null;
          if (oNewWsDialog) {
            oNewWsDialog.destroy();
            oNewWsDialog = null;
          }
          if (oDialog) {
            oDialog.destroy();
            oDialog = null;
          }
        }
      };

      return oController;
    }

    return {
      /**
       * List Report toolbar action. Opens the upload dialog, whose workspace
       * Select is populated from IntakeService.RequirementWorkspaces so the user
       * picks the target workspace for uploadDocument(workspaceId, …).
       */
      onOpenUpload: function () {
        var oExtensionAPI = this;
        var oController = createController(oExtensionAPI);

        oExtensionAPI
          .loadFragment({
            id: UPLOAD_FRAGMENT_ID,
            name: "poc.sp.hub.intakehub.ext.fragment.UploadDialog",
            controller: oController
          })
          .then(function (oControl) {
            var oDialog = Array.isArray(oControl) ? oControl[0] : oControl;
            oController.setDialog(oDialog);
            oDialog.attachAfterClose(oController.onDialogClosed);
            // The hint text takes the size cap as {0}; a declarative binding
            // passes no parameter, so it is filled in here where MAX_UPLOAD_MB is.
            oController.byId("uploadFileHint").setText(
              oController.getText("uploadFileHint", [MAX_UPLOAD_MB])
            );
            WorkspacePicker.bindOpenWorkspaces(oController.byId("uploadWorkspaceSelect"));
            oDialog.open();
          });
      }
    };
  }
);
