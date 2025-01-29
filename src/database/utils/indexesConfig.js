const logger = require('../../utils/logger');

async function createCollections(db, collections) {
    for (const [collectionName, config] of Object.entries(collections)) {
        try {
            await db.createCollection(collectionName);
            logger.info(`Collection ${collectionName} created or exists`);
        } catch (error) {
            if (error.code !== 48) {
                logger.error(`Error creating collection ${collectionName}:`, error);
            }
        }
    }
}

async function processCollectionIndexes(collections) {
    for (const [collectionName, config] of Object.entries(collections)) {
        logger.info(`Processing indexes for ${collectionName}...`);
        
        try {
            const existingIndexes = await config.collection.listIndexes().toArray();
            
            for (const indexDef of config.indexes) {
                const keyString = Object.entries(indexDef.key)
                    .map(([k, v]) => `${k}_${v}`)
                    .join('_');
                
                const existingIndex = existingIndexes.find(idx => 
                    JSON.stringify(idx.key) === JSON.stringify(indexDef.key)
                );

                if (!existingIndex) {
                    await config.collection.createIndex(indexDef.key, indexDef.options);
                } else if (
                    existingIndex.unique !== indexDef.options.unique && 
                    indexDef.options.unique !== undefined
                ) {
                    await config.collection.dropIndex(existingIndex.name);
                    await config.collection.createIndex(indexDef.key, indexDef.options);
                }
            }
        } catch (error) {
            logger.error(`Error processing indexes for ${collectionName}:`, error);
        }
    }
}

async function updateIndexes(db) {
    try {
        logger.info('Starting index verification...');
        
        const collections = {
            wallets: {
                collection: db.collection("wallets"),
                indexes: [
                    { key: { address: 1 }, options: { unique: true } }
                ]
            },
            users: {
                collection: db.collection("users"),
                indexes: [
                    { key: { chatId: 1 }, options: { unique: true } },
                    { key: { username: 1 }, options: {} },
                    { key: { referralLink: 1 }, options: { unique: true } }
                ]
            },
            subscriptions: {
                collection: db.collection("subscriptions"),
                indexes: [
                    { key: { chatId: 1 }, options: { unique: true } },
                    { key: { username: 1 }, options: {} },
                    { key: { expiresAt: 1 }, options: {} },
                    { key: { active: 1 }, options: {} }
                ]
            },
            group_subscriptions: {
                collection: db.collection("group_subscriptions"),
                indexes: [
                    { key: { chatId: 1 }, options: { unique: true } },
                    { key: { expiresAt: 1 }, options: {} },
                    { key: { active: 1 }, options: {} }
                ]
            },
            paymentReceipt: {
                collection: db.collection("paymentReceipt"),
                indexes: [
                    { key: { sessionId: 1 }, options: { unique: true } },
                    { key: { chatId: 1 }, options: {} },
                    { key: { username: 1 }, options: {} },
                    { key: { expiresAt: 1 }, options: {} },
                ]
            },
        };

        await createCollections(db, collections);
        await processCollectionIndexes(collections);

        logger.info('Index verification completed successfully');
    } catch (error) {
        logger.error('Error during index verification:', error);
    }
}

module.exports = { updateIndexes };