using SourcingProject as service from '../../srv/sp_service';
annotate service.SPHeader with @(
    UI.FieldGroup #GeneratedGroup : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataField',
                Label : 'Number',
                Value : number,
            },
            {
                $Type : 'UI.DataField',
                Label : 'Status',
                Value : status,
            },
            {
                $Type : 'UI.DataField',
                Label : 'Create at',
                Value : createdat,
            },
        ],
    },
    UI.Facets : [
        {
            $Type : 'UI.ReferenceFacet',
            ID : 'GeneratedFacet1',
            Label : 'General Information',
            Target : '@UI.FieldGroup#GeneratedGroup',
        },
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Additional Info',
            ID : 'AdditionalInfo',
            Target : '@UI.FieldGroup#AdditionalInfo',
        },
        {
            $Type : 'UI.ReferenceFacet',
            Label : 'Items',
            ID : 'Items',
            Target : 'items/@UI.LineItem#Items',
        },
    ],
    UI.LineItem : [
        {
            $Type : 'UI.DataField',
            Label : 'Number',
            Value : number,
        },
        {
            $Type : 'UI.DataField',
            Label : 'Status',
            Value : status,
        },
        {
            $Type : 'UI.DataField',
            Label : 'Version',
            Value : version,
        },
        {
            $Type : 'UI.DataField',
            Label : 'Create at',
            Value : createdat,
        },
    ],
    UI.SelectionFields : [
        number,
    ],
    UI.HeaderInfo : {
        TypeName : 'Sourcing Project',
        TypeNamePlural : 'Sourcing Projects',
        Title : {
            $Type : 'UI.DataField',
            Value : number,
        },
        Description : {
            $Type : 'UI.DataField',
            Value : status,
        },
        TypeImageUrl : 'sap-icon://capital-projects',
    },
    UI.FieldGroup #AdditionalInfo : {
        $Type : 'UI.FieldGroupType',
        Data : [
            {
                $Type : 'UI.DataField',
                Value : version,
                Label : 'Version',
            },
        ],
    },
);

annotate service.SPHeader with {
    number @Common.Label : 'Sourcing Project Number'
};

annotate service.SPItem with @(
    UI.LineItem #Items : [
        {
            $Type : 'UI.DataField',
            Value : SPHeader.items.item_number,
            Label : 'Number',
        },
        {
            $Type : 'UI.DataField',
            Value : SPHeader.items.item_status,
            Label : 'Status',
        },
    ]
);

