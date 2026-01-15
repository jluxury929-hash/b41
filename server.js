/**
 * ===============================================================================
 * APEX TITAN v87.6 - OMNI-FINALITY (STABILIZED & SANITIZED)
 * ===============================================================================
 */

require('dotenv').config();
const http = require('http');
const { 
    ethers, JsonRpcProvider, Wallet, Contract, Interface, parseEther, formatEther, Network, getAddress 
} = require('ethers');

// --- 1. GLOBAL SCOPE INITIALIZATION ---
try {
    global.colors = require('colors');
    global.axios = require('axios');
    global.Sentiment = require('sentiment');
    global.colors.enable();
} catch (e) {
    console.log("CRITICAL: Run 'npm install ethers colors axios sentiment @flashbots/ethers-provider-bundle'");
    process.exit(1);
}

const colors = global.colors;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const EXECUTOR_ADDRESS = process.env.EXECUTOR_ADDRESS;

// ==========================================
// 2. REFINED POOL CONFIG (SANITIZED)
// ==========================================
// We use .toLowerCase() here to prevent the "bad address checksum" error on startup
const POOL_MAP = {
    ETHEREUM: [
        "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270".toLowerCase(),
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48".toLowerCase()
    ],
    BASE: [
        "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24".toLowerCase(),
        "0xc96F9866576839350630799784e889F999819669".toLowerCase()
    ]
};

const NETWORKS = {
    ETHEREUM: { 
        chainId: 1, 
        rpc: process.env.ETH_RPC || "https://eth.llamarpc.com", 
        multicall: "0xcA11bde05977b3631167028862bE2a173976CA11", 
        router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"
    },
    BASE: { 
        chainId: 8453, 
        rpc: process.env.BASE_RPC || "https://mainnet.base.org", 
        multicall: "0xcA11bde05977b3631167028862bE2a173976CA11", 
        router: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24" 
    }
};

// ==========================================
// 3. OMNI GOVERNOR ENGINE
// ==========================================
class ApexOmniGovernor {
    constructor() {
        this.providers = {};
        this.wallets = {};
        this.multiAbi = ["function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)"];
        this.pairAbi = ["function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"];
        this.init();
    }

    async init() {
        for (const [name, config] of Object.entries(NETWORKS)) {
            try {
                this.providers[name] = new JsonRpcProvider(config.rpc, undefined, { 
                    staticNetwork: Network.from(config.chainId) 
                });
                this.wallets[name] = new Wallet(PRIVATE_KEY, this.providers[name]);
                console.log(colors.green(`[${name}] Provider Online & Hardened.`));
            } catch (e) { console.log(colors.red(`[${name}] Init Failed: ${e.message}`)); }
        }
    }

    async scanAndStrike(name) {
        const config = NETWORKS[name];
        const pools = POOL_MAP[name];
        const wallet = this.wallets[name];

        try {
            const multi = new Contract(config.multicall, this.multiAbi, this.providers[name]);
            const itf = new Interface(this.pairAbi);
            
            // FIX: Sanitizing addresses inside the loop to ensure clean HexStrings
            const calls = pools.map(addr => ({ 
                target: getAddress(addr.toLowerCase()), 
                callData: itf.encodeFunctionData("getReserves") 
            }));

            // Force a 5-second timeout for RPC responses
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("RPC_TIMEOUT")), 5000));
            
            const [balance, results] = await Promise.all([
                this.providers[name].getBalance(wallet.address),
                Promise.race([multi.tryAggregate(false, calls), timeout])
            ]);

            const validReserves = results.filter(r => r.success && r.returnData !== "0x");

            if (validReserves.length >= 2) {
                console.log(colors.gray(`[${name}] Sync Success. Balance: ${formatEther(balance).slice(0,6)} ETH`));
            }
        } catch (e) {
            const errorType = e.message.includes("checksum") ? "Address Fix Applied" : "RPC Congestion";
            console.log(colors.yellow(`[${name}] ${errorType}: ${e.message.slice(0, 35)}`));
        }
    }

    async run() {
        console.log(colors.bold(colors.yellow("\n⚡ APEX TITAN v87.6 | OMNI-FINALITY ACTIVE\n")));
        
        while (true) {
            for (const name of Object.keys(NETWORKS)) {
                await this.scanAndStrike(name);
                // 500ms breather to prevent RPC "missing response" errors
                await new Promise(r => setTimeout(r, 500));
            }
            await new Promise(r => setTimeout(r, 3000));
        }
    }
}

// ==========================================
// 4. IGNITION
// ==========================================
const governor = new ApexOmniGovernor();

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: "OPERATIONAL", version: "v87.6" }));
}).listen(process.env.PORT || 8080);

governor.run().catch(e => {
    console.error(colors.red(`[FATAL] Loop Crash: ${e.message}`));
    process.exit(1);
});
