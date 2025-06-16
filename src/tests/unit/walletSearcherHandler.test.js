const WalletSearcherHandler = require('../../bot/commandHandlers/walletSearcherHandler');
const { WalletService } = require('../../database');
const logger = require('../../utils/logger');

// Mock dependencies
jest.mock('../../database', () => ({
  WalletService: {
    getWalletsByCriteria: jest.fn(),
  }
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

describe('WalletSearcherHandler', () => {
  let handler;
  let mockBot;
  let mockAccessControl;
  let mockMsg;
  let mockQuery;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock access control
    mockAccessControl = {
      isAllowed: jest.fn().mockResolvedValue(true)
    };

    // Mock bot
    mockBot = {
      sendMessage: jest.fn().mockResolvedValue({ message_id: 123 }),
      editMessageText: jest.fn().mockResolvedValue({}),
      answerCallbackQuery: jest.fn().mockResolvedValue({}),
      sendLongMessage: jest.fn().mockResolvedValue({})
    };

    // Mock message
    mockMsg = {
      chat: { id: 'chat123' },
      from: { id: 'user123', username: 'testuser' },
      message_thread_id: null
    };

    // Mock callback query
    mockQuery = {
      id: 'query123',
      data: 'walletSearch:search',
      message: {
        chat: { id: 'chat123' },
        message_id: 123,
        text: `
<b>Wallet Search</b>

Search for wallets based on your criteria:

<b>Current Criteria:</b>
- Win Rate: ≥ 50%
- Portfolio Value: ≥ $10,000
- 30d Profit: ≥ $1,000
- SOL Balance: ≥ 10 SOL
`
      }
    };

    // Create handler instance
    handler = new WalletSearcherHandler(mockAccessControl);
  });

  describe('handleCommand', () => {
    it('should check subscription and send initial message', async () => {
      await handler.handleCommand(mockBot, mockMsg, [], null);
      
      expect(mockAccessControl.isAllowed).toHaveBeenCalledWith('user123');
      expect(mockBot.sendMessage).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Starting WalletSearcher command'));
    });

    it('should reject non-premium users', async () => {
      mockAccessControl.isAllowed.mockResolvedValue(false);
      
      await handler.handleCommand(mockBot, mockMsg, [], null);
      
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        'chat123',
        expect.stringContaining('Premium feature'),
        expect.any(Object)
      );
    });
  });

  describe('handleCallback', () => {
    it('should handle search action and execute search', async () => {
      // Mock wallet data
      const mockWallets = [
        {
          address: '0x123...789',
          winrate: 70,
          total_value: 15000,
          sol_balance: '20',
          realized_profit_30d: 2000
        }
      ];
      
      WalletService.getWalletsByCriteria.mockResolvedValue(mockWallets);
      
      await handler.handleCallback(mockBot, { ...mockQuery, data: 'walletSearch:search' });
      
      expect(mockBot.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Searching wallets'),
        expect.any(Object)
      );
      
      expect(WalletService.getWalletsByCriteria).toHaveBeenCalledWith(expect.objectContaining({
        winrate: { $gte: 50 },
        total_value: { $gte: 10000 },
        realized_profit_30d: { $gte: 1000 },
        sol_balance: { $gte: '10' }
      }));
      
      // Should display results
      expect(mockBot.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Wallet Search Results'),
        expect.any(Object)
      );
    });

    it('should handle criteria selection', async () => {
      await handler.handleCallback(mockBot, { ...mockQuery, data: 'walletSearch:winrate' });
      
      expect(mockBot.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining('Select minimum win rate'),
        expect.any(Object)
      );
      
      expect(mockBot.answerCallbackQuery).toHaveBeenCalledWith('query123');
    });
  });

  describe('_parseStateFromMessage', () => {
    it('should correctly parse state from message text', () => {
      const message = `
<b>Wallet Search</b>

Search for wallets based on your criteria:

<b>Current Criteria:</b>
- Win Rate: ≥ 70%
- Portfolio Value: ≥ $50,000
- 30d Profit: ≥ $5,000
- SOL Balance: ≥ 25 SOL
`;

      const state = handler._parseStateFromMessage(message);
      
      expect(state).toEqual({
        winrate: 70,
        total_value: 50000,
        realized_profit_30d: 5000,
        sol_balance: 25
      });
    });

    it('should handle "Any" values in criteria', () => {
      const message = `
<b>Wallet Search</b>

Search for wallets based on your criteria:

<b>Current Criteria:</b>
- Win Rate: Any
- Portfolio Value: ≥ $10,000
- 30d Profit: Any
- SOL Balance: ≥ 10 SOL
`;

      const state = handler._parseStateFromMessage(message);
      
      expect(state).toEqual({
        winrate: 0,
        total_value: 10000,
        realized_profit_30d: 0,
        sol_balance: 10
      });
    });
  });
});