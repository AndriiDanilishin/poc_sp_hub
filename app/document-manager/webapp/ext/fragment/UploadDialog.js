sap.ui.define(
  [
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "poc/sp/hub/documentmanager/ext/lib/ActionRunner"
  ],
  function (Fragment, MessageToast, MessageBox, ActionRunner) {
    "use strict";

    var FRAGMENT_ID = "kbUploadDialogFrag";

    // Must match MAX_UPLOAD_BYTES in srv/knowledge-service.js and the
    // FileUploader's maximumFileSize. The client check is a UX affordance; the
    // server is the control.
    var MAX_UPLOAD_MB = 10;

    // Single source of truth for the FileUploader's fileType, the hint text and
    // MEDIA_TYPE_BY_EXTENSION; must match PARSER_BY_EXTENSION on the server.
    var ACCEPTED_EXTENSIONS = ["pdf", "csv", "tsv", "eml", "json", "txt", "md"];

    // Content-Type for the stream PUT when the browser reports none (common for
    // .eml/.md on Windows). Each value is on the server's ALLOWED_MEDIA_TYPES.
    var MEDIA_TYPE_BY_EXTENSION = {
      pdf: "application/pdf",
      csv: "text/csv",
      tsv: "text/tab-separated-values",
      eml: "message/rfc822",
      json: "application/json",
      txt: "text/plain",
      md: "text/markdown"
    };

    function extensionOf(sFileName) {
      var iDot = (sFileName || "").lastIndexOf(".");
      return iDot > -1 ? sFileName.slice(iDot + 1).toLowerCase() : "";
    }

    /**
     * One controller per dialog invocation, bound to one ExtensionAPI. Nothing
     * lives at module scope (the module is a component-wide singleton, so a
     * cached dialog could outlive its view); the dialog is destroyed on close.
     */
    function createController(oExtensionAPI) {
      var oDialog = null;
      var oPickedFile = null;
      // Uploading is two requests: createFromFile makes the row, then the bytes
      // are PUT to it. If the PUT fails the row exists already, so pressing
      // Upload again re-PUTs to it instead of creating a duplicate document.
      var oPending = null;

      function i18n(sKey, aArgs) {
        return oExtensionAPI.getModel("i18n").getResourceBundle().getText(sKey, aArgs);
      }

      var oController = {
        byId: function (sLocalId) {
          return Fragment.byId(FRAGMENT_ID, sLocalId);
        },

        getText: i18n,

        setDialog: function (oDlg) {
          oDialog = oDlg;
        },

        onCancel: function () {
          if (oDialog) {
            oDialog.close();
          }
        },

        onFieldChange: function (oEvent) {
          oEvent.getSource().setValueState("None");
        },

        /** Pre-fill the title from the file name; the user can still change it. */
        onFileSelected: function (oEvent) {
          var aFiles = oEvent.getParameter("files");
          oPickedFile = aFiles && aFiles.length ? aFiles[0] : null;
          var oUploader = oController.byId("kbUploadFileUploader");
          oUploader.setValueState("None");
          if (!oPickedFile) {
            return;
          }
          var oTitle = oController.byId("kbUploadTitle");
          if (!oTitle.getValue()) {
            oTitle.setValue(oPickedFile.name.replace(/\.[^.]+$/, ""));
            oTitle.setValueState("None");
          }
        },

        onFileTypeMissmatch: function () {
          oPickedFile = null;
          MessageBox.error(i18n("validationFileTypeUnsupported", [ACCEPTED_EXTENSIONS.join(", ")]));
        },

        onFileSizeExceed: function () {
          oPickedFile = null;
          MessageBox.error(i18n("validationFileTooLarge", [MAX_UPLOAD_MB]));
        },

        /** Inline validation at the fields; focuses the first offender. */
        _validate: function () {
          var aInvalid = [];
          var oUploader = oController.byId("kbUploadFileUploader");
          if (!oPickedFile) {
            oUploader.setValueState("Error");
            oUploader.setValueStateText(i18n("validationNoFile"));
            aInvalid.push(oUploader);
          }
          [
            ["kbUploadCategory", "getSelectedKey", "validationNoCategory"],
            ["kbUploadTitle", "getValue", "validationNoTitle"]
          ].forEach(function (aCheck) {
            var oControl = oController.byId(aCheck[0]);
            if (!(oControl[aCheck[1]]() || "").trim()) {
              oControl.setValueState("Error");
              oControl.setValueStateText(i18n(aCheck[2]));
              aInvalid.push(oControl);
            }
          });
          if (aInvalid.length) {
            aInvalid[0].focus();
            return false;
          }
          return true;
        },

        onConfirmUpload: function () {
          if (!oController._validate()) {
            return;
          }
          var oModel = oExtensionAPI.getModel();
          var mParams = {
            category: oController.byId("kbUploadCategory").getSelectedKey(),
            title: oController.byId("kbUploadTitle").getValue().trim(),
            sourceRef: oController.byId("kbUploadSourceRef").getValue().trim() || undefined,
            fileName: oPickedFile.name,
            fileSize: oPickedFile.size
          };
          var sKey = JSON.stringify(mParams);
          var oConfirmBtn = oController.byId("kbUploadConfirmBtn");
          var bSucceeded = false;
          oConfirmBtn.setEnabled(false);
          oDialog.setBusy(true);

          var bResume = oPending && oPending.file === oPickedFile && oPending.key === sKey;
          var pDocument = bResume
            ? Promise.resolve(oPending.document)
            : ActionRunner.invoke(oModel, "createFromFile", mParams);

          pDocument
            .then(function (oDocument) {
              oPending = { document: oDocument, file: oPickedFile, key: sKey };
              return oController._readFile().then(function (oBuffer) {
                var sMediaType =
                  MEDIA_TYPE_BY_EXTENSION[extensionOf(oPickedFile.name)] ||
                  oPickedFile.type ||
                  "application/octet-stream";
                return oController
                  ._putBinary(oModel, oDocument.ID, oBuffer, sMediaType)
                  .then(
                    function () {
                      oPending = null;
                      return oDocument;
                    },
                    function (oError) {
                      oExtensionAPI.refresh();
                      throw new Error(
                        i18n("uploadBinaryFailed", [
                          ActionRunner.describeError(oError, i18n("uploadFailed"))
                        ])
                      );
                    }
                  );
              });
            })
            .then(function (oDocument) {
              return oController._reportIndexStatus(oModel, oDocument.ID);
            })
            .then(function () {
              bSucceeded = true;
              oExtensionAPI.refresh();
            })
            .catch(function (oError) {
              MessageBox.error(
                ActionRunner.describeError(oError, i18n("uploadFailed"), i18n("notCurator"))
              );
            })
            .finally(function () {
              // Reset busy before close(): afterClose destroys the dialog.
              oConfirmBtn.setEnabled(true);
              if (oDialog) {
                oDialog.setBusy(false);
                if (bSucceeded) {
                  oDialog.close();
                }
              }
            });
        },

        _readFile: function () {
          return new Promise(function (resolve, reject) {
            var oReader = new FileReader();
            oReader.onerror = function () {
              reject(oReader.error);
            };
            oReader.onload = function () {
              resolve(oReader.result);
            };
            oReader.readAsArrayBuffer(oPickedFile);
          });
        },

        /**
         * After the server parsed and embedded the file, tell the curator whether
         * the document is searchable — a parse failure (e.g. a PDF without a text
         * layer while OCR is unavailable) is a successful upload but not a
         * successful indexing.
         */
        _reportIndexStatus: function (oModel, sId) {
          var oBinding = oModel.bindContext(
            "/KnowledgeDocuments(ID=" + sId + ",IsActiveEntity=true)",
            null,
            { $select: "indexStatus,indexError", $$groupId: "$direct" }
          );
          return oBinding.requestObject().then(function (oDoc) {
            if (oDoc && oDoc.indexStatus === "FAILED") {
              MessageBox.warning(i18n("uploadIndexFailed", [oDoc.indexError || ""]));
            } else {
              MessageToast.show(i18n("uploadSuccess"));
            }
          });
        },

        /**
         * PUT the bytes to the document's media stream. fetch, because OData V4
         * has no client API for stream properties. The service root comes from
         * the model (never hardcoded) so an approuter prefix is respected, and a
         * real CSRF token is fetched first (see intake-hub UploadDialog.js).
         */
        _putBinary: function (oModel, sId, oArrayBuffer, sContentType) {
          var sServiceUrl = oModel.getServiceUrl();
          var sUrl = sServiceUrl + "KnowledgeDocuments(ID=" + sId + ",IsActiveEntity=true)/contentBinary";
          return fetch(sServiceUrl, {
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
              var mHeaders = { "Content-Type": sContentType };
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
                  // Non-JSON error body — keep the raw text.
                }
                var oError = new Error(sMessage || "HTTP " + oResponse.status);
                oError.status = oResponse.status;
                throw oError;
              });
            });
        },

        onDialogClosed: function () {
          oPickedFile = null;
          oPending = null;
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
       * List Report toolbar action. `this` is the ListReport ExtensionAPI (no
       * getView, no event argument), and loadFragment needs an explicit
       * controller that owns the dialog's handlers.
       */
      onOpenUpload: function () {
        var oExtensionAPI = this;
        var oController = createController(oExtensionAPI);
        oExtensionAPI
          .loadFragment({
            id: FRAGMENT_ID,
            name: "poc.sp.hub.documentmanager.ext.fragment.UploadDialog",
            controller: oController
          })
          .then(function (oControl) {
            var oDialog = Array.isArray(oControl) ? oControl[0] : oControl;
            oController.setDialog(oDialog);
            oDialog.attachAfterClose(oController.onDialogClosed);
            oController
              .byId("kbUploadHint")
              .setText(
                oController.getText("uploadFileHint", [MAX_UPLOAD_MB, ACCEPTED_EXTENSIONS.join(", ")])
              );
            oDialog.open();
          });
      }
    };
  }
);
