// utils/trackingValidator.js
   function validateTrackingData(data) {
    const requiredFields = {
      tokenAddress: data.tokenAddress,
      'tokenInfo.symbol': data.tokenInfo?.symbol,
      'tokenInfo.totalSupply': data.tokenInfo?.totalSupply,
      'tokenInfo.decimals': data.tokenInfo?.decimals,
      totalSupplyControlled: data.totalSupplyControlled,  
      topHoldersWallets: data.topHoldersWallets
    };
   
    const missingFields = Object.entries(requiredFields)
      .filter(([_, value]) => value === undefined || value === null)
      .map(([key]) => key);
   
    return {
      isValid: missingFields.length === 0,
      message: missingFields.length > 0 ? `Missing fields: ${missingFields.join(', ')}` : ''
    };
   }
   
   module.exports = { validateTrackingData };