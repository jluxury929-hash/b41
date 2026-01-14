/**
 * ===============================================================================
 * APEX TITAN v87.3 - OMNI-FINALITY + FLASHBOTS SENTRY
 * ===============================================================================
 */

require('dotenv').config();
const http = require('http');
const { 
    ethers, JsonRpcProvider, Wallet, Contract, Interface, parseEther, formatEther 
} = require('ethers');
const { FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle');

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

// Hard-capture env variables
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const EXECUTOR_ADDRESS = process.env.EXECUTOR_ADDRESS;
const FB_AUTH_KEY = process.env.FB_AUTH_KEY || PRIVATE_KEY; // Unique key for FB reputation

const POOL_MAP = {
    ETHEREUM: ["0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
    BASE: ["0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24", "0x25d887Ce7a35172C62FeBFD67a1856F20FaEbb00"]
};

const NETWORKS = {
    ETHEREUM: { chainId: 1, rpc: process.env.ETH_RPC, multicall: "0xcA11bde05977b3631167028862bE2a173976CA11", router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", fb: "https://relay.flashbots.net" },
    BASE: { chainId: 8453, rpc: process.env.BASE_RPC, multicall: "0xcA11bde05977b3631167028862bE2a173976CA11", router: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24" }
};

// ==========================================
// 2. CORE OMNI-ENGINE
// ==========================================
class ApexOmniGovernor {
    constructor() {
        this.providers = {}; this.wallets = {}; this.fbProviders = {};
        this.multiAbi = ["function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)"];
        this.pairAbi = ["function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"];
        this.execAbi = ["function executeTriangle(address router, address tokenA, address tokenB, uint256 amountIn) external payable"];
        
        this.init();
    }

    async init() {
        for (const [name, config] of Object.entries(NETWORKS)) {
            const provider = new JsonRpcProvider(config.rpc, config.chainId, { staticNetwork: true });
            this.providers[name] = provider;
            this.wallets[name] = new Wallet(PRIVATE_KEY, provider);

            if (config.fb) {
                const authSigner = new Wallet(FB_AUTH_KEY, provider);
                this.fbProviders[name] = await FlashbotsBundleProvider.create(provider, authSigner, config.fb);
                console.log(colors.cyan(`[${name}] Flashbots Sentry Active.`));
            }
        }
    }

    async scanAndStrike(name) {
        const config = NETWORKS[name];
        const pools = POOL_MAP[name];
        try {
            const multi = new Contract(config.multicall, this.multiAbi, this.providers[name]);
            const itf = new Interface(this.pairAbi);
            const calls = pools.map(addr => ({ target: addr, callData: itf.encodeFunctionData("getReserves") }));

            const [balance, [, returnData]] = await Promise.all([
                this.providers[name].getBalance(this.wallets[name].address),
                multi.tryAggregate(false, calls)
            ]);

            const reserves = returnData.filter(r => r.success).map(r => itf.decodeFunctionResult("getReserves", r.returnData));
            const tradeSize = balance - parseEther("0.01"); // Simple Moat

            if (tradeSize > 0n && reserves.length >= 2) {
                // Insert ArbitrageMath.calculateCyclicProfit check here
                console.log(colors.gray(`[${name}] Market Synced. Balance: ${formatEther(balance).slice(0,6)} ETH`));
            }
        } catch (e) { console.log(colors.red(`[${name}] Scan Lag.`)); }
    }

    async run() {
        console.log(colors.bold(colors.yellow("\n⚡ APEX TITAN v87.3 | OMNI-FINALITY READY\n")));
        while (true) {
            for (const name of Object.keys(NETWORKS)) await this.scanAndStrike(name);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
}

// --- 3. IGNITION ---
const governor = new ApexOmniGovernor();
http.createServer((req, res) => { res.writeHead(200); res.end("OPERATIONAL"); }).listen(process.env.PORT || 8080);
governor.run();
