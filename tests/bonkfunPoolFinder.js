// ====================================================================================
// STANDALONE UTILITY: Bonk.fun Pool ID Finder
// Save this as: utils/bonkfunPoolFinder.js
// ====================================================================================

const { PublicKey } = require('@solana/web3.js');

class BonkfunPoolFinder {
    constructor() {
        // Program IDs
        this.LAUNCHLAB_PROGRAM = new PublicKey('LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj');
        this.RAYDIUM_CPMM_PROGRAM = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
        this.RAYDIUM_AMM_PROGRAM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
        this.SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
        
        // API endpoints
        this.RAYDIUM_API_BASE = 'https://launch-history-v1.raydium.io';
        this.RAYDIUM_V3_API = 'https://api-v3.raydium.io';
        
        // Known pool mappings (manual overrides)
        this.KNOWN_POOLS = {
            'CssndHPw8AdKRRpcNowaA8QFcihaf139pRa98oxobonk': '93nDGcvueZzf8N5mP6hJuSUcHja7UAU1zwVd85vCn71R'
        };
    }

    // Method 1: Check known mappings first
    getKnownPoolId(tokenAddress) {
        if (this.KNOWN_POOLS[tokenAddress]) {
            console.log(`✅ Found known pool mapping: ${tokenAddress} -> ${this.KNOWN_POOLS[tokenAddress]}`);
            return this.KNOWN_POOLS[tokenAddress];
        }
        return null;
    }

    // Method 2: API-based pool discovery
    async findPoolViaAPI(tokenAddress) {
        console.log(`🔍 Searching for pool via Raydium API...`);
        
        // Try multiple API endpoints
        const endpoints = [
            `${this.RAYDIUM_V3_API}/pools/info/mint?mint1=${tokenAddress}&poolType=cpmm&poolSortField=liquidity&sortType=desc&pageSize=10&page=1`,
            `${this.RAYDIUM_V3_API}/pools/info/mint?mint1=${tokenAddress}&poolType=all&poolSortField=volume24h&sortType=desc&pageSize=10&page=1`,
            `${this.RAYDIUM_V3_API}/pools/info/list?poolType=cpmm&poolSortField=volume24h&sortType=desc&pageSize=100&page=1`
        ];

        for (let i = 0; i < endpoints.length; i++) {
            try {
                console.log(`   Trying API endpoint ${i + 1}...`);
                const response = await fetch(endpoints[i]);
                
                if (response.ok) {
                    const data = await response.json();
                    
                    if (data.success && data.data && data.data.data && data.data.data.length > 0) {
                        // For specific mint search
                        if (i < 2) {
                            const pool = data.data.data[0];
                            console.log(`✅ Found pool via API: ${pool.id}`);
                            return pool.id;
                        }
                        // For pool list search
                        else {
                            for (const pool of data.data.data) {
                                if (pool.mintA === tokenAddress || pool.mintB === tokenAddress) {
                                    console.log(`✅ Found pool in pool list: ${pool.id}`);
                                    return pool.id;
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.log(`   ❌ API endpoint ${i + 1} failed: ${error.message}`);
            }
        }
        
        console.log(`❌ No pool found via API`);
        return null;
    }

    // Method 3: PDA derivation with multiple patterns
    async derivePoolPDA(tokenAddress) {
        console.log(`🔍 Attempting PDA derivation...`);
        
        const tokenMint = new PublicKey(tokenAddress);
        
        // Pattern definitions
        const patterns = [
            // LaunchLab patterns
            {
                name: 'LaunchLab Standard',
                program: this.LAUNCHLAB_PROGRAM,
                seeds: () => [Buffer.from('pool'), tokenMint.toBuffer()]
            },
            {
                name: 'LaunchLab with Program',
                program: this.LAUNCHLAB_PROGRAM,
                seeds: () => [Buffer.from('pool'), this.LAUNCHLAB_PROGRAM.toBuffer(), tokenMint.toBuffer()]
            },
            {
                name: 'LaunchLab with SOL',
                program: this.LAUNCHLAB_PROGRAM,
                seeds: () => [Buffer.from('pool'), tokenMint.toBuffer(), this.SOL_MINT.toBuffer()]
            },
            
            // CPMM patterns
            {
                name: 'CPMM Standard',
                program: this.RAYDIUM_CPMM_PROGRAM,
                seeds: () => [Buffer.from('cp_pool'), tokenMint.toBuffer(), this.SOL_MINT.toBuffer()]
            },
            {
                name: 'CPMM Reverse',
                program: this.RAYDIUM_CPMM_PROGRAM,
                seeds: () => [Buffer.from('cp_pool'), this.SOL_MINT.toBuffer(), tokenMint.toBuffer()]
            },
            {
                name: 'CPMM Alternative',
                program: this.RAYDIUM_CPMM_PROGRAM,
                seeds: () => [Buffer.from('pool'), tokenMint.toBuffer(), this.SOL_MINT.toBuffer()]
            },
            
            // AMM patterns
            {
                name: 'AMM Legacy',
                program: this.RAYDIUM_AMM_PROGRAM,
                seeds: () => [Buffer.from('pool'), this.RAYDIUM_AMM_PROGRAM.toBuffer(), tokenMint.toBuffer(), this.SOL_MINT.toBuffer()]
            },
            {
                name: 'AMM Simple',
                program: this.RAYDIUM_AMM_PROGRAM,
                seeds: () => [Buffer.from('pool'), tokenMint.toBuffer(), this.SOL_MINT.toBuffer()]
            }
        ];

        const derivedPools = [];

        for (const pattern of patterns) {
            try {
                const seeds = pattern.seeds();
                const [poolId] = await PublicKey.findProgramAddress(seeds, pattern.program);
                const poolIdStr = poolId.toBase58();
                
                derivedPools.push({
                    name: pattern.name,
                    poolId: poolIdStr
                });
                
                console.log(`   ✅ ${pattern.name}: ${poolIdStr}`);
            } catch (error) {
                console.log(`   ❌ ${pattern.name}: Failed - ${error.message}`);
            }
        }

        return derivedPools;
    }

    // Method 4: Test pool IDs against API
    async testPoolId(poolId) {
        try {
            const url = `${this.RAYDIUM_API_BASE}/trade?poolId=${poolId}&limit=1`;
            const response = await fetch(url);
            
            if (response.ok) {
                const data = await response.json();
                return {
                    valid: true,
                    hasData: data.success && data.data && data.data.rows && data.data.rows.length > 0,
                    tradeCount: data.success && data.data && data.data.rows ? data.data.rows.length : 0
                };
            } else {
                return {
                    valid: false,
                    error: `HTTP ${response.status}: ${response.statusText}`
                };
            }
        } catch (error) {
            return {
                valid: false,
                error: error.message
            };
        }
    }

    // Main function: Find the correct pool ID
    async findPoolId(tokenAddress) {
        console.log(`\n🚀 Starting comprehensive pool search for: ${tokenAddress}`);
        console.log(`=" ".repeat(80)`);

        // Step 1: Check known mappings
        console.log(`\n📋 STEP 1: Checking known pool mappings...`);
        const knownPool = this.getKnownPoolId(tokenAddress);
        if (knownPool) {
            const testResult = await this.testPoolId(knownPool);
            console.log(`   Test result: ${JSON.stringify(testResult, null, 2)}`);
            if (testResult.valid) {
                console.log(`✅ FOUND WORKING POOL: ${knownPool} (from known mapping)`);
                return knownPool;
            }
        }

        // Step 2: API-based discovery
        console.log(`\n🌐 STEP 2: API-based pool discovery...`);
        const apiPool = await this.findPoolViaAPI(tokenAddress);
        if (apiPool) {
            const testResult = await this.testPoolId(apiPool);
            console.log(`   Test result: ${JSON.stringify(testResult, null, 2)}`);
            if (testResult.valid) {
                console.log(`✅ FOUND WORKING POOL: ${apiPool} (from API)`);
                return apiPool;
            }
        }

        // Step 3: PDA derivation
        console.log(`\n🔐 STEP 3: PDA derivation...`);
        const derivedPools = await this.derivePoolPDA(tokenAddress);
        
        console.log(`\n🧪 STEP 4: Testing all derived pools...`);
        for (const pool of derivedPools) {
            console.log(`   Testing ${pool.name}: ${pool.poolId}`);
            const testResult = await this.testPoolId(pool.poolId);
            console.log(`   Result: ${JSON.stringify(testResult, null, 2)}`);
            
            if (testResult.valid) {
                console.log(`✅ FOUND WORKING POOL: ${pool.poolId} (${pool.name})`);
                return pool.poolId;
            }
        }

        console.log(`\n❌ NO WORKING POOL FOUND`);
        return null;
    }
}

// Usage example and test function
async function testBonkfunPool() {
    const finder = new BonkfunPoolFinder();
    
    // Test with the problematic token
    const tokenAddress = 'HhfyQNANe8DNAgSaMNRAW5GAs6J15PpTNMUpzBbbonk';
    const expectedPoolId = '4sRW7YEmDXbBZRVGAUBT4RHPWcJ8ALyXmfYbd9dtWNtg';
    
    console.log(`Expected pool ID: ${expectedPoolId}`);
    
    const foundPoolId = await finder.findPoolId(tokenAddress);
    
    if (foundPoolId) {
        console.log(`\n🎯 RESULT: Found pool ID: ${foundPoolId}`);
        console.log(`✅ Success: ${foundPoolId === expectedPoolId ? 'MATCHES EXPECTED!' : 'Different from expected'}`);
        
        // Test the expected pool ID directly
        console.log(`\n🔬 Testing expected pool ID directly...`);
        const directTest = await finder.testPoolId(expectedPoolId);
        console.log(`Expected pool test result: ${JSON.stringify(directTest, null, 2)}`);
    } else {
        console.log(`\n❌ FAILED: Could not find any working pool ID`);
    }
}

// Export for use in other files
module.exports = BonkfunPoolFinder;

// Run test if this file is executed directly
if (require.main === module) {
    testBonkfunPool().catch(console.error);
}