/**
* Validates and parses various input formats for blockchain analysis
*/

const validateSolanaAddress = (address) => {
    if (typeof address !== 'string') return false;
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
 };
 
 const validateEthereumAddress = (address) => {
    if (typeof address !== 'string') return false;
    return /^0x[a-fA-F0-9]{40}$/.test(address);
 };
 
 const recognizeArgType = (arg) => {
    const lowerArg = arg.toLowerCase();
    
    if (validateSolanaAddress(arg)) {
        return { type: 'solanaAddress', value: arg };
    }
    
    if (validateEthereumAddress(arg)) {
        return { type: 'ethereumAddress', value: arg };
    }
    
    if (/^(\d+(\.\d+)?)(h|m|min|d|day|days)$/.test(lowerArg)) {
        return { type: 'time', value: lowerArg };
    }
    
    if (/^(\d+(\.\d+)?%?)$/.test(lowerArg)) {
        return { type: 'percentage', value: lowerArg.endsWith('%') ? lowerArg : `${lowerArg}%` };
    }
    
    if (['pump', 'nopump'].includes(lowerArg)) {
        return { type: 'flag', value: lowerArg };
    }
    
    return { type: 'unknown', value: arg };
 };
 
 const formatAddress = (address, chain) => {
    if (!address) return '';
    const formattedAddress = address.trim();
    return chain.toLowerCase() === 'ethereum' ? formattedAddress.toLowerCase() : formattedAddress;
 };
 
 const validateAndFormatAddress = (address, chain) => {
    if (!address) {
        return { isValid: false, formattedAddress: null, error: 'Address is required' };
    }
 
    const chainType = chain.toLowerCase();
    if (!['solana', 'ethereum'].includes(chainType)) {
        return { isValid: false, formattedAddress: null, error: 'Invalid chain type' };
    }
 
    const isValid = chainType === 'solana' ? validateSolanaAddress(address) : validateEthereumAddress(address);
    if (!isValid) {
        return { isValid: false, formattedAddress: null, error: `Invalid ${chainType} address format` };
    }
 
    return { isValid: true, formattedAddress: formatAddress(address, chainType), error: null };
 };
 
 const validateAndParseTimeFrame = (timeFrame, minHours, maxHours, allowDays = true) => {
    if (!timeFrame) return 1;
    
    let value = parseFloat(timeFrame);
    let unit = timeFrame.replace(/[0-9.]/g, '').toLowerCase();
 
    switch (unit) {
        case 'm':
        case 'min':
            value /= 60;
            break;
        case 'd':
        case 'day':
        case 'days':
            if (!allowDays) throw new Error("Days not allowed for this command");
            value *= 24;
            break;
    }
 
    if (isNaN(value) || value < minHours || value > maxHours) {
        throw new Error(`Invalid time frame. Please enter between ${minHours}h and ${maxHours}h`);
    }
 
    return Math.round(value * 100) / 100;
 };
 
 const validateAndParseMinAmountOrPercentage = (input, totalSupply, decimals, minPercentage, maxPercentage, defaultPercentage = 1) => {
    if (!input) {
        return { 
            minAmount: BigInt(Math.floor((totalSupply * defaultPercentage/100) * Math.pow(10, decimals))), 
            minPercentage: defaultPercentage 
        };
    }
 
    const value = parseFloat(input.replace('%', ''));
 
    if (isNaN(value) || value < minPercentage || value > maxPercentage) {
        throw new Error(`Invalid input. Please enter a percentage between ${minPercentage}% and ${maxPercentage}%`);
    }

    const minAmount = BigInt(Math.floor((totalSupply * minPercentage / 100) * Math.pow(10, decimals)));
 
    return { minAmount, minPercentage };
 };
 
 module.exports = {
    validateSolanaAddress,
    validateEthereumAddress, 
    recognizeArgType,
    formatAddress,
    validateAndFormatAddress,
    validateAndParseTimeFrame,
    validateAndParseMinAmountOrPercentage
 };