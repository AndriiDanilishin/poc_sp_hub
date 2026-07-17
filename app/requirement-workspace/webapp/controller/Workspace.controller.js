sap.ui.define(
    [
        "sap/ui/core/mvc/Controller",
        "sap/m/MessageToast",
        "sap/m/MessageBox",
        "sap/m/Dialog",
        "sap/m/Button",
        "sap/m/List",
        "sap/m/CustomListItem",
        "sap/m/VBox",
        "sap/m/Text",
        "sap/m/Label",
        "sap/m/Input",
        "sap/m/ObjectAttribute",
        "sap/ui/model/Filter",
        "sap/ui/model/FilterOperator"
    ],
    function (
        Controller,
        MessageToast,
        MessageBox,
        Dialog,
        Button,
        List,
        CustomListItem,
        VBox,
        Text,
        Label,
        Input,
        ObjectAttribute,
        Filter,
        FilterOperator
    ) {
        "use strict";

        return Controller.extend("poc.sp.hub.requirementworkspace.controller.Workspace", {
            formatter: {
                confidencePercent: function (vScore) {
                    if (vScore === null || vScore === undefined) {
                        return "—";
                    }
                    return Math.round(Number(vScore) * 100) + " %";
                },
                // Thresholds from docs/solution-architecture.md §19.
                confidenceState: function (vScore) {
                    if (vScore === null || vScore === undefined) {
                        return "None";
                    }
                    var n = Number(vScore);
                    return n >= 0.8 ? "Success" : n >= 0.5 ? "Warning" : "Error";
                },
                aiStatusState: function (sStatus) {
                    switch (sStatus) {
                        case "ACCEPTED":
                            return "Success";
                        case "EDITED":
                            return "Information";
                        case "REJECTED":
                            return "Error";
                        case "PROPOSED":
                            return "Warning";
                        default:
                            return "None";
                    }
                }
            },

            onInit: function () {
                // The "ui" state model is created in Component.init before this view.
                // Pick a default workspace once the Select has data (prefer OPEN ones).
                var oSelect = this.byId("workspaceSelect");
                var that = this;
                var fnAttach = function () {
                    var oBinding = oSelect.getBinding("items");
                    if (!oBinding) {
                        setTimeout(fnAttach, 100);
                        return;
                    }
                    oBinding.attachEventOnce("dataReceived", function () {
                        setTimeout(function () {
                            that._selectDefaultWorkspace();
                        }, 0);
                    });
                };
                fnAttach();
            },

            _selectDefaultWorkspace: function () {
                var oSelect = this.byId("workspaceSelect");
                var aItems = oSelect.getItems();
                if (!aItems.length) {
                    return;
                }
                var oDefault =
                    aItems.find(function (oItem) {
                        var oCtx = oItem.getBindingContext();
                        return oCtx && oCtx.getProperty("status") === "OPEN";
                    }) || aItems[0];
                oSelect.setSelectedItem(oDefault);
                this._applyWorkspace(oDefault);
            },

            onWorkspaceChange: function (oEvent) {
                this._applyWorkspace(oEvent.getParameter("selectedItem"));
            },

            _applyWorkspace: function (oItem) {
                if (!oItem) {
                    return;
                }
                var oCtx = oItem.getBindingContext();
                var oUiModel = this.getView().getModel("ui");
                oUiModel.setProperty("/workspaceId", oCtx.getProperty("ID"));
                oUiModel.setProperty("/workspaceStatus", oCtx.getProperty("status"));
                oUiModel.setProperty("/selCount", 0);
                this._rebindTable();
            },

            _getTable: function () {
                return this.byId("reqTable");
            },

            _rebindTable: function () {
                var oTable = this._getTable();
                // rebind() is the public API in current versions; keep a fallback.
                (oTable.rebind || oTable._rebind).call(oTable);
            },

            _refreshTable: function () {
                var oTable = this._getTable();
                if (oTable.clearSelection) {
                    oTable.clearSelection();
                }
                this.getView().getModel("ui").setProperty("/selCount", 0);
                var oBinding = oTable.getRowBinding && oTable.getRowBinding();
                if (oBinding) {
                    oBinding.refresh();
                }
            },

            onSelectionChange: function () {
                var iCount = this._getTable().getSelectedContexts().length;
                this.getView().getModel("ui").setProperty("/selCount", iCount);
            },

            _selectedContexts: function () {
                return this._getTable().getSelectedContexts();
            },

            // Unbound OData action helper (merge/split/reject/regenerate/promote all
            // take explicit params — see srv/workspace-service.cds).
            _callAction: function (sName, mParams) {
                var oOperation = this.getView().getModel().bindContext("/" + sName + "(...)");
                Object.keys(mParams || {}).forEach(function (sKey) {
                    oOperation.setParameter(sKey, mParams[sKey]);
                });
                var pInvoke = oOperation.invoke ? oOperation.invoke() : oOperation.execute();
                return pInvoke.then(function () {
                    var oCtx = oOperation.getBoundContext();
                    return oCtx && oCtx.getObject ? oCtx.getObject() : undefined;
                });
            },

            _showError: function (oError) {
                var sMessage =
                    (oError && oError.error && oError.error.message) ||
                    (oError && oError.message) ||
                    String(oError);
                MessageBox.error(sMessage);
            },

            onAccept: function () {
                var that = this;
                var aPatches = this._selectedContexts().map(function (oCtx) {
                    // Explicit aiStatus keeps ACCEPTED (the service's before-UPDATE hook
                    // only auto-marks EDITED when aiStatus is not part of the patch).
                    return oCtx.setProperty("aiStatus", "ACCEPTED");
                });
                Promise.all(aPatches)
                    .then(function () {
                        MessageToast.show(aPatches.length + " requirement(s) accepted.");
                        that._refreshTable();
                    })
                    .catch(this._showError.bind(this));
            },

            onMerge: function () {
                var that = this;
                var aContexts = this._selectedContexts();
                var aIds = aContexts.map(function (oCtx) {
                    return oCtx.getProperty("ID");
                });
                MessageBox.confirm(
                    "Merge " + aIds.length + " requirements? The first selected row survives and inherits all source links.",
                    {
                        title: "Merge Requirements",
                        onClose: function (sAction) {
                            if (sAction !== MessageBox.Action.OK) {
                                return;
                            }
                            that._callAction("merge", { ids: aIds })
                                .then(function () {
                                    MessageToast.show("Requirements merged.");
                                    that._refreshTable();
                                })
                                .catch(that._showError.bind(that));
                        }
                    }
                );
            },

            onSplit: function () {
                var that = this;
                var sId = this._selectedContexts()[0].getProperty("ID");
                this._callAction("split", { id: sId })
                    .then(function () {
                        MessageToast.show("Requirement split — adjust quantities on both rows.");
                        that._refreshTable();
                    })
                    .catch(this._showError.bind(this));
            },

            onReject: function () {
                var that = this;
                var sId = this._selectedContexts()[0].getProperty("ID");
                this._callAction("reject", { id: sId })
                    .then(function () {
                        MessageToast.show("AI proposal rejected — fields cleared for manual entry.");
                        that._refreshTable();
                    })
                    .catch(this._showError.bind(this));
            },

            onRegenerate: function () {
                var that = this;
                var oPage = this.byId("page");
                var sId = this._selectedContexts()[0].getProperty("ID");
                oPage.setBusy(true);
                this._callAction("regenerate", { id: sId })
                    .then(function () {
                        MessageToast.show("AI enrichment regenerated — review the new proposal.");
                        that._refreshTable();
                    })
                    .catch(this._showError.bind(this))
                    .finally(function () {
                        oPage.setBusy(false);
                    });
            },

            onDelete: function () {
                var that = this;
                var aContexts = this._selectedContexts();
                MessageBox.confirm("Delete " + aContexts.length + " requirement(s)?", {
                    title: "Delete Requirements",
                    onClose: function (sAction) {
                        if (sAction !== MessageBox.Action.OK) {
                            return;
                        }
                        Promise.all(
                            aContexts.map(function (oCtx) {
                                return oCtx.delete();
                            })
                        )
                            .then(function () {
                                MessageToast.show("Deleted.");
                                that.getView().getModel("ui").setProperty("/selCount", 0);
                            })
                            .catch(that._showError.bind(that));
                    }
                });
            },

            onPromote: function () {
                var that = this;
                var sWorkspaceId = this.getView().getModel("ui").getProperty("/workspaceId");
                MessageBox.confirm(
                    "Promote all accepted/edited requirements of this workspace into a new Sourcing Project?",
                    {
                        title: "Promote to Sourcing Project",
                        onClose: function (sAction) {
                            if (sAction !== MessageBox.Action.OK) {
                                return;
                            }
                            that._callAction("promoteToSourcingProject", { workspaceId: sWorkspaceId })
                                .then(function (oResult) {
                                    that._onPromoted(oResult);
                                })
                                .catch(that._showError.bind(that));
                        }
                    }
                );
            },

            _onPromoted: function (oResult) {
                var that = this;
                var sProjectId = oResult && oResult.sourcingProjectId;
                var iCopied = (oResult && oResult.requirementsCopied) || 0;

                // The workspace is ARCHIVED now — refresh the selector and status.
                this.byId("workspaceSelect").getBinding("items").refresh();
                this.getView().getModel("ui").setProperty("/workspaceStatus", "ARCHIVED");
                this._refreshTable();

                MessageBox.success(
                    iCopied + " requirement(s) copied into the new Sourcing Project.",
                    {
                        title: "Promoted",
                        actions: ["Open Project", MessageBox.Action.CLOSE],
                        emphasizedAction: "Open Project",
                        onClose: function (sAction) {
                            if (sAction === "Open Project" && sProjectId) {
                                window.open(
                                    "/poc.sp.hub.sourcingproject/index.html#/SourcingProjects(" + sProjectId + ")",
                                    "_blank"
                                );
                            }
                        }
                    }
                );
            },

            // --- Sources (traceability, §18/§19) -------------------------------

            onShowSources: function () {
                var oCtx = this._selectedContexts()[0];
                var sId = oCtx.getProperty("ID");
                var oList = new List({
                    noDataText: "No source links recorded for this requirement."
                });
                oList.setModel(this.getView().getModel());
                oList.bindItems({
                    path: "/RequirementSources",
                    parameters: { $expand: "document($select=fileName,originType)" },
                    filters: [new Filter("requirement_ID", FilterOperator.EQ, sId)],
                    template: new CustomListItem({
                        content: [
                            new VBox({
                                items: [
                                    new Text({ text: "{rawSnippet}" }).addStyleClass("sapUiTinyMarginTop"),
                                    new ObjectAttribute({ title: "Location", text: "{location}" }),
                                    new ObjectAttribute({
                                        title: "Document",
                                        text: "{document/fileName} ({document/originType})"
                                    })
                                ]
                            }).addStyleClass("sapUiSmallMargin")
                        ]
                    })
                });

                var oDialog = new Dialog({
                    title: "Requirement Sources",
                    contentWidth: "36rem",
                    content: [oList],
                    endButton: new Button({
                        text: "Close",
                        press: function () {
                            oDialog.close();
                        }
                    }),
                    afterClose: function () {
                        oDialog.destroy();
                    }
                });
                this.getView().addDependent(oDialog);
                oDialog.open();
            },

            // --- Edit (inline curation, §19) ------------------------------------

            onEdit: function () {
                var that = this;
                var oCtx = this._selectedContexts()[0];
                var oData = oCtx.getObject();

                var oDescription = new Input({ value: oData.description || "" });
                var oQuantity = new Input({ value: oData.quantity != null ? String(oData.quantity) : "", type: "Number" });
                var oUnit = new Input({ value: oData.unit || "" });
                var oDate = new Input({ value: oData.requestedDate || "", placeholder: "YYYY-MM-DD" });

                var oDialog = new Dialog({
                    title: "Edit Requirement",
                    contentWidth: "26rem",
                    content: [
                        new VBox({
                            items: [
                                new Label({ text: "Description", labelFor: oDescription }),
                                oDescription,
                                new Label({ text: "Quantity", labelFor: oQuantity }).addStyleClass("sapUiTinyMarginTop"),
                                oQuantity,
                                new Label({ text: "Unit", labelFor: oUnit }).addStyleClass("sapUiTinyMarginTop"),
                                oUnit,
                                new Label({ text: "Requested Date", labelFor: oDate }).addStyleClass("sapUiTinyMarginTop"),
                                oDate
                            ]
                        }).addStyleClass("sapUiSmallMargin")
                    ],
                    beginButton: new Button({
                        text: "Save",
                        type: "Emphasized",
                        press: function () {
                            var aPatches = [];
                            var sQty = oQuantity.getValue();
                            // The service's before-UPDATE hook marks the row EDITED (§19, §25).
                            if (oDescription.getValue() !== (oData.description || "")) {
                                aPatches.push(oCtx.setProperty("description", oDescription.getValue()));
                            }
                            if (sQty !== (oData.quantity != null ? String(oData.quantity) : "")) {
                                aPatches.push(oCtx.setProperty("quantity", sQty === "" ? null : sQty));
                            }
                            if (oUnit.getValue() !== (oData.unit || "")) {
                                aPatches.push(oCtx.setProperty("unit", oUnit.getValue()));
                            }
                            if (oDate.getValue() !== (oData.requestedDate || "")) {
                                aPatches.push(oCtx.setProperty("requestedDate", oDate.getValue() || null));
                            }
                            oDialog.close();
                            if (!aPatches.length) {
                                return;
                            }
                            Promise.all(aPatches)
                                .then(function () {
                                    MessageToast.show("Requirement updated (marked EDITED).");
                                    that._refreshTable();
                                })
                                .catch(that._showError.bind(that));
                        }
                    }),
                    endButton: new Button({
                        text: "Cancel",
                        press: function () {
                            oDialog.close();
                        }
                    }),
                    afterClose: function () {
                        oDialog.destroy();
                    }
                });
                this.getView().addDependent(oDialog);
                oDialog.open();
            }
        });
    }
);
