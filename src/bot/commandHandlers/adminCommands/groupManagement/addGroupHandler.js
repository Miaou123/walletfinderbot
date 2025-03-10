// src/bot/commandHandlers/adminCommands/groupManagement/addGroupAdminHandler.js

const BaseAdminHandler = require('../baseAdminHandler');
const logger = require('../../../../utils/logger');
const { getDatabase } = require('../../../../database/config/connection');

class AddGroupHandler extends BaseAdminHandler {
    constructor(accessControl, bot) {
        super(accessControl, bot);
    }

    async handle(msg, args) {
        const chatId = String(msg.chat.id);
        const userId = msg.from.id;
        
        try {
            // Vérifier si l'utilisateur est admin du bot
            if (!await this.checkAdmin(userId)) {
                await this.bot.sendMessage(
                    chatId,
                    "❌ Only bot administrators can use this command."
                );
                return;
            }

            // Vérifier si nous sommes dans un groupe
            const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
            if (!isGroup) {
                await this.bot.sendMessage(
                    chatId,
                    "❌ This command must be used directly in the target group."
                );
                return;
            }

            // Extraire les arguments
            if (args.length < 1) {
                const helpMessage = 
                    "Usage: /add_group_admin <duration_months>\n\n" +
                    "Example:\n" +
                    "/add_group_admin 3\n\n" +
                    "This will create a 3-month subscription for the current group.";
                
                await this.bot.sendMessage(chatId, helpMessage);
                return;
            }

            const targetGroupId = chatId; // Utiliser l'ID du groupe actuel
            const durationMonths = parseInt(args[0], 10);

            // Valider les arguments
            if (isNaN(durationMonths) || durationMonths <= 0) {
                await this.bot.sendMessage(
                    chatId,
                    "❌ Duration must be a positive number of months."
                );
                return;
            }

            // Vérifier si le bot a accès au groupe
            try {
                // Obtenir le bot ID
                const botInfo = await this.bot.getMe();
                const botId = botInfo.id;
                
                // Vérifier l'accès au groupe et les permissions
                const chat = await this.bot.getChat(targetGroupId);
                const chatMember = await this.bot.getChatMember(
                    targetGroupId, 
                    botId.toString()
                );
                
                if (!['administrator', 'member'].includes(chatMember.status)) {
                    await this.bot.sendMessage(
                        chatId, 
                        "⚠️ The bot is not a member of this group. " +
                        "Please add the bot to the group first."
                    );
                    return;
                }

                // Créer l'abonnement administrativement
                await this.createAdminGroupSubscription(msg, chat.title, durationMonths);
                
                // Message de confirmation
                const successMessage = `✅ Group "${chat.title}" has been added with a ${durationMonths}-month subscription.`;
                await this.bot.sendMessage(chatId, successMessage);

            } catch (error) {
                logger.error('Error accessing group:', error);
                throw new Error(`Could not access group: ${error.message}`);
            }

        } catch (error) {
            logger.error('Error in add_group_admin command:', error);
            await this.bot.sendMessage(
                chatId,
                "❌ An error occurred while adding the group. Please verify the group ID and bot permissions."
            );
        }
    }

    async createAdminGroupSubscription(msg, groupName, durationMonths) {
        try {
            // Accès direct à la base de données
            const database = await getDatabase();
            const collection = database.collection("group_subscriptions");
            
            const chatId = String(msg.chat.id);
            const userId = String(msg.from.id);
            const username = msg.from.username || 'admin';
            
            // Créer un ID de paiement fictif pour traçabilité
            const adminPaymentId = `admin_grant_${Date.now()}`;
            
            // Date d'expiration (maintenant + durée en mois)
            const expiryDate = new Date();
            expiryDate.setMonth(expiryDate.getMonth() + durationMonths);
            
            // Préparer l'entrée de l'historique de paiement conforme au schema
            const paymentEntry = {
                paymentId: adminPaymentId,
                duration: '1month', // Conforme au schema
                amount: 0,
                paymentDate: new Date(),
                paymentStatus: 'completed',
                paidByUserId: userId,
                paidByUsername: username
            };
            
            // Vérification de l'existence du groupe
            const existingSubscription = await collection.findOne({ chatId });
            
            if (existingSubscription) {
                // Mise à jour d'un abonnement existant
                const result = await collection.updateOne(
                    { chatId },
                    {
                        $set: {
                            groupName,
                            active: true,
                            expiresAt: expiryDate,
                            lastUpdated: new Date()
                        },
                        $push: { 
                            paymentHistory: paymentEntry 
                        }
                    }
                );
                
                logger.info(`Admin group subscription updated for ${chatId}, duration: ${durationMonths} months`, {
                    adminId: userId,
                    groupName,
                    durationMonths,
                    expiryDate
                });
                
                return { updated: true, result };
            } else {
                // Création d'un nouvel abonnement
                // S'assurer que tous les champs obligatoires sont présents
                const newSubscription = {
                    chatId,
                    groupName,
                    adminUserId: userId, // Obligatoire selon schema
                    active: true,
                    startDate: new Date(),
                    expiresAt: expiryDate,
                    lastUpdated: new Date(),
                    paymentHistory: [paymentEntry]
                };
                
                // On utilise updateOne avec upsert pour éviter les problèmes d'index
                const result = await collection.updateOne(
                    { chatId }, 
                    { $set: newSubscription },
                    { upsert: true }
                );
                
                logger.info(`Admin group subscription created for ${chatId}, duration: ${durationMonths} months`, {
                    adminId: userId,
                    groupName,
                    durationMonths,
                    expiryDate
                });
                
                return { created: true, result };
            }
        } catch (error) {
            logger.error(`Error creating admin group subscription for ${msg.chat.id}:`, error);
            throw error;
        }
    }
}

module.exports = AddGroupHandler;