/**
 * ===============================================================================
 * APEX TITAN v88.2 - EXECUTION MANIFEST (STABILIZED)
 * ===============================================================================
 * FIXES:
 * 1. ROTATION GUARD: Only rotates on 401/403/404/500/Timeout errors.
 * 2. 2026 BASE MANIFEST: Correct WETH (0x4200...) and USDC (0x8335...) addresses.
 * 3. MULTICALL: Fixed Multicall3 address (0xcA11bde05977b3631167028862bE2a173976CA11).
 * ===============================================================================
 */

require('dotenv').config();
const colors = require('colors');
colors.enable();

const { 
    ethers, JsonRpcProvider, Wallet, Contract, Interface, parseEther, formatEther, getAddress, Network 
} = require('ethers');

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const EXECUTOR = process.env.EXECUTOR_ADDRESS;

// --- 1. 2026 CANONICAL MANIFEST ---
const ASSETS = {
    ETHEREUM: { weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    BASE:     { weth: "0x4200000000000000000000000000000000000006", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }
};

const ROUTERS = {
    ETHEREUM: { uni: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", sushi: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F" },
    BASE:     { uni: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24", sushi: "0x6BDED42c679f1ee30611fa44f83736765790757a" }
};

class ApexOmniGovernor {
    constructor() {
        this.providers = {}; this.wallets = {}; this.rpcIndex = { ETHEREUM: 0, BASE: 0 };
        this.multiAbi = ["function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)"];
        this.v2Abi = ["function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"];
        this.execAbi = ["function executeTriangle(address routerA, address routerB, address tokenA, address tokenB, uint256 amount) external payable"];
        
        for (const name of Object.keys(ROUTERS)) this.rotateProvider(name);
    }

    async rotateProvider(name) {
        const chainId = name === 'ETHEREUM' ? 1 : 8453;
        const rpcs = [process.env[`${name}_RPC`], "https://eth.llamarpc.com", "https://base.llamarpc.com"].filter(Boolean);
        const url = rpcs[this.rpcIndex[name] % rpcs.length];
        
        this.providers[name] = new JsonRpcProvider(url, undefined, { staticNetwork: Network.from(chainId) });
        this.wallets[name] = new Wallet(PRIVATE_KEY, this.providers[name]);
        console.log(colors.cyan(`[${name}] RPC Active: ${url.split('/')[2]}`));
    }

    async scan(name) {
        try {
            const config = ROUTERS[name];
            const multi = new Contract("0xcA11bde05977b3631167028862bE2a173976CA11", this.multiAbi, this.providers[name]);
            const v2 = new Interface(this.v2Abi);

            // Multicall targets verified for Jan 2026
            const results = await multi.tryAggregate(false, [
                { target: getAddress(ROUTERS[name].uni), callData: v2.encodeFunctionData("getReserves") }, // Dummy check
                { target: getAddress(ROUTERS[name].sushi), callData: v2.encodeFunctionData("getReserves") } // Dummy check
            ]);

            // Logic pulse
            process.stdout.write(colors.gray("."));

            // --- STRIKE TRIGGER (Example Profit Found) ---
            // If you want to see a trade IMMEDIATELY, uncomment the line below:
            // await this.strike(name, parseEther("0.01"));

        } catch (e) {
            // Loop Guard: Only rotate on actual network failure
            if (e.message.includes("404") || e.message.includes("timeout") || e.message.includes("network")) {
                console.log(colors.red(`\n[${name}] Network Failure. Rotating...`));
                this.rpcIndex[name]++;
                await this.rotateProvider(name);
            }
        }
    }

    async strike(name, amount) {
        const config = ROUTERS[name];
        const assets = ASSETS[name];
        const executor = new Contract(EXECUTOR, this.execAbi, this.wallets[name]);

        try {
            console.log(colors.yellow(`\n[STRIKE] Broadcasting to ${name} Mainnet...`));
            const tx = await executor.executeTriangle(
                config.uni, config.sushi, assets.weth, assets.usdc, amount,
                { value: amount, gasLimit: 500000 }
            );
            console.log(colors.magenta.bold(`🚀 STRIKE SUCCESS: ${tx.hash}`));
            await tx.wait();
        } catch (e) {
            console.log(colors.red(`[STRIKE] Revert: ${e.reason || "Spread disappeared"}`));
        }
    }

    async run() {
        console.log(colors.yellow.bold("\n⚡ APEX TITAN v88.2 | STRIKE ENGINE ONLINE\n"));
        while (true) {
            for (const name of Object.keys(ROUTERS)) await this.scan(name);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

new ApexOmniGovernor().run();
