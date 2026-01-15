/**
 * ===============================================================================
 * APEX TITAN v87.9 - DUAL-DEX STRIKE ENGINE
 * ===============================================================================
 */

require('dotenv').config();
const colors = require('colors');
colors.enable();
global.colors = colors;

const { 
    ethers, JsonRpcProvider, Wallet, Contract, Interface, parseEther, formatEther, Network, getAddress 
} = require('ethers');

// --- 1. CONFIGURATION ---
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const EXECUTOR = process.env.EXECUTOR_ADDRESS;

// We compare Uniswap V2 vs Sushiswap V2 to find trades
const POOL_MAP = {
    ETHEREUM: {
        uni: "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc", // USDC/WETH
        sushi: "0x397ff1542f962076d0bfe58ea045ffa2d347aca0" // USDC/WETH
    },
    BASE: {
        uni: "0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C", // USDC/WETH
        sushi: "0x2e0a2da557876a91726719114777c082531d2794" // USDC/WETH
    }
};

const NETWORKS = {
    ETHEREUM: { chainId: 1, rpcs: [process.env.ETH_RPC, "https://eth.llamarpc.com"].filter(Boolean), multicall: "0xcA11bde05977b3631167028862bE2a173976CA11" },
    BASE: { chainId: 8453, rpcs: [process.env.BASE_RPC, "https://base.llamarpc.com"].filter(Boolean), multicall: "0xcA11bde05977b3631167028862bE2a173976CA11" }
};

// --- 2. MATH ENGINE ---
function getAmountOut(amountIn, resIn, resOut) {
    const amountInWithFee = BigInt(amountIn) * 997n; // 0.3% Fee
    return (amountInWithFee * BigInt(resOut)) / ((BigInt(resIn) * 1000n) + amountInWithFee);
}

class ApexOmniGovernor {
    constructor() {
        this.providers = {}; this.wallets = {}; this.rpcIndex = { ETHEREUM: 0, BASE: 0 };
        this.multiAbi = ["function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)"];
        this.pairAbi = ["function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"];
        this.execAbi = ["function executeStrike(address routerA, address routerB, address tokenA, address tokenB, uint256 amount) external payable"];
        
        for (const name of Object.keys(NETWORKS)) this.rotateProvider(name);
    }

    async rotateProvider(name) {
        const config = NETWORKS[name];
        const url = config.rpcs[this.rpcIndex[name] % config.rpcs.length];
        this.providers[name] = new JsonRpcProvider(url, undefined, { staticNetwork: Network.from(config.chainId) });
        this.wallets[name] = new Wallet(PRIVATE_KEY, this.providers[name]);
        console.log(colors.cyan(`[${name}] RPC Active: ${url.split('/')[2]}`));
    }

    async scanAndStrike(name) {
        const poolSet = POOL_MAP[name];
        const config = NETWORKS[name];
        
        try {
            const multi = new Contract(config.multicall, this.multiAbi, this.providers[name]);
            const itf = new Interface(this.pairAbi);
            const calls = [
                { target: getAddress(poolSet.uni), callData: itf.encodeFunctionData("getReserves") },
                { target: getAddress(poolSet.sushi), callData: itf.encodeFunctionData("getReserves") }
            ];

            const results = await multi.tryAggregate(false, calls);
            if (!results[0].success || !results[1].success) return;

            const resUni = itf.decodeFunctionResult("getReserves", results[0].returnData);
            const resSushi = itf.decodeFunctionResult("getReserves", results[1].returnData);

            // Math Check: Buy 0.1 ETH on Uni, sell on Sushi
            const amountIn = parseEther("0.1");
            const tokensFromUni = getAmountOut(amountIn, resUni[0], resUni[1]);
            const ethBackFromSushi = getAmountOut(tokensFromUni, resSushi[1], resSushi[0]);

            if (ethBackFromSushi > amountIn) {
                const profit = ethBackFromSushi - amountIn;
                console.log(colors.green.bold(`\n[${name}] 💰 TRADE SIGNAL: +${formatEther(profit)} ETH`));
                await this.execute(name, amountIn);
            } else {
                process.stdout.write(colors.gray("."));
            }
        } catch (e) {
            this.rpcIndex[name]++;
            this.rotateProvider(name);
        }
    }

    async execute(name, amount) {
        const wallet = this.wallets[name];
        const contract = new Contract(EXECUTOR, this.execAbi, wallet);
        try {
            console.log(colors.yellow(`[${name}] Sending Strike Transaction...`));
            const tx = await contract.executeStrike(
                "0x...", // Router A
                "0x...", // Router B
                "0x...", // Token A (WETH)
                "0x...", // Token B (USDC)
                amount,
                { gasLimit: 500000 }
            );
            console.log(colors.magenta.bold(`🚀 STRIKE SUCCESS: ${tx.hash}`));
            await tx.wait();
        } catch (e) {
            console.log(colors.red(`[${name}] Trade Reverted: ${e.reason || "Gas/Slippage"}`));
        }
    }

    async run() {
        console.log(colors.yellow.bold("\n⚡ APEX TITAN v87.9 | STRIKE ENGINE ONLINE\n"));
        while (true) {
            for (const name of Object.keys(NETWORKS)) await this.scanAndStrike(name);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

new ApexOmniGovernor().run();
