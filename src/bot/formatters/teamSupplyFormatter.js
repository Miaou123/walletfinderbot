// formatters/teamSupplyFormatter.js
const { formatNumber } = require('./generalFormatters');
const BigNumber = require('bignumber.js');
const logger = require('../../utils/logger');
const unifiedFormatter = require('./unifiedFormatter');

const getEmoji = (percentage) => {
    if (percentage <= 10) return '🟢';
    if (percentage <= 20) return '🟡';
    if (percentage <= 40) return '🟠';
    if (percentage <= 50) return '🔴';
    return '☠️';
};

const formatTeamSupplyResult = (analyzedWallets, tokenInfo, teamWallets, totalSupplyControlled) => {
    try {
        // Pour déboguer ce qui est passé à cette fonction
        logger.debug('Team formatter received:', {
            analyzedWalletsCount: analyzedWallets?.length || 0,
            teamWalletsCount: teamWallets?.length || 0,
            totalSupplyControlled
        });

        // Vérifier si analyzedWallets a bien des catégories
        if (analyzedWallets && analyzedWallets.length > 0) {
            const sampleWallets = analyzedWallets.slice(0, 3);
            logger.debug('Sample wallet categories:', 
                sampleWallets.map(w => ({ 
                    address: w.address?.slice(0, 6), 
                    category: w.category || 'undefined',
                    hasFunding: !!w.funderAddress
                }))
            );
        }

        // Forcer par défaut la catégorie "Team" à tout wallet sans catégorie spécifique
        const fixedWallets = analyzedWallets.map(wallet => ({
            ...wallet,
            category: wallet.category || 'Team'
        }));

        // Utiliser le formateur unifié
        return unifiedFormatter.formatWalletAnalysis(
            fixedWallets, 
            tokenInfo,
            teamWallets,
            totalSupplyControlled,
            {
                title: 'Team Supply Analysis',
                emoji: '👥',
                warningEmoji: '⚠️',
                walletType: 'team',
                displayCategory: true,
                maxWallets: 10
            }
        );
    } catch (error) {
        logger.error('Error in formatTeamSupplyResult:', error);
        return 'Error formatting team wallet details.';
    }
};

function formatWalletDetails(analyzedWallets, tokenInfo) {
    try {
        // Forcer par défaut la catégorie "Team" à tout wallet sans catégorie spécifique
        const fixedWallets = analyzedWallets.map(wallet => ({
            ...wallet,
            category: wallet.category || 'Team'
        }));

        return unifiedFormatter.formatWalletDetails(
            fixedWallets,
            tokenInfo,
            {
                displayCategory: true,
                walletType: 'team'
            }
        );
    } catch (error) {
        logger.error('Error in formatWalletDetails:', error);
        return 'Error formatting team wallet details.';
    }
}

module.exports = {
    formatTeamSupplyResult,
    formatWalletDetails
};