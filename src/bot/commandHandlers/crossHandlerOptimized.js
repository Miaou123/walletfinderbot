const commandFactory = require('./commandFactory');
const crossAnalyzer = require('../../analysis/crossAnalyzerOptimized');
const unifiedFormatter = require('../formatters/unifiedFormatter');

/**
 * Creates an optimized cross handler using the command factory pattern
 */
const CrossHandlerOptimized = commandFactory.createCrossAnalysisCommand({
  name: 'cross',
  description: 'Cross-analyze multiple tokens to find common holders',
  analyzerFn: async (tokenAddresses, valueThreshold, context, subContext) => {
    return await crossAnalyzer.analyzeCrossTokens(
      tokenAddresses,
      valueThreshold,
      context,
      subContext
    );
  },
  formatFn: (result, params) => {
    return unifiedFormatter.formatCrossAnalysis(result);
  },
  minTokens: 2,
  maxTokens: 5,
  defaultValueThreshold: 10000
});

module.exports = CrossHandlerOptimized;