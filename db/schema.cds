namespace workspace;

using {
    cuid,
    managed
} from '@sap/cds/common';

entity Documents : cuid, managed {
    fileName   : String(255) @mandatory;
    fileType   : String(10)  @mandatory;
    fileSize   : Integer;
    status     : String(20) default 'UPLOADED';
    chunkCount : Integer default 0;
    errorMsg   : String(1000);
    chunks     : Composition of many DocumentChunks
                     on chunks.document = $self;
}

entity DocumentChunks : cuid {
    document   : Association to Documents @mandatory;
    content    : LargeString              @mandatory;
    chunkIndex : Integer                  @mandatory;
    tokenCount : Integer;
    embedding  : Vector(3072);
}

entity ChatSessions : cuid, managed {
    title    : String(200);
    document : Association to Documents; // Link session to document
    messages : Composition of many ChatMessages
                   on messages.session = $self;
}

entity ChatMessages : cuid {
    session   : Association to ChatSessions @mandatory;
    role      : String(20)                  @mandatory;
    content   : LargeString                 @mandatory;
    timestamp : Timestamp                   @cds.on.insert: $now;
    sources   : LargeString;
}


entity SPHeader : cuid {
    number    : Integer64                 @mandatory;
    status    : String(20)                  @mandatory;
    version   : Integer                     @mandatory;
    createdat : Timestamp                   @cds.on.insert: $now;
    items     : Composition of many SPItem
                   on items.SPHeader = $self;
}

entity SPItem : cuid {
    SPHeader      : Association to SPHeader     @mandatory;
    item_number   : Integer64                   @mandatory;
    item_status   : String(20)                  @mandatory;
    product_type  : String(40)                  @mandatory;
    delivery_date : Date;
}


