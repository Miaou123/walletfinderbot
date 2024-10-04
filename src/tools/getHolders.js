const BigNumber = require('bignumber.js');
const { getSolanaApi } = require('../integrations/solanaApi');

const MIN_TOKEN_THRESHOLD = 1000;

async function getHolders(coinAddress, mainContext, subContext) {
    const solanaApi = getSolanaApi();
    try {

        const tokenSupplyInfo = await solanaApi.getTokenSupply(coinAddress, mainContext, subContext);
        const tokenDecimals = tokenSupplyInfo.value.decimals;
  
      let allHolders = new Map();
      let cursor;
  
      while (true) {
        const result = await solanaApi.getTokenAccounts(coinAddress, 1000, cursor, mainContext, subContext);
  
        if (!result.token_accounts || result.token_accounts.length === 0) {
            console.log('No more results or no token accounts found');
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
  
      return Array.from(allHolders.values());
    } catch (error) {
      console.error('Error fetching holders:', error);
      throw error;
    }
}
  
async function getTopHolders(coinAddress, count = 20, mainContext, subContext) {
    const solanaApi = getSolanaApi();
    try {
      let topHolders;
      console.log('Getting top holders:', count);
      if (count <= 20) {
        const result = await solanaApi.getTokenLargestAccounts(coinAddress, mainContext, subContext);
  
        if (!result || !result.value) {
          console.error('Invalid response from Helius API:', JSON.stringify(result, null, 2));
          throw new Error('Invalid response from Helius API');
        }
  
        topHolders = await Promise.all(result.value.map(async (account, index) => {
          console.log(`Processing account ${index + 1}: ${account.address}`);
          const tokenAccountInfo = await solanaApi.getAccountInfo(account.address, { encoding: 'jsonParsed' }, mainContext, subContext);
          
          if (!tokenAccountInfo || !tokenAccountInfo.value || !tokenAccountInfo.value.data || !tokenAccountInfo.value.data.parsed) {
            console.error(`Invalid account info for address: ${account.address}`);
            return null;
          }
  
          const ownerAddress = tokenAccountInfo.value.data.parsed.info.owner;
          const solBalanceResponse = await solanaApi.getBalance(ownerAddress, mainContext, subContext);
          let solBalance = '0';
          
          if (solBalanceResponse && solBalanceResponse.value !== undefined) {
            solBalance = new BigNumber(solBalanceResponse.value).dividedBy(1e9).toFixed(9);
          } else {
            console.error(`Invalid SOL balance response for ${ownerAddress}:`, solBalanceResponse);
          }
  
          return {
            address: ownerAddress,
            balance: account.amount,
            tokenBalance: account.amount,
            solBalance: solBalance
          };
        }));
  
        topHolders = topHolders.filter(holder => holder !== null);

        topHolders = topHolders.slice(0, count);

      } else {
        console.log(`Fetching all holders for token: ${coinAddress}`);
        const allHolders = await getHolders(coinAddress, mainContext, subContext);
        topHolders = allHolders
          .sort((a, b) => b.balance - a.balance)
          .slice(0, count);
      }
  
      return topHolders.map(holder => ({
        address: holder.address || holder.pubkey,
        tokenBalance: holder.tokenBalance || holder.balance.toString(),
        balance: typeof holder.balance === 'number' ? holder.balance : parseFloat(holder.balance || holder.amount),
        solBalance: holder.solBalance || '0'
      }));
    } catch (error) {
      console.error('Error fetching top holders:', error);
      throw error;
    }
}
  
module.exports = { getHolders, getTopHolders };