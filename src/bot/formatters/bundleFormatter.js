function formatBundleResponse(bundleData) {
    let formattedResponse = "Bundle Information:\n\n";

    // Add all the information from bundleData
    formattedResponse += `Bundled: ${bundleData.bundleDetected ? 'Yes' : 'No'}\n`;
    formattedResponse += `Transactions: ${bundleData.transactions}\n`;
    formattedResponse += `Total Amount: ${bundleData.totalAmount.toFixed(2)}\n`;

    // Developer Info
    formattedResponse += "\nDeveloper Information:\n";
    formattedResponse += `Bundled Amount: ${bundleData.developerInfo.bundledAmount.toFixed(2)}\n`;
    formattedResponse += `Percentage of Supply: ${(bundleData.developerInfo.percentageOfSupply * 100).toFixed(2)}%\n`;

    // Transaction Details
    formattedResponse += "\nTransaction Details:\n";
    for (const [txHash, details] of Object.entries(bundleData.transactionDetails)) {
        formattedResponse += `\nTransaction Hash: ${txHash}\n`;
        formattedResponse += `Amounts: ${details.amounts.join(', ')}\n`;
        formattedResponse += `Amounts Percentages: ${details.amountsPercentages.map(p => p.toFixed(2) + '%').join(', ')}\n`;
    }

    // Wrap the entire response in a code block for better formatting in Telegram
    return `\`\`\`\n${formattedResponse}\n\`\`\``;
}

module.exports = {
    formatBundleResponse
};