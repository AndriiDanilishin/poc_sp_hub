const cds = require('@sap/cds');

module.exports = cds.service.impl(async function () {

    const { SPHeader, SPItem } = this.entities;
    this.on('CreateSourcingProject', async (req) => {
        const { number, version, items } = req.data;
        const tx = cds.transaction(req);

        // Create header
        const header = await tx.run(
            INSERT.into(SPHeader).entries({
                number,
                version,
                status: 'CREATED'
            })
        );

        const headerId = header.ID;
        // Create items
        if (items?.length) {
            await tx.run(
                INSERT.into(SPItem).entries(
                    items.map(item => ({
                        SPHeader_ID: headerId,
                        item_number: item.item_number,
                        item_status: 'CREATED',
                        product_type: item.product_type,
                        delivery_date: item.delivery_date
                    }))
                )
            );
        }

        return await tx.run(
            SELECT.one.from(SPHeader).where({ ID: headerId })
        );
    });

    /** Release Sourcing Project*/
    this.on('ReleaseSourcingProject', async (req) => {
        const { ID } = req.data;
        const tx = cds.transaction(req);
        const existing = await tx.run(
            SELECT.one.from(SPHeader).where({ ID })
        );

        if (!existing) {
            return req.error(404, `Sourcing Project ${ID} not found`);
        }

        await tx.run(
            UPDATE(SPHeader)
                .set({
                    status: 'RELEASED'
                })
                .where({ ID })
        );

        await tx.run(
            UPDATE(SPItem)
                .set({
                    item_status: 'RELEASED'
                })
                .where({
                    SPHeader_ID: ID
                })
        );

        return await tx.run(
            SELECT.one.from(SPHeader).where({ ID })
        );
    });

});