# Miner Launchpad Smart Contract Audit Report

**Audit Date:** December 17, 2025
**Auditor:** Claude Code (Anthropic)
**Audit Passes:** 2 (Initial + Deep Dive)
**Solidity Version:** 0.8.19
**Contracts Reviewed:** Core.sol, Rig.sol, Auction.sol, Unit.sol, Multicall.sol, UnitFactory.sol, RigFactory.sol, AuctionFactory.sol

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [Contract Overview](#contract-overview)
4. [Security Findings](#security-findings)
5. [Intended Behaviors (Acknowledged)](#intended-behaviors-acknowledged)
6. [Acknowledged Risks](#acknowledged-risks)
7. [Implemented Fixes](#implemented-fixes)
8. [Gas Optimization Notes](#gas-optimization-notes)
9. [Test Coverage](#test-coverage)
10. [Conclusion](#conclusion)
11. [Deep Dive Audit (Second Pass)](#deep-dive-audit-second-pass)
12. [Appendix: Contract Constants Reference](#appendix-contract-constants-reference)

---

## Executive Summary

The Miner Launchpad is a token launchpad system implementing a dual Dutch auction mechanism for "mining rigs" that emit ERC20 tokens. The audit found the system to be **well-designed and secure** against the primary concern of LP drainage attacks.

**Key Findings:**
- No critical vulnerabilities found that would allow LP drainage or unauthorized minting
- Strong frontrun protection via epochId and deadline mechanisms
- Proper use of ReentrancyGuard on all state-changing functions
- LP tokens are permanently burned, ensuring perpetual liquidity
- All arithmetic operations verified overflow-safe
- 10 cross-contract attack vectors analyzed - none exploitable

**Fixes Implemented During Audit:**
- Added `MAX_INITIAL_UPS` (1e24) to prevent overflow in minted amount calculation
- Added `MIN_HALVING_PERIOD` (1 day) to prevent degenerate tokenomics

**Total Findings:**
- Critical: 0
- High: 0
- Medium: 0
- Low/Informational: 10 (all acknowledged or informational)
- Intended Behaviors Documented: 8

---

## System Architecture

```
                    +-------------+
                    |    Core     |
                    |  (Launchpad)|
                    +------+------+
                           |
           +---------------+---------------+
           |               |               |
    +------v------+ +------v------+ +------v------+
    |    Unit     | |     Rig     | |   Auction   |
    | (ERC20+Vote)| |(Dutch Auction| |(Treasury    |
    |             | |   Mining)   | |  Auction)   |
    +-------------+ +------+------+ +------+------+
                           |               |
                           +-------+-------+
                                   |
                            +------v------+
                            |  Uniswap V2 |
                            |   LP Pool   |
                            | (Unit/DONUT)|
                            +-------------+
```

### Flow Summary:

1. **Launch:** User provides DONUT → Core deploys Unit token → Creates LP → Burns LP → Deploys Auction → Deploys Rig → Transfers minting rights to Rig

2. **Mining:** Users pay WETH (Dutch auction) → Become current miner → Previous miner receives Unit tokens + 80% of payment → Treasury (Auction) receives 15% → Team 4% → Protocol 1%

3. **Treasury Auction:** Accumulated WETH auctioned off for LP tokens → LP tokens burned → Deflationary pressure on LP

---

## Contract Overview

### Core.sol
- Main launchpad contract
- Deploys Unit, Rig, and Auction via factories
- Creates and burns initial LP
- Maintains registry of deployed rigs
- Owner can set protocol fee address and minimum DONUT for launch

### Rig.sol
- Dutch auction for mining rights
- Price decays linearly from `epochInitPrice` to 0 over `epochPeriod`
- Mints Unit tokens to previous miner based on time held
- Implements halving schedule for emission rate (UPS)
- Owner (launcher) can modify treasury and team addresses

### Auction.sol
- Dutch auction for accumulated treasury assets (WETH)
- Payment in LP tokens (burned to DEAD_ADDRESS)
- Price decays linearly over epoch period

### Unit.sol
- ERC20 with ERC20Permit and ERC20Votes extensions
- Minting controlled exclusively by Rig contract
- `setRig` can transfer minting rights (one-way lock after launch)

### Multicall.sol
- Helper for ETH wrapping and batched operations
- Provides aggregated view functions for frontend

---

## Security Findings

### VERIFIED SECURE

| Category | Status | Notes |
|----------|--------|-------|
| Reentrancy Protection | SECURE | ReentrancyGuard on all state-changing functions |
| Access Control | SECURE | Proper onlyOwner modifiers, Unit minting locked to Rig |
| Integer Overflow | SECURE | Solidity 0.8.19 + explicit bounds checking |
| LP Drainage | NOT POSSIBLE | LP tokens burned at launch, cannot remove liquidity |
| Unauthorized Minting | NOT POSSIBLE | Only Rig can mint, Rig has no setRig function |
| Frontrun Protection | SECURE | epochId + deadline + maxPrice/maxPaymentTokenAmount |
| Fee Calculation | SECURE | Fees sum to 100%, treasury absorbs rounding dust |
| Price Overflow | SECURE | ABS_MAX_INIT_PRICE = uint192.max prevents overflow |

### LOW SEVERITY FINDINGS

#### [L-1] No Emergency Pause Mechanism

**Status:** Acknowledged
**Location:** All contracts
**Description:** No contract implements Pausable. In case of discovered exploit, there's no way to halt operations.
**Recommendation:** Consider adding pause functionality to Rig.sol for emergency scenarios.

#### [L-2] Constructor Parameter Validation Gaps in Core

**Status:** Acknowledged
**Location:** Core.sol:131-151
**Description:** Immutable addresses (_weth, _donutToken, factories) not validated for address(0).
**Impact:** If misconfigured, deployment succeeds but launch() fails on first use.

#### [L-3] Unbounded String Length for epochUri

**Status:** Acknowledged
**Location:** Rig.sol:170
**Description:** No length check on `_epochUri` parameter.
**Impact:** Gas cost only affects caller; potential frontend display issues.

#### [L-4] Missing Events in Factory Contracts

**Status:** Acknowledged
**Location:** UnitFactory.sol, RigFactory.sol, AuctionFactory.sol
**Description:** No deployment events emitted.
**Impact:** Harder to index deployments off-chain without Core events.

#### [L-5] Missing Reverse Lookups in Core Registry

**Status:** Acknowledged
**Location:** Core.sol:52-56
**Description:** No reverse mappings (unitToRig, auctionToRig, lpToRig).
**Impact:** Off-chain services may need these lookups.

---

## Intended Behaviors (Acknowledged)

The following behaviors were reviewed and confirmed as **intentional design decisions**:

### [I-1] Halving Schedule Not Applied Mid-Epoch

**Location:** Rig.sol:222-235
**Behavior:** When a miner holds through halving periods, they receive tokens at the epoch's starting UPS rate for the entire duration. Halvings only apply to the NEW epoch.

**Example:**
- Miner A mines at year 0 (epochUps = 1e18)
- No one mines for 3 years
- Miner A receives: 3 years × 1e18 tokens (not adjusted for halvings)
- New epoch starts with halvings applied

**Rationale:** Rewards long-term holders who maintain the rig. Creates incentive to mine even during low activity periods.

### [I-2] First Miner Pays Launcher

**Location:** Rig.sol:153
**Behavior:** Initial `epochMiner` is set to launcher (team address). First real miner pays:
- 80% of WETH payment to launcher
- Unit tokens for time since deployment to launcher
- 4% team fee to launcher

**Rationale:** Provides initial incentive for launchers. Compensates launcher for deployment costs and initial liquidity provision.

### [I-3] Zero Accumulated Assets in Auction

**Location:** Auction.sol:132-136
**Behavior:** Auction.buy() can be called even when accumulated asset balances are zero (transfers 0).

**Rationale:** Allows epoch reset mechanism. New epoch starts at minInitPrice regardless of payment amount.

### [I-4] Treasury Address Mutable by Owner

**Location:** Rig.sol:249-253
**Behavior:** Rig owner can redirect treasury fees (15%) to any address.

**Rationale:** Allows launcher flexibility in fee management. Owner is the launcher who deployed the rig.

### [I-5] Team Fee Can Be Disabled

**Location:** Rig.sol:260-263
**Behavior:** Owner can set team to address(0), redirecting team fees to treasury.

**Rationale:** Provides flexibility for fee configuration post-launch.

### [I-6] Multicall.buy() Hardcodes WETH

**Location:** Multicall.sol:122-123
**Behavior:** Only WETH can be claimed through Multicall helper.

**Rationale:** System designed for WETH as the sole treasury asset. Direct Auction.buy() available for other tokens if needed.

### [I-7] Price Decay Precision Loss

**Location:** Rig.sol:284, Auction.sol:167
**Behavior:** Integer division in price decay slightly favors protocol (prices marginally higher).

**Rationale:** Standard integer math behavior. Negligible impact, consistent behavior.

### [I-8] Free Mining at Zero Price

**Location:** Rig.sol:183
**Behavior:** When Dutch auction expires, anyone can mine for free.

**Rationale:** Core Dutch auction mechanism. Ensures rig never becomes permanently stuck.

---

## Acknowledged Risks

### [R-1] Block Timestamp Manipulation

**Risk Level:** Low
**Description:** Block producers can manipulate timestamp within ~15 second drift, affecting price calculations and mine timing.
**Mitigation:** Drift is minimal; economic impact negligible.

### [R-2] CEI Pattern Violation (Protected)

**Location:** Rig.sol:183-236
**Description:** State updates occur after external calls. Protected by ReentrancyGuard.
**Status:** Acceptable due to nonReentrant modifier.

### [R-3] ERC20Votes Total Supply Cap

**Location:** Unit.sol (inherited from OpenZeppelin)
**Description:** ERC20Votes has built-in cap at type(uint224).max (~2.7e67 tokens).
**Status:** Extremely unlikely to reach with bounded MAX_INITIAL_UPS.

### [R-4] Duplicate Assets in Auction.buy()

**Location:** Auction.sol:133-136
**Description:** Passing duplicate assets in array wastes gas but doesn't cause issues.
**Status:** Self-grief only, no security impact.

---

## Implemented Fixes

### [FIX-1] Added MAX_INITIAL_UPS Bound

**Location:** Rig.sol:38
**Change:** Added constant `MAX_INITIAL_UPS = 1e24` (1 million tokens/second)

**Rationale:** Prevents potential overflow in `minedAmount = mineTime * epochUps` calculation. With 1e24 max UPS, overflow impossible for ~3.7e46 years of holding.

```solidity
uint256 public constant MAX_INITIAL_UPS = 1e24;
```

**Validation Added:** Rig.sol:131
```solidity
if (_initialUps > MAX_INITIAL_UPS) revert Rig__InitialUpsExceedsMax();
```

### [FIX-2] Added MIN_HALVING_PERIOD Bound

**Location:** Rig.sol:39
**Change:** Added constant `MIN_HALVING_PERIOD = 1 days`

**Rationale:** Prevents degenerate tokenomics where halvings occur too rapidly (e.g., every second).

```solidity
uint256 public constant MIN_HALVING_PERIOD = 1 days;
```

**Validation Added:** Rig.sol:134
```solidity
if (_halvingPeriod < MIN_HALVING_PERIOD) revert Rig__HalvingPeriodBelowMin();
```

---

## Gas Optimization Notes

The following are observations, not recommendations (no changes made):

1. **Rig.mine() Fee Distribution:** 4 separate safeTransferFrom calls. Could be optimized but affects code clarity.

2. **Auction Assets Loop:** Unbounded loop over assets array. Self-limiting as caller pays gas.

3. **String Storage for URIs:** Large URIs cost significant gas. Acceptable as caller pays.

4. **View Function Efficiency:** Multicall view functions make multiple external calls. Acceptable for read operations.

---

## Test Coverage

**Total Tests:** 284 passing
**Test Categories:**
- Business Logic Tests
- Comprehensive Security Tests
- Core Tests
- Multicall-Only Tests
- Rig Exploit Attempts
- Rigorous Tests
- Unit Token Exploit Attempts

**Key Test Areas:**
- Dutch auction price mechanics
- Fee distribution accuracy (80/15/4/1 split)
- Halving schedule behavior
- Frontrun protection (epochId, deadline, maxPrice)
- Access control (minting, setRig, ownership)
- Reentrancy protection
- Edge cases (zero price, max values, boundaries)
- Integration flows (launch -> mine -> halving -> auction)
- Gas consistency

---

## Conclusion

The Miner Launchpad smart contract system demonstrates **solid security architecture** with appropriate protections against common vulnerabilities. The primary concern of LP drainage is **not possible** due to the burned LP design.

**Security Posture:** Strong
**Code Quality:** High
**Test Coverage:** Comprehensive

**Key Strengths:**
1. Burned LP ensures permanent liquidity
2. Unit minting locked to Rig contract (no setRig on Rig)
3. ReentrancyGuard on all state-changing functions
4. Multiple layers of frontrun protection
5. Bounded parameters prevent overflow scenarios

**Recommendations for Future Consideration:**
1. Add emergency pause mechanism
2. Add events to factory contracts for better indexing
3. Consider reverse lookup mappings in Core registry

---

## Deep Dive Audit (Second Pass)

### Arithmetic Safety Analysis

All arithmetic operations were verified for overflow/underflow safety:

#### Rig.sol Price Calculations
```
getPrice(): epochInitPrice - epochInitPrice * timePassed / epochPeriod
- Max epochInitPrice: type(uint192).max ≈ 6.27e57
- Max timePassed: epochPeriod (capped at 365 days = 3.15e7 seconds)
- Max intermediate: 6.27e57 * 3.15e7 ≈ 1.98e65 < type(uint256).max ✓
```

#### Rig.sol New Init Price
```
newInitPrice = price * priceMultiplier / PRECISION
- Max price: ABS_MAX_INIT_PRICE = type(uint192).max
- Max priceMultiplier: 3e18
- Max intermediate: (2^192 - 1) * 3e18 ≈ 1.88e76 < type(uint256).max ✓
```

#### Rig.sol Mined Amount
```
minedAmount = mineTime * epochUps
- Max mineTime practical: 1000 years = 3.15e10 seconds
- Max epochUps: MAX_INITIAL_UPS = 1e24
- Max result: 3.15e10 * 1e24 = 3.15e34 < type(uint256).max ✓
```

#### Rig.sol Fee Distribution
```
previousMinerAmount = price * 8000 / 10000 (80%)
teamAmount = price * 400 / 10000 (4%)
protocolAmount = price * 100 / 10000 (1%)
treasuryAmount = price - sum (15% + dust)

Verification: 8000 + 400 + 100 = 8500 basis points
Remaining: 10000 - 8500 = 1500 (15%)
Total: 100% ✓
Rounding: All divisions round down, treasury absorbs dust ✓
```

#### Halving Calculation
```
halvings = (time - startTime) / halvingPeriod
ups = initialUps >> halvings

- halvingPeriod >= MIN_HALVING_PERIOD = 86400, no division by zero ✓
- Shift by >= 256 results in 0, then ups = tailUps ✓
```

---

### Cross-Contract Attack Vector Analysis

| Attack Vector | Exploitable? | Analysis |
|---------------|--------------|----------|
| Frontrun launch() to steal Unit | NO | Unit deployed atomically, address unpredictable |
| Sandwich attack on mine() | NO | maxPrice slippage protection, epochId check |
| Reentrancy via callbacks | NO | WETH/Unit/LP have no callbacks, ReentrancyGuard present |
| Oracle manipulation | NO | unitPrice only used in view functions, not for on-chain logic |
| LP manipulation during launch | NO | Unit freshly deployed, pair doesn't exist yet |
| Mining with rig = Multicall | SELF-GRIEF | Tokens stuck in Multicall, only affects attacker |
| Create2 address prediction | NO | Factories use `new`, not `create2` |
| Approval race condition | NO | safeApprove(0) then safeApprove(amount) pattern used |
| Stale epoch exploitation | NO | Intended behavior - free mining after expiry |
| Flash loan attacks | NO | No price oracles, rewards given to PREVIOUS miner |

---

### Additional Low Severity Findings (Second Pass)

#### [L-6] Auction.buy() Missing assetsReceiver Validation

**Location:** Auction.sol:113-136
**Description:** No check that `assetsReceiver != address(0)`. If called with address(0), the transaction reverts at the ERC20 transfer (OpenZeppelin prevents transfers to zero address).
**Impact:** Caller wastes gas on inevitable revert. No security impact.
**Status:** Informational only.

#### [L-7] Multicall Has No ReentrancyGuard

**Location:** Multicall.sol
**Description:** Multicall functions (mine, buy, launch) have no reentrancy protection.
**Analysis:** All Multicall functions delegate to contracts with ReentrancyGuard (Rig, Auction, Core). Multicall holds no persistent state that could be exploited.
**Status:** Safe by design - no fix needed.

#### [L-8] Potential WETH Dust Accumulation in Multicall

**Location:** Multicall.sol:104-107
**Description:** If Rig.mine() uses less WETH than deposited (theoretical edge case) and the refund transfer fails (msg.sender is contract rejecting transfers), WETH could accumulate.
**Analysis:** In practice, Rig.mine() uses exact price amount via safeTransferFrom. WETH accumulation requires both an edge case AND a contract rejecting WETH.
**Status:** Theoretical only, no practical impact.

#### [L-9] deployedRigs Array Unbounded Growth

**Location:** Core.sol:239
**Description:** `deployedRigs.push(rig)` grows unboundedly. deployedRigsLength() view function could eventually hit gas limits.
**Impact:** Only affects view function, not state-changing operations. Array is never iterated in contracts.
**Status:** Informational - consider off-chain indexing for large deployments.

#### [L-10] RigFactory Double Ownership Transfer

**Location:** RigFactory.sol:57, Core.sol:236
**Description:** RigFactory transfers ownership to msg.sender (Core), then Core transfers to params.launcher. Two ownership transfers per launch.
**Impact:** Minor gas overhead (~5k gas). No security impact.
**Status:** Working as designed, could be optimized.

---

### Interface Verification

All interfaces verified to match implementations:

| Interface | Implementation | Status |
|-----------|----------------|--------|
| IRig | Rig.sol | ✓ Match |
| IUnit | Unit.sol | ✓ Match |
| IAuction | Auction.sol | ✓ Match |
| ICore | Core.sol | ✓ Match |
| IRigFactory | RigFactory.sol | ✓ Match |
| IAuctionFactory | AuctionFactory.sol | ✓ Match |
| IUnitFactory | UnitFactory.sol | ✓ Match |

---

### ERC20Votes Considerations

**Implementation:** Unit.sol inherits ERC20, ERC20Permit, ERC20Votes from OpenZeppelin v4.x

**Checkpoints:** Uses block numbers for voting power snapshots (OZ v4.x default)

**Max Supply:** type(uint224).max ≈ 2.7e67 tokens enforced by ERC20Votes._mint()

**Permit:** EIP-2612 compliant with nonce tracking, domain separator correctly initialized

**Delegation:** Self-delegation required before voting power is counted (standard ERC20Votes behavior)

---

### State Transition Diagram

```
                    LAUNCH
                      │
                      ▼
        ┌─────────────────────────┐
        │     EPOCH 0 (Init)      │
        │  miner = launcher       │
        │  ups = initialUps       │
        │  price = minInitPrice   │
        └───────────┬─────────────┘
                    │ mine()
                    ▼
        ┌─────────────────────────┐
        │     EPOCH N             │◄──────┐
        │  miner = new miner      │       │
        │  ups = f(halvings)      │       │ mine()
        │  price = prev * mult    │       │
        └───────────┬─────────────┘       │
                    │                     │
                    │ price decays to 0   │
                    │ (epoch expires)     │
                    │                     │
                    ▼                     │
        ┌─────────────────────────┐       │
        │  Anyone can mine free   │───────┘
        │  price = 0              │
        │  newPrice = minInitPrice│
        └─────────────────────────┘
```

---

### Fee Flow Diagram

```
         MINER PAYMENT (100%)
                │
    ┌───────────┼───────────────────┐
    │           │                   │
    ▼           ▼                   ▼
Previous    Treasury            Team + Protocol
 Miner       (Auction)
  80%          15%                4% + 1%
    │           │                   │
    │           ▼                   │
    │    LP Token Auction           │
    │           │                   │
    │           ▼                   │
    │     DEAD_ADDRESS              │
    │      (LP Burned)              │
    │                               │
    └───────────┬───────────────────┘
                │
                ▼
         Deflationary
          Pressure
```

---

## Appendix: Contract Constants Reference

### Rig.sol
```solidity
PREVIOUS_MINER_FEE = 8_000    // 80%
TEAM_FEE = 400                // 4%
PROTOCOL_FEE = 100            // 1%
DIVISOR = 10_000              // basis points
PRECISION = 1e18

MIN_EPOCH_PERIOD = 10 minutes
MAX_EPOCH_PERIOD = 365 days
MIN_PRICE_MULTIPLIER = 1.1e18 // 110%
MAX_PRICE_MULTIPLIER = 3e18   // 300%
ABS_MIN_INIT_PRICE = 1e6
ABS_MAX_INIT_PRICE = type(uint192).max
MAX_INITIAL_UPS = 1e24        // 1M tokens/sec
MIN_HALVING_PERIOD = 1 days
```

### Auction.sol
```solidity
MIN_EPOCH_PERIOD = 1 hours
MAX_EPOCH_PERIOD = 365 days
MIN_PRICE_MULTIPLIER = 1.1e18
MAX_PRICE_MULTIPLIER = 3e18
ABS_MIN_INIT_PRICE = 1e6
ABS_MAX_INIT_PRICE = type(uint192).max
PRICE_MULTIPLIER_SCALE = 1e18
```

---

*This audit was conducted by Claude Code. Smart contract audits provide a point-in-time assessment and do not guarantee the absence of all vulnerabilities. Users should conduct their own due diligence before interacting with any smart contract system.*
