# Miner Launchpad Smart Contract Security Audit (GPT-5.2)

**Audit date:** 2025-12-18  
**Commit:** `d40f16b`  
**Solidity version:** `0.8.19`  

**In-scope:** `contracts/Core.sol`, `contracts/Rig.sol`, `contracts/Auction.sol`, `contracts/Unit.sol`, `contracts/Multicall.sol`, `contracts/*Factory.sol`, `contracts/interfaces/*.sol`  
**Out-of-scope:** `contracts/mocks/*` (test-only mocks), off-chain scripts/UI, deployment key management.

---

## Executive Summary

**Overall security posture:** Strong. I did not identify any **Critical** or **High** severity vulnerabilities that allow unauthorized minting, LP withdrawal, or direct fund theft under the documented trust assumptions.

**Key strengths:**
- Arithmetic safety from Solidity `0.8.19`
- `ReentrancyGuard` applied to key state-changing entrypoints (`Rig.mine()`, `Auction.buy()`, `Core.launch()`)
- Clear access control boundaries (`Ownable` on `Core`/`Rig`; minting gated by `Unit.rig`)
- Parameter bounds in `Rig`/`Auction` reduce degenerate configurations

**Key dependencies / trust assumptions (explicit):**
- `weth`, `donutToken`, Uniswap V2 `factory/router`, and the deployed `UnitFactory/RigFactory/AuctionFactory` are correctly configured and non-malicious.
- ERC20s used for payment (intended: WETH, UniswapV2 LP) behave like standard ERC20s (no fee-on-transfer, no malicious callbacks).

**Testing observed:** Local Hardhat test suite passes (`284 passing`).

No Foundry PoC exploits are provided because no critical/high issues were found.

---

## Vulnerability Findings

- **Severity:** Low  
  **Title:** Effects-after-interactions pattern in `Rig.mine()` and `Auction.buy()` relies on `nonReentrant`  
  **Description:** Both functions perform external token interactions (`transferFrom` / `transfer`) before updating epoch state. While `ReentrancyGuard` is present and materially reduces practical risk, the contracts’ safety relies on that guard continuing to exist and being correctly applied. This is a common CEI best-practice concern: if the guard is removed/refactored in the future, or if a non-standard token introduces unexpected control flow, the blast radius increases.  
  **Code Snippet:**
  ```solidity
  // contracts/Rig.sol
  // external calls occur before epoch state is updated
  IERC20(quote).safeTransferFrom(msg.sender, address(this), price);
  IERC20(quote).safeTransfer(epochMiner, previousMinerAmount);
  IERC20(quote).safeTransfer(treasury, treasuryAmount);
  IERC20(quote).safeTransfer(team, teamAmount);
  IERC20(quote).safeTransfer(protocolFeeAddr, protocolAmount);

  // Update state for new epoch
  epochId++;
  epochInitPrice = newInitPrice;
  epochMiner = miner;

  // contracts/Auction.sol
  IERC20(paymentToken).safeTransferFrom(msg.sender, paymentReceiver, paymentAmount);
  for (uint256 i = 0; i < assets.length; i++) {
      IERC20(assets[i]).safeTransfer(assetsReceiver, balance);
  }
  // Update state for new epoch
  epochId++;
  ```
  **Recommendation:** Keep `nonReentrant` on these entrypoints. For defense-in-depth, refactor further toward CEI: update epoch state before distributions, or accrue balances and let recipients withdraw.

- **Severity:** Informational  
  **Title:** Dutch auctions decay to `0`, enabling free `mine()` / free `buy()` after epoch expiry  
  **Description:** Both `Rig` and `Auction` prices return `0` after the epoch period passes, allowing a takeover/purchase for free. This may be intentional to prevent deadlocks, but it is a key economic/security property that should be clearly communicated to integrators/users because it changes the “cost to seize rights/assets” after inactivity.  
  **Code Snippet:**
  ```solidity
  // contracts/Rig.sol
  uint256 timePassed = block.timestamp - epochStartTime;
  if (timePassed > epochPeriod) return 0;

  // contracts/Auction.sol
  uint256 timePassed = block.timestamp - startTime;
  if (timePassed > epochPeriod) return 0;
  ```
  **Recommendation:** If intended, ensure docs/UI explicitly warn that price can hit zero and show time-to-zero. If not intended, consider a non-zero decay floor or an explicit expiry/reset mechanism.

- **Severity:** Low  
  **Title:** `Auction.buy()` lets buyer sweep arbitrary ERC20s held by the Auction (operational risk, especially with price→0)  
  **Description:** The buyer supplies `assets[]` and the contract transfers the *entire* balance of each asset to `assetsReceiver`. Any ERC20 accidentally sent to the Auction becomes claimable by anyone willing to pay the current price (potentially `0` after expiry). This is consistent with “auction sells all assets” designs, but it’s an important risk surface for accidental deposits and UI token-discovery logic.  
  **Code Snippet:**
  ```solidity
  // contracts/Auction.sol
  function buy(address[] calldata assets, address assetsReceiver, ...) external returns (uint256 paymentAmount) {
      paymentAmount = getPrice();
      ...
      for (uint256 i = 0; i < assets.length; i++) {
          uint256 balance = IERC20(assets[i]).balanceOf(address(this));
          IERC20(assets[i]).safeTransfer(assetsReceiver, balance);
      }
  }
  ```
  **Recommendation:** Consider restricting to a fixed allowlist (e.g., only WETH) or maintaining an on-chain asset registry. If flexibility is required, add strong documentation/UI safeguards.

- **Severity:** Informational  
  **Title:** `Multicall.mine()` refunds the *entire* WETH balance to the caller (can sweep stray WETH)  
  **Description:** `Multicall.mine()` transfers all WETH held by `Multicall` to the caller at the end. This means any WETH accidentally sent to `Multicall` can be swept by the next user who calls `mine()`. This does not compromise the Rig/Core directly, but it is a footgun for users/operators.  
  **Code Snippet:**
  ```solidity
  // contracts/Multicall.sol
  uint256 wethBalance = IERC20(weth).balanceOf(address(this));
  if (wethBalance > 0) {
      IERC20(weth).safeTransfer(msg.sender, wethBalance);
  }
  ```
  **Recommendation:** Track per-call deltas (refund only what’s left from the current call), or add a dedicated sweep function with explicit access control. At minimum, document “do not send WETH directly to Multicall”.

- **Severity:** Low  
  **Title:** Privileged controls can redirect fees / change launch constraints (centralization & governance risk)  
  **Description:**  
  - `Core` owner can change `protocolFeeAddress` and `minDonutForLaunch`, affecting fee routing and who can launch.  
  - Each `Rig` owner can change `treasury` and `team`, which can redirect fee flows away from the “default” treasury auction address and change recipient economics.  
  These are not bugs, but they materially affect user trust assumptions.  
  **Code Snippet:**
  ```solidity
  // contracts/Core.sol
  function setProtocolFeeAddress(address _protocolFeeAddress) external onlyOwner { ... }
  function setMinDonutForLaunch(uint256 _minDonutForLaunch) external onlyOwner { ... }

  // contracts/Rig.sol
  function setTreasury(address _treasury) external onlyOwner { ... }
  function setTeam(address _team) external onlyOwner { ... }
  ```
  **Recommendation:** Make these controls explicit in docs/UI (show current values on every rig). Consider `Ownable2Step` and/or timelocks for `Core`, and consider whether `Rig` should permanently lock `treasury/team` after an initial setup window.

- **Severity:** Informational  
  **Title:** `Core.launch()` payer is `msg.sender`, not necessarily `params.launcher` (UX/phishing risk)  
  **Description:** The struct positions `launcher` as the recipient/owner, but the DONUT is pulled from `msg.sender`. This enables “launch on behalf of” flows, but it also increases the risk that users accidentally fund a launch whose ownership goes to a different address (especially if a UI exposes `launcher`). The inline comment is also misleading (“Transfer DONUT from launcher”).  
  **Code Snippet:**
  ```solidity
  // contracts/Core.sol
  struct LaunchParams { address launcher; ... }
  ...
  // Transfer DONUT from launcher
  IERC20(donutToken).safeTransferFrom(msg.sender, address(this), params.donutAmount);
  ```
  **Recommendation:** If intended, fix the comment and consider adding the payer (`msg.sender`) to the `Core__Launched` event. If not intended, enforce `require(msg.sender == params.launcher)` (or add a separate self-launch function that enforces it).

- **Severity:** Informational  
  **Title:** `Core` leaves Uniswap router allowances set after `launch()`  
  **Description:** `Core.launch()` approves the router for `unit` and `donutToken` but does not revoke allowances. If tokens are later sent to `Core` accidentally, a compromised router could pull them. In normal operation `Core` should not hold balances, so this is low impact but a best-practice improvement.  
  **Code Snippet:**
  ```solidity
  // contracts/Core.sol
  IERC20(unit).safeApprove(uniswapV2Router, 0);
  IERC20(unit).safeApprove(uniswapV2Router, params.unitAmount);
  IERC20(donutToken).safeApprove(uniswapV2Router, 0);
  IERC20(donutToken).safeApprove(uniswapV2Router, params.donutAmount);
  ```
  **Recommendation:** After `addLiquidity`, reset both allowances back to `0` to minimize “stray token drain” risk.

- **Severity:** Informational  
  **Title:** `Multicall.getAuction()` can revert for unknown rigs (no zero-address handling)  
  **Description:** If `ICore(core).rigToAuction(rig)` returns `address(0)`, `Multicall.getAuction()` will revert when it calls the zero address as an `IAuction`. This is not exploitable for funds, but can break frontends and monitoring.  
  **Code Snippet:**
  ```solidity
  // contracts/Multicall.sol
  address auction = ICore(core).rigToAuction(rig);
  state.epochId = IAuction(auction).epochId(); // reverts if auction == address(0)
  ```
  **Recommendation:** Add an explicit check (revert with a custom error, or return an “empty” struct). Optionally require `ICore(core).isDeployedRig(rig)`.

- **Severity:** Informational  
  **Title:** Unbounded `epochUri` / `uri` string storage (gas/storage bloat is caller-paid)  
  **Description:** URIs are stored on-chain as `string`, with no length caps. Attackers can’t cheaply store enormous data due to gas limits, but large strings can still bloat storage, increase indexing load, and create UX instability.  
  **Code Snippet:**
  ```solidity
  // contracts/Rig.sol
  string public epochUri;
  string public uri;
  ...
  epochUri = _epochUri;
  function setUri(string calldata _uri) external onlyOwner { uri = _uri; }
  ```
  **Recommendation:** Consider a max length, or store hashes/content-addresses (`bytes32`) instead of full strings.

---

## Conclusion

The contracts exhibit good security hygiene (checked arithmetic, `ReentrancyGuard`, explicit access control, parameter bounds, and a clear separation of concerns). I found **no Critical/High** vulnerabilities in the on-chain logic under stated dependency assumptions.

**Overall security rating:** **Low risk / strong**, with the main remaining issues being design/operational risks (price→0 behavior, auction asset sweep semantics, and privileged fee-routing controls) plus a handful of best-practice and gas optimizations.
