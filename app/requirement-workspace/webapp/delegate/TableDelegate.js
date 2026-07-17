sap.ui.define(
    [
        "sap/ui/mdc/odata/v4/TableDelegate",
        "sap/ui/model/Filter",
        "sap/ui/model/FilterOperator",
        "sap/ui/core/Element"
    ],
    function (TableDelegate, Filter, FilterOperator, Element) {
        "use strict";

        var Delegate = Object.assign({}, TableDelegate);

        // Property infos for p13n (column/sort personalization) and condition typing.
        // Keys match the propertyKey of the columns declared in Workspace.view.xml.
        var PROPERTIES = [
            { key: "description", path: "description", label: "Description", dataType: "sap.ui.model.odata.type.String" },
            { key: "normalizedDescription", path: "normalizedDescription", label: "Normalized Description", dataType: "sap.ui.model.odata.type.String" },
            { key: "quantity", path: "quantity", label: "Quantity", dataType: "sap.ui.model.odata.type.Decimal" },
            { key: "unit", path: "unit", label: "Unit", dataType: "sap.ui.model.odata.type.String" },
            { key: "requestedDate", path: "requestedDate", label: "Requested Date", dataType: "sap.ui.model.odata.type.Date" },
            { key: "materialGroup_code", path: "materialGroup_code", label: "Material Group", dataType: "sap.ui.model.odata.type.String" },
            { key: "commodityCode_code", path: "commodityCode_code", label: "Commodity Code", dataType: "sap.ui.model.odata.type.String" },
            { key: "confidenceScore", path: "confidenceScore", label: "AI Confidence", dataType: "sap.ui.model.odata.type.Decimal" },
            { key: "aiStatus", path: "aiStatus", label: "AI Status", dataType: "sap.ui.model.odata.type.String" },
            { key: "duplicateOf_ID", path: "duplicateOf_ID", label: "Duplicate Of", dataType: "sap.ui.model.odata.type.Guid" }
        ];

        Delegate.fetchProperties = function () {
            return Promise.resolve(PROPERTIES);
        };

        // Manual condition -> sap.ui.model.Filter mapping instead of FilterUtil:
        // deterministic across mdc versions, and this app only needs a handful of
        // operators. Conditions on the same property are ORed, across properties ANDed.
        var OPERATOR_MAP = {
            EQ: FilterOperator.EQ,
            NE: FilterOperator.NE,
            Contains: FilterOperator.Contains,
            StartsWith: FilterOperator.StartsWith,
            EndsWith: FilterOperator.EndsWith,
            BT: FilterOperator.BT,
            GT: FilterOperator.GT,
            GE: FilterOperator.GE,
            LT: FilterOperator.LT,
            LE: FilterOperator.LE
        };

        function conditionsToFilters(mConditions) {
            var aResult = [];
            Object.keys(mConditions || {}).forEach(function (sPath) {
                var aPerPath = (mConditions[sPath] || [])
                    .filter(function (oCondition) {
                        return OPERATOR_MAP[oCondition.operator] && oCondition.values && oCondition.values.length;
                    })
                    .map(function (oCondition) {
                        return new Filter(sPath, OPERATOR_MAP[oCondition.operator], oCondition.values[0], oCondition.values[1]);
                    });
                if (aPerPath.length === 1) {
                    aResult.push(aPerPath[0]);
                } else if (aPerPath.length > 1) {
                    aResult.push(new Filter({ filters: aPerPath, and: false }));
                }
            });
            return aResult;
        }

        Delegate.updateBindingInfo = function (oTable, oBindingInfo) {
            TableDelegate.updateBindingInfo.apply(this, arguments);
            oBindingInfo.path = oTable.getPayload().collectionPath;
            oBindingInfo.parameters.$count = true;

            var aFilters = [];

            // Conditions from the associated mdc FilterBar (Go button).
            var oFilterBar = Element.getElementById(oTable.getFilter());
            if (oFilterBar && oFilterBar.getConditions) {
                aFilters = aFilters.concat(conditionsToFilters(oFilterBar.getConditions()));
            }

            // Always scope to the workspace selected in the page header.
            var oUiModel = oTable.getModel("ui");
            var sWorkspaceId = oUiModel && oUiModel.getProperty("/workspaceId");
            if (sWorkspaceId) {
                aFilters.push(new Filter("workspace_ID", FilterOperator.EQ, sWorkspaceId));
            }

            oBindingInfo.filters = aFilters.length > 1 ? [new Filter({ filters: aFilters, and: true })] : aFilters;
        };

        return Delegate;
    }
);
