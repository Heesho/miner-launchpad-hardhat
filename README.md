# Miner Launchpad

A decentralized token launch platform on Base that enables fair, sniper-resistant token distributions through Dutch auction mining and permanent liquidity.

---

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Key Features](#key-features)
- [For Token Launchers](#for-token-launchers)
- [For Miners](#for-miners)
- [Technical Architecture](#technical-architecture)
- [Contract Reference](#contract-reference)
- [Integration Guide](#integration-guide)
- [Deployment](#deployment)
- [Testing](#testing)
- [Security](#security)

---

## Overview

Miner Launchpad allows anyone to launch a new token with:

- **Permanent liquidity** - Initial LP tokens are burned, liquidity can never be removed
- **Fair distribution** - Tokens are earned through mining over time, not bought in bulk
- **Sniper resistance** - Dutch auction pricing makes front-running unprofitable

When you launch a token, a mining "Rig" is created where participants compete to mine newly minted tokens. The mining uses a Dutch auction system where prices start high and decay over time, creating natural price discovery and preventing bots from grabbing large allocations at launch.

---

## How It Works

### The Mining Cycle

Think of it like a gold mine where miners compete for control:

1. **Someone launches a token** - They provide DONUT tokens to create initial liquidity
2. **Mining begins** - The Rig produces tokens at a steady rate (e.g., 4 tokens/second)
3. **Miners compete** - Anyone can become the active miner by paying the current Dutch auction price
4. **Tokens are earned** - The active miner earns all tokens produced while they hold the position
5. **Takeover happens** - When someone new mines, the previous miner receives their earned tokens + 80% of what the new miner paid

```
Epoch 1: Price starts at 1 ETH, decays toward 0 over time
├── Alice pays 0.5 ETH when price drops to that level
└── Alice is now mining, earning tokens

Epoch 2: Price resets to 1 ETH (0.5 × 2 multiplier)
├── Bob pays 0.8 ETH to take over
├── Alice receives: her mined tokens + 0.64 ETH (80% of Bob's payment)
└── Bob is now mining

Epoch 3+: Cycle continues...
```

### Dutch Auction Pricing

Each epoch is a Dutch auction where price continuously falls:

```
Price
  │
  │ 1.0 ETH ████
  │              ████
  │                  ████
  │                      ████
  │                          ████ → 0
  └─────────────────────────────────── Time
       Early = Expensive    Late = Cheap
```

**This defeats snipers because:**
- Being first means paying the HIGHEST price
- Waiting gives you a LOWER price
- No advantage to speed - patience wins

### Emission Halving

Like Bitcoin, token production decreases over time:

```
Month 1:  4 tokens/second
Month 2:  2 tokens/second  (halved)
Month 3:  1 token/second   (halved)
Month 4:  0.5 tokens/second
...continues until minimum rate
```

---

## Key Features

### 1. Permanent Liquidity

When a token launches, LP tokens are **burned** to an unrecoverable address:

```
Initial liquidity created → LP tokens → Burned to 0x000...dEaD
```

This means:
- Liquidity can NEVER be removed
- No rug pulls possible
- Token will always be tradeable

### 2. Fair Token Distribution

Tokens are distributed based on **time held**, not amount paid:

```
Tokens Earned = Time as Active Miner × Emission Rate
```

You can't buy a large allocation instantly - distribution happens gradually across many participants.

### 3. Fee Distribution

When someone mines, their payment is split:

| Recipient | % | Purpose |
|-----------|---|---------|
| Previous Miner | 80% | Reward for holding position |
| Treasury | 15% | Accumulates for LP auctions |
| Team | 4% | Development |
| Protocol | 1% | Platform |

### 4. Treasury Auctions

The 15% treasury fee accumulates and is auctioned to LP holders via Dutch auction. Winners pay with LP tokens (which are burned), creating deflationary pressure.

---

## For Token Launchers

### What You Need

1. **DONUT tokens** - For initial liquidity
2. **Team wallet address** - Receives 4% of mining fees
3. **Configuration decisions** - Emission rates, epoch durations, etc.

### Launch Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `tokenName` | Token display name | "My Token" |
| `tokenSymbol` | Ticker symbol | "MTK" |
| `unitUri` | Metadata URI (logo, etc.) | "ipfs://Qm..." |
| `donutAmount` | DONUT for liquidity | 1000 |
| `initialUps` | Starting emission rate (max: 1M/sec) | 4 tokens/sec |
| `tailUps` | Minimum emission rate | 0.01 tokens/sec |
| `halvingPeriod` | Time between halvings (min: 1 day) | 30 days |
| `rigEpochPeriod` | Mining epoch duration | 1 hour |
| `rigPriceMultiplier` | Price increase per epoch | 2x |
| `rigMinInitPrice` | Floor starting price | 0.0001 ETH |
| `auctionInitPrice` | Auction starting price | 1 LP token |
| `auctionEpochPeriod` | Auction duration | 1 day |
| `auctionPriceMultiplier` | Auction price increase | 1.2x |
| `auctionMinInitPrice` | Auction floor price | 0.001 LP |

### After Launch

As the launcher, you own the Rig contract and can:
- Update unit metadata URI
- Change team address
- Change treasury address
- Transfer ownership

You **cannot**:
- Mint additional tokens
- Change emission rates
- Remove liquidity
- Pause mining

---

## For Miners

### How to Mine

1. Check the current price and epoch
2. Decide when to mine (wait for lower price or secure position now)
3. Call `mine()` with WETH or use Multicall with ETH
4. Earn tokens based on time held
5. Receive payment when someone takes over

### Understanding Returns

When you mine, you'll eventually receive:

1. **Mined Tokens** = Time as miner × Emission rate
2. **ETH Payment** = 80% of what the next miner pays

Example:
```
You pay 0.5 ETH to mine
You hold for 2 hours at 4 tokens/second
Next miner pays 0.8 ETH

Your returns:
├── Tokens: 2 × 3600 × 4 = 28,800 tokens
├── ETH: 0.8 × 80% = 0.64 ETH
└── Net: +0.14 ETH profit + 28,800 tokens
```

---

## Technical Architecture

### Contract Structure

```
┌─────────────────────────────────────────────────────────────┐
│                         CORE                                 │
│              (Orchestrator & Registry)                       │
└───────────────────────────┬─────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  UnitFactory    │ │   RigFactory    │ │ AuctionFactory  │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│     Unit        │ │      Rig        │ │    Auction      │
│   (ERC20)       │ │   (Mining)      │ │  (Treasury)     │
└─────────────────┘ └─────────────────┘ └─────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                       Multicall                              │
│              (Helper for ETH wrapping & batch queries)       │
└─────────────────────────────────────────────────────────────┘
```

### Launch Sequence

```
User calls Core.launch(params)
    │
    ├── 1. Transfer DONUT from user
    ├── 2. Deploy Unit token
    ├── 3. Mint initial Units for LP
    ├── 4. Create Uniswap V2 pair (Unit/DONUT)
    ├── 5. BURN LP tokens (permanent liquidity)
    ├── 6. Deploy Auction contract
    ├── 7. Deploy Rig contract
    ├── 8. Transfer minting rights to Rig (permanent)
    └── 9. Transfer Rig ownership to launcher
```

### Price Calculation

```solidity
// Dutch auction decay
function getPrice() public view returns (uint256) {
    uint256 elapsed = block.timestamp - epochStartTime;
    if (elapsed >= epochPeriod) return 0;
    uint256 remaining = epochPeriod - elapsed;
    return (initPrice * remaining) / epochPeriod;
}
```

### Emission Calculation

```solidity
// Halving schedule
function getUps() public view returns (uint256) {
    uint256 elapsed = block.timestamp - startTime;
    uint256 halvings = elapsed / halvingPeriod;
    uint256 currentUps = initialUps >> halvings;  // Divide by 2^n
    return currentUps < tailUps ? tailUps : currentUps;
}
```

---

## Contract Reference

### Core.sol

```solidity
function launch(LaunchParams calldata params) external returns (
    address unit,
    address rig,
    address auction,
    address lpToken
)

event Core__Launched(
    address launcher,
    address unit,
    address rig,
    address auction,
    address lpToken,
    string tokenName,
    string tokenSymbol,
    string uri,
    uint256 donutAmount,
    uint256 unitAmount,
    uint256 initialUps,
    uint256 tailUps,
    uint256 halvingPeriod,
    uint256 rigEpochPeriod,
    uint256 rigPriceMultiplier,
    uint256 rigMinInitPrice,
    uint256 auctionInitPrice,
    uint256 auctionEpochPeriod,
    uint256 auctionPriceMultiplier,
    uint256 auctionMinInitPrice
)
```

### Rig.sol

```solidity
function mine(
    address miner,        // Who receives future tokens
    uint256 _epochId,     // Frontrun protection
    uint256 deadline,     // Transaction deadline
    uint256 maxPrice,     // Slippage protection
    string memory _epochUri // Metadata
) external returns (uint256 price)

function getPrice() external view returns (uint256)
function getUps() external view returns (uint256)

event Rig__Mined(address indexed sender, address indexed miner, uint256 price, string uri)
event Rig__Minted(address indexed miner, uint256 amount)
event Rig__PreviousMinerFee(address indexed miner, uint256 amount)
event Rig__TreasuryFee(address indexed treasury, uint256 amount)
event Rig__TeamFee(address indexed team, uint256 amount)
event Rig__ProtocolFee(address indexed protocol, uint256 amount)
```

### Auction.sol

```solidity
function buy(
    address[] calldata assets,      // Assets to claim
    address assetsReceiver,         // Receives assets
    uint256 _epochId,               // Frontrun protection
    uint256 deadline,               // Transaction deadline
    uint256 maxPaymentTokenAmount   // Max LP tokens to pay
) external returns (uint256 paymentAmount)

function getPrice() external view returns (uint256)

event Auction__Buy(address indexed buyer, address indexed assetsReceiver, uint256 paymentAmount)
```

### Multicall.sol

```solidity
// Mine with ETH (auto-wraps to WETH)
function mine(
    address rig,
    uint256 epochId,
    uint256 deadline,
    uint256 maxPrice,
    string memory epochUri
) external payable

// Buy from auction
function buy(
    address rig,
    uint256 epochId,
    uint256 deadline,
    uint256 maxPaymentTokenAmount
) external

// Launch via Multicall (overwrites launcher to msg.sender)
function launch(ICore.LaunchParams calldata params) external returns (
    address unit,
    address rig,
    address auction,
    address lpToken
)

// Query rig state
function getRig(address rig, address account) external view returns (RigState memory)

// Query auction state
function getAuction(address rig, address account) external view returns (AuctionState memory)
```

---

## Integration Guide

### Launching a Token

```javascript
const { ethers } = require("ethers");

// 1. Approve DONUT
await donut.approve(coreAddress, donutAmount);

// 2. Launch
const params = {
  launcher: userAddress,
  tokenName: "My Token",
  tokenSymbol: "MTK",
  unitUri: "ipfs://QmYourMetadataHash",
  donutAmount: ethers.utils.parseEther("1000"),
  initialUps: ethers.utils.parseEther("4"),
  tailUps: ethers.utils.parseEther("0.01"),
  halvingPeriod: 30 * 24 * 60 * 60,
  rigEpochPeriod: 60 * 60,
  rigPriceMultiplier: ethers.utils.parseEther("2"),
  rigMinInitPrice: ethers.utils.parseEther("0.0001"),
  auctionInitPrice: ethers.utils.parseEther("1"),
  auctionEpochPeriod: 24 * 60 * 60,
  auctionPriceMultiplier: ethers.utils.parseEther("1.2"),
  auctionMinInitPrice: ethers.utils.parseEther("0.001")
};

const tx = await core.launch(params);
const receipt = await tx.wait();
const event = receipt.events.find(e => e.event === "Core__Launched");
const { rig, unit, auction, lpToken } = event.args;
```

### Mining with ETH (via Multicall)

```javascript
const currentPrice = await rig.getPrice();
const epochId = await rig.epochId();
const deadline = Math.floor(Date.now() / 1000) + 300;
const maxPrice = currentPrice.mul(105).div(100); // 5% slippage

const tx = await multicall.mine(
  rigAddress,
  epochId,
  deadline,
  maxPrice,
  "",
  { value: maxPrice }
);
```

### Mining with WETH (direct)

```javascript
await weth.approve(rigAddress, maxPrice);
const tx = await rig.mine(minerAddress, epochId, deadline, maxPrice, "");
```

### Listening for Events

```javascript
rig.on("Rig__Mined", (miner, epochId, price, minedAmount, uri) => {
  console.log(`New miner: ${miner}, paid: ${ethers.utils.formatEther(price)} ETH`);
});
```

---

## Deployment

### Environment Setup

```bash
# .env
PRIVATE_KEY=your_deployer_private_key
RPC_URL=https://mainnet.base.org
SCAN_API_KEY=your_basescan_api_key
```

### Configuration

Edit `scripts/deployFactory.js`:

```javascript
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const DONUT_ADDRESS = "0x...";  // DONUT token
const UNISWAP_V2_FACTORY = "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6";
const UNISWAP_V2_ROUTER = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24";
const PROTOCOL_FEE_ADDRESS = "0x...";
const MIN_DONUT_FOR_LAUNCH = 100;
const INITIAL_UNIT_MINT_AMOUNT = 1_000_000;
```

### Deploy

```bash
npm install
npx hardhat compile
npx hardhat run scripts/deployFactory.js --network base
```

---

## Testing

```bash
# All tests
npx hardhat test

# Specific test
npx hardhat test tests/testFactory.js

# With gas report
REPORT_GAS=true npx hardhat test
```

### Test Files

| File | Coverage |
|------|----------|
| `testFactory.js` | Core launch and mining |
| `testComprehensive.js` | Full integration |
| `testRigorous.js` | Parameter validation |
| `testRigExploits.js` | Rig security |
| `testUnitExploits.js` | Token security |
| `testBusinessLogic.js` | Business logic |
| `testMulticallOnly.js` | Multicall |

---

## Security

### Audit Status

This codebase has been audited. See [ClaudeCodeAudit.md](./ClaudeCodeAudit.md) for the full audit report.

**Summary:**
- 0 Critical, 0 High, 0 Medium vulnerabilities
- 284 tests passing
- All arithmetic operations verified overflow-safe
- 10 cross-contract attack vectors analyzed - none exploitable

### Parameter Bounds

| Parameter | Min | Max |
|-----------|-----|-----|
| `initialUps` | 1 | 1e24 (1M tokens/sec) |
| `tailUps` | 1 | initialUps |
| `halvingPeriod` | 1 day | - |
| `epochPeriod` (Rig) | 10 minutes | 365 days |
| `epochPeriod` (Auction) | 1 hour | 365 days |
| `priceMultiplier` | 1.1x (110%) | 3x (300%) |
| `minInitPrice` | 1e6 | type(uint192).max |

### Immutable After Launch

- Token name/symbol
- Emission schedule (initialUps, tailUps, halvingPeriod)
- Price mechanics (epochPeriod, multiplier, minPrice)
- Initial liquidity (burned forever)
- Unit minting rights (locked to Rig contract)

### Mutable by Rig Owner

- Treasury address
- Team address
- Metadata URI

### Not Possible

- Minting tokens outside Rig mechanism
- Removing initial liquidity
- Pausing or stopping mining
- Changing emission parameters
- LP drainage attacks
- Flash loan exploits

### Frontrun Protection

All state-changing functions include:
- `epochId` - prevents replaying transactions across epochs
- `deadline` - prevents stale transactions
- `maxPrice` / `maxPaymentTokenAmount` - slippage protection

---

## License

MIT
