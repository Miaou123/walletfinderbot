# Helius Stress Test Runner

## 🚀 Quick Start

Save the stress test as `test/heliusStressTest.js` and run:

```bash
# Quick 1-minute test
node test/heliusStressTest.js quick

# Standard 5-minute test  
node test/heliusStressTest.js standard

# Extreme 10-minute load test
node test/heliusStressTest.js extreme

# Test only RPC endpoints
node test/heliusStressTest.js rpcOnly

# Test only Enhanced API endpoints  
node test/heliusStressTest.js apiOnly

# Circuit breaker test (triggers failures intentionally)
node test/heliusStressTest.js circuitBreakerTest
```

## 📊 What Each Test Does

### **Standard Test (Recommended)**
- **Duration:** 5 minutes
- **Concurrency:** 50 parallel requests
- **Coverage:** All endpoints (RPC + Enhanced API)
- **Purpose:** Real-world load simulation

### **Quick Test** 
- **Duration:** 1 minute
- **Concurrency:** 20 parallel requests  
- **Purpose:** Development/debugging

### **Extreme Test**
- **Duration:** 10 minutes
- **Concurrency:** 100 parallel requests
- **Purpose:** Maximum stress testing

### **Circuit Breaker Test**
- **Concurrency:** 150 parallel requests (intentionally high)
- **Purpose:** Test failover behavior and recovery

## 🎯 Tested Endpoints

### **RPC Endpoints (200 req/s limit):**
- `getTokenAccountsByOwner` - Your main wallet checking endpoint
- `getBalance` - SOL balance checks
- `getTokenSupply` - Token supply info
- `getAccountInfo` - Account data
- `getTokenLargestAccounts` - Top holders
- `getSignaturesForAddress` - Transaction history
- `getTransaction` - Transaction details
- `getTokenMetadata` - Token metadata

### **Enhanced API Endpoints (50 req/s limit):**
- `getAssetsByOwner` - NFT/token assets
- `getAsset` - Individual asset info
- `getTokenAccounts` - Token account pagination
- `getAssetCount` - Asset counting

## 📈 What to Look For

### **✅ Good Results:**
- **Success Rate:** >95%
- **Circuit Breaker:** Stays closed during normal load
- **Timeouts:** <5% of requests
- **Rate Limiter:** Queue stays under 30 for RPC, 15 for API

### **⚠️ Warning Signs:**
- **Success Rate:** 85-95%
- **Frequent retries:** High retry success rate
- **Growing queues:** >50 RPC, >20 API queue size

### **❌ Problems:**
- **Success Rate:** <85%
- **Circuit breaker opens:** During normal load
- **High timeouts:** >10% timeout rate
- **Queue overflow:** Consistent high queue sizes

## 🔧 Custom Test

```javascript
const { HeliusStressTest } = require('./test/heliusStressTest');

async function customTest() {
  const stressTest = new HeliusStressTest();
  
  await stressTest.runStressTest({
    duration: 120000,        // 2 minutes
    concurrency: 30,         // 30 parallel requests
    testMix: 'rpc',         // Only test RPC endpoints
    intensity: 'medium'      // Moderate load
  });
}

customTest();
```

## 📊 Sample Output

```
🚀 Starting Helius Stress Test {
  duration: 300000,
  concurrency: 50,
  testMix: 'all',
  intensity: 'high'
}

📊 Phase: Warm-up (30000ms, 30% intensity)
📊 Phase: Ramp-up (30000ms, 70% intensity)  
📊 Phase: Peak Load (180000ms, 100% intensity)
📊 Phase: Sustained Load (90000ms, 80% intensity)
📊 Phase: Cool-down (30000ms, 20% intensity)

================================================================================
🎯 HELIUS STRESS TEST REPORT
================================================================================

📊 OVERALL STATISTICS:
Duration: 360.1s
Total Requests: 2847
Successful: 2731
Failed: 116
Success Rate: 95.9%
Requests/Second: 7.91

🎯 ENDPOINT PERFORMANCE:
getTokenAccountsByOwner:
  Requests: 487
  Success Rate: 96.3%
  Avg Duration: 1247ms
  Min/Max: 234ms / 8934ms

getBalance:
  Requests: 298  
  Success Rate: 98.7%
  Avg Duration: 892ms
  Min/Max: 156ms / 4532ms

⚙️ RATE LIMITER STATS:
{
  "totalRequests": 2847,
  "failedRequests": 116,
  "timeoutRequests": 23,
  "consecutiveFailures": 0,
  "failureRate": "4.1%",
  "timeoutRate": "0.8%",
  "circuitOpen": false,
  "rpcQueue": 3,
  "apiQueue": 1
}
```

## 🎯 Interpreting Results

### **Your Rate Limiter Performance:**
- **Queue Management:** Should see queues build up during peak load, then drain
- **Circuit Breaker:** Should NOT open during normal tests (only during extreme)
- **Retry Logic:** Should see some retry successes, indicating smart recovery
- **Timeout Handling:** Progressive timeouts should prevent most timeout failures

### **Helius API Performance:**
- **RPC Endpoints:** Should handle 180+ req/s easily
- **Enhanced APIs:** Should handle 45+ req/s without issues
- **Response Times:** Varies by endpoint, 500ms-3s is normal
- **Error Patterns:** Look for specific error types (rate limits vs timeouts)

## 🚨 Troubleshooting

### **High Failure Rate:**
1. Check if circuit breaker is opening too early
2. Verify timeout settings aren't too aggressive
3. Monitor for specific error patterns

### **Poor Performance:**
1. Reduce concurrency in rate limiter settings
2. Increase delays between requests
3. Check network conditions

### **Circuit Breaker Issues:**
1. Adjust failure threshold (currently 8)
2. Modify circuit timeout (currently 90s)
3. Test with `circuitBreakerTest` preset

## 🎮 Running Continuous Tests

```bash
# Run tests every hour for 24 hours
for i in {1..24}; do
  echo "=== Test Run $i ==="
  node test/heliusStressTest.js standard
  sleep 3600  # 1 hour
done
```

This stress test will give you complete confidence in your rate limiter's performance under various load conditions!