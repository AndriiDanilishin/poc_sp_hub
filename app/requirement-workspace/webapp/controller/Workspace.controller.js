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
        "sap/m/SelectDialog",
        "sap/m/StandardListItem",
        "sap/m/ProgressIndicator",
        "sap/ui/model/json/JSONModel",
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
        SelectDialog,
        StandardListItem,
        ProgressIndicator,
        JSONModel,
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
                },

                // A row blocks promotion when the AI is unsure (confidence < 0.5)
                // AND no human has reviewed it yet (still PROPOSED) — mirrors the
                // promoteToSourcingProject gate (§19). The four aiStatus* formatters
                // below fold that "needs review" signal into the single AI Status
                // ObjectStatus (text/state/icon/tooltip). This is deliberate: a
                // nested/second control's binding is NOT re-evaluated per row inside
                // an mdc ResponsiveTable column template (it fires once with
                // undefined), so gating must live on the one cell control whose
                // parts-binding the table does resolve per row.
                // NOTE: inside an mdc ResponsiveTable column-template formatter,
                // `this` is NOT the formatter object, so these must be standalone
                // (no `this.` sibling calls). The gate is inlined in each.
                aiStatusText: function (sStatus, vScore) {
                    var review = sStatus === "PROPOSED" && vScore != null && Number(vScore) < 0.5;
                    return review ? sStatus + " — review" : sStatus;
                },
                aiStatusStateGated: function (sStatus, vScore) {
                    if (sStatus === "PROPOSED" && vScore != null && Number(vScore) < 0.5) {
                        return "Error";
                    }
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
                },
                aiStatusIcon: function (sStatus, vScore) {
                    var review = sStatus === "PROPOSED" && vScore != null && Number(vScore) < 0.5;
                    return review ? "sap-icon://alert" : "";
                },
                aiStatusTooltip: function (sStatus, vScore) {
                    var review = sStatus === "PROPOSED" && vScore != null && Number(vScore) < 0.5;
                    return review
                        ? "Low AI confidence and not yet reviewed — blocks promotion until you Accept, Edit, or Reject it."
                        : "";
                }
            },

            onInit: function () {
                // The "ui" state model is created in Component.init before this view.
                // Pick a default workspace once the Select has data (prefer OPEN ones).
                // Careful: on a warm server the items may already be there before we
                // attach — check first, then listen, and only ever select once.
                // A ?workspace=<id> deep-link (e.g. from the Intake Hub hand-off)
                // overrides the default and pre-selects that workspace on arrival.
                this._sInitialWorkspaceId = this._readWorkspaceParam();
                var oSelect = this.byId("workspaceSelect");
                var that = this;
                var bDone = false;
                var fnSelectOnce = function () {
                    if (bDone || !oSelect.getItems().length) {
                        return;
                    }
                    bDone = true;
                    that._selectDefaultWorkspace();
                };
                var fnAttach = function () {
                    var oBinding = oSelect.getBinding("items");
                    if (!oBinding) {
                        setTimeout(fnAttach, 100);
                        return;
                    }
                    fnSelectOnce();
                    if (!bDone) {
                        oBinding.attachEvent("change", function () {
                            setTimeout(fnSelectOnce, 0);
                        });
                        oBinding.attachEvent("dataReceived", function () {
                            setTimeout(fnSelectOnce, 0);
                        });
                    }
                };
                fnAttach();
            },

            // Read a ?workspace=<id> deep-link from either the search string or the
            // hash query (the app runs behind a hash route), tolerant of both.
            _readWorkspaceParam: function () {
                try {
                    var sSearch = window.location.search || "";
                    var sHash = window.location.hash || "";
                    var iQ = sHash.indexOf("?");
                    var sHashQuery = iQ >= 0 ? sHash.slice(iQ) : "";
                    var sId =
                        new URLSearchParams(sSearch).get("workspace") ||
                        new URLSearchParams(sHashQuery).get("workspace");
                    return sId || null;
                } catch (e) {
                    return null;
                }
            },

            _selectDefaultWorkspace: function () {
                var oSelect = this.byId("workspaceSelect");
                var aItems = oSelect.getItems();
                if (!aItems.length) {
                    return;
                }
                // A deep-linked workspace wins over the OPEN-preferring default,
                // but only if it actually exists in the list; otherwise fall back.
                var sDeepLink = this._sInitialWorkspaceId;
                var oDefault =
                    (sDeepLink &&
                        aItems.find(function (oItem) {
                            var oCtx = oItem.getBindingContext();
                            return oCtx && oCtx.getProperty("ID") === sDeepLink;
                        })) ||
                    aItems.find(function (oItem) {
                        var oCtx = oItem.getBindingContext();
                        return oCtx && oCtx.getProperty("status") === "OPEN";
                    }) ||
                    aItems[0];
                oSelect.setSelectedKey(oDefault.getBindingContext().getProperty("ID"));
                this._applyWorkspace(oDefault);
            },

            onWorkspaceChange: function (oEvent) {
                this._applyWorkspace(oEvent.getParameter("selectedItem"));
            },

            // Create a new (OPEN) workspace via the writable RequirementWorkspaces
            // projection, then drop the user into it. New workspaces are always OPEN
            // — only promotion archives them (see onPromote / the service lifecycle).
            onCreateWorkspace: function () {
                var that = this;
                var oTitle = new Input({ placeholder: "e.g. Q4 Lab Equipment", width: "100%" });

                var oCreateButton = new Button({
                    text: "Create",
                    type: "Emphasized",
                    enabled: false,
                    press: function () {
                        var sTitle = oTitle.getValue().trim();
                        oDialog.close();
                        that._createWorkspace(sTitle);
                    }
                });
                // Guardrail: a workspace must have a non-empty title.
                oTitle.attachLiveChange(function () {
                    oCreateButton.setEnabled(oTitle.getValue().trim().length > 0);
                });

                var oDialog = new Dialog({
                    title: "New Requirement Workspace",
                    contentWidth: "26rem",
                    content: [
                        new VBox({
                            items: [
                                new Label({ text: "Title", labelFor: oTitle, required: true }),
                                oTitle
                            ]
                        }).addStyleClass("sapUiSmallMargin")
                    ],
                    beginButton: oCreateButton,
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
            },

            _createWorkspace: function (sTitle) {
                var that = this;
                var oListBinding = this.getView().getModel().bindList("/RequirementWorkspaces");
                var oContext = oListBinding.create({ title: sTitle, status: "OPEN" });
                oContext
                    .created()
                    .then(function () {
                        var sNewId = oContext.getProperty("ID");
                        MessageToast.show('Workspace "' + sTitle + '" created.');
                        that._selectWorkspaceById(sNewId);
                    })
                    .catch(this._showError.bind(this));
            },

            // Refresh the selector, then select the given workspace once its item
            // shows up. The created row isn't in getItems() synchronously after
            // refresh(), so select by KEY (which the Select re-resolves when items
            // arrive) and apply the workspace on dataReceived. A run-once guard plus
            // an immediate attempt covers both warm and cold binding states.
            _selectWorkspaceById: function (sId) {
                var that = this;
                var oSelect = this.byId("workspaceSelect");
                var oBinding = oSelect.getBinding("items");
                var bDone = false;
                var fnPick = function () {
                    if (bDone) {
                        return;
                    }
                    var oItem = oSelect.getItems().find(function (o) {
                        var oCtx = o.getBindingContext();
                        return oCtx && oCtx.getProperty("ID") === sId;
                    });
                    if (!oItem) {
                        return;
                    }
                    bDone = true;
                    oSelect.setSelectedKey(sId);
                    that._applyWorkspace(oItem);
                };
                if (oBinding) {
                    oBinding.attachEvent("dataReceived", fnPick);
                    oBinding.refresh();
                    // The created row may already be in the aggregation after refresh().
                    fnPick();
                }
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
            // take explicit params — see srv/workspace-service.cds). Pass sGroupId to
            // put the call in its own request group — required for bulk fan-out so
            // parallel invokes don't share (and cancel) one $auto batch.
            _callAction: function (sName, mParams, sGroupId) {
                var mBindingParams = sGroupId ? { $$groupId: sGroupId } : undefined;
                var oOperation = this.getView()
                    .getModel()
                    .bindContext("/" + sName + "(...)", undefined, mBindingParams);
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

            // Concurrency cap for bulk enrichment. AI enrichment is I/O-bound and each
            // backend regenerate() also runs master-data SELECTs — a small pool keeps
            // several in flight without hammering the server / AI provider. Tune if the
            // provider rate-limits.
            _ENRICH_CONCURRENCY: 4,

            onRegenerate: function () {
                var that = this;
                var aContexts = this._selectedContexts();
                if (!aContexts.length) {
                    return;
                }

                // Single selection: keep the original behavior verbatim (backward compat)
                // — one action call, the original toast, page-busy indicator.
                if (aContexts.length === 1) {
                    var oPage = this.byId("page");
                    var sId = aContexts[0].getProperty("ID");
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
                    return;
                }

                // Multi selection: enrich every selected row via the SAME backend
                // regenerate action (no duplicated business logic), bounded concurrency,
                // continue-on-failure, live progress + per-row refresh, final summary.
                this._runBulkEnrichment(aContexts);
            },

            _runBulkEnrichment: function (aContexts) {
                var that = this;
                var oUiModel = this.getView().getModel("ui");
                var iTotal = aContexts.length;

                // Snapshot id + context up front (selection is cleared on refresh).
                var aItems = aContexts.map(function (oCtx) {
                    return {
                        id: oCtx.getProperty("ID"),
                        description: oCtx.getProperty("description"),
                        context: oCtx
                    };
                });

                oUiModel.setProperty("/enriching", true); // disables the button
                var oProgress = this._openProgressDialog(iTotal);
                var iDone = 0;

                // Worker: enrich one requirement via the reused backend action. Each call
                // uses the predefined "$direct" group so it is sent immediately as its own
                // HTTP request. This avoids two failure modes seen with the default $auto
                // group: (a) concurrent operations sharing one $auto batch cancel each
                // other; (b) a custom named group is deferred and never auto-submitted.
                var fnWorker = function (oItem) {
                    return that._callAction("regenerate", { id: oItem.id }, "$direct");
                };

                // After each item settles: bump progress. NOTE: we deliberately do NOT
                // refresh individual row contexts here — refreshing a context while sibling
                // operations are still pending on the same model cancels them. All rows are
                // refreshed once at the end via _refreshTable().
                var fnOnEach = function () {
                    iDone += 1;
                    that._updateProgressDialog(oProgress, iDone, iTotal);
                };

                this._runWithConcurrency(aItems, this._ENRICH_CONCURRENCY, fnWorker, fnOnEach)
                    .then(function (aResults) {
                        that._closeProgressDialog(oProgress);
                        oUiModel.setProperty("/enriching", false);
                        that._refreshTable();
                        that._showBulkSummary(aResults);
                    })
                    .catch(function (oError) {
                        // The runner never rejects per-item; this only guards an
                        // unexpected orchestration error.
                        that._closeProgressDialog(oProgress);
                        oUiModel.setProperty("/enriching", false);
                        that._refreshTable();
                        that._showError(oError);
                    });
            },

            // Promise-pool: keeps up to iLimit workers in flight, each pulling the next
            // item when it finishes. NEVER rejects per item — a failing fnWorker is
            // captured as { ok:false, error }, so the pool always drains (continue on
            // failure). Resolves to the array of all results. Pure client-side utility.
            _runWithConcurrency: function (aItems, iLimit, fnWorker, fnOnEach) {
                return new Promise(function (resolve) {
                    var aResults = [];
                    var iNext = 0;
                    var iActive = 0;
                    var iTotal = aItems.length;

                    if (iTotal === 0) {
                        resolve(aResults);
                        return;
                    }

                    // Dispatch ONE item. Kept as its own function so each item captures
                    // its own oItem/iIndex — a `var` inside the pump loop would be shared
                    // across all iterations' closures (all results would reference the
                    // last item).
                    var runOne = function (oItem, iIndex) {
                        Promise.resolve()
                            .then(function () {
                                return fnWorker(oItem, iIndex);
                            })
                            .then(function (vValue) {
                                return { item: oItem, ok: true, value: vValue };
                            })
                            .catch(function (oError) {
                                return { item: oItem, ok: false, error: oError };
                            })
                            .then(function (oResult) {
                                aResults.push(oResult);
                                if (fnOnEach) {
                                    fnOnEach(oResult);
                                }
                                iActive -= 1;
                                if (aResults.length === iTotal) {
                                    resolve(aResults);
                                } else {
                                    pump();
                                }
                            });
                    };

                    var pump = function () {
                        while (iActive < iLimit && iNext < iTotal) {
                            runOne(aItems[iNext], iNext);
                            iNext += 1;
                            iActive += 1;
                        }
                    };
                    pump();
                });
            },

            _openProgressDialog: function (iTotal) {
                var oModel = new JSONModel({
                    percent: 0,
                    text: "Enriching 0 of " + iTotal + "…"
                });
                var oIndicator = new ProgressIndicator({
                    percentValue: "{prog>/percent}",
                    displayValue: "{prog>/text}",
                    showValue: true,
                    width: "100%",
                    state: "Information"
                });
                var oDialog = new Dialog({
                    title: "Enriching requirements",
                    contentWidth: "24rem",
                    // No close button — the run must finish (button is already disabled).
                    content: [
                        new VBox({
                            items: [
                                new Text({ text: "Running AI enrichment on the selected requirements." }),
                                oIndicator.addStyleClass("sapUiSmallMarginTop")
                            ]
                        }).addStyleClass("sapUiSmallMargin")
                    ]
                });
                oDialog.setModel(oModel, "prog");
                this.getView().addDependent(oDialog);
                oDialog.open();
                return oDialog;
            },

            _updateProgressDialog: function (oDialog, iDone, iTotal) {
                if (!oDialog) {
                    return;
                }
                var oModel = oDialog.getModel("prog");
                oModel.setProperty("/percent", Math.round((iDone / iTotal) * 100));
                oModel.setProperty("/text", "Enriching " + iDone + " of " + iTotal + "…");
            },

            _closeProgressDialog: function (oDialog) {
                if (oDialog) {
                    oDialog.close();
                    oDialog.destroy();
                }
            },

            _showBulkSummary: function (aResults) {
                var aFailed = aResults.filter(function (r) {
                    return !r.ok;
                });
                var iOk = aResults.length - aFailed.length;

                if (!aFailed.length) {
                    MessageBox.success(
                        "Enriched " + iOk + " requirement(s). Review the new proposals."
                    );
                    return;
                }

                var sNames = aFailed
                    .map(function (r) {
                        return '"' + (r.item.description || r.item.id) + '"';
                    })
                    .join(", ");
                MessageBox.warning(
                    "Enriched " + iOk + " of " + aResults.length + " requirement(s). " +
                        aFailed.length + " failed: " + sNames + ". Select the failed row(s) and retry."
                );
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

            // Open a searchable, paged value-help dialog over a read-only master-data
            // list (MaterialGroups / CommodityCodes). Scales past the seed's 3 rows to
            // production-scale UNSPSC catalogs: growing/paged list + server-side search
            // on the key/label. On confirm, writes the picked code into oInput and
            // records it on oState so Save can patch the association FK.
            _openCodeValueHelp: function (mConfig) {
                var oInput = mConfig.input;
                var oState = mConfig.state;
                var aSearchFields = mConfig.searchFields; // OData props to filter on

                var oDialog = new SelectDialog({
                    title: mConfig.title,
                    growing: true,
                    growingThreshold: 50,
                    contentWidth: "28rem",
                    items: {
                        path: "/" + mConfig.entitySet,
                        template: new StandardListItem({
                            title: "{" + mConfig.keyProp + "}",
                            description: "{" + mConfig.textProp + "}"
                        })
                    },
                    search: function (oEvent) {
                        var sValue = oEvent.getParameter("value");
                        var oBinding = oEvent.getParameter("itemsBinding");
                        var aFilters = sValue
                            ? [new Filter(aSearchFields.map(function (sField) {
                                return new Filter(sField, FilterOperator.Contains, sValue);
                            }), false)]
                            : [];
                        oBinding.filter(aFilters);
                    },
                    confirm: function (oEvent) {
                        var oItem = oEvent.getParameter("selectedItem");
                        var sCode = oItem ? oItem.getTitle() : "";
                        oInput.setValue(sCode);
                        oState.code = sCode || null;
                    },
                    cancel: function () {}
                });
                oDialog.setModel(oInput.getModel()); // the OData v4 default model
                this.getView().addDependent(oDialog);
                oDialog.open();
            },

            onEdit: function () {
                var that = this;
                var oCtx = this._selectedContexts()[0];
                var oData = oCtx.getObject();

                var oDescription = new Input({ value: oData.description || "" });
                var oQuantity = new Input({ value: oData.quantity != null ? String(oData.quantity) : "", type: "Number" });
                var oUnit = new Input({ value: oData.unit || "" });
                var oDate = new Input({ value: oData.requestedDate || "", placeholder: "YYYY-MM-DD" });

                // Material Group / Commodity: read-only inputs driven by value help
                // (typing a code by hand invites typos / dangling FKs — the picker
                // guarantees a valid code). oState tracks the staged code for Save.
                var oMgState = { code: oData.materialGroup_code || null };
                var oCcState = { code: oData.commodityCode_code || null };
                var oMaterialGroup = new Input({
                    value: oData.materialGroup_code || "",
                    placeholder: "Select a Material Group",
                    showValueHelp: true,
                    valueHelpOnly: true,
                    valueHelpRequest: function () {
                        that._openCodeValueHelp({
                            input: oMaterialGroup,
                            state: oMgState,
                            title: "Select Material Group",
                            entitySet: "MaterialGroups",
                            keyProp: "code",
                            textProp: "name",
                            searchFields: ["code", "name"]
                        });
                    }
                });
                var oCommodity = new Input({
                    value: oData.commodityCode_code || "",
                    placeholder: "Select a Commodity Code",
                    showValueHelp: true,
                    valueHelpOnly: true,
                    valueHelpRequest: function () {
                        that._openCodeValueHelp({
                            input: oCommodity,
                            state: oCcState,
                            title: "Select Commodity Code",
                            entitySet: "CommodityCodes",
                            keyProp: "code",
                            textProp: "description",
                            searchFields: ["code", "description"]
                        });
                    }
                });

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
                                oDate,
                                new Label({ text: "Material Group", labelFor: oMaterialGroup }).addStyleClass("sapUiTinyMarginTop"),
                                oMaterialGroup,
                                new Label({ text: "Commodity", labelFor: oCommodity }).addStyleClass("sapUiTinyMarginTop"),
                                oCommodity
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
                            if (oMgState.code !== (oData.materialGroup_code || null)) {
                                aPatches.push(oCtx.setProperty("materialGroup_code", oMgState.code));
                            }
                            if (oCcState.code !== (oData.commodityCode_code || null)) {
                                aPatches.push(oCtx.setProperty("commodityCode_code", oCcState.code));
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
