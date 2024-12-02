/**
 * Utilities for validating blockchain addresses and other inputs
 */

/**
 * Validates a Solana address format
 * @param {string} address - The address to validate
 * @returns {boolean} - True if valid, false otherwise
 */
const validateSolanaAddress = (address) => {
    if (typeof address !== 'string') return false;
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
};

/**
 * Validates an Ethereum address format
 * @param {string} address - The address to validate
 * @returns {boolean} - True if valid, false otherwise
 */
const validateEthereumAddress = (address) => {
    if (typeof address !== 'string') return false;
    return /^0x[a-fA-F0-9]{40}$/.test(address);
};

/**
 * Determines the type and format of an input argument
 * @param {string} arg - The argument to analyze
 * @returns {Object} - Object containing the type and formatted value
 */
const recognizeArgType = (arg) => {
    const lowerArg = arg.toLowerCase();
    
    // Check for Solana address
    if (validateSolanaAddress(arg)) {
        return { type: 'solanaAddress', value: arg };
    }
    
    // Check for Ethereum address
    if (validateEthereumAddress(arg)) {
        return { type: 'ethereumAddress', value: arg };
    }
    
    // Check for time format (e.g., 1h, 30m, 45min)
    if (/^(\d+(\.\d+)?)(h|m|min)$/.test(lowerArg)) {
        return { type: 'time', value: lowerArg };
    }
    
    // Check for percentage (with or without % symbol)
    if (/^(\d+(\.\d+)?%?)$/.test(lowerArg)) {
        return { 
            type: 'percentage', 
            value: lowerArg.endsWith('%') ? lowerArg : `${lowerArg}%` 
        };
    }
    
    // Check for specific flags
    if (['pump', 'nopump'].includes(lowerArg)) {
        return { type: 'flag', value: lowerArg };
    }
    
    return { type: 'unknown', value: arg };
};

/**
 * Formats an address to ensure consistent representation
 * @param {string} address - The address to format
 * @param {string} chain - The blockchain type ('solana' or 'ethereum')
 * @returns {string} - The formatted address
 */
const formatAddress = (address, chain) => {
    if (!address) return '';
    
    const formattedAddress = address.trim();
    
    if (chain.toLowerCase() === 'ethereum') {
        return formattedAddress.toLowerCase();
    }
    
    return formattedAddress;
};

/**
 * Validates and formats blockchain addresses
 * @param {string} address - The address to validate and format
 * @param {string} chain - The blockchain type ('solana' or 'ethereum')
 * @returns {Object} - Object containing validation result and formatted address
 */
const validateAndFormatAddress = (address, chain) => {
    if (!address) {
        return { 
            isValid: false, 
            formattedAddress: null, 
            error: 'Address is required' 
        };
    }

    const chainType = chain.toLowerCase();
    
    if (!['solana', 'ethereum'].includes(chainType)) {
        return { 
            isValid: false, 
            formattedAddress: null, 
            error: 'Invalid chain type' 
        };
    }

    const isValid = chainType === 'solana' 
        ? validateSolanaAddress(address)
        : validateEthereumAddress(address);

    if (!isValid) {
        return { 
            isValid: false, 
            formattedAddress: null, 
            error: `Invalid ${chainType} address format` 
        };
    }

    return {
        isValid: true,
        formattedAddress: formatAddress(address, chainType),
        error: null
    };
};

module.exports = {
    validateSolanaAddress,
    validateEthereumAddress,
    recognizeArgType,
    formatAddress,
    validateAndFormatAddress
};