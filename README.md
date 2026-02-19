# liberdus-bridge-contract

Secondary ERC20 contract for Liberdus (LIB) tokens, deployed on EVM chains (e.g. BSC). It represents LIB on the EVM chain and enables bridging tokens to and from the Liberdus network. Unlike the primary contract, it has no independent minting — all token supply enters exclusively through `bridgeIn`, called by the authorized bridge relayer.

> **Related repositories**
> - [`liberdus-token-contract`](https://github.com/liberdus/liberdus-token-contract) — primary Liberdus ERC20 contract on Polygon; main token with controlled minting during pre-mainnet
> - [`liberdus-bsc-bridge-contract`](https://github.com/liberdus/liberdus-bsc-bridge-contract) — vault contract on Polygon for locking LIB during Polygon-to-BSC bridging (pre-mainnet only)

## Overview

`LiberdusSecondary` is a mint/burn ERC20 bridge contract. The authorized `bridgeInCaller` address mints tokens when a user bridges in, and users burn tokens when they bridge out.

### Pre-mainnet (Polygon ↔ BSC via vault)

Bridging before Liberdus mainnet launch uses a lock-and-mint mechanism together with the vault contract (`liberdus-bsc-bridge-contract`) on Polygon:

**Polygon → BSC:** User calls `bridgeOut` on the Polygon vault, locking their LIB. The relayer detects the event and calls `bridgeIn` on this contract, minting LIB to the user on BSC.

**BSC → Polygon:** User calls `bridgeOut` on this contract, burning their LIB. The relayer detects the event and calls `bridgeIn` on the Polygon vault, releasing the locked LIB to the user.

### Post-mainnet (Liberdus network ↔ BSC)

After mainnet launch, the vault is retired and bridging goes directly through the Liberdus network:

**Liberdus → BSC:** The relayer calls `bridgeIn` on this contract, minting LIB to the user on BSC.

**BSC → Liberdus:** User calls `bridgeOut` on this contract, burning their LIB. The relayer completes the transfer on the Liberdus network side.

## Features

- ERC20 token — name: `Liberdus`, symbol: `LIB`
- Multi-signature governance — 3-of-4 signers required for admin operations
- No independent minting — all supply comes via `bridgeIn` called by the authorized relayer
- Replay attack prevention — processed transaction IDs are tracked on-chain
- Bridge in enabled by default; bridge out enabled after Liberdus mainnet launch
- Configurable bridge limits (max amount, cooldown) via multisig
- Chain ID immutably set at deployment

## Contract Parameters

| Parameter | Default | Description |
|---|---|---|
| `maxBridgeInAmount` | 10,000 LIB | Maximum tokens per bridge-in call |
| `bridgeInCooldown` | 1 minute | Minimum time between bridge-in calls |
| `bridgeInEnabled` | `true` | Whether bridge-in is active |
| `bridgeOutEnabled` | `false` | Whether bridge-out is active (enabled once Polygon-to-BSC bridging opens) |
| `REQUIRED_SIGNATURES` | 3 | Signatures needed to execute a multisig operation |
| `OPERATION_DEADLINE` | 3 days | Time window for signers to approve a pending operation |

## Prerequisites

- Node.js v14+
- npm v6+

## Installation

```bash
git clone https://github.com/liberdus/liberdus-bridge-contract.git
cd liberdus-bridge-contract
npm install
```

Create a `.env` file in the root directory:

```env
# Deployed contract address
LIBERDUS_SECONDARY_ADDRESS=0x...

# Deployer / relayer private key
PRIVATE_KEY=0x...

# Multisig signer addresses (for production deployments)
SIGNER_1=0x...
SIGNER_2=0x...
SIGNER_3=0x...
SIGNER_4=0x...

# RPC endpoints
POLYGON_URL=https://polygon-rpc.com
BSC_TESTNET_URL=https://bsc-testnet-dataseed.bnbchain.org

# Block explorer API keys (for contract verification)
POLYGONSCAN_API_KEY=...
BSCSCAN_API_KEY=...
```

## Compile & Test

```bash
# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Run tests with gas report
REPORT_GAS=true npx hardhat test
```

## Deployment

### Local (Hardhat)

Deploys the contract, configures the bridge-in caller, and runs a round-trip bridge test:

```bash
npx hardhat run scripts/deploy-local.js
```

### Testnet / Mainnet

```bash
# BSC testnet
npx hardhat run scripts/deploy-liberdus-secondary.js --network bscTestnet
```

The script outputs the deployed contract address. Set `LIBERDUS_SECONDARY_ADDRESS` in your `.env` for subsequent scripts.

## Bridge Operations

### Bridge In (relayer mints tokens)

The `bridgeInCaller` address calls this after detecting a qualifying event on the source chain (vault `BridgedOut` on Polygon pre-mainnet, or a transfer on the Liberdus network post-mainnet):

```bash
TX_ID=<unique-tx-id> \
AMOUNT_LIB=1000 \
TARGET_ADDRESS=0xRecipient \
npx hardhat run scripts/initiate-bridge-in.js --network bscTestnet
```

| Variable | Default | Description |
|---|---|---|
| `LIBERDUS_SECONDARY_ADDRESS` | — | Contract address (required) |
| `TX_ID` | timestamp-based | Unique ID of the source transaction |
| `AMOUNT_LIB` | `10000` | Amount of LIB to mint |
| `TARGET_ADDRESS` | deployer | Recipient address on BSC |

### Bridge Out (user burns tokens)

The token holder calls this to initiate a transfer back. Pre-mainnet the relayer unlocks tokens from the Polygon vault; post-mainnet it completes the transfer on the Liberdus network:

```bash
AMOUNT_LIB=500 \
TARGET_ADDRESS=0xDestinationAddress \
npx hardhat run scripts/initiate-bridge-out.js --network bscTestnet
```

| Variable | Default | Description |
|---|---|---|
| `LIBERDUS_SECONDARY_ADDRESS` | — | Contract address (required) |
| `AMOUNT_LIB` | `100` | Amount of LIB to burn |
| `TARGET_ADDRESS` | deployer | Destination address (Polygon or Liberdus network) |

## Admin Operations (Multisig)

All admin operations require 3-of-4 signer approval. A signer calls `requestOperation`, then 3 signers call `submitSignature`. Execution is automatic once the threshold is reached.

### Operation Types

| OpType | Name | Description |
|---|---|---|
| 0 | `SetBridgeInCaller` | Set the authorized relayer address |
| 1 | `SetBridgeInLimits` | Update `maxBridgeInAmount` and `bridgeInCooldown` |
| 2 | `UpdateSigner` | Replace one of the 4 multisig signers |
| 3 | `SetBridgeInEnabled` | Enable or disable bridge-in |
| 4 | `SetBridgeOutEnabled` | Enable or disable bridge-out |

### Configure Bridge (local script)

```bash
LIBERDUS_SECONDARY_ADDRESS=0x... \
BRIDGE_IN_CALLER_SECONDARY=0xRelayer \
SECONDARY_BRIDGE_OUT_ENABLED=true \
npx hardhat run scripts/set-bridge-in-caller.js
```

| Variable | Description |
|---|---|
| `BRIDGE_IN_CALLER_SECONDARY` | Address to set as the authorized bridge-in relayer |
| `SECONDARY_BRIDGE_IN_ENABLED` | `true`/`false` to toggle bridge-in |
| `SECONDARY_BRIDGE_OUT_ENABLED` | `true`/`false` to toggle bridge-out |
| `RECIPIENTS` | Comma-separated addresses to pre-fund with ETH |
| `ETH_AMOUNT` | ETH amount to send to each recipient (default: `10`) |

## Check Balances

```bash
BALANCE_ONLY=true npx hardhat run scripts/interact-bridge.js
```

## Networks

| Network | Chain ID | Use |
|---|---|---|
| `localhost` | 31337 | Local development |
| `bscTestnet` | 97 | BSC testnet |

## Security

Built on OpenZeppelin contracts (v5). Not yet audited — use at your own risk.

## License

MIT
