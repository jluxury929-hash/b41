/**
 * ===============================================================================
 * APEX TITAN v88.1 - EXECUTION VERBOSITY
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

const ROUTERS = {
    ETHEREUM: { uni: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", sushi: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F" },
    BASE: { uni: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24", sushi: "0x6BDED42c679f1ee30611fa44f83736765790757a" }
};

const POOL_MAP = {
    ETHEREUM: { uni: "0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc", sushi: "0x397ff1542f962076d0bfe58ea045ffa2d347aca0" },
    BASE:     { uni: "0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C", sushi: "0x2e0a2da557876a91726719114777c082531d2794" }
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
        
        // v6 FIX: staticNetwork must be a Network object to prevent "noNetwork" errors
        this.providers[name] = new JsonRpcProvider(url, undefined, { 
            staticNetwork: Network.from(chainId) 
        });
        this.wallets[name] = new Wallet(PRIVATE_KEY, this.providers[name]);
        console.log(colors.cyan(`[${name}] Provider: ${url.split('/')[2]} | Status: ACTIVE`));
    }

    async scan(name) {
        try {
            const pools = POOL_MAP[name];
            const multi = new Contract("0xcA11bde05977b3631167028862bE2a173976CA11", this.multiAbi, this.providers[name]);
            const v2 = new Interface(this.v2Abi);

            const results = await multi.tryAggregate(false, [
                { target: getAddress(pools.uni), callData: v2.encodeFunctionData("getReserves") },
                { target: getAddress(pools.sushi), callData: v2.encodeFunctionData("getReserves") }
            ]);

            if (!results[0].success || !results[1].success) return;

            const resUni = v2.decodeFunctionResult("getReserves", results[0].returnData);
            const resSushi = v2.decodeFunctionResult("getReserves", results[1].returnData);

            // Math Check
            const amountIn = parseEther("0.1");
            const amtOut1 = (amountIn * 997n * BigInt(resUni[1])) / ((BigInt(resUni[0]) * 1000n) + (amountIn * 997n));
            const amtOut2 = (amtOut1 * 997n * BigInt(resSushi[0])) / ((BigInt(resSushi[1]) * 1000n) + (amtOut1 * 997n));

            if (amtOut2 > amountIn) {
                console.log(colors.green.bold(`\n[${name}] 💰 SPREAD FOUND: ${formatEther(amtOut2 - amountIn)} ETH`));
                await this.strike(name, amountIn);
            } else {
                // Verbosity: uncomment to see why it isn't striking
                // process.stdout.write(colors.gray(`[Gap: ${formatEther(amtOut2 - amountIn)}] `));
                process.stdout.write(colors.gray("."));
            }
        } catch (e) {
            // Only rotate on actual connection errors
            if (e.message.includes("network") || e.message.includes("404") || e.message.includes("timeout")) {
                console.log(colors.red(`\n[${name}] Connection Error. Rotating...`));
                this.rpcIndex[name]++;
                await this.rotateProvider(name);
            }
        }
    }

    async strike(name, amount) {
        const executor = new Contract(EXECUTOR, this.execAbi, this.wallets[name]);
        try {
            console.log(colors.yellow(`[STRIKE] Sending Transaction...`));
            const tx = await executor.executeTriangle(
                ROUTERS[name].uni, ROUTERS[name].sushi, 
                "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH (Needs per-chain map)
                "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC (Needs per-chain map)
                amount,
                { value: amount, gasLimit: 500000 }
            );
            console.log(colors.magenta.bold(`🚀 STRIKE SUCCESS: ${tx.hash}`));
            await tx.wait();
        } catch (e) {
            console.log(colors.red(`[STRIKE] Reverted: ${e.reason || "Price moved or High Gas"}`));
        }
    }

    async run() {
        console.log(colors.yellow.bold("\n⚡ APEX TITAN v88.1 | ENGINE START\n"));
        while (true) {
            for (const name of Object.keys(ROUTERS)) await this.scan(name);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

new ApexOmniGovernor().run();
