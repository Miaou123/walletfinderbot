const { analyzeBestTraders } = require('../../analysis/bestTraders');
const unifiedFormatter = require('../formatters/unifiedFormatter');
const { validateSolanaAddress } = require('./helpers');
const commandFactory = require('./commandFactory');
const requestManager = require('../../utils/requestManager');

/**
 * Parse best traders command arguments
 * @param {Array} args - Command arguments
 * @returns {Object} Parsed parameters
 */
function parseArguments(args) {
  const [contractAddress, ...otherArgs] = args;
  let winrateThreshold = 30;
  let portfolioThreshold = 5000;
  let sortOption = 'winrate';

  for (const arg of otherArgs) {
    const lowercaseArg = arg.toLowerCase();
    // Check if arg is a sort option
    if (['pnl', 'winrate', 'wr', 'portfolio', 'port', 'sol', 'rank', 'totalpnl'].includes(lowercaseArg)) {
      sortOption = lowercaseArg;
    } else {
      const num = parseFloat(arg);
      if (!isNaN(num)) {
        if (num >= 0 && num <= 100) {
          winrateThreshold = num;
        } else if (num > 100 && num <= 1000000) {
          portfolioThreshold = num;
        }
      }
    }
  }

  return {
    contractAddress,
    winrateThreshold,
    portfolioThreshold,
    sortOption
  };
}

/**
 * Validate best traders command arguments
 * @param {Array} args - Command arguments
 * @returns {Object} Validation result
 */
function validateArgs(args) {
  if (!args || args.length === 0) {
    return {
      isValid: false,
      errorMessage: "Please provide a token address. Usage: /bt [token_address] [winrate_threshold]* [portfolio_threshold]* [sort_option]*"
    };
  }

  if (!validateSolanaAddress(args[0])) {
    return {
      isValid: false,
      errorMessage: "Invalid Solana address. Please provide a valid Solana token address."
    };
  }

  return { isValid: true };
}

/**
 * Best traders analyzer function
 * @param {Object} params - Command parameters
 * @returns {Promise<Array>} Best traders data
 */
async function bestTradersAnalyzer(params) {
  const { contractAddress, winrateThreshold, portfolioThreshold, sortOption } = params;
  
  // Create cache key for this specific analysis
  const cacheKey = `best_traders_${contractAddress}_${winrateThreshold}_${portfolioThreshold}_${sortOption}`;
  
  // Use request manager to handle caching
  return requestManager.withCache(
    cacheKey,
    async () => {
      // Perform the analysis
      return await analyzeBestTraders(
        contractAddress,
        winrateThreshold,
        portfolioThreshold,
        sortOption,
        'bestTraders'
      );
    },
    {
      ttl: requestManager.cacheTimes.medium,
      limitType: 'default'
    }
  );
}

/**
 * Best traders formatter function
 * @param {Array} traders - Best traders data
 * @param {Object} params - Command parameters
 * @returns {string} Formatted result
 */
function formatBestTraders(traders, params) {
  return unifiedFormatter.formatBestTraders(traders, params);
}

/**
 * Create Best Traders Handler using command factory
 */
const BestTradersHandlerOptimized = commandFactory.createAnalysisCommand({
  name: 'besttraders',
  description: 'Analyze best traders for a specific token',
  analyzerFn: async (params) => {
    return await bestTradersAnalyzer(params);
  },
  formatFn: formatBestTraders,
  validateFn: (args, defaultValues) => validateArgs(args),
  minArgs: 1,
  maxArgs: 4,
  defaultValues: {
    winrateThreshold: 30,
    portfolioThreshold: 5000,
    sortOption: 'winrate'
  },
  
  // Override extractParams method in the factory to use our custom parser
  extractParams: parseArguments
});

module.exports = BestTradersHandlerOptimized;