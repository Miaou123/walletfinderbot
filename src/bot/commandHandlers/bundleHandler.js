const bundleAnalyzer = require('../../analysis/bundle'); // Changed from UnifiedBundleAnalyzer
const { formatMainMessage, formatNonPumpfunBundleResponse } = require('../formatters/bundleFormatter');
const logger = require('../../utils/logger');
const { validateSolanaAddress } = require('./helpers');
const stateManager = require('../../utils/stateManager');

class BundleHandler {
    constructor(accessControl = null) {
        this.bundleAnalyzer = bundleAnalyzer; // Use the exported instance directly
        this.COMMAND_NAME = 'bundle';
        this.accessControl = accessControl;
    }

    generateCallbackData(action, params = {}) {
        if (action === 'track') {
            return `track:bundle:${params.tokenAddress}`;
        } else if (action === 'details') {
            return `bundle:details:${params.tokenAddress}`;
        }
        return `bundle:${action}:${params.tokenAddress}`;
    }

    createTrackButton(tokenAddress) {
        return {
            text: "Track Bundle Wallets",
            callback_data: this.generateCallbackData('track', { tokenAddress })
        };
    }

    createDetailsButton(tokenAddress) {
        return {
            text: "Show Bundle Details",
            callback_data: this.generateCallbackData('details', { tokenAddress })
        };
    }

    async handleCommand(bot, msg, args, messageThreadId) {
        const username = msg.from.username;
        logger.info(`Starting Bundle command for user ${username}`);
    
        try {
            const address = args[0];
            const isTeamAnalysis = args.length > 1 && args[1].toLowerCase() === 'team';
    
            if (!validateSolanaAddress(address)) {
                await bot.sendLongMessage(
                    msg.chat.id,
                    "Invalid Solana address. Please provide a valid Solana address.",
                    { message_thread_id: messageThreadId }
                );
                return;
            }
    
            logger.info(`Processing bundle analysis for address ${address}${isTeamAnalysis ? ' (team analysis)' : ''}`);
            
            const results = await this.bundleAnalyzer.analyzeBundle(address, 50000, isTeamAnalysis);
            
            let formattedMessage;
            
            // Check platform from results (will be added by our modified bundle.js)
            const platform = results.platform || 'PumpFun';
            
            if (platform === 'PumpFun') {
                formattedMessage = formatMainMessage(results);
            } else {
                // For Bonk.fun or other platforms, you might want to modify the formatter
                formattedMessage = formatMainMessage(results); // Use same formatter for now
            }
    
            // Always prepare tracking data for potential use
            const hasTrackableWallets = this.hasTrackableWallets(results);
            if (hasTrackableWallets) {
                const trackingData = this.prepareTrackingData(results, address, msg.chat.id);
                stateManager.setTrackingInfo(msg.chat.id, address, trackingData);
            }
    
            // Show tracking buttons to EVERYONE if bundles were found
            const replyMarkup = hasTrackableWallets ? {
                inline_keyboard: [
                    [
                        this.createTrackButton(address),
                        this.createDetailsButton(address)
                    ]
                ]
            } : undefined;
    
            await bot.sendMessage(
                msg.chat.id,
                formattedMessage,
                {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true,
                    message_thread_id: messageThreadId,
                    reply_markup: replyMarkup
                }
            );
    
        } catch (error) {
            logger.error('Error in bundle command:', error);
            throw error; 
        }
    }

    async handleCallback(bot, query) {
        try {
            const [category, action, tokenAddress] = query.data.split(':');
            
            if (action === 'details') {
                await this.handleDetailsView(bot, query, tokenAddress);
            }
            
            await bot.answerCallbackQuery(query.id);
        } catch (error) {
            logger.error('Error in bundle callback:', error);
            await bot.answerCallbackQuery(query.id, { text: "An error occurred", show_alert: true });
        }
    }

    async handleDetailsView(bot, query, tokenAddress) {
        const chatId = query.message.chat.id;
        const trackingInfo = stateManager.getTrackingInfo(chatId, tokenAddress);

        if (!trackingInfo?.bundleDetails) {
            throw new Error("No bundle details found. Please run the analysis again.");
        }

        const message = this.formatBundleDetails(trackingInfo.bundleDetails, trackingInfo.tokenInfo);
        await bot.sendLongMessage(chatId, message, { 
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    }

    prepareTrackingData(scanData, tokenAddress, chatId) {
        // Extract bundle wallets from the analysis results
        const bundleWallets = this.extractBundleWallets(scanData);
        const totalSupplyControlled = this.calculateTotalSupplyControlled(scanData, bundleWallets);
        
        logger.debug(`Extracted ${bundleWallets.length} bundle wallets for tracking`);
        
        return {
            tokenAddress,
            trackType: 'bundle',
            tokenInfo: {
                symbol: scanData.tokenInfo.symbol,
                totalSupply: scanData.tokenInfo.total_supply,
                decimals: scanData.tokenInfo.decimals,
                address: tokenAddress
            },
            totalSupplyControlled,
            initialSupplyPercentage: totalSupplyControlled,
            // Store wallets for tracking
            wallets: bundleWallets,
            bundleWallets: bundleWallets,
            bundleDetails: this.prepareBundleDetails(scanData),
            chatId
        };
    }

    extractBundleWallets(scanData) {
        const bundleWallets = new Set();
        
        // Extract wallets from regular bundle analysis
        if (scanData.allBundles && Array.isArray(scanData.allBundles)) {
            scanData.allBundles.forEach(bundle => {
                if (bundle.uniqueWallets) {
                    Array.from(bundle.uniqueWallets).forEach(wallet => {
                        bundleWallets.add(wallet);
                    });
                }
            });
        }
        
        // Extract wallets from team bundle analysis
        if (scanData.teamBundles && Array.isArray(scanData.teamBundles)) {
            scanData.teamBundles.forEach(bundle => {
                if (bundle.uniqueWallets) {
                    Array.from(bundle.uniqueWallets).forEach(wallet => {
                        bundleWallets.add(wallet);
                    });
                }
            });
        }
        
        return Array.from(bundleWallets);
    }

    calculateTotalSupplyControlled(scanData, bundleWallets) {
        // Calculate the total supply percentage controlled by bundle wallets
        const totalSupply = scanData.tokenInfo?.total_supply || 0;
        
        if (scanData.totalHoldingAmount && totalSupply > 0) {
            return (scanData.totalHoldingAmount / totalSupply) * 100;
        }
        
        // Fallback calculation if holding amount is not available
        if (scanData.totalTokensBundled && totalSupply > 0) {
            return (scanData.totalTokensBundled / totalSupply) * 100;
        }
        
        return 0;
    }

    prepareBundleDetails(scanData) {
        // Prepare detailed bundle information for the details view
        const bundles = scanData.allBundles || scanData.teamBundles || [];
        
        return {
            totalBundles: scanData.totalBundles || scanData.totalTeamWallets || 0,
            totalTokensBundled: scanData.totalTokensBundled || 0,
            percentageBundled: scanData.percentageBundled || 0,
            totalSolSpent: scanData.totalSolSpent || 0,
            totalHoldingAmount: scanData.totalHoldingAmount || 0,
            totalHoldingAmountPercentage: scanData.totalHoldingAmountPercentage || 0,
            bundles: bundles.slice(0, 20), // Limit to top 20 bundles for details
            isTeamAnalysis: scanData.isTeamAnalysis || false
        };
    }

    hasTrackableWallets(results) {
        // Check if there are wallets that can be tracked
        const bundleWallets = this.extractBundleWallets(results);
        return bundleWallets.length > 0;
    }

    formatBundleDetails(bundleDetails, tokenInfo) {
        const { bundles, isTeamAnalysis, totalBundles, totalTokensBundled, totalHoldingAmount } = bundleDetails;
        
        let message = `<b>${tokenInfo.symbol}</b> (<a href="https://dexscreener.com/solana/${tokenInfo.address}">📈</a>)\n`;
        message += `<b>${totalBundles} ${isTeamAnalysis ? 'team' : ''} bundle${totalBundles !== 1 ? 's' : ''} details:</b>\n\n`;
        
        message += `📦 Total Bundles: ${totalBundles}\n`;
        message += `🪙 Total Tokens Bundled: ${this.formatNumber(totalTokensBundled)} ${tokenInfo.symbol}\n`;
        message += `🔒 Total Holding Amount: ${this.formatNumber(totalHoldingAmount)} ${tokenInfo.symbol}\n\n`;
        
        bundles.forEach((bundle, index) => {
            const walletLinks = Array.from(bundle.uniqueWallets || []).map(wallet => {
                const truncated = this.truncateAddress(wallet);
                return `<a href="https://solscan.io/account/${wallet}">${truncated}</a>`;
            }).join(', ');
            
            message += `<b>Bundle ${index + 1} (Slot ${bundle.slot}):</b>\n`;
            message += `├ 💼 Wallets (${bundle.uniqueWalletsCount || bundle.uniqueWallets?.size || 0}): ${walletLinks}\n`;
            message += `├ 🪙 Tokens: ${this.formatNumber(bundle.tokensBought)} ${tokenInfo.symbol}\n`;
            message += `├ 💰 SOL Spent: ${this.formatNumber(bundle.solSpent)} SOL\n`;
            if (bundle.holdingAmount !== undefined) {
                message += `└ 🔒 Current Holdings: ${this.formatNumber(bundle.holdingAmount)} ${tokenInfo.symbol}\n`;
            }
            message += `\n`;
        });
        
        return message;
    }

    formatNumber(num, decimals = 2) {
        if (num === undefined || num === null || isNaN(num)) return '0';
        
        if (num >= 1000000) {
            return (num / 1000000).toFixed(decimals) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(decimals) + 'K';
        }
        
        return num.toFixed(decimals);
    }

    truncateAddress(address, start = 4, end = 4) {
        if (!address) return 'Unknown';
        return `${address.slice(0, start)}...${address.slice(-end)}`;
    }
}

module.exports = BundleHandler;