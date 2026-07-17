sap.ui.define(
    [
        "sap/ui/mdc/FilterBarDelegate",
        "sap/ui/mdc/odata/v4/TypeMap"
    ],
    function (FilterBarDelegate, ODataV4TypeMap) {
        "use strict";

        var Delegate = Object.assign({}, FilterBarDelegate);

        // The FilterFields are declared statically in Workspace.view.xml; this only
        // provides the matching property infos (keys must match their propertyKey).
        Delegate.fetchProperties = function () {
            return Promise.resolve([
                { key: "description", label: "Description", dataType: "sap.ui.model.odata.type.String" },
                { key: "aiStatus", label: "AI Status", dataType: "sap.ui.model.odata.type.String" }
            ]);
        };

        Delegate.getTypeMap = function () {
            return ODataV4TypeMap;
        };

        return Delegate;
    }
);
