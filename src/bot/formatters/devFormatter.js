// formatters/devFormatter.js

const { formatNumber, truncateAddress } = require('./generalFormatters');
const logger = require('../../utils/logger');

function formatDevAnalysis(analysis) {
    try {
        if (!analysis.success) {
            return [`Error analyzing developer: ${analysis.error || 'Unknown error'}`];
        }

        const ticker = analysis.tokenSymbol || 'Unknown';
        let message = `👨‍💻 <b>Developer Analysis for <a href="https://solscan.io/token/${analysis.tokenAddress}">${ticker}</a></b>\n`;

        // Affichage des infos du dev
        const devShort = analysis.devAddress ? truncateAddress(analysis.devAddress) : 'Unknown';
        const devLink = analysis.devAddress ? `https://solscan.io/account/${analysis.devAddress}` : '#';

        const holdingPercentage = analysis.ownerTokenStats && analysis.ownerTokenStats.holdingPercentage
            ? `${analysis.ownerTokenStats.holdingPercentage}%`
            : '0.00%';

        const portfolioValue = (analysis.ownerPortfolio && analysis.ownerPortfolio.portfolioValueUsd)
            ? `$${formatNumber(analysis.ownerPortfolio.portfolioValueUsd)}`
            : '$0';

        const solBalance = (analysis.ownerPortfolio && analysis.ownerPortfolio.solBalance)
            ? formatNumber(analysis.ownerPortfolio.solBalance) 
            : '0.00';

        message += `├ Dev: <a href="${devLink}">${devShort}</a> → ${holdingPercentage}\n`;
        message += `├ 💼 Port: ${portfolioValue} (SOL: ${solBalance})\n`;

        // Top 3 tokens
        if (analysis.ownerPortfolio && Array.isArray(analysis.ownerPortfolio.topTokens) && analysis.ownerPortfolio.topTokens.length > 0) {
            message += `└ 💰 Top 3: `;
            const validTokens = analysis.ownerPortfolio.topTokens.filter(token => token && token.symbol && token.mint);
            if (validTokens.length > 0) {
                const topTokensStr = validTokens.map(token => {
                    const tokenValueStr = formatNumber(token.valueNumber || 0);
                    const tokenSymbol = token.symbol;
                    const tokenLink = `https://dexscreener.com/solana/${token.mint}?maker=${analysis.devAddress}`;
                    return `<a href="${tokenLink}">${tokenSymbol}</a> $${tokenValueStr}`;
                }).join(', ');
                message += `${topTokensStr}\n`;
            } else {
                message += `No valid tokens found\n`;
            }
        } else {
            message += `└ 💰 Top 3: No tokens found\n`;
        }

        message += `\n`;

        // Dev Stats
        message += `📊 <b>Dev Statistics</b>\n`;
        message += `├ Total Coins Created: ${analysis.coinsStats.totalCoins}\n`;
        message += `├ Successfully Bonded: ${analysis.coinsStats.bondedCount}\n`;
        message += `└ Bond Rate: ${analysis.coinsStats.bondedPercentage}%\n\n`;

        // Bonded Coins Performance
        if (analysis.bondedCoinsInfo && Array.isArray(analysis.bondedCoinsInfo.topPerformers) && analysis.bondedCoinsInfo.topPerformers.length > 0) {
            message += `💎 <b>Bonded Coins Performance</b>\n`;
            analysis.bondedCoinsInfo.topPerformers.forEach((coin, index) => {
                if (coin && coin.marketCap && coin.symbol) {
                    const mcapStr = formatNumber(coin.marketCap || 0);
                    const holdersStr = coin.holders?.count ? ` | ${formatNumber(coin.holders.count)} holders` : '';
                    const coinLink = `https://dexscreener.com/solana/${coin.address}`;
                    message += `${index + 1}. <a href="${coinLink}">${coin.symbol}</a> - $${mcapStr}${holdersStr}\n`;
                }
            });
            message += '\n';
        }

        // Funding Info
        message += `💰 <b>Funding Info</b>\n`;
        if (analysis.fundingInfo && analysis.fundingInfo.funderAddress) {
            const fundingAmount = analysis.fundingInfo.amount 
                ? `${analysis.fundingInfo.amount.toFixed(2)} SOL`
                : '';

            const fundingDate = analysis.fundingInfo.timestamp 
                ? calculateTimeAgo(analysis.fundingInfo.timestamp)
                : 'Unknown date';

            const funderLabel = analysis.fundingInfo.label ? ` (${analysis.fundingInfo.label})` : '';
            const funderAddressShort = truncateAddress(analysis.fundingInfo.funderAddress);
            const funderLink = `https://solscan.io/account/${analysis.fundingInfo.funderAddress}`;

            message += `└ Funded by: <a href="${funderLink}">${funderAddressShort}</a>${funderLabel}`;
            if (fundingAmount) message += ` - ${fundingAmount}`;
            if (fundingDate) message += ` (${fundingDate})`;
            message += '\n\n';
        } else {
            message += `└ Couldn't find funding info\n\n`;
        }

        // Transfer Connections
        if (analysis.transferConnections && Array.isArray(analysis.transferConnections)) {
            const validConnections = analysis.transferConnections.filter(conn => 
                conn && typeof conn === 'object' && conn.address && conn.amount
            );
    
            if (validConnections.length > 0) {
                message += `🔄 <b>Transfer Connections</b>\n`;
                message += `Found ${validConnections.length} unique connections:\n`;
    
                validConnections.forEach((connection, index, arr) => {
                    try {
                        const prefix = index === arr.length - 1 ? '└' : '├';
                        const date = connection.timestamp 
                            ? calculateTimeAgo(connection.timestamp)
                            : 'Unknown date';
    
                        const connectionLabel = connection.label ? ` (${connection.label})` : '';
                        const connectionAddressShort = truncateAddress(connection.address);
                        const connectionLink = `https://solscan.io/account/${connection.address}`;
    
                        message += `${prefix} <a href="${connectionLink}">${connectionAddressShort}</a>${connectionLabel}`;
                        if (connection.amount) message += ` - ${connection.amount.toFixed(2)} SOL`;
                        if (date) message += ` (${date})`;
                        message += '\n';
    
                        // Ici on ajoute l'affichage des détails du wallet s'ils existent
                        if (connection.walletDetails && typeof connection.walletDetails === 'object') {
                            const details = connection.walletDetails;
                            
                            // Si ce wallet a créé des coins
                            if (details.totalCoinsCreated && details.totalCoinsCreated > 0) {
                                message += `    ├ Bonded coins: ${details.bondedCoinsCount || 0}/${details.totalCoinsCreated}`;
                                
                                // Si on a des top coins
                                if (Array.isArray(details.topCoins) && details.topCoins.length > 0) {
                                    const topCoinsStr = details.topCoins
                                        .filter(coin => coin && coin.symbol && coin.marketCap)
                                        .map(coin => `${coin.symbol} ($${formatNumber(coin.marketCap)})`)
                                        .join(', ');
                                    if (topCoinsStr) message += ` (${topCoinsStr})`;
                                }
                                message += '\n';
                            }
    
                            // Si la valeur du portefeuille est supérieure à 10k USD
                            if (details.portfolioValue && details.portfolioValue > 10000) {
                                const portfolioValueK = (details.portfolioValue / 1000).toFixed(1);
                                message += `    └ 💼 Port: $${portfolioValueK}k USD\n`;
                            }
                        }

                    } catch (error) {
                        logger.error(`Error formatting connection: ${error}`);
                    }
                });
            }
        }

        return [message];
    } catch (error) {
        logger.error('Error formatting dev analysis:', error);
        return ['Error formatting developer analysis results.'];
    }
}

function calculateTimeAgo(timestamp) {
    const now = Date.now();
    const timeDifference = now - timestamp * 1000; 
    const seconds = Math.floor(timeDifference / 1000);
    const minutes = Math.floor(timeDifference / (1000 * 60));
    const hours = Math.floor(timeDifference / (1000 * 60 * 60));
    const days = Math.floor(timeDifference / (1000 * 60 * 60 * 24));
    const weeks = Math.floor(timeDifference / (1000 * 60 * 60 * 24 * 7));
    const months = Math.floor(timeDifference / (1000 * 60 * 60 * 24 * 30));
    const years = Math.floor(timeDifference / (1000 * 60 * 60 * 24 * 365));

    if (years > 0) {
        return `${years} year${years !== 1 ? 's' : ''} ago`;
    } else if (months > 0) {
        return `${months} month${months !== 1 ? 's' : ''} ago`;
    } else if (weeks > 0) {
        return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
    } else if (days > 0) {
        return `${days} day${days !== 1 ? 's' : ''} ago`;
    } else if (hours > 0) {
        return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    } else if (minutes > 0) {
        return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    } else {
        return `${seconds} second${seconds !== 1 ? 's' : ''} ago`;
    }
}

module.exports = { formatDevAnalysis };
