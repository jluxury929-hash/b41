/**
 * ===============================================================================
 * APEX TITAN v88.0 - STRIKE FINALITY
 * ===============================================================================
 */

require('dotenv').config();
const colors = require('colors');
colors.enable();

const { 
    ethers, JsonRpcProvider, Wallet, Contract, Interface, parseEther, formatEther, Network, getAddress 
} = require('ethers');

// --- 1. CONFIGURATION ---
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const EXECUTOR = process.env.EXECUTOR_ADDRESS;

const ROUTERS = {
    ETHEREUM: {
        uni: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        sushi: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"
    },
    BASE: {
        uni: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24", // Uniswap V2 (Base)
        sushi: "0x6BDED42c679f1ee30611fa44f83736765790757a"  // Sushi Base
    }
};

const POOL_MAP = {
    ETHEREUM: { uni: "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc", sushi: "0x397ff1542f962076d0bfe58ea045ffa2d347aca0" },
    BASE:     { uni: "0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C", sushi: "0x2e0a2da557876a91726719114777c082531d2794" }
};

const TOKENS = {
    ETHEREUM: { weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    BASE:     { weth: "0x4200000000000000000000000000000000000006", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }
};

// --- 2. MATH UTILITIES ---
function getAmountOut(amountIn, resIn, resOut) {
    if (resIn === 0n || resOut === 0n) return 0n;
    const amountInWithFee = BigInt(amountIn) * 997n;
    return (amountInWithFee * BigInt(resOut)) / ((BigInt(resIn) * 1000n) + amountInWithFee);
}

class ApexOmniGovernor {
    constructor() {
        this.providers = {}; this.wallets = {}; this.rpcIndex = { ETHEREUM: 0, BASE: 0 };
        this.multiAbi = ["function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)"];
        this.v2Abi = ["function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"];
        this.execAbi = ["function executeTriangle(address routerA, address routerB, address tokenA, address tokenB, uint256 amount) external payable"];
        
        for (const name of Object.keys(ROUTERS)) this.rotateProvider(name);
    }

    async rotateProvider(name) {
        const rpcs = [process.env[`${name}_RPC`], "https://eth.llamarpc.com", "https://base.llamarpc.com"].filter(Boolean);
        const url = rpcs[this.rpcIndex[name] % rpcs.length];
        this.providers[name] = new JsonRpcProvider(url, undefined, { staticNetwork: true });
        this.wallets[name] = new Wallet(PRIVATE_KEY, this.providers[name]);
        console.log(colors.cyan(`[${name}] Provider: ${url.split('/')[2]}`));
    }

    async scan(name) {
        const pools = POOL_MAP[name];
        const multi = new Contract("0xcA11bde05977b3631167028862bE2a173976CA11", this.multiAbi, this.providers[name]);
        const v2 = new Interface(this.v2Abi);

        try {
            const calls = [
                { target: getAddress(pools.uni), callData: v2.encodeFunctionData("getReserves") },
                { target: getAddress(pools.sushi), callData: v2.encodeFunctionData("getReserves") }
            ];

            const results = await multi.tryAggregate(false, calls);
            if (!results[0].success || !results[1].success) {
                process.stdout.write(colors.gray("?"));
                return;
            }

            const resUni = v2.decodeFunctionResult("getReserves", results[0].returnData);
            const resSushi = v2.decodeFunctionResult("getReserves", results[1].returnData);

            // Test 0.1 ETH trade
            const amountIn = parseEther("0.1");
            const tokens = getAmountOut(amountIn, resUni[0], resUni[1]);
            const back = getAmountOut(tokens, resSushi[1], resSushi[0]);

            if (back > amountIn + parseEther("0.0001")) {
                console.log(colors.green.bold(`\n[${name}] 💰 SIGNAL: Profit ${formatEther(back - amountIn)} ETH`));
                await this.strike(name, amountIn);
            } else {
                process.stdout.write(colors.gray("."));
            }
        } catch (e) {
            this.rpcIndex[name]++;
            await this.rotateProvider(name);
        }
    }

    async strike(name, amount) {
        const config = ROUTERS[name];
        const tokens = TOKENS[name];
        const executor = new Contract(EXECUTOR, this.execAbi, this.wallets[name]);

        try {
            console.log(colors.yellow(`[STRIKE] Broadcasting to ${name}...`));
            const tx = await executor.executeTriangle(
                config.uni, config.sushi, tokens.weth, tokens.usdc, amount,
                { value: amount, gasLimit: 400000 }
            );
            console.log(colors.magenta.bold(`🚀 STRIKE SUCCESS: ${tx.hash}`));
            await tx.wait();
        } catch (e) {
            console.log(colors.red(`[STRIKE] Failed: ${e.reason || "Sim Revert"}`));
        }
    }

    async run() {
        console.log(colors.yellow.bold("\n⚡ APEX TITAN v88.0 | STRIKE FINALITY\n"));
        while (true) {
            for (const name of Object.keys(ROUTERS)) await this.scan(name);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

new ApexOmniGovernor().run();
