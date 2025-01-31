// src/bot/commandHandlers/adminCommands/index.js

// Import User Management Handlers
const RemoveUserHandler = require('./userManagement/removeUserHandler');
const GetUserHandler = require('./userManagement/getUserHandler');

// Import Group Management Handlers
const AddGroupHandler = require('./groupManagement/addGroupHandler');
const RemoveGroupHandler = require('./groupManagement/removeGroupHandler');
const ListGroupsHandler = require('./groupManagement/listGroupsHandler');

// Import Subscription Management Handlers
const AddSubscriptionHandler = require('./subscriptionManagement/addSubscriptionHandler');
const AddGroupsSubscriptionHandler = require('./subscriptionManagement/addGroupSubscriptionHandler');
const RemoveSubscriptionHandler = require('./subscriptionManagement/removeSubscriptionHandler');
const RemoveGroupSubscriptionHandler = require('./subscriptionManagement/removeGroupSubscriptionHandler');
const CheckSubscriptionHandler = require('./subscriptionManagement/checkSubscriptionHandler');
const ListSubscriptionsHandler = require('./subscriptionManagement/listSubscriptionsHandler');
const ListGroupSubscriptionsHandler = require('./subscriptionManagement/listGroupSubscriptionsHandler');


// Import System Command Handlers
const BroadcastHandler = require('./systemCommands/broadcastHandler');
const UsageStatsHandler = require('./systemCommands/usageStatsHandler');


//Utils
const logger = require('../../../utils/logger');

class AdminCommandManager {
    constructor(accessControl, bot, usageTracker) {

        if (!accessControl || !bot) {
            throw new Error('Required dependencies missing');
        }
        this.accessControl = accessControl;
        this.bot = bot;
        this.usageTracker = usageTracker;

        this.handlers = {
            // User Management
            removeuser: new RemoveUserHandler(accessControl, bot),
            getuser: new GetUserHandler(accessControl, bot),
            
            // Group Management
            addgroup: new AddGroupHandler(accessControl, bot),
            removegroup: new RemoveGroupHandler(accessControl, bot),
            listgroups: new ListGroupsHandler(accessControl, bot),
            
            // Subscription Management
            addsub: new AddSubscriptionHandler(accessControl, bot),
            addgroupsub: new AddGroupsSubscriptionHandler(accessControl, bot),
            removesub: new RemoveSubscriptionHandler(accessControl, bot),
            removegroupsub: new RemoveGroupSubscriptionHandler(accessControl, bot),
            checksub: new CheckSubscriptionHandler(accessControl, bot),
            listsubs: new ListSubscriptionsHandler(accessControl, bot),
            listgroupsubs: new ListGroupSubscriptionsHandler(accessControl, bot),
            
            // System Commands
            broadcast: new BroadcastHandler(accessControl, bot),
            usagestats: new UsageStatsHandler(accessControl, bot, usageTracker)
        };
    }

    getHandler(command) {
        return this.handlers[command];
    }

     async handleCommand(command, msg, args) {
        try {
            // Debug du message reçu
            logger.debug('AdminCommandManager received message:', {
                command,
                msgStructure: {
                    chat: msg?.chat ? { 
                        id: msg.chat.id,
                        type: msg.chat.type 
                    } : 'undefined',
                    from: msg?.from ? {
                        id: msg.from.id,
                        username: msg.from.username
                    } : 'undefined'
                }
            });

            const handler = this.handlers[command];
            if (!handler) {
                throw new Error(`No handler found for admin command: ${command}`);
            }

            if (!msg || !msg.chat || !msg.from) {
                logger.error('Invalid message structure:', { msg });
                throw new Error('Invalid message format: missing required properties');
            }

            // Ajout des propriétés manquantes si nécessaire
            const completeMsg = {
                ...msg,
                chat: {
                    ...msg.chat,
                    id: String(msg.chat.id)
                },
                from: {
                    ...msg.from,
                    id: Number(msg.from.id)
                }
            };

            await handler.handle(completeMsg, args);
            
        } catch (error) {
            logger.error(`Error in admin command ${command}:`, error);
            if (msg?.chat?.id) {
                try {
                    await this.bot.sendMessage(
                        msg.chat.id,
                        "❌ An error occurred while executing the command."
                    );
                } catch (sendError) {
                    logger.error('Error sending error message:', sendError);
                }
            }
            throw error;
        }
    }
}

module.exports = AdminCommandManager;