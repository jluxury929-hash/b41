/**
 * ===============================================================================
 * APEX TITAN v87.7 - RPC REDUNDANCY & FAILOVER
 * ===============================================================================
 * FIXES:
 * 1. BASE FAILOVER: Added backup RPCs to bypass 404 Not Found errors.
 * 2. ROTATION LOGIC: Automatic index shifting on network rejection.
 * 3. STALL PROTECTION: Reduced stallTimeout to force faster rotation.
 * ===============================================================================
 */

require('dotenv').config();
const { 
    ethers, JsonRpcProvider, Wallet, Contract, Interface, parseEther, formatEther, Network, getAddress 
} = require('ethers');

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

// --- NEW: MULTI-RPC ENDPOINTS ---
const NETWORKS = {
    ETHEREUM: { 
        chainId: 1, 
        rpcs: [process.env.ETH_RPC, "https://eth.llamarpc.com", "https://rpc.ankr.com/eth"].filter(Boolean), 
        multicall: "0xcA11bde05977b3631167028862bE2a173976CA11"
    },
    BASE: { 
        chainId: 8453, 
        rpcs: [process.env.BASE_RPC, "https://base.llamarpc.com", "https://mainnet.base.org"].filter(Boolean), 
        multicall: "0xcA11bde05977b3631167028862bE2a173976CA11" 
    }
};

class ApexOmniGovernor {
    constructor() {
        this.providers = {};
        this.rpcIndex = { ETHEREUM: 0, BASE: 0 };
        this.multiAbi = ["function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)"];
        this.pairAbi = ["function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"];
        
        for (const name of Object.keys(NETWORKS)) this.rotateProvider(name);
    }

    async rotateProvider(name) {
        const config = NETWORKS[name];
        const url = config.rpcs[this.rpcIndex[name] % config.rpcs.length];
        
        this.providers[name] = new JsonRpcProvider(url, undefined, { 
            staticNetwork: Network.from(config.chainId) 
        });
        
        console.log(global.colors.cyan(`[${name}] Provider Rotated -> ${url.split('/')[2]}`));
    }

    async scanAndStrike(name) {
        const config = NETWORKS[name];
        const pools = POOL_MAP[name];

        try {
            const multi = new Contract(config.multicall, this.multiAbi, this.providers[name]);
            const itf = new Interface(this.pairAbi);
            const calls = pools.map(addr => ({ 
                target: getAddress(addr), 
                callData: itf.encodeFunctionData("getReserves") 
            }));

            // Use a race to detect if the RPC is hanging
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("RPC_STALL")), 4000));
            const results = await Promise.race([multi.tryAggregate(false, calls), timeout]);

            if (results && results.length >= 2) {
                process.stdout.write(global.colors.gray(".")); // Healthy pulse
            }
        } catch (e) {
            console.log(global.colors.red(`\n[${name}] RPC Error: ${e.message.slice(0,25)}. Rotating...`));
            this.rpcIndex[name]++;
            await this.rotateProvider(name);
        }
    }

    async run() {
        console.log(global.colors.yellow.bold("\n⚡ APEX TITAN v87.7 | REDUNDANCY ENABLED\n"));
        while (true) {
            for (const name of Object.keys(NETWORKS)) {
                await this.scanAndStrike(name);
            }
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

new ApexOmniGovernor().run();
