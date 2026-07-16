using {workspace as db} from '../db/schema';

service SourcingProject{
    entity SPHeader as projection on db.SPHeader;
    entity SPItem as projection on db.SPItem;

    action CreateSourcingProject(
        number  : Integer,
        version : Integer,
        items   : many CreateSPItemInput
    ) returns SPHeader;

    action ReleaseSourcingProject(
        ID : UUID
    ) returns SPHeader;
}

type CreateSPItemInput {
    item_number   : Integer;
    product_type  : String(40);
    delivery_date : Date;
}