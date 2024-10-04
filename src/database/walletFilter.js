const { saveInterestingWallet } = require('./database');

function isWalletInteresting(walletData) {
    const data = walletData.data;

    const {
        balance,
        total_value,
        realized_profit_30d,
        winrate,
        buy_30d,
        token_avg_cost,
        token_sold_avg_profit,
        pnl_2x_5x_num,
        pnl_gt_5x_num
    } = data;

    const criteria = [
        { name: 'Balance > 5', condition: parseFloat(balance) > 5 },
        { name: 'Total value > 20000', condition: total_value > 20000 },
        { name: 'Realized profit 30d > 10000', condition: realized_profit_30d > 10000 },
        { name: 'Winrate > 0.5', condition: winrate > 0.5 },
        { name: '5 < Buy 30d < 1000', condition: buy_30d > 5 && buy_30d < 1000 },
        { name: '200 < Token avg cost < 5000', condition: token_avg_cost > 200 && token_avg_cost < 5000 },
        { name: 'Token sold avg profit > 200', condition: token_sold_avg_profit > 200 },
        { name: 'PNL 2x-5x num > 5', condition: pnl_2x_5x_num > 5 },
        { name: 'PNL > 5x num > 2', condition: pnl_gt_5x_num > 2 }
    ];

    const score = criteria.filter(criterion => criterion.condition).length;

    // console.log('Detailed criteria evaluation:');
    // criteria.forEach(criterion => {
    //     console.log(`${criterion.name}: ${criterion.condition}`);
    // });
    // console.log(`Total score: ${score} out of ${criteria.length}`);

    return score >= 7;
}

async function processWallets(wallets) {
    // console.log('Processing wallets:', wallets.length);
    for (const wallet of wallets) {
        console.log('Processing wallet:', wallet.wallet);
        
        if (!wallet || !wallet.data) {
            console.error('Invalid wallet data:', wallet);
            continue;
        }

        if (isWalletInteresting(wallet.data)) {
            try {
                await saveInterestingWallet(wallet.wallet, wallet.data.data);
                console.log(`Wallet ${wallet.wallet} is interesting and saved to database`);
            } catch (error) {
                console.error(`Error saving wallet ${wallet.wallet} to database:`, error);
            }
        } else {
            console.log(`Wallet ${wallet.wallet} not interesting enough to save`);
        }
    }
}

module.exports = { processWallets, isWalletInteresting };