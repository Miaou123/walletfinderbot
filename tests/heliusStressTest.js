// test/heliusStressTest.js - Comprehensive stress test for all endpoints
const { getSolanaApi } = require('../src/integrations/solanaApi');
const HeliusRateLimiter = require('../src/utils/rateLimiters/heliusRateLimiter');
const logger = require('../src/utils/logger');

class HeliusStressTest {
  constructor() {
    this.solanaApi = getSolanaApi();
    this.results = {
      startTime: null,
      endTime: null,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      endpointResults: {},
      rateLimiterStats: {},
      errors: []
    };

    // Test data - mix of real and common addresses
    this.testData = {
      // Popular token addresses for testing
      tokens: [
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
        'So11111111111111111111111111111111111111112',   // SOL
        '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
        'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
      ],
      
      // Mix of whale wallets and regular wallets for testing
      wallets: [
        '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', // Popular wallet
        'GThUX1Atko4tqhN2NaiTazWSeFWMuiUiQG4v3fR6c8Av', // Another wallet
        '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Whale wallet
        'EhYXQP36mfREUt8bqjDFdFQAjKf99Q7QzXp7P3mfMYpD', // Random wallet
        'BbGEbgMidG9y3Cje5t6yA4fwLq8PgcBG1HqE1BgvM2Ac', // Another test wallet
      ],

      // Transaction signatures for testing
      signatures: [
        '4hXTCkRzt9WyecNzV1XPgCDfGAZzhs1AHLdmgTGhqeUsywVkAzfHpd1FsrM1kUhFu5VnhsxzQnr1eKsGG1N1pJ1X',
        '3KxwJKCZFLEMK6qLVdaYnYoBYFE8r8Tq2kL8NhDdQLpwP7YqX9QnY2vR4B6AXtXBkzjhfQLJQy4ZqMmG9aJVFNd',
        // These might not exist, but will test error handling
      ]
    };
  }

  async runStressTest(options = {}) {
    const config = {
      duration: options.duration || 300000,        // 5 minutes default
      concurrency: options.concurrency || 50,      // 50 concurrent operations
      rampUpTime: options.rampUpTime || 30000,     // 30 seconds ramp up
      testMix: options.testMix || 'all',           // 'rpc', 'api', or 'all'
      intensity: options.intensity || 'high',      // 'low', 'medium', 'high', 'extreme'
      ...options
    };

    logger.info('🚀 Starting Helius Stress Test', config);
    this.results.startTime = Date.now();

    try {
      // Initialize rate limiter stats
      this.logInitialStats();

      // Run different test phases
      await this.runTestPhases(config);

      // Final analysis
      await this.analyzeResults();

    } catch (error) {
      logger.error('Stress test failed:', error);
      this.results.errors.push({
        type: 'CRITICAL_ERROR',
        message: error.message,
        timestamp: Date.now()
      });
    } finally {
      this.results.endTime = Date.now();
      this.generateReport();
    }
  }

  async runTestPhases(config) {
    const phases = [
      { name: 'Warm-up', duration: 30000, intensity: 0.3 },
      { name: 'Ramp-up', duration: config.rampUpTime, intensity: 0.7 },
      { name: 'Peak Load', duration: config.duration * 0.6, intensity: 1.0 },
      { name: 'Sustained Load', duration: config.duration * 0.3, intensity: 0.8 },
      { name: 'Cool-down', duration: 30000, intensity: 0.2 }
    ];

    for (const phase of phases) {
      logger.info(`📊 Phase: ${phase.name} (${phase.duration}ms, ${phase.intensity * 100}% intensity)`);
      await this.runPhase(phase, config);
      
      // Log stats between phases
      this.logPhaseStats(phase.name);
      
      // Brief pause between phases
      await this.delay(2000);
    }
  }

  async runPhase(phase, config) {
    const startTime = Date.now();
    const endTime = startTime + phase.duration;
    const activeOperations = new Set();

    while (Date.now() < endTime) {
      const currentConcurrency = Math.floor(config.concurrency * phase.intensity);
      
      // Maintain target concurrency
      while (activeOperations.size < currentConcurrency && Date.now() < endTime) {
        const operation = this.createRandomOperation(config.testMix);
        activeOperations.add(operation);
        
        operation.finally(() => {
          activeOperations.delete(operation);
        });
      }

      // Brief pause to control rate
      await this.delay(100);
    }

    // Wait for remaining operations to complete
    if (activeOperations.size > 0) {
      logger.info(`Waiting for ${activeOperations.size} operations to complete...`);
      await Promise.allSettled([...activeOperations]);
    }
  }

  createRandomOperation(testMix) {
    const rpcEndpoints = [
      'getTokenAccountsByOwner',
      'getBalance',
      'getTokenSupply',
      'getAccountInfo',
      'getTokenLargestAccounts',
      'getSignaturesForAddress',
      'getTransaction',
      'getTokenMetadata'
    ];

    const apiEndpoints = [
      'getAssetsByOwner',
      'getAsset',
      'getTokenAccounts',
      'getAssetCount'
    ];

    let endpoints;
    if (testMix === 'rpc') {
      endpoints = rpcEndpoints;
    } else if (testMix === 'api') {
      endpoints = apiEndpoints;
    } else {
      endpoints = [...rpcEndpoints, ...apiEndpoints];
    }

    const endpoint = this.randomChoice(endpoints);
    return this.executeEndpointTest(endpoint);
  }

  async executeEndpointTest(endpoint) {
    const startTime = Date.now();
    
    try {
      let result;
      const context = `stress_test_${endpoint}`;
      
      switch (endpoint) {
        case 'getTokenAccountsByOwner':
          const wallet = this.randomChoice(this.testData.wallets);
          const token = this.randomChoice(this.testData.tokens);
          result = await this.solanaApi.getTokenAccountsByOwner(wallet, token, context);
          break;

        case 'getBalance':
          const address = this.randomChoice(this.testData.wallets);
          result = await this.solanaApi.getBalance(address, context);
          break;

        case 'getTokenSupply':
          const tokenForSupply = this.randomChoice(this.testData.tokens);
          result = await this.solanaApi.getTokenSupply(tokenForSupply, context);
          break;

        case 'getAccountInfo':
          const accountAddress = this.randomChoice([...this.testData.wallets, ...this.testData.tokens]);
          result = await this.solanaApi.getAccountInfo(accountAddress, {}, context);
          break;

        case 'getTokenLargestAccounts':
          const tokenForLargest = this.randomChoice(this.testData.tokens);
          result = await this.solanaApi.getTokenLargestAccounts(tokenForLargest, context);
          break;

        case 'getSignaturesForAddress':
          const walletForSigs = this.randomChoice(this.testData.wallets);
          result = await this.solanaApi.getSignaturesForAddress(walletForSigs, { limit: 100 }, context);
          break;

        case 'getTransaction':
          const signature = this.randomChoice(this.testData.signatures);
          result = await this.solanaApi.getTransaction(signature, {}, context);
          break;

        case 'getTokenMetadata':
          const tokenForMeta = this.randomChoice(this.testData.tokens);
          result = await this.solanaApi.getTokenMetadata(tokenForMeta, context);
          break;

        case 'getAssetsByOwner':
          const ownerAddress = this.randomChoice(this.testData.wallets);
          result = await this.solanaApi.getAssetsByOwner(ownerAddress, 50, {}, context);
          break;

        case 'getAsset':
          const assetId = this.randomChoice(this.testData.tokens);
          result = await this.solanaApi.getAsset(assetId, context);
          break;

        case 'getTokenAccounts':
          const mintForAccounts = this.randomChoice(this.testData.tokens);
          result = await this.solanaApi.getTokenAccounts(mintForAccounts, 100, null, context);
          break;

        case 'getAssetCount':
          const ownerForCount = this.randomChoice(this.testData.wallets);
          result = await this.solanaApi.getAssetCount(ownerForCount, context);
          break;

        default:
          throw new Error(`Unknown endpoint: ${endpoint}`);
      }

      // Record success
      this.recordResult(endpoint, true, Date.now() - startTime, result);

    } catch (error) {
      // Record failure
      this.recordResult(endpoint, false, Date.now() - startTime, null, error);
    }
  }

  recordResult(endpoint, success, duration, result, error = null) {
    this.results.totalRequests++;
    
    if (success) {
      this.results.successfulRequests++;
    } else {
      this.results.failedRequests++;
      this.results.errors.push({
        endpoint,
        error: error?.message || 'Unknown error',
        timestamp: Date.now()
      });
    }

    // Initialize endpoint stats if needed
    if (!this.results.endpointResults[endpoint]) {
      this.results.endpointResults[endpoint] = {
        total: 0,
        successful: 0,
        failed: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0
      };
    }

    const endpointStats = this.results.endpointResults[endpoint];
    endpointStats.total++;
    endpointStats.totalDuration += duration;
    endpointStats.minDuration = Math.min(endpointStats.minDuration, duration);
    endpointStats.maxDuration = Math.max(endpointStats.maxDuration, duration);

    if (success) {
      endpointStats.successful++;
    } else {
      endpointStats.failed++;
    }
  }

  logInitialStats() {
    const initialStats = HeliusRateLimiter.getStats();
    logger.info('📈 Initial Rate Limiter Stats:', initialStats);
  }

  logPhaseStats(phaseName) {
    const stats = HeliusRateLimiter.getStats();
    const currentResults = {
      phase: phaseName,
      totalRequests: this.results.totalRequests,
      successRate: `${((this.results.successfulRequests / this.results.totalRequests) * 100).toFixed(1)}%`,
      rateLimiterStats: stats
    };
    
    logger.info(`📊 ${phaseName} Stats:`, currentResults);
  }

  async analyzeResults() {
    // Get final rate limiter stats
    this.results.rateLimiterStats = HeliusRateLimiter.getStats();
    
    // Check if rate limiter is healthy
    const isHealthy = HeliusRateLimiter.isHealthy();
    
    // Calculate endpoint averages
    Object.keys(this.results.endpointResults).forEach(endpoint => {
      const stats = this.results.endpointResults[endpoint];
      stats.averageDuration = stats.totalDuration / stats.total;
      stats.successRate = (stats.successful / stats.total) * 100;
    });

    logger.info('🔍 Final Analysis:', {
      isHealthy,
      overallSuccessRate: `${((this.results.successfulRequests / this.results.totalRequests) * 100).toFixed(1)}%`,
      totalDuration: this.results.endTime - this.results.startTime,
      requestsPerSecond: (this.results.totalRequests / ((this.results.endTime - this.results.startTime) / 1000)).toFixed(2)
    });
  }

  generateReport() {
    const duration = this.results.endTime - this.results.startTime;
    const successRate = (this.results.successfulRequests / this.results.totalRequests) * 100;
    const requestsPerSecond = this.results.totalRequests / (duration / 1000);

    console.log('\n' + '='.repeat(80));
    console.log('🎯 HELIUS STRESS TEST REPORT');
    console.log('='.repeat(80));
    
    console.log('\n📊 OVERALL STATISTICS:');
    console.log(`Duration: ${(duration / 1000).toFixed(1)}s`);
    console.log(`Total Requests: ${this.results.totalRequests}`);
    console.log(`Successful: ${this.results.successfulRequests}`);
    console.log(`Failed: ${this.results.failedRequests}`);
    console.log(`Success Rate: ${successRate.toFixed(1)}%`);
    console.log(`Requests/Second: ${requestsPerSecond.toFixed(2)}`);
    
    console.log('\n🎯 ENDPOINT PERFORMANCE:');
    Object.entries(this.results.endpointResults).forEach(([endpoint, stats]) => {
      console.log(`${endpoint}:`);
      console.log(`  Requests: ${stats.total}`);
      console.log(`  Success Rate: ${stats.successRate.toFixed(1)}%`);
      console.log(`  Avg Duration: ${stats.averageDuration.toFixed(0)}ms`);
      console.log(`  Min/Max: ${stats.minDuration}ms / ${stats.maxDuration}ms`);
    });

    console.log('\n⚙️ RATE LIMITER STATS:');
    console.log(JSON.stringify(this.results.rateLimiterStats, null, 2));

    if (this.results.errors.length > 0) {
      console.log('\n❌ ERROR SUMMARY:');
      const errorCounts = {};
      this.results.errors.forEach(error => {
        const key = `${error.endpoint || 'UNKNOWN'}: ${error.error || error.message}`;
        errorCounts[key] = (errorCounts[key] || 0) + 1;
      });
      
      Object.entries(errorCounts).forEach(([error, count]) => {
        console.log(`${error}: ${count} occurrences`);
      });
    }

    console.log('\n' + '='.repeat(80));
  }

  // Utility methods
  randomChoice(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Usage examples and presets
const StressTestPresets = {
  // Quick test for development
  quick: {
    duration: 60000,      // 1 minute
    concurrency: 20,
    intensity: 'medium'
  },

  // Standard stress test
  standard: {
    duration: 300000,     // 5 minutes
    concurrency: 50,
    intensity: 'high'
  },

  // Extreme load test
  extreme: {
    duration: 600000,     // 10 minutes
    concurrency: 100,
    intensity: 'extreme'
  },

  // RPC-only test
  rpcOnly: {
    duration: 300000,
    concurrency: 60,
    testMix: 'rpc'
  },

  // API-only test
  apiOnly: {
    duration: 300000,
    concurrency: 30,
    testMix: 'api'
  },

  // Circuit breaker test (designed to trigger failures)
  circuitBreakerTest: {
    duration: 180000,     // 3 minutes
    concurrency: 150,     // Intentionally high to trigger circuit breaker
    intensity: 'extreme'
  }
};

// CLI runner
async function runStressTest() {
  const testType = process.argv[2] || 'standard';
  const preset = StressTestPresets[testType];
  
  if (!preset) {
    console.error('Available presets:', Object.keys(StressTestPresets).join(', '));
    process.exit(1);
  }

  const stressTest = new HeliusStressTest();
  await stressTest.runStressTest(preset);
}

// Export for programmatic use
module.exports = { HeliusStressTest, StressTestPresets };

// Run if called directly
if (require.main === module) {
  runStressTest().catch(console.error);
}