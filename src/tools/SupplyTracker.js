// tools/SupplyTracker.js
const BigNumber = require('bignumber.js');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger'); 
const { getSolanaApi } = require('../integrations/solanaApi');
const { scanToken } = require('../analysis/topHoldersScanner');

// Récupération de l'API Solana
const solanaApi = getSolanaApi();

// Configuration des intervalles et des expirations
const CHECK_INTERVAL = 1 * 60 * 1000;       // 1 minute
const SAVE_INTERVAL = 0.5 * 60 * 1000;      // 30 secondes
const CLEANUP_INTERVAL = 1 * 60 * 60 * 1000; // 1 heure
const EXPIRY_TIME = 2 * 24 * 60 * 60 * 1000;    // 2 days

/**
 * Petite fonction utilitaire pour attendre `ms` millisecondes.
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Effectue des tentatives de `operation` avec une stratégie d'exponentiel backoff.
 * @param {Function} operation - Fonction asynchrone à tenter.
 * @param {number} maxRetries - Nombre maximum de tentatives.
 * @param {number} initialDelay - Délai initial en ms avant la première relance.
 */
async function retryWithBackoff(operation, maxRetries = 5, initialDelay = 1000) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      return await operation();
    } catch (err) {
      if (retries === maxRetries - 1) {
        throw err;
      }
      const delay = initialDelay * Math.pow(2, retries);
      logger.warn(`Retry attempt ${retries + 1}. Waiting ${delay}ms before next attempt.`);
      await wait(delay);
      retries++;
    }
  }
}

/**
 * @class SupplyTracker
 * @description Classe responsable de suivre la supply (top holders, team, fresh, ou bundle) d'un token.
 */
class SupplyTracker {
  /**
   * @param {Object} bot - Instance du bot Telegram.
   * @param {Object} accessControl - Instance du controle d'accès (pour déterminer le rôle de l'utilisateur).
   */
  constructor(bot, accessControl) {
    // Map<string, Map<string, trackerObject>>
    this.userTrackers = new Map();
    this.bot = bot;
    this.accessControl = accessControl;

    // Fichier où seront stockées les infos de tracking
    this.saveFilePath = path.join(__dirname, '../data/trackers.json');

    // Mise en place des intervalles pour sauvegarde + nettoyage
    this.saveInterval = setInterval(() => this.saveTrackers(), SAVE_INTERVAL);
    this.cleanupInterval = setInterval(() => this.cleanupExpiredTrackers(), CLEANUP_INTERVAL);
  }

  /**
   * Initialise le SupplyTracker en chargeant les trackers depuis le fichier
   * et en nettoyant immédiatement les trackers expirés.
   */
  async init() {
    try {
      await this.loadTrackers();
      // Nettoyage initial au démarrage
      await this.cleanupExpiredTrackers();
      logger.info('SupplyTracker initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize SupplyTracker:', error);
      throw new Error('SupplyTracker initialization failed');
    }
  }

  /**
   * Nettoie les trackers qui ont dépassé la durée d'expiration (31 jours).
   */
  async cleanupExpiredTrackers() {
    const now = Date.now();
    let trackersRemoved = 0;

    logger.debug('Starting cleanup check...');

    for (const [chatId, trackers] of this.userTrackers.entries()) {
      for (const [trackerId, tracker] of trackers.entries()) {
        const age = now - tracker.startTimestamp;
        logger.debug(
          `Checking tracker ${trackerId} - Age: ${age / 1000}s / ${EXPIRY_TIME / 1000}s`
        );

        if (age > EXPIRY_TIME) {
          logger.debug(`Removing expired tracker ${trackerId} for chat ${chatId}`);
          await this.notifyExpiry(tracker);
          this.stopTracking(chatId, trackerId);
          trackersRemoved++;
        }
      }
    }

    if (trackersRemoved > 0) {
      logger.debug(`Cleaned up ${trackersRemoved} expired trackers`);
      await this.saveTrackers();
    }
  }

  /**
   * Envoie un message à l'utilisateur pour lui indiquer que le tracking a expiré.
   */
  async notifyExpiry(tracker) {
    const message = `⌛ Tracking expired for ${tracker.ticker}\n\n` +
                    `The ${tracker.trackType} supply tracking has been automatically stopped after 31 days.\n` +
                    `If you want to continue tracking, please start a new tracking session.`;
    try {
      await this.bot.sendMessage(tracker.chatId, message);
    } catch (error) {
      logger.error(`Failed to send expiry notification for ${tracker.ticker}:`, error);
    }
  }

  /**
   * Sauvegarde tous les trackers dans le fichier JSON configuré.
   */
  async saveTrackers() {
    const trackersData = {};
    for (const [chatId, trackers] of this.userTrackers.entries()) {
      trackersData[chatId] = Array.from(trackers.entries()).map(([trackerId, tracker]) => ({
        trackerId,
        chatId: tracker.chatId,
        wallets: tracker.wallets,
        initialSupplyPercentage: tracker.initialSupplyPercentage.toString(),
        currentSupplyPercentage: tracker.currentSupplyPercentage.toString(),
        totalSupply: tracker.totalSupply.toString(),
        significantChangeThreshold: tracker.significantChangeThreshold.toString(),
        ticker: tracker.ticker,
        decimals: tracker.decimals,
        trackType: tracker.trackType,
        tokenAddress: tracker.tokenAddress,
        startTimestamp: tracker.startTimestamp
      }));
    }
    try {
      await fs.writeFile(this.saveFilePath, JSON.stringify(trackersData, null, 2));
    } catch (error) {
      logger.error('Error saving trackers:', error);
    }
  }

  /**
   * Charge les trackers depuis le fichier JSON et ignore ceux déjà expirés.
   */
  async loadTrackers() {
    try {
      const data = await fs.readFile(this.saveFilePath, 'utf8');
      const trackersData = JSON.parse(data);
      const now = Date.now();

      for (const [chatId, trackers] of Object.entries(trackersData)) {
        const userTrackers = new Map();
        for (const tracker of trackers) {
          // Ignore les trackers déjà expirés
          if (now - tracker.startTimestamp > EXPIRY_TIME) {
            logger.debug(`Skipping expired tracker ${tracker.trackerId} during load`);
            continue;
          }

          const restoredTracker = {
            ...tracker,
            initialSupplyPercentage: new BigNumber(tracker.initialSupplyPercentage),
            currentSupplyPercentage: new BigNumber(tracker.currentSupplyPercentage),
            totalSupply: new BigNumber(tracker.totalSupply),
            significantChangeThreshold: new BigNumber(tracker.significantChangeThreshold),
            // Recrée l'interval de check
            intervalId: setInterval(() => this.checkSupply(chatId, tracker.trackerId), CHECK_INTERVAL)
          };
          userTrackers.set(tracker.trackerId, restoredTracker);
        }
        if (userTrackers.size > 0) {
          this.userTrackers.set(chatId, userTrackers);
        }
      }
      logger.debug('Trackers loaded successfully');
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.debug('No saved trackers found. Starting with empty tracker list.');
      } else {
        logger.error('Error loading trackers:', error);
      }
    }
  }

  /**
   * Démarre un nouveau tracking (top holders, team, fresh, ou bundle).
   */
  async startTracking(
    tokenAddress,
    chatId,
    wallets,
    initialSupplyPercentage,
    totalSupply,
    significantChangeThreshold,
    ticker,
    decimals,
    trackType,
  ) {
    logger.debug(`Starting tracking for user ${chatId}`, {
      tokenAddress,
      chatId,
      hasWallets: !!wallets,
      initialSupplyPercentage,
      totalSupply,
      significantChangeThreshold,
      ticker,
      decimals,
      trackType
    });

    if (!this.userTrackers.has(chatId)) {
      this.userTrackers.set(chatId, new Map());
    }
    const userTrackers = this.userTrackers.get(chatId);

    // Limite fixe de 5 trackers par utilisateur
    const MAX_TRACKERS = 5;

    if (userTrackers.size >= MAX_TRACKERS) {
      throw new Error(
        `You've reached your maximum number of simultaneous trackings (${MAX_TRACKERS}). ` +
        `Please stop an existing tracking with /tracker before starting a new one.`
      );
    }

    const trackerId = `${tokenAddress}_${trackType}`;
    if (userTrackers.has(trackerId)) {
      throw new Error(`Already tracking ${trackType} for ${tokenAddress}`);
    }

    const now = Date.now();
    const expiryDate = new Date(now + EXPIRY_TIME);
    logger.debug(`Creating new tracker with timestamp ${now} - Will expire at ${expiryDate.toLocaleString()} (in 31 days)`);

    const tracker = {
      chatId,
      initialSupplyPercentage: new BigNumber(initialSupplyPercentage),
      currentSupplyPercentage: new BigNumber(initialSupplyPercentage),
      totalSupply: new BigNumber(totalSupply),
      significantChangeThreshold: new BigNumber(significantChangeThreshold),
      ticker,
      decimals,
      trackType,
      tokenAddress,
      startTimestamp: now,
      // Store wallets for team, fresh, or bundle tracking
      ...((trackType === 'team' || trackType === 'fresh' || trackType === 'bundle') && { wallets }),
      intervalId: setInterval(() => this.checkSupply(chatId, trackerId), CHECK_INTERVAL)
    };

    userTrackers.set(trackerId, tracker);
    this.userTrackers.set(chatId.toString(), userTrackers);
    await this.saveTrackers();
  }

  /**
   * Stoppe un tracking en cours pour un utilisateur donné.
   */
  stopTracking(chatId, trackerId) {
    // Si c'est un ID de groupe (les IDs de groupe sont négatifs dans Telegram)
    const isGroup = chatId < 0;
    let userTrackers;
    
    if (isGroup) {
        // Pour les groupes, chercher avec l'ID du groupe
        userTrackers = this.userTrackers.get(chatId.toString());
    } else {
        // Pour les chats privés, comportement normal
        userTrackers = this.userTrackers.get(chatId.toString());
    }

    if (!userTrackers) {
        logger.debug(`No trackers found for ${isGroup ? 'group' : 'user'} ${chatId}`);
        return false;
    }
    
    const tracker = userTrackers.get(trackerId);
    if (!tracker) return false;

    clearInterval(tracker.intervalId);
    userTrackers.delete(trackerId);

    if (userTrackers.size === 0) {
        this.userTrackers.delete(chatId.toString());
    }
    return true;
  }

  /**
   * Retourne la liste des supply trackées par un utilisateur.
   */
  getTrackedSuppliesByUser(chatId) {
    const userTrackers = this.userTrackers.get(chatId.toString());
    if (!userTrackers) {
      logger.debug(`No trackers found for user ${chatId}`);
      return [];
    }
   
    return Array.from(userTrackers.entries()).map(([trackerId, tracker]) => ({
      trackerId,
      tokenAddress: tracker.tokenAddress,
      ticker: tracker.ticker,
      currentSupplyPercentage: tracker.currentSupplyPercentage.toFixed(2),
      trackType: tracker.trackType,
      significantChangeThreshold: tracker.significantChangeThreshold.toFixed(2),
      wallets: (tracker.trackType === 'team' || tracker.trackType === 'fresh' || tracker.trackType === 'bundle') ? tracker.wallets : [] // Include wallets for team, fresh, and bundle tracking
    }));
   }

 /**
 * Vérifie la supply (team, fresh, bundle, ou top holders) et notifie en cas de changement significatif.
 * Includes special handling for 0% fresh wallet bug with full analysis retry.
 */
async checkSupply(chatId, trackerId) {
  logger.debug(`Checking supply for ${chatId}, trackerId: ${trackerId}`);
  const userTrackers = this.userTrackers.get(chatId);
  if (!userTrackers) {
    logger.debug(`No trackers found for user ${chatId}`);
    return;
  }

  const tracker = userTrackers.get(trackerId);
  logger.debug(`Current tracker info:`, tracker);
  if (!tracker) {
    logger.debug(`No tracker found for ID ${trackerId} of user ${chatId}`);
    return;
  }

  try {
    await retryWithBackoff(async () => {
      let newSupplyPercentage;

      if (tracker.trackType === 'team') {
        // Pour le tracking team, utiliser les wallets
        newSupplyPercentage = await this.getTeamSupply(
          tracker.wallets,
          tracker.tokenAddress,
          tracker.totalSupply,
          tracker.decimals,
          'supply', 
          'check' 
        );
      } else if (tracker.trackType === 'fresh') {
        // Special handling for fresh wallets with 0% bug detection and retry
        newSupplyPercentage = await this.getFreshSupplyWithRetry(
          tracker.wallets,
          tracker.tokenAddress,
          tracker.totalSupply,
          tracker.decimals,
          tracker.currentSupplyPercentage,
          'supply',
          'freshCheck'
        );
      } else if (tracker.trackType === 'bundle') {
        // Pour le tracking bundle wallets, utiliser getControlledSupply
        newSupplyPercentage = await this.getControlledSupply(
          tracker.wallets,
          tracker.tokenAddress,
          tracker.totalSupply,
          tracker.decimals,
          'supply',
          'bundleCheck'
        );
      } else {
        // Pour le tracking top holders, utiliser scanToken
        const scanResult = await scanToken(
          tracker.tokenAddress,
          20,  // nombre de holders
          false,
          'supplyCheck'
        );
        if (!scanResult || typeof scanResult.totalSupplyControlled !== 'number') {
          throw new Error(`Invalid scan result for ${tracker.tokenAddress}`);
        }
        newSupplyPercentage = new BigNumber(scanResult.totalSupplyControlled);
      }

      if (newSupplyPercentage.isNaN() || !newSupplyPercentage.isFinite()) {
        throw new Error(`Invalid supply percentage calculated for ${tracker.tokenAddress}`);
      }

      const change = newSupplyPercentage.minus(tracker.initialSupplyPercentage);
      if (change.abs().isGreaterThanOrEqualTo(tracker.significantChangeThreshold)) {
        await this.notifyChange(tracker, newSupplyPercentage, change);
        tracker.initialSupplyPercentage = newSupplyPercentage;
      }

      tracker.currentSupplyPercentage = newSupplyPercentage;
    });
  } catch (error) {
    logger.error(`Error checking supply for ${tracker.tokenAddress}:`, {
      error: error.message,
      stack: error.stack,
      tokenAddress: tracker.tokenAddress,
      trackType: tracker.trackType
    });
  }
}

/**
 * Special method to handle fresh wallet supply calculation with 0% bug detection and retry.
 * If 0% is detected, it re-runs the entire fresh wallet analysis up to 3 times with exponential backoff.
 */
async getFreshSupplyWithRetry(wallets, tokenAddress, totalSupply, decimals, currentSupplyPercentage, mainContext, subContext) {
  const MAX_RETRIES = 3;
  const INITIAL_DELAY = 2000; // 2 seconds
  
  logger.debug(`Getting fresh supply for ${tokenAddress}`, {
    walletsCount: wallets?.length || 0,
    currentSupplyPercentage: currentSupplyPercentage.toString()
  });

  // First, try the normal supply calculation
  let supplyPercentage = await this.getControlledSupply(
    wallets,
    tokenAddress,
    totalSupply,
    decimals,
    mainContext,
    subContext
  );

  // Check if we got 0% and the previous value was > 0%
  const isZeroPercent = supplyPercentage.isEqualTo(0);
  const hadPreviousSupply = currentSupplyPercentage.isGreaterThan(0);

  if (isZeroPercent && hadPreviousSupply) {
    logger.warn(`Detected 0% fresh supply for ${tokenAddress} (previously ${currentSupplyPercentage.toFixed(2)}%). This is likely a Helius API issue. Starting retry process...`);
    
    let retryCount = 0;
    
    while (retryCount < MAX_RETRIES) {
      try {
        const delay = INITIAL_DELAY * Math.pow(2, retryCount);
        logger.info(`Retry attempt ${retryCount + 1}/${MAX_RETRIES} for fresh wallet analysis of ${tokenAddress}. Waiting ${delay}ms...`);
        
        // Wait with exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Re-run the entire fresh wallet analysis
        logger.debug(`Re-running full fresh wallet analysis for ${tokenAddress}...`);
        const { analyzeFreshWallets } = require('../analysis/freshWallets');
        const freshAnalysisResult = await analyzeFreshWallets(tokenAddress, mainContext);
        
        if (!freshAnalysisResult || !freshAnalysisResult.scanData) {
          throw new Error('Fresh wallet analysis returned invalid data');
        }
        
        // Recalculate supply percentage from the fresh analysis
        const freshSupplyPercentage = new BigNumber(freshAnalysisResult.scanData.totalSupplyControlled || 0);
        
        logger.info(`Fresh wallet analysis retry ${retryCount + 1} completed. New supply: ${freshSupplyPercentage.toFixed(2)}%`);
        
        // If we got a non-zero result, use it
        if (freshSupplyPercentage.isGreaterThan(0)) {
          logger.info(`Successfully recovered from 0% bug. Fresh supply is now ${freshSupplyPercentage.toFixed(2)}%`);
          return freshSupplyPercentage;
        }
        
        // If still 0%, continue to next retry
        logger.warn(`Retry ${retryCount + 1} still returned 0%. Continuing to next retry...`);
        
      } catch (error) {
        logger.error(`Error during fresh wallet analysis retry ${retryCount + 1}:`, {
          error: error.message,
          tokenAddress,
          retryCount: retryCount + 1
        });
        
        // If this was the last retry, we'll fall through to return the 0%
        if (retryCount === MAX_RETRIES - 1) {
          logger.error(`All ${MAX_RETRIES} retries failed for ${tokenAddress}. Will proceed with 0% value.`);
          break;
        }
      }
      
      retryCount++;
    }
    
    // If we reach here, all retries failed or still returned 0%
    logger.warn(`After ${MAX_RETRIES} retries, fresh supply for ${tokenAddress} is still 0%. This will be reported to Telegram.`);
  }

  return supplyPercentage;
}


  /**
   * Récupère le solde d'un wallet pour un token donné, en gérant les retries (backoff).
   */
  async getTokenBalance(walletAddress, tokenAddress, mainContext, subContext) {
    return retryWithBackoff(async () => {
      try {
        // Handle case where walletAddress is an object
        const address = typeof walletAddress === 'object' ? 
          (walletAddress.address || '') : walletAddress;
        
        if (!address || !tokenAddress) {
          logger.warn(`Invalid wallet address or token address:`, {
            wallet: typeof walletAddress === 'object' ? 'object' : walletAddress,
            token: tokenAddress
          });
          return new BigNumber(0);
        }
        
        logger.debug(`Getting token balance for ${address.slice(0, 8)}...`);
        const tokenAccounts = await solanaApi.getTokenAccountsByOwner(address, tokenAddress, mainContext, subContext);
        
        if (
          tokenAccounts &&
          tokenAccounts.length > 0 &&
          tokenAccounts[0].account?.data?.parsed?.info?.tokenAmount?.amount
        ) {
          const balance = new BigNumber(tokenAccounts[0].account.data.parsed.info.tokenAmount.amount);
          logger.debug(`Found balance for ${address.slice(0, 8)}...: ${balance.toString()}`);
          return balance;
        }
        
        logger.warn(`No valid token account found for wallet ${address} and token ${tokenAddress}`);
        return new BigNumber(0);
      } catch (error) {
        logger.error(`Error getting token balance:`, { 
          wallet: typeof walletAddress === 'object' ? JSON.stringify(walletAddress).slice(0, 50) : walletAddress,
          error: error.message
        });
        // Return 0 instead of throwing so tracking can continue
        return new BigNumber(0);
      }
    });
  }

  /**
   * Calcule le pourcentage de supply contrôlé par les wallets passés en paramètre.
   */
  async getControlledSupply(controllingWallets, tokenAddress, totalSupply, decimals, mainContext, subContext) {
    logger.debug(`Calculating controlled supply for ${tokenAddress}`, {
      wallets: controllingWallets,
      totalSupply,
      decimals
    });
    if (!controllingWallets || controllingWallets.length === 0) {
      logger.warn(`No controlling wallets found for ${tokenAddress}. Returning 0.`);
      return new BigNumber(0);
    }

    const balances = await Promise.all(
      controllingWallets.map(wallet => {
        if (typeof wallet === 'string') {
          return this.getTokenBalance(wallet, tokenAddress, mainContext, subContext);
        } else if (wallet && wallet.address) {
          return this.getTokenBalance(wallet.address, tokenAddress, mainContext, subContext);
        } else {
          logger.warn(`Invalid wallet structure: ${JSON.stringify(wallet)}`);
          return new BigNumber(0);
        }
      })
    );

    const totalBalance = balances.reduce(
      (total, balance) => total.plus(balance.dividedBy(new BigNumber(10).pow(decimals))),
      new BigNumber(0)
    );
    const supplyPercentage = totalBalance.dividedBy(totalSupply).multipliedBy(100);
    logger.debug(`Total controlled balance: ${totalBalance.toString()}, Supply percentage: ${supplyPercentage.toFixed(2)}%`);
    return supplyPercentage;
  }

  /**
   * Calcule le pourcentage de supply contrôlé par des team wallets.
   */
  async getTeamSupply(teamWallets, tokenAddress, totalSupply, decimals, mainContext, subContext) {
    logger.debug(`Calculating team supply for ${tokenAddress}`, {
      wallets: teamWallets?.slice(0, 3) || [], // Log just a few wallets for brevity
      totalWallets: teamWallets?.length || 0,
      totalSupply,
      decimals
    });
    if (!teamWallets || teamWallets.length === 0) {
      logger.warn(`No team wallets found for ${tokenAddress}. Returning 0.`);
      return new BigNumber(0);
    }

    const balances = await Promise.all(
      teamWallets.map(wallet => this.getTokenBalance(wallet, tokenAddress, mainContext, subContext))
    );
    const totalBalance = balances.reduce(
      (total, balance) => total.plus(balance.dividedBy(new BigNumber(10).pow(decimals))),
      new BigNumber(0)
    );
    const supplyPercentage = totalBalance.dividedBy(totalSupply).multipliedBy(100);
    logger.debug(`Total team balance: ${totalBalance.toString()}, Supply percentage: ${supplyPercentage.toFixed(2)}%`);
    return supplyPercentage;
  }

 /**
 * Enhanced notification method that includes context about retries for 0% values
 */
async notifyChange(tracker, newPercentage, change) {
  const emoji = change.isGreaterThan(0) ? '📈' : '📉';
  const changeStr = change.isGreaterThan(0) ? `+${change.toFixed(2)}` : change.toFixed(2);
  
  let message = `⚠️ Significant change detected in ${tracker.trackType} supply for ${tracker.ticker}\n`;
  message += `${tracker.trackType.charAt(0).toUpperCase() + tracker.trackType.slice(1)} wallets now hold ${newPercentage.toFixed(2)}% (previously ${tracker.initialSupplyPercentage.toFixed(2)}%)\n`;
  message += `${emoji} ${changeStr}%`;
  
  // Add special note for 0% values that might be due to API issues
  if (newPercentage.isEqualTo(0) && tracker.trackType === 'fresh') {
    message += `\n\n⚠️ Note: 0% supply detected. This was verified with multiple retries to account for potential API issues.`;
  }
  
  try {
    await this.bot.sendMessage(tracker.chatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    logger.info(`Notification sent for ${tracker.trackType} supply change:`, {
      chatId: tracker.chatId,
      tokenAddress: tracker.tokenAddress,
      oldPercentage: tracker.initialSupplyPercentage.toFixed(2),
      newPercentage: newPercentage.toFixed(2),
      change: changeStr
    });
  } catch (error) {
    logger.error('Error sending supply change notification:', {
      error: error.message,
      chatId: tracker.chatId,
      tokenAddress: tracker.tokenAddress
    });
  }
}

  /**
   * Notifie l'utilisateur en cas d'erreur lors du tracking.
   */
  async notifyError(tracker, error) {
    const errorMessage =
      `⚠️ Error occurred while tracking ${tracker.trackType} supply for ${tracker.ticker}\n\n` +
      `Error: ${error.message}\n\n` +
      `Tracking will continue, but you may want to check the tracked supply again.`;

    try {
      await this.bot.sendMessage(tracker.chatId, errorMessage);
    } catch (sendError) {
      logger.error(`Failed to send error notification for ${tracker.ticker}:`, sendError);
    }
  }
}

/**
 * @function initializeSupplyTracker
 * @description Crée et initialise une instance de SupplyTracker.
 * @param {Object} bot - Instance du bot Telegram.
 * @param {Object} accessControlInstance - Instance du controle d'accès.
 * @returns {Promise<SupplyTracker>}
 */
async function initializeSupplyTracker(bot, accessControlInstance) {
  const supplyTrackerInstance = new SupplyTracker(bot, accessControlInstance);
  try {
    await supplyTrackerInstance.init();
    // L'instance est prête à l'emploi
    return supplyTrackerInstance;
  } catch (error) {
    logger.error('Error initializing SupplyTracker:', error);
    throw error;
  }
}

// Exportation de la classe et de la fonction
module.exports = {
  SupplyTracker,
  initializeSupplyTracker
};