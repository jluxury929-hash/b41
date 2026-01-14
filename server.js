/**
 * ===============================================================================
 * APEX TITAN v87.0 (FULL BUILD) - MULTICALL & CYCLIC PATH SINGULARITY
 * ===============================================================================
 */

require('dotenv').config();
const cluster = require('cluster');
const os = require('os');
const http = require('http');
const WebSocket = require("ws");
const { 
    ethers, JsonRpcProvider, Wallet, Contract, Interface, parseEther, formatEther 
} = require('ethers');
require('colors');

// ==========================================
// 1. MATHEMATICAL ENGINE (CYCLIC PATH)
// ==========================================
class ArbitrageMath {
    /**
     * Uniswap V2 Constant Product Formula: (dy = (dx * 997 * y) / (x * 1000 + dx * 997))
     * Includes 0.3% fee per hop.
     */
    static getAmountOut(amountIn, reserveIn, reserveOut) {
        if (amountIn <= 0n) return 0n;
        const amountInWithFee = amountIn * 997n;
        const numerator = amountInWithFee * reserveOut;
        const denominator = (reserveIn * 1000n) + amountInWithFee;
        return numerator / denominator;
    }

    static calculateCyclicProfit(amountIn, reservesArray) {
        let currentAmount = amountIn;
        for (const [resIn, resOut] of reservesArray) {
            currentAmount = this.getAmountOut(currentAmount, resIn, resOut);
        }
        return currentAmount - amountIn; // Positive = Real Net Profit
    }
}

// ==========================================
// 2. MULTICALL AGGREGATOR
// ==========================================
class MulticallScanner {
    constructor(provider, multicallAddress) {
        this.provider = provider;
        this.address = multicallAddress;
        this.iface = new Interface([
            "function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)"
        ]);
        this.poolIface = new Interface([
            "function getReserves() external view returns (uint112, uint112, uint32)"
        ]);
    }

    async getBulkReserves(poolAddresses) {
        const calls = poolAddresses.map(target => ({
            target,
            callData: this.poolIface.encodeFunctionData("getReserves")
        }));

        try {
            const tx = { to: this.address, data: this.iface.encodeFunctionData("aggregate", [calls]) };
            const result = await this.provider.call(tx);
            const [, returnData] = this.iface.decodeFunctionResult("aggregate", result);
            
            return returnData.map(data => {
                const r = this.poolIface.decodeFunctionResult("getReserves", data);
                return [BigInt(r[0]), BigInt(r[1])]; // [reserve0, reserve1]
            });
        } catch (e) {
            return [];
        }
    }
}

// ==========================================
// 3. CORE INFRASTRUCTURE
// ==========================================
const NETWORKS = {
    ETHEREUM: { chainId: 1, rpc: process.env.ETH_RPC, multicall: "0xcA11bde05977b3631167028862bE2a173976CA11", moat: "0.01", router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D" },
    BASE: { chainId: 8453, rpc: process.env.BASE_RPC, multicall: "0xcA11bde05977b3631167028862bE2a173976CA11", moat: "0.005", router: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24" }
};

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const EXECUTOR_ADDRESS = process.env.EXECUTOR_ADDRESS;

if (cluster.isPrimary) {
    console.log(`\n⚡ APEX TITAN v87.0 ONLINE | MULTICALL ACTIVE`.gold.bold);
    Object.keys(NETWORKS).forEach(chain => cluster.fork({ TARGET_CHAIN: chain }));
} else {
    runWorker();
}

async function runWorker() {
    const name = process.env.TARGET_CHAIN;
    const config = NETWORKS[name];
    const provider = new JsonRpcProvider(config.rpc, config.chainId, { staticNetwork: true });
    const wallet = new Wallet(PRIVATE_KEY, provider);
    const scanner = new MulticallScanner(provider, config.multicall);

    console.log(`[${name}] Worker Engine Engaged.`.cyan);

    // Startup Diagnostic Ping
    try {
        await wallet.sendTransaction({ to: wallet.address, value: 0, gasLimit: 21000 });
        console.log(`[${name}] ✅ Diagnostic Ping Successful.`.green);
    } catch (e) { console.log(`[${name}] ⚠️ Ping Failed (Check balance).`.red); }

    // THE MAIN ARBITRAGE LOOP
    while (true) {
        try {
            const balance = await provider.getBalance(wallet.address);
            const tradeSize = balance - parseEther(config.moat);

            if (tradeSize > parseEther("0.001")) {
                // Example: Checking 3 pools in a cycle (ETH -> TOKEN A -> TOKEN B -> ETH)
                const pools = [
                    "0x...", // Pool 1: ETH/TokenA
                    "0x...", // Pool 2: TokenA/TokenB
                    "0x..."  // Pool 3: TokenB/ETH
                ];

                const reserves = await scanner.getBulkReserves(pools);
                const netProfit = ArbitrageMath.calculateCyclicProfit(tradeSize, reserves);

                if (netProfit > 0n) {
                    console.log(`[${name}] 💰 Arb Found! Net Profit: ${formatEther(netProfit)} ETH`.gold);
                    // Strike logic goes here...
                }
            }
        } catch (e) { /* Suppressed network errors */ }
        await new Promise(r => setTimeout(r, 2000));
    }
}
