const BigNumber = require('bignumber.js');
const { getSolanaApi } = require('../integrations/solanaApi');

MIN_TOKEN_THRESHOLD = 1000;

async function getHolders(coinAddress) {
    const solanaApi = getSolanaApi();
    try {
      const tokenDecimals = await solanaApi.getTokenDecimals(coinAddress);
      console.log(`Token decimals: ${tokenDecimals}`);
  
      let allHolders = new Map();
      let cursor;
  
      while (true) {
        const result = await solanaApi.getTokenAccounts(coinAddress, 1000, cursor);
  
        if (!result || result.token_accounts.length === 0) {
          console.log('No more results');
          break;
        }
  
        result.token_accounts.forEach((account) => {
          const balance = new BigNumber(account.amount).dividedBy(new BigNumber(10).pow(tokenDecimals));
          if (balance.isGreaterThanOrEqualTo(MIN_TOKEN_THRESHOLD)) {
            allHolders.set(account.owner, {
              address: account.owner,
              balance: balance.toNumber(),
              tokenBalance: balance.toFixed()
            });
          }
        });
  
        console.log(`Total unique holders with >${MIN_TOKEN_THRESHOLD} tokens so far: ${allHolders.size}`);
  
        cursor = result.cursor;
  
        if (!cursor) {
          console.log('Stopping pagination: no more cursor');
          break;
        }
      }
  
      console.log(`Final total unique holders with >${MIN_TOKEN_THRESHOLD} tokens retrieved: ${allHolders.size}`);
  
      return Array.from(allHolders.values());
    } catch (error) {
      console.error('Error fetching holders:', error);
      throw error;
    }
  }
  
  async function getTopHolders(coinAddress, count = 20) {
    const solanaApi = getSolanaApi();
    try {
      let topHolders;
      if (count <= 20) {
        const result = await solanaApi.getTokenLargestAccounts(coinAddress);
  
        if (!result || !result.value) {
          throw new Error('Invalid response from Helius API');
        }
  
        topHolders = await Promise.all(result.value.map(async (account) => {
          const tokenAccountInfo = await solanaApi.getAccountInfo(account.address);
          const ownerAddress = tokenAccountInfo.value.data.parsed.info.owner;
          const solBalance = await solanaApi.getBalance(ownerAddress);
  
          return {
            address: ownerAddress,
            tokenBalance: account.uiAmount.toString(),
            balance: parseFloat(account.amount),
            solBalance: solBalance / 1e9
          };
        }));
  
        console.log(`Returning top ${topHolders.length} holders using getTokenLargestAccounts`);
      } else {
        const allHolders = await getHolders(coinAddress);
        topHolders = allHolders
          .sort((a, b) => b.balance - a.balance)
          .slice(0, count);
  
        console.log(`Returning top ${topHolders.length} holders using pagination method`);
      }
  
      return topHolders.map(holder => ({
        address: holder.address || holder.pubkey,
        tokenBalance: holder.tokenBalance || holder.balance.toString(),
        balance: typeof holder.balance === 'number' ? holder.balance : parseFloat(holder.balance || holder.amount),
        solBalance: holder.solBalance || 0
      }));
    } catch (error) {
      console.error('Error fetching top holders:', error);
      throw error;
    }
  }
  
  module.exports = { getHolders, getTopHolders };