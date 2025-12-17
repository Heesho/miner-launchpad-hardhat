# Miner Launchpad Smart Contract Audit (CodexAudit)

**Audit date:** 2025-12-17  
**Auditor:** Codex CLI (GPT-5.2)  
**Solidity version:** 0.8.19  
**Scope:** `contracts/Core.sol`, `contracts/Rig.sol`, `contracts/Auction.sol`, `contracts/Unit.sol`, `contracts/Multicall.sol`, `contracts/*Factory.sol`, `contracts/interfaces/*.sol`  
**Out of scope:** `contracts/mocks/*` (test-only mocks), off-chain scripts/UI, deployment key management.

This is a point-in-time review of the repository contents. It is not a guarantee that no bugs exist.

---

## Executive Summary

- **Critical / High:** 0 found
- **Medium:** 0 found
- **Low / Informational:** Several design/operational risks documented below
- **Fixes applied in this repo during audit:** constructor zero-address validation for core dependencies (see `F-01`–`F-04`)

The core security objectives appear met:
- **LP drainage protection:** initial Unit/DONUT LP is burned at launch (no protocol-controlled LP withdrawal path)
- **Unauthorized Unit minting:** minting is locked to the Rig contract; Rig has no method to change the Unit minter
- **Reentrancy protection:** state-changing entrypoints are guarded with `ReentrancyGuard`
- **MEV/stale-tx protection:** `epochId` + `deadline` + `maxPrice` / `maxPaymentTokenAmount`

---

## System Overview (Business Logic)

- `Core.launch()` deploys a new `Unit` (ERC20Votes), seeds a Uniswap V2 Unit/DONUT pool, burns the LP, deploys an `Auction` (treasury auction), deploys a `Rig` (mining auction), and transfers Unit minting rights to the Rig.
- `Rig.mine()` runs a Dutch auction for “active miner” rights. When mined:
  - Previous miner receives: (a) minted Unit for time held, (b) 80% of payment
  - Treasury receives: 15% of payment (default treasury is the `Auction` contract)
  - Team receives: 4% of payment (default team is launcher)
  - Protocol receives: 1% of payment (from `Core.protocolFeeAddress()`)
- `Auction.buy()` runs a Dutch auction in LP tokens (burned) to claim accumulated treasury assets (default: WETH).
- `Multicall` is a convenience wrapper for frontend flows (wrap ETH to WETH for mining, launch via Core, and buy from Auction).

---

## Threat Model / Trust Assumptions

- `Core` is deployed with correct addresses for WETH, DONUT, UniswapV2 factory/router, and the factories. If those are malicious/misconfigured, user safety degrades materially.
- Launchers (Rig owners) are trusted to configure `treasury`/`team`/`uri` post-launch; these are explicitly mutable.
- Dutch auctions allow “wait until cheap/zero” behavior by design; competition is the economic deterrent.

---

## Findings Index (Status = Fixed / Intended / Acknowledged)

| ID | Severity | Title | Primary Location(s) | Status |
|---:|:--|:--|:--|:--|
| F-01 | Low | Missing zero-address validation (Core ctor) | `contracts/Core.sol` | Fixed |
| F-02 | Low | Rig ctor allowed bricking config (team/unit/quote/core = 0) | `contracts/Rig.sol` | Fixed |
| F-03 | Low | Missing zero-address validation (Auction ctor) | `contracts/Auction.sol` | Fixed |
| F-04 | Low | Missing zero-address validation (Multicall ctor) | `contracts/Multicall.sol` | Fixed |
| I-01 | Design | Free mining at price = 0 after epoch expiry | `contracts/Rig.sol` | Intended |
| I-02 | Design | Rewards are realized on epoch transition (takeover or self-mine) | `contracts/Rig.sol` | Intended |
| I-03 | Design | Halving schedule is applied per-epoch (not continuously mid-epoch) | `contracts/Rig.sol` | Intended |
| I-04 | Design | Auction can be bought at price = 0 after epoch expiry | `contracts/Auction.sol` | Intended |
| I-05 | Design | Auction sells *all* balances of caller-specified `assets[]` | `contracts/Auction.sol` | Intended |
| I-06 | Design | `Core.launch()` does not require `msg.sender == launcher` | `contracts/Core.sol` | Intended |
| I-07 | Design | Rig owner can change `treasury` / `team` / `uri` post-launch | `contracts/Rig.sol` | Intended |
| R-01 | Low | No emergency pause / circuit breaker | System-wide | Acknowledged |
| R-02 | Low | CEI ordering (external calls before state updates) relies on nonReentrant | `contracts/Rig.sol`, `contracts/Auction.sol` | Acknowledged |
| R-03 | Low | Burn address is not cryptographically unspendable | `contracts/Core.sol`, `contracts/Auction.sol` | Acknowledged |
| R-04 | Info | Unbounded string storage for URIs (gas/storage bloat is caller-paid) | `contracts/Rig.sol` | Acknowledged |
| R-05 | Info | `Multicall.mine()` refunds entire WETH balance to caller (can sweep accidental WETH) | `contracts/Multicall.sol` | Acknowledged |
| R-06 | Low | Core owner can change protocol fee + launch threshold | `contracts/Core.sol` | Acknowledged |

---

## Detailed Findings

### F-01 — Missing zero-address validation (Core ctor)
**Severity:** Low  
**Status:** Fixed  
**Location:** `contracts/Core.sol`

**Issue:** Core immutables (WETH/DONUT/router/factories) were not validated against `address(0)`. A misconfigured deployment would succeed but later fail at runtime.

**Fix applied:** Added a constructor check that reverts if any critical dependency address is zero.

---

### F-02 — Rig ctor allowed bricking config (team/unit/quote/core = 0)
**Severity:** Low  
**Status:** Fixed  
**Location:** `contracts/Rig.sol`

**Issue:** `Rig` relied on `_team` as the initial `epochMiner`. If `_team == address(0)`, the rig becomes unusable because `mine()` attempts to mint to `address(0)` (and to pay `epochMiner`).

**Fix applied:** Added constructor checks for `_unit`, `_quote`, `_team`, and `_core` non-zero (treasury already validated).

---

### F-03 — Missing zero-address validation (Auction ctor)
**Severity:** Low  
**Status:** Fixed  
**Location:** `contracts/Auction.sol`

**Issue:** `paymentToken` and `paymentReceiver` were not validated against `address(0)`, allowing deployments that would revert at runtime or behave unexpectedly.

**Fix applied:** Added constructor checks for `_paymentToken` and `_paymentReceiver` non-zero.

---

### F-04 — Missing zero-address validation (Multicall ctor)
**Severity:** Low  
**Status:** Fixed  
**Location:** `contracts/Multicall.sol`

**Issue:** A misconfigured `Multicall` (zero core/weth/donut) would deploy but fail during use.

**Fix applied:** Added constructor check for non-zero addresses.

---

## Intended Behaviors (Reviewed)

### I-01 — Free mining at price = 0 after epoch expiry
**Status:** Intended  
If `Rig.getPrice()` reaches 0, anyone can take over the rig for free. This prevents permanent deadlocks and is consistent with a Dutch auction that decays to 0.

### I-02 — Rewards realized on epoch transitions
**Status:** Intended  
Unit emissions are minted to the **previous** miner only when `mine()` is called (takeover or self-mine), not continuously in the background.

### I-03 — Halving applied per epoch (not mid-epoch)
**Status:** Intended  
The epoch’s emission rate is fixed at epoch start (`epochUps`) and applied to the entire holding period until the next `mine()`. If a miner holds across a halving boundary without a takeover, minted rewards for that period reflect the epoch’s starting rate.

### I-04 — Auction can be bought at price = 0 after epoch expiry
**Status:** Intended  
If no one buys before decay completion, the auction can be cleared for 0 payment tokens.

### I-05 — Auction sells all balances of caller-specified assets
**Status:** Intended  
`Auction.buy(assets, ...)` transfers the full balance of each token in `assets[]` to `assetsReceiver`. Any token held by the Auction is therefore “for sale” if included by a buyer.

### I-06 — `Core.launch()` does not require `msg.sender == launcher`
**Status:** Intended  
The DONUT payer (`msg.sender`) and the `launcher`/Rig owner can be different addresses. This enables “launching on behalf of” another address, but may surprise integrators that assume they must match.

### I-07 — Rig owner can change `treasury` / `team` / `uri` post-launch
**Status:** Intended  
The launcher (Rig owner) can redirect treasury fees away from the default `Auction` contract by changing `treasury`, and can update the team recipient. This is a governance/centralization choice that should be disclosed to users.

---

## Acknowledged Risks / Recommendations

### R-01 — No emergency pause / circuit breaker
**Severity:** Low  
**Status:** Acknowledged  
There is no `Pausable`/guardian mechanism to halt operations on discovery of an exploit. Consider adding an opt-in pause (with strong governance controls) if operational requirements demand it.

### R-02 — CEI ordering relies on `nonReentrant`
**Severity:** Low  
**Status:** Acknowledged  
`Rig.mine()` and `Auction.buy()` perform external calls prior to updating epoch state. Reentrancy is mitigated by `ReentrancyGuard`, but the design relies on it remaining present and correctly applied.

### R-03 — Burn address is not cryptographically unspendable
**Severity:** Low  
**Status:** Acknowledged  
LP tokens and auction payments are sent to `0x000...dEaD`. This is industry standard, but not mathematically “impossible to spend.” It is used because Uniswap V2 LP tokens typically disallow `transfer` to `address(0)`.

### R-04 — Unbounded URI strings
**Severity:** Informational  
**Status:** Acknowledged  
`epochUri` (set by any miner) and `uri` (set by Rig owner) can be arbitrarily large, increasing storage and gas costs. This is mostly self-inflicted; consider length limits if desired for UX predictability.

### R-05 — Multicall refunds all WETH held
**Severity:** Informational  
**Status:** Acknowledged  
`Multicall.mine()` refunds **all** WETH it holds to the caller. This is appropriate for a stateless helper, but means any accidental WETH sent to `Multicall` can be swept by the next caller.

### R-06 — Core owner can change protocol fee + launch threshold
**Severity:** Low  
**Status:** Acknowledged  
`Core` owner can update `protocolFeeAddress` and `minDonutForLaunch`. This is expected admin control but introduces governance/centralization risk (e.g., fees redirected or launches halted).
