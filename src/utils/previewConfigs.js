const previewConfigs = {
    'scan': {
        title: '🔍 Token Scanner',
        description: 'Analyze token holders and get detailed insights about their portfolios',
        preview: {
            command: '/scan DgQBv9Ef1YkFc587XfsJKk6jzdanyA5Tj95UDjcfMksH',
            response: `<b><a href="https://solscan.io/token/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump">Fartcoin</a></b> (Fartcoin) <a href="https://dexscreener.com/solana/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump">📈</a>
<code>9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump</code>

<strong>Top 10 holders analysis:</strong>
👥 Supply Controlled: <code>12.50%</code>
💰 Average portfolio Value: <code>1158.8M</code>
❗️ Notable Addresses: <code>10</code>

<strong>Holders Info</strong>

1 - <a href="https://solscan.io/account/FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5">FWznb...ouN5</a> → <code>2.19%</code> 🐳  <a href="https://gmgn.ai/sol/address/[object%20Object]">gmgn</a>/<a href="https://app.cielo.finance/profile/[object%20Object]/pnl/tokens">cielo</a> 
├ 💰 High Value
├ 💳 Sol: <code>1.23M</code>
└ 💲 Port: <code>792.9M</code> (<a href="https://dexscreener.com/solana/GuhyMtwWzdrUUZ4hWsvqV1P31iDpDryrbMefx9TmFWjp?maker=FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5">wTRUMP</a> <code>539.9M</code>, <a href="https://dexscreener.com/solana/HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3?maker=FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5">PYTH</a> <code>5.7M</code>, <a href="https://dexscreener.com/solana/HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC?maker=FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5">ai16z</a> <code>2.4M</code>)

2 - <a href="https://solscan.io/account/A77HErqtfN1hLLpvZ9pCtu66FEtM8BveoaKbbMoZ4RiR">A77HE...4RiR</a> → <code>2.18%</code> 🐳  <a href="https://gmgn.ai/sol/address/[object%20Object]">gmgn</a>/<a href="https://app.cielo.finance/profile/[object%20Object]/pnl/tokens">cielo</a> 
├ 💰 High Value
├ 💳 Sol: <code>181.18k</code>
└ 💲 Port: <code>483.4M</code> (<a href="https://dexscreener.com/solana/Fd5w5rZZ71iT9HG3qQDHH43SveUWGfAw1zhfUA3ZCCwk?maker=A77HErqtfN1hLLpvZ9pCtu66FEtM8BveoaKbbMoZ4RiR">TRX6900</a> <code>385.6M</code>, <a href="https://dexscreener.com/solana/GuhyMtwWzdrUUZ4hWsvqV1P31iDpDryrbMefx9TmFWjp?maker=A77HErqtfN1hLLpvZ9pCtu66FEtM8BveoaKbbMoZ4RiR">wTRUMP</a> <code>34.8M</code>, <a href="https://dexscreener.com/solana/HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC?maker=A77HErqtfN1hLLpvZ9pCtu66FEtM8BveoaKbbMoZ4RiR">ai16z</a> <code>7.7M</code>)

3 - <a href="https://solscan.io/account/5sTQ5ih7xtctBhMXHr3f1aWdaXazWrWfoehqWdqWnTFP">5sTQ5...nTFP</a> → <code>1.31%</code> 🐳  <a href="https://gmgn.ai/sol/address/[object%20Object]">gmgn</a>/<a href="https://app.cielo.finance/profile/[object%20Object]/pnl/tokens">cielo</a> 
├ 💰 High Value
├ 💳 Sol: <code>6.89k</code>
└ 💲 Port: <code>29.7M</code> (<a href="https://dexscreener.com/solana/GuhyMtwWzdrUUZ4hWsvqV1P31iDpDryrbMefx9TmFWjp?maker=5sTQ5ih7xtctBhMXHr3f1aWdaXazWrWfoehqWdqWnTFP">wTRUMP</a> <code>17.4M</code>, <a href="https://dexscreener.com/solana/Hax9LTgsQkze1YFychnBLtFH8gYbQKtKfWKKg2SP6gdD?maker=5sTQ5ih7xtctBhMXHr3f1aWdaXazWrWfoehqWdqWnTFP">TAI</a> <code>5M</code>, <a href="https://dexscreener.com/solana/HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC?maker=5sTQ5ih7xtctBhMXHr3f1aWdaXazWrWfoehqWdqWnTFP">ai16z</a> <code>4.4M</code>)`,
        },
        features: [
            '🔍 Detailed analysis of top holders',
            '💰 Top holders supply tracking',
            '🔄 Token distribution insights',
            '🏷️ Smart wallet categorization',
        ],
        note: '💡 Use the "Track Supply" system to get notified when these holders buy or sell!'
    },
    'dexpaid': {
        title: '💰 DexScreener Status Checker',
        description: 'Check if a token profile has been updated on dexscreener and if there are ads or boosts running',
        preview: {
            command: '/dp 9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump',
            response: `📊 DexScreener Status for <b>$Fartcoin</b> <a href="https://solscan.io/token/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump">🔗</a>
Token Profile: ✅
Boost: ❌`
        },
        features: [
            '✨ Token profile verification',
            '🚀 Boost status check',
            '📈 Advertising status check',
        ],
        note: '💡 Essential for verifying token legitimacy and marketing efforts!'
    },

    'walletsearch': {
        title: '🔍 Wallet Search 🔥BETA',
        description: 'Search the entire Noesis database for wallets matching specific criteria',
        preview: {
            command: '/ws',
            response: `<b>🔍 Wallet Search</b>
    
    Set criteria and click Search to find matching wallets.
    
    <b>Current Criteria:</b>
    - Win Rate: 70% | Total Value: $50,000
    - SOL: 100 | PnL (30d): $5,000
    
    <b>Example Searches:</b>
    - Win Rate + Total Value = Top performers
    - 5x+ + 2x-5x = Big winners
    - Low Hold Time + High Buys/Sells = Active traders
    
    <b>Search Results:</b>
    
    1. <a href="https://solscan.io/account/AB32YWz7KkrAYbGz3ADbD1NZSgKkAmgHPFYi18xJpump">AB32Y...pump</a> <a href="https://gmgn.ai">GMGN</a>/<a href="https://app.cielo.finance">Cielo</a>
    ├ 💼 $2.5M | SOL: 205 | WR: 83%
    ├ 🔄 4.2B/3.1S | ⏱️ 13h
    └ 🚀 2x-5x: 14 | 5x+: 7
    
    2. <a href="https://solscan.io/account/FRqu2AX7WeedFY2kuCgYGNmAA456gdXPXpump">FRqu2...pump</a> <a href="https://gmgn.ai">GMGN</a>/<a href="https://app.cielo.finance">Cielo</a>
    ├ 💼 $1.8M | SOL: 420 | WR: 75%
    ├ 🔄 2.1B/1.8S | ⏱️ 6h
    └ 🚀 2x-5x: 8 | 5x+: 3
    
    3. <a href="https://solscan.io/account/9tz4HsZLQ4De4Axx8n14WK9LE7BvBxpump">9tz4H...pump</a> <a href="https://gmgn.ai">GMGN</a>/<a href="https://app.cielo.finance">Cielo</a>
    ├ 💼 $980k | SOL: 155 | WR: 72%
    ├ 🔄 5.7B/3.9S | ⏱️ 4h
    └ 🚀 2x-5x: 21 | 5x+: 5`
        },
        features: [
            '🔍 Filter by multiple criteria simultaneously',
            '💰 Find wallets by portfolio value and SOL balance',
            '📊 Sort by win rate, PnL, trading activity',
            '🏆 Discover elite traders with specific performance metrics',
            '⚡ Track wallets with significant 2x-5x and 5x+ trades',
        ],
        note: '💡 Premium subscribers only! Find the most successful wallets in the Solana ecosystem with custom search criteria.',
        betaFeature: true
    },
    'bundle': {
        title: '📦 Bundle Analysis',
        description: 'Analyze bundled trades and detect coordinated buying patterns',
        preview: {
            command: '/bundle 9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump',
            response: `<b>Total Bundles</b> for <a href="https://solscan.io/token/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump">Fartcoin</a> (Fartcoin) <a href="https://dexscreener.com/solana/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump">📈</a>

<b>📦 Total Bundles:</b> <code>36</code>
<b>🪙 Total Tokens Bundled:</b> <code>680.1M</code> Fartcoin (<code>68.01%</code>)
<b>💰 Total SOL Spent:</b> <code>89.4</code> SOL
<b>🔒 Total Holding Amount:</b> <code>3.4k</code> Fartcoin (<code>0%</code>)

<b>Top 5 bundles:</b>

<b>Bundle 1 (Slot 296264068):</b>
  <b>💼 Wallets:</b> <a href="https://solscan.io/address/Ds47zMcn7xoZ1DpQeCGx95Hw26XatnRpM9tvcaHFP9gP">Ds47z...P9gP</a>, <a href="https://solscan.io/address/71ffD9ttArPfug8gyDqsraCYh2ywAtRMZkQh2tSBj4ie">71ffD...j4ie</a>
  <b>🪙 Tokens Bought:</b> <code>108.5M</code> Fartcoin (<code>10.85%</code>)
  <b>💰 SOL Spent:</b> <code>3.9</code> SOL
  <b>🔒 Holding Amount:</b> <code>0</code> Fartcoin (<code>0%</code>)

<b>Bundle 2 (Slot 296264108):</b>
  <b>💼 Wallets:</b> <a href="https://solscan.io/address/3b7HqD1YAFgXeqqYmSaMU6tMr2DLMWZXZb5NgajCjpre">3b7Hq...jpre</a>, <a href="https://solscan.io/address/bVsU3WSVwBgH4WYrDAzfPExT3xU7s9CVfFsSBshBx32">bVsU3...Bx32</a>
  <b>🪙 Tokens Bought:</b> <code>69.4M</code> Fartcoin (<code>6.94%</code>)
  <b>💰 SOL Spent:</b> <code>5.2</code> SOL
  <b>🔒 Holding Amount:</b> <code>0</code> Fartcoin (<code>0%</code>)

<b>Bundle 3 (Slot 296264098):</b>
  <b>💼 Wallets:</b> <a href="https://solscan.io/address/GoWARC9qxKmdwkaC9HPd1dxgzUdg6FYpXv3rbLzPk7hd">GoWAR...k7hd</a>, <a href="https://solscan.io/address/EoX1bZYxq9BPmRJA6PoQdsQ3qMtPtqJk8JW6cCo99RR7">EoX1b...9RR7</a>
  <b>🪙 Tokens Bought:</b> <code>49.8M</code> Fartcoin (<code>4.98%</code>)
  <b>💰 SOL Spent:</b> <code>3.9</code> SOL
  <b>🔒 Holding Amount:</b> <code>0</code> Fartcoin (<code>0%</code>)

⚠️Bundles shown for pump.fun coins aren't necessarily block 0 bundles. For more information on how the /bundle command works please use /help /bundle in private.`
        },
        features: [
            '📦 Detect coordinated buys',
            '💰 Track total SOL spent',
        ],
        note: '💡 Essential for identifying potential team wallets and coordinated buying patterns!'
    },
  'walletchecker': {
    title: '📊 Wallet Performance Analyzer',
    description: 'Get detailed analytics of any Solana wallet, including trading performance, risk metrics, and historical data',
    preview: {
        command: '/wc DBsS77mfMvfYz8MF4vmwd4Dkj6higHPVSvUbFwYYa67M',
        response: `📊 Wallet Analysis
    🔗 <a href="https://solscan.io/account/DBsS77mfMvfYz8MF4vmwd4Dkj6higHPVSvUbFwYYa67M">Solscan</a> | <a href="https://birdeye.so/profile/DBsS77mfMvfYz8MF4vmwd4Dkj6higHPVSvUbFwYYa67M">birdeye</a> | <a href="https://gmgn.ai/sol/address/DBsS77mfMvfYz8MF4vmwd4Dkj6higHPVSvUbFwYYa67M">gmgn</a>

    🏦 Balance: <code>486.24</code> SOL

    <b>📊 Performance:</b>
    💵 Total PnL: <code>$2.0M (+229.96%)</code>
    7D PnL: <code>+183.61%</code>
    30D PnL: <code>+131.00%</code>
    🏆 WinRate: <code>64%</code>

    <b>📈 Trading Activity (30d):</b>
    📈 Avg Trades Per Day: <code>4.1</code>
    🛒 Avg Trade Buys/Sells: <code>1.2</code> / <code>2.9</code>
    🛒 Avg Buy Size: <code>$8.0K</code>
    💰 Avg Profit: <code>$5.1K</code>
    ⏪ Last Trade: <code>13h</code> ago

    <b>📈 Trade Stats (30d):</b>
    ↕️ Total Trades: <code>32</code>
    ⬆️ Win Trades: <code>9</code>
    🚀 &gt;500%: <code>3 (9.38%)</code>
    💫 200%-500%: <code>0 (0.00%)</code>
    ✨ 0%-200%: <code>23 (71.88%)</code>

    <b>⚠️ Risk Metrics (30d):</b>
    🚩 Scam Tokens: <code>0 (0%)</code>
    ⚡ Fast Trades &lt; 1 min: <code>3 (10%)</code>

    <i>You can change the timeframe by adding 1d / 7d or 30d at the end of your command (default is 30d)</i>`
        },
        features: [
            '📊 Complete performance metrics',
            '⚠️ Risk analysis and metrics',
            '🔄 Multiple timeframe analysis',
            '🔍 Trade pattern detection'
        ],
        note: '💡 Deep dive into any wallet\'s trading behavior and performance!'
    },
    'topholders': {
        title: '👥 Top Holders Analysis',
        description: 'Analyze top token holders with detailed portfolio insights and metrics',
        preview: {
            command: '/th 9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump',
            response: `<b><a href="https://solscan.io/token/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump">Fartcoin</a></b> (Fartcoin) <a href="https://dexscreener.com/solana/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump">📈</a>
<code>9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump</code>

🐳 <code>18</code> whales wallets (calculated excluding Fartcoin) (<code>10.54%</code> worth $<code>N/A</code>)
🆕 <code>0</code> fresh wallets (<code>0.00%</code> worth $<code>0</code>)
💤 <code>0</code> inactive wallets (<code>0.00%</code> worth $<code>0</code>)

🐳 Whale Wallets for <a href="https://solscan.io/token/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump">Fartcoin</a>

1.  <a href="https://solscan.io/account/4NfwPyCRv81vmhWhTgbrvT6StNfFny9PCuuVq1efcUz9">4NfwP...cUz9</a> → <code>0.68%</code> <a href="https://gmgn.ai/sol/address/4NfwPyCRv81vmhWhTgbrvT6StNfFny9PCuuVq1efcUz9">gmgn</a>/<a href="https://app.cielo.finance/profile/4NfwPyCRv81vmhWhTgbrvT6StNfFny9PCuuVq1efcUz9/pnl/tokens">cielo</a>
├ 💼 Port: <code>53374.7M</code> (SOL: <code>0.05</code>)
├ 💰 P/L (30d): <code>-18k</code> 📈 uPnL: <code>3.2M</code>
└ 📊 Winrate (30d): <code>5.13%</code> (<a href="https://dexscreener.com/solana/3FkVTy1c7SE6RqfK7v3bW2jbc1B25je86D3gBG2Zyfmc?maker=4NfwPyCRv81vmhWhTgbrvT6StNfFny9PCuuVq1efcUz9">LOCKIN</a> <code>53364.2M</code>, <a href="https://dexscreener.com/solana/BNbERcAV1JakxB3uDpvRqvvimMvGLsmLf4k5bLjXpump?maker=4NfwPyCRv81vmhWhTgbrvT6StNfFny9PCuuVq1efcUz9">BERA</a> <code>6.9M</code>, <a href="https://dexscreener.com/solana/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump?maker=4NfwPyCRv81vmhWhTgbrvT6StNfFny9PCuuVq1efcUz9">Fartcoin</a> <code>3.6M</code>)

2.  <a href="https://solscan.io/account/7WUzqEfQqK2sRbweM7h2BHJVyam3q487MTUj1AxNc6fZ">7WUzq...c6fZ</a> → <code>0.56%</code> <a href="https://gmgn.ai/sol/address/7WUzqEfQqK2sRbweM7h2BHJVyam3q487MTUj1AxNc6fZ">gmgn</a>/<a href="https://app.cielo.finance/profile/7WUzqEfQqK2sRbweM7h2BHJVyam3q487MTUj1AxNc6fZ/pnl/tokens">cielo</a>
├ 💼 Port: <code>10855.1M</code> (SOL: <code>0.01</code>)
├ 💰 P/L (30d): <code>6.5M</code> 📈 uPnL: <code>-97.9k</code>
└ 📊 Winrate (30d): <code>45.45%</code> (<a href="https://dexscreener.com/solana/9PqwECrkoFtZPWqLa3o1LPoSspn717RK5SVdeakNw1Fr?maker=7WUzqEfQqK2sRbweM7h2BHJVyam3q487MTUj1AxNc6fZ">Lessin</a> <code>10101.9M</code>, <a href="https://dexscreener.com/solana/D7ddyCWBihGeHfkPi54WJSieQTd83oMWDuhcgE8yrq3d?maker=7WUzqEfQqK2sRbweM7h2BHJVyam3q487MTUj1AxNc6fZ">Pain</a> <code>736.6M</code>, <a href="https://dexscreener.com/solana/5hz7T5w6Qvh32oMrrw98msB5kRHwnNtCa936sAGLbLoV?maker=7WUzqEfQqK2sRbweM7h2BHJVyam3q487MTUj1AxNc6fZ">Anthropic</a> <code>9.7M</code>)`,
        },
        features: [
            '👥 Comprehensive whale analysis',
            '⚖️ Supply distribution insights',
            '📊 Portfolio value tracking',
            '💰 PnL and performance metrics',
        ],
        note: '💡 Click on wallet addresses to view detailed transaction history on Solscan!'
    },
    'team': {
        title: '👥 Team Supply Analysis',
        description: 'Analyze token supply distribution among team/insider wallets',
        preview: {
            command: '/team NEXEA',
            response: `<b>Team Supply Analysis for <a href="https://dexscreener.com/solana/undefined">NEXEA</a></b>

👥 Supply Controlled by team/insiders: <code>89.10%</code> ☠️
⚠️ Wallets flagged as team/insiders: <code>187</code>

<b>Top team wallets:</b>
1. <a href="https://solscan.io/account/3tod4efVpW11sLNR7HPke6o5xcbpBkWerjJFvFBetWjM">3tod4e...tWjM</a> (<code>15%</code>) - Fresh
2. <a href="https://solscan.io/account/BRrj2AnqUVuit797bCfcvSa1sNoXW4xjA1Kprp9L8YER">BRrj2A...8YER</a> (<code>7.29%</code>) - Fresh
3. <a href="https://solscan.io/account/62iDH8zLVpc2GxfzhkgpJV1aDLLjWEjryADgrDNejDyz">62iDH8...jDyz</a> (<code>3.30%</code>) - Fresh
4. <a href="https://solscan.io/account/2WsnfnKgjs69pTaKvEVvVzK2P2t13NBXjuKdWYNaf5tw">2Wsnfn...f5tw</a> (<code>2.90%</code>) - Fresh
5. <a href="https://solscan.io/account/GeRAoUPDw1WbaXxvBmMiwtEQw8wHYS3xWy7VGsxdYAM">GeRAoU...dYAM</a> (<code>1.79%</code>) - Fresh`
        },
        features: [
            '🔍 Identify team and insider wallets',
            '📊 Track supply concentration',
            '⚖️ Monitor supply distribution',
            '🚨 Risk level indicators',
            '📈 Real-time tracking capability'
        ],
        note: '💡 Use "Track Team Wallets" button to get notifications of team wallet movements!'
    },
    'besttraders': {
        title: '🏆 Best Traders Analysis',
        description: 'Find and analyze the most successful traders for any token',
        preview: {
            command: '/bt tokenAddress 50 10000 winrate',
            response: `🏆 Best traders analysis for:
<code>Ejq4Xr7KwHtLPkfGr3DGkKSgyGCuZvsndeyj92yXpump</code>
📊 Winrate threshold: <code>>50%</code>
💰 Portfolio threshold: <code>$10000</code>
📈 Sorted by: <code>winrate</code>

Click /bt to customize these values
                    
1. <a href="https://solscan.io/account/4pZB2v8g8c723e2MVe6pujLuMkn24VPriJCKocGbr4fB">4pZB2...r4fB</a> 🐳 <a href="https://gmgn.ai/sol/address/4pZB2v8g8c723e2MVe6pujLuMkn24VPriJCKocGbr4fB">gmgn</a>/<a href="https://app.cielo.finance/profile/4pZB2v8g8c723e2MVe6pujLuMkn24VPriJCKocGbr4fB/pnl/tokens">cielo</a>
├ 💼 Port: <code>$2M</code> (SOL: <code>0.40</code>)
├ 💰 P/L (30d): <code>$1M</code> 📈 uPnL: <code>$-141k</code>
└ 📊 Winrate (30d): <code>100.00%</code>

2. <a href="https://solscan.io/account/D4L6BMJRAsYcmtUCkvVhoJ82HqhieHZ8JmwvZQhZRtRC">D4L6B...RtRC</a> 🐳 <a href="https://gmgn.ai/sol/address/D4L6BMJRAsYcmtUCkvVhoJ82HqhieHZ8JmwvZQhZRtRC">gmgn</a>/<a href="https://app.cielo.finance/profile/D4L6BMJRAsYcmtUCkvVhoJ82HqhieHZ8JmwvZQhZRtRC/pnl/tokens">cielo</a>
├ 💼 Port: <code>$133k</code> (SOL: <code>0.16</code>)
├ 💰 P/L (30d): <code>$998k</code> 📈 uPnL: <code>$-238k</code>
└ 📊 Winrate (30d): <code>100.00%</code>

3. <a href="https://solscan.io/account/3NMDSDJm8p7N3BozWzVcKHKgRR4HeBWV4vgB6fzYx8A6">3NMDS...x8A6</a> 🐳 <a href="https://gmgn.ai/sol/address/3NMDSDJm8p7N3BozWzVcKHKgRR4HeBWV4vgB6fzYx8A6">gmgn</a>/<a href="https://app.cielo.finance/profile/3NMDSDJm8p7N3BozWzVcKHKgRR4HeBWV4vgB6fzYx8A6/pnl/tokens">cielo</a>
├ 💼 Port: <code>$189k</code> (SOL: <code>330.45</code>)
├ 💰 P/L (30d): <code>$156k</code> 📈 uPnL: <code>$-85k</code>
└ 📊 Winrate (30d): <code>100.00%</code>`
        },
        features: [
            '🏆 Top trader identification',
            '💰 Portfolio value analysis',
            '📈 PnL monitoring',
            '🎯 Customizable thresholds',
            '🔄 Multiple sorting options'
        ],
        note: '💡 Filter by winrate, portfolio value, or P/L to find the best traders!'
    },
    'cross': {
        title: '🔄 Cross-Analysis',
        description: 'Analyze common holders between multiple tokens',
        preview: {
            command: '/cross 9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump',
            response: `<b>Cross-Analysis Results for <a href="https://solscan.io/token/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump">Fartcoin</a> <a href="https://solscan.io/token/A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump">FWOG</a></b>

Total common holders: <code><b>216</b></code>
Fartcoin/FWOG: <b><code>216</code></b>

1. <a href="https://solscan.io/account/FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5">FWzn...ouN5</a> 🐳 <a href="https://gmgn.ai/sol/address/FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5">gmgn</a>/<a href="https://app.cielo.finance/profile/FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5/pnl/tokens">cielo</a>
├ 🪙 Tokens held: <b>2/2</b>
├ 💼 Port: $<b>1010M</b> (SOL: <b>1.20M</b>)
├ 💰 P/L (30d): $<b>0</b> 📈 uPnL: $<b>0</b>
├ 📊 Winrate (30d): <b>0.00%</b>
└ 🔗 Combined Value: $<b>15.1M</b> (<a href="https://solscan.io/token/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump">Fartcoin</a>: $<b>11M</b>, <a href="https://solscan.io/token/A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump">FWOG</a>: $<b>4.2M</b>)

2. <a href="https://solscan.io/account/ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ">ASTy...iaJZ</a> 🦐 <a href="https://gmgn.ai/sol/address/ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ">gmgn</a>/<a href="https://app.cielo.finance/profile/ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ/pnl/tokens">cielo</a>
├ 🪙 Tokens held: <b>2/2</b>
├ 💼 Port: $<b>0</b> (SOL: <b>28.61k</b>)
├ 💰 P/L (30d): $<b>N/A</b> 📈 uPnL: $<b>0</b>
├ 📊 Winrate (30d): <b>0.00%</b>
└ 🔗 Combined Value: $<b>7.7M</b> (<a href="https://solscan.io/token/9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump">Fartcoin</a>: $<b>6.5M</b>, <a href="https://solscan.io/token/A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump">FWOG</a>: $<b>1.1M</b>)`,
        },
        features: [
            '🔍 Common holder detection',
            '📊 Performance metrics',
            '📈 Cross-token insights',
        ],
        note: '💡 Find wallets active across multiple tokens to identify potential whales and trading patterns!'
    },
    'crossbt': {
        title: '🔄 Cross Top Traders Analysis',
        description: 'Find common top traders between multiple tokens',
        preview: {
            command: '/crossbt 9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump',
            response: `<b>Cross-Analysis of Top Traders</b>

Analyzing top traders for 2 tokens:
1. <code>9BB6N...gpump</code>
2. <code>A8C3x...wpump</code>

1. <a href="https://solscan.io/account/FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5">FWznb...ouN5</a> 🐳 <a href="https://gmgn.ai/sol/address/FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5">GMGN</a>/<a href="https://app.cielo.finance/profile/FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5/pnl/tokens">Cielo</a>
├ 💼 Port: $<code>1010M</code> (SOL: <code>1.20M</code>)
├ 💰 P/L (30d): $<code>0</code> 📈 uPnL: $<code>0</code>
├ 📊 Winrate (30d): <code>0.00%</code>
└ 🏆 Stats:
   9BB6N...gpump: PNL $<code>11M</code>, <code>215.32%</code>
   A8C3x...wpump: PNL $<code>4.2M</code>, <code>187.65%</code>

2. <a href="https://solscan.io/account/ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ">ASTyf...iaJZ</a> 🦐 <a href="https://gmgn.ai/sol/address/ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ">GMGN</a>/<a href="https://app.cielo.finance/profile/ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ/pnl/tokens">Cielo</a>
├ 💼 Port: $<code>0</code> (SOL: <code>28.61k</code>)
├ 💰 P/L (30d): $<code>N/A</code> 📈 uPnL: $<code>0</code>
├ 📊 Winrate (30d): <code>0.00%</code>
└ 🏆 Stats:
   9BB6N...gpump: PNL $<code>6.5M</code>, <code>167.43%</code>
   A8C3x...wpump: PNL $<code>1.1M</code>, <code>143.21%</code>`,
        },
        features: [
            '🔍 Multi-token trader analysis',
            '📊 Performance comparison',
            '💰 Portfolio metrics tracking',
            '🏆 Top trader identification',
        ],
        note: '💡 Compare up to 3 tokens to find common successful traders!'
    },
    'entrymap': {
        title: '📈 Entry Price Analysis',
        description: 'Analyze entry prices and PnL for token holders',
        preview: {
            command: '/em 4Z6AbaXT9nk5J3uihNSjBVUoxUTSosRbDTkTfAFMpump',
            response: `<a href="https://dexscreener.com/solana/4Z6AbaXT9nk5J3uihNSjBVUoxUTSosRbDTkTfAFMpump">📊</a> <a href="https://solscan.io/token/4Z6AbaXT9nk5J3uihNSjBVUoxUTSosRbDTkTfAFMpump">YE</a>

<b>Summary:</b>
Avg Entry MCAP: <code>2.08M</code> USD | Avg PnL: <code>-19.49%</code>

<b>Top Holders:</b>
🔴 <a href="https://solscan.io/account/3KNCdquQuPBq6ZWChRJr8jGpkoyZ5LurLCt6sNJJMxbq">3KNC...Mxbq</a> | <code>2.78%</code> | Avg Entry: <code>3.35M</code> | PnL: <code>-50.04%</code> | 4h ago

🟢 <a href="https://solscan.io/account/6j5eoZ18Bxrg3E4SSbD2PEtK7LiiUnnEDWXpizjHCHZ7">6j5e...CHZ7</a> | <code>1.38%</code> | Avg Entry: <code>1.39M</code> | PnL: <code>19.99%</code> | 6h ago

🔴 <a href="https://solscan.io/account/4AKKJfN5njdyoTQ4CL8F3CuoF9Wz7SWyF5kcT2ApCqr6">4AKK...Cqr6</a> | <code>1.33%</code> | Avg Entry: <code>1.82M</code> | PnL: <code>-8.10%</code> | 4h ago`,
        },
        features: [
            '📊 Entry price analysis',
            '📈 PnL calculation per holder',
            '⏰ Entry timing data',
        ],
        note: '💡 Track entry prices and PnL of top holders to understand buying patterns!'
    },
    'freshratio': {
        title: '📊 Fresh Wallet Analysis',
        description: 'Analyze the proportion of fresh wallets buying a token',
        preview: {
            command: '/fr ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY 1h 0.005%',
            response: `<b>Fresh wallet ratio analysis results for</b>
<b><a href="https://solscan.io/token/ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY">Moo Deng</a></b> (MOODENG) <a href="https://dexscreener.com/solana/ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY">📈</a>
<code>ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY</code>

📊 <b>Analysis Results:</b>
└ Fresh Wallets Ratio: <code>3.18%</code>

🔝 <b>Top Fresh Wallet Buyers:</b>
1. <a href="https://solscan.io/account/5kwA6jdFKZD6BAdfaTGcTPe9vhJ3k3cKE6LdHApL4iUJ">5kwA6...4iUJ</a> - <code>0.70%</code>
2. <a href="https://solscan.io/account/7eCsrPcZmDJT692ZAN4wbambgJLR1xy81onZq9idAoBz">7eCsr...AoBz</a> - <code>0.26%</code>
3. <a href="https://solscan.io/account/GcaAfu247YqjymzPAZt3ArEMRWmp9R359na6maUyg4DT">GcaAf...g4DT</a> - <code>0.15%</code>`,
        },
        features: [
            '📊 Fresh wallet ratio calculation',
            '💰 Supply percentage analysis',
        ],
        note: '💡 Track the proportion of fresh wallets to identify organic buying patterns!'
    },
    'dev': {
        title: '👨‍💻 Developer Analysis',
        description: 'Analyze developer profiles and track their coin creation history',
        preview: {
            command: '/dev Ejq4Xr7KwHtLPkfGr3DGkKSgyGCuZvsndeyj92yXpump',
            response: `👨‍💻 <b>Developer Analysis for <a href="https://solscan.io/token/Ejq4Xr7KwHtLPkfGr3DGkKSgyGCuZvsndeyj92yXpump">BASKT</a></b>
├ Dev: <a href="https://solscan.io/account/ELsbngpRtxAVwst6Yzwsu2kiU4QCa9rL1XpGqVNaEt4m">ELsbn...Et4m</a> → <code>2.07%</code>
├ 💼 Port: $<code>92k</code> (SOL: <code>0.6</code>)
└ 💰 Top 3: <a href="https://dexscreener.com/solana/Ejq4Xr7KwHtLPkfGr3DGkKSgyGCuZvsndeyj92yXpump?maker=ELsbngpRtxAVwst6Yzwsu2kiU4QCa9rL1XpGqVNaEt4m">BASKT</a> $<code>91.8k</code>, <a href="https://dexscreener.com/solana/SOL?maker=ELsbngpRtxAVwst6Yzwsu2kiU4QCa9rL1XpGqVNaEt4m">SOL</a> $<code>124.5</code>

📊 <b>Dev Statistics</b>
├ Total Coins Created: <code>1</code>
├ Successfully Bonded: <code>1</code>
└ Bond Rate: <code>100.00%</code>

💎 <b>Bonded Coins Performance</b>
1. <a href="https://dexscreener.com/solana/undefined">BASKT</a> - $<code>4.4M</code>

💰 <b>Funding Info</b>
└ Funded by: <a href="https://solscan.io/account/H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS">H8sMJ...3WjS</a> (Coinbase) - <code>4.07</code> SOL (1 month ago)`,
        },
        features: [
            '👨‍💻 Developer wallet analysis',
            '📊 Coin creation history',
            '🔗 Transfer connections',
            '💎 Performance metrics',
            '💫 Funding source detection'
        ],
        note: '💡 Track developer history and verify their previous successes!'
    },
    'search': {
        title: '🔎 Wallet Search',
        description: 'Search for specific wallets based on partial addresses',
        preview: {
            command: '/search tokenAddress CMcH',
            response: `Found <code>1</code> matching wallet(s):

1 - <a href="https://solscan.io/account/CMcHRygKpNG2Jx83T1cTiqAvg55mYXv6uSwjhFzLwQFc">CMcHRy...wQFc</a>
├ 💳 Sol: <code>9.77</code>
└ 💲 Port: $<code>125.1k</code> (<a href="https://dexscreener.com/solana/GJLiErro8cbWeDngDMWJug9dkwwckYZg4Lvb79F3pump?maker=CMcHRygKpNG2Jx83T1cTiqAvg55mYXv6uSwjhFzLwQFc">ily</a> $<code>26.4k</code>, <a href="https://dexscreener.com/solana/ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY?maker=CMcHRygKpNG2Jx83T1cTiqAvg55mYXv6uSwjhFzLwQFc">MOODENG</a> $<code>23.9k</code>, <a href="https://dexscreener.com/solana/GqmEdRD3zGUZdYPeuDeXxCc8Cj1DBmGSYK97TCwSpump?maker=CMcHRygKpNG2Jx83T1cTiqAvg55mYXv6uSwjhFzLwQFc">e/acc</a> $<code>22k</code>)`,
        },
        features: [
            '🔍 Partial address matching',
        ],
        note: '💡 Search through token holders using parts of their wallet address!'
    }
};

function formatPreviewMessage(config) {
    let message = `<b>${config.title}</b>\n\n`;
    message += `${config.description}\n\n`;
    
    message += `<b>Example Usage:</b>\n`;
    message += `<code>${config.preview.command}</code>\n\n`;
    
    message += `<b>Example Output:</b>\n`;
    message += `${config.preview.response}\n\n`;
    
    if (config.features?.length > 0) {
        message += `<b>✨ Key Features:</b>\n`;
        config.features.forEach(feature => {
            message += `• ${feature}\n`;
        });
        message += '\n';
    }
    
    if (config.note) {
        message += `<i>${config.note}</i>`;
    }

    return message;
}

module.exports = {
    previewConfigs,
    formatPreviewMessage
};