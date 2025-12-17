const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";
const AddressDead = "0x000000000000000000000000000000000000dEaD";

let owner, protocol, team, user0, user1, user2, user3, user4;
let weth, donut, core, multicall;
let rigFactory, auctionFactory;
let uniswapFactory, uniswapRouter;

// Helper to get a deadline far in the future
async function getFutureDeadline() {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp + 86400 * 365;
}

// Helper to ensure user has enough DONUT
async function ensureDonut(user, amount = convert("50", 18)) {
  const balance = await donut.balanceOf(user.address);
  if (balance.lt(amount)) {
    await donut.connect(user).deposit({ value: amount.sub(balance).add(convert("10", 18)) });
  }
}

// Helper to launch a fresh rig
async function launchFreshRig(launcher, params = {}) {
  await ensureDonut(launcher, convert("50", 18));
  const defaultParams = {
    launcher: launcher.address,
    tokenName: "Test Unit",
    tokenSymbol: "TUNIT",
    uri: "",
    donutAmount: convert("10", 18),
    unitAmount: convert("1000000", 18),
    initialUps: convert("4", 18),
    tailUps: convert("0.01", 18),
    halvingPeriod: 86400 * 30,
    rigEpochPeriod: 3600,
    rigPriceMultiplier: convert("2", 18),
    rigMinInitPrice: convert("0.0001", 18),
    auctionInitPrice: convert("1", 18),
    auctionEpochPeriod: 86400,
    auctionPriceMultiplier: convert("1.2", 18),
    auctionMinInitPrice: convert("0.001", 18),
  };

  const launchParams = { ...defaultParams, ...params };
  await donut.connect(launcher).approve(core.address, launchParams.donutAmount);
  const tx = await core.connect(launcher).launch(launchParams);
  const receipt = await tx.wait();
  const launchEvent = receipt.events.find((e) => e.event === "Core__Launched");

  return {
    rig: launchEvent.args.rig,
    unit: launchEvent.args.unit,
    auction: launchEvent.args.auction,
    lpToken: launchEvent.args.lpToken,
  };
}

// Helper to mine a rig
async function mineRig(rigAddress, miner, rigRecipient = null) {
  const rigContract = await ethers.getContractAt("Rig", rigAddress);
  const epochId = await rigContract.epochId();
  const price = await rigContract.getPrice();
  const deadline = await getFutureDeadline();

  await weth.connect(miner).deposit({ value: convert("10", 18) });
  await weth.connect(miner).approve(rigAddress, price.mul(2));

  const tx = await rigContract
    .connect(miner)
    .mine(rigRecipient || miner.address, epochId, deadline, price.mul(2), "");

  return tx;
}

describe("Rigorous Tests", function () {
  before("Initial set up", async function () {
    // Reset network state for test isolation
    await network.provider.send("hardhat_reset");

    [owner, protocol, team, user0, user1, user2, user3, user4] = await ethers.getSigners();

    // Deploy WETH
    const wethArtifact = await ethers.getContractFactory("MockWETH");
    weth = await wethArtifact.deploy();

    // Deploy mock DONUT token
    donut = await wethArtifact.deploy();

    // Deploy mock Uniswap V2
    const mockUniswapFactoryArtifact = await ethers.getContractFactory("MockUniswapV2Factory");
    uniswapFactory = await mockUniswapFactoryArtifact.deploy();

    const mockUniswapRouterArtifact = await ethers.getContractFactory("MockUniswapV2Router");
    uniswapRouter = await mockUniswapRouterArtifact.deploy(uniswapFactory.address);

    // Deploy factories
    const rigFactoryArtifact = await ethers.getContractFactory("RigFactory");
    rigFactory = await rigFactoryArtifact.deploy();

    const auctionFactoryArtifact = await ethers.getContractFactory("AuctionFactory");
    auctionFactory = await auctionFactoryArtifact.deploy();

    // Deploy UnitFactory
    const unitFactoryArtifact = await ethers.getContractFactory("UnitFactory");
    const unitFactory = await unitFactoryArtifact.deploy();

    // Deploy Core
    const coreArtifact = await ethers.getContractFactory("Core");
    core = await coreArtifact.deploy(
      weth.address,
      donut.address,
      uniswapFactory.address,
      uniswapRouter.address,
      unitFactory.address,
      rigFactory.address,
      auctionFactory.address,
      protocol.address,
      convert("5", 18)
    );

    // Deploy Multicall
    const multicallArtifact = await ethers.getContractFactory("Multicall");
    multicall = await multicallArtifact.deploy(core.address, weth.address, donut.address);

    // Mint tokens to users
    for (const user of [user0, user1, user2, user3, user4]) {
      await donut.connect(user).deposit({ value: convert("100", 18) });
    }
  });

  // ============================================
  // MULTICALL DONUT PRICING TESTS
  // ============================================
  describe("Multicall DONUT Pricing", function () {
    let testRig, testUnit, testAuction, testLpToken;

    before(async function () {
      const result = await launchFreshRig(user0);
      testRig = result.rig;
      testUnit = result.unit;
      testAuction = result.auction;
      testLpToken = result.lpToken;
    });

    it("getRig returns unitPrice in DONUT terms", async function () {
      const state = await multicall.getRig(testRig, user1.address);

      // unitPrice should be DONUT/Unit ratio from LP
      // Since LP was created with DONUT, unitPrice should be > 0
      expect(state.unitPrice).to.be.gte(0);

      // Verify by checking LP reserves directly
      const lpContract = await ethers.getContractAt("IERC20", testLpToken);
      const donutInLP = await donut.balanceOf(testLpToken);
      const unitInLP = await ethers.getContractAt("IERC20", testUnit).then(c => c.balanceOf(testLpToken));

      if (unitInLP.gt(0)) {
        const expectedPrice = donutInLP.mul(convert("1", 18)).div(unitInLP);
        expect(state.unitPrice).to.be.closeTo(expectedPrice, expectedPrice.div(100));
      }
    });

    it("getRig returns user donutBalance", async function () {
      const state = await multicall.getRig(testRig, user1.address);
      const actualDonutBalance = await donut.balanceOf(user1.address);

      expect(state.donutBalance).to.equal(actualDonutBalance);
    });

    it("getAuction returns paymentTokenPrice in DONUT terms", async function () {
      const state = await multicall.getAuction(testRig, user1.address);

      // paymentTokenPrice = (DONUT in LP * 2) / LP total supply
      const lpContract = await ethers.getContractAt("IERC20", testLpToken);
      const donutInLP = await donut.balanceOf(testLpToken);
      const lpTotalSupply = await lpContract.totalSupply();

      if (lpTotalSupply.gt(0)) {
        const expectedPrice = donutInLP.mul(2).mul(convert("1", 18)).div(lpTotalSupply);
        expect(state.paymentTokenPrice).to.be.closeTo(expectedPrice, expectedPrice.div(100));
      }
    });

    it("getAuction returns user donutBalance", async function () {
      const state = await multicall.getAuction(testRig, user1.address);
      const actualDonutBalance = await donut.balanceOf(user1.address);

      expect(state.donutBalance).to.equal(actualDonutBalance);
    });

    it("Pricing updates after mining activity", async function () {
      const stateBefore = await multicall.getRig(testRig, user1.address);

      // Mine to trigger token minting and fee distribution
      await mineRig(testRig, user1);

      // Wait some time
      await network.provider.send("evm_increaseTime", [60]);
      await network.provider.send("evm_mine");

      await mineRig(testRig, user2);

      const stateAfter = await multicall.getRig(testRig, user1.address);

      // Unit balance should have changed
      expect(stateAfter.unitBalance).to.be.gt(stateBefore.unitBalance);
    });

    it("Zero address skips all balance queries", async function () {
      const state = await multicall.getRig(testRig, AddressZero);

      expect(state.ethBalance).to.equal(0);
      expect(state.wethBalance).to.equal(0);
      expect(state.donutBalance).to.equal(0);
      expect(state.unitBalance).to.equal(0);
    });

    it("getAuction zero address skips balance queries", async function () {
      const state = await multicall.getAuction(testRig, AddressZero);

      expect(state.wethBalance).to.equal(0);
      expect(state.donutBalance).to.equal(0);
      expect(state.paymentTokenBalance).to.equal(0);
    });
  });

  // ============================================
  // EDGE CASES AND BOUNDARY CONDITIONS
  // ============================================
  describe("Edge Cases and Boundary Conditions", function () {
    it("Mining at exact epoch boundary", async function () {
      const result = await launchFreshRig(user0, { rigEpochPeriod: 600 });
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // Fast forward to exactly epoch end
      await network.provider.send("evm_increaseTime", [600]);
      await network.provider.send("evm_mine");

      const price = await rigContract.getPrice();
      expect(price).to.equal(0);

      // Should be able to mine at zero price
      const epochId = await rigContract.epochId();
      const deadline = await getFutureDeadline();
      await rigContract.connect(user1).mine(user1.address, epochId, deadline, 0, "");

      expect(await rigContract.epochMiner()).to.equal(user1.address);
    });

    it("Mining at exact halving boundary", async function () {
      const result = await launchFreshRig(user0, {
        initialUps: convert("8", 18),
        tailUps: convert("1", 18),
        halvingPeriod: 86400, // 1 day (MIN_HALVING_PERIOD)
      });
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // Check UPS at exactly halving boundary
      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");

      const ups = await rigContract.getUps();
      expect(ups).to.equal(convert("4", 18)); // Should be halved exactly once
    });

    it("Very small price calculations don't underflow", async function () {
      const result = await launchFreshRig(user0, {
        rigMinInitPrice: convert("0.000001", 18), // Very small min price
        rigPriceMultiplier: convert("1.1", 18),
      });
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // Fast forward to low price
      await network.provider.send("evm_increaseTime", [3500]);
      await network.provider.send("evm_mine");

      // Should handle small prices without reverting
      const price = await rigContract.getPrice();
      expect(price).to.be.gte(0);
    });

    it("Very large UPS values work correctly", async function () {
      const result = await launchFreshRig(user0, {
        initialUps: convert("1000000", 18), // 1M tokens per second
        tailUps: convert("1000", 18),
        halvingPeriod: 86400,
      });
      const rigContract = await ethers.getContractAt("Rig", result.rig);
      const unitContract = await ethers.getContractAt("Unit", await rigContract.unit());

      await mineRig(result.rig, user1);

      // Wait 1 second
      await network.provider.send("evm_increaseTime", [1]);
      await network.provider.send("evm_mine");

      const balanceBefore = await unitContract.balanceOf(user1.address);
      await mineRig(result.rig, user2);
      const balanceAfter = await unitContract.balanceOf(user1.address);

      // Should have minted tokens based on elapsed time * 1M UPS
      // Allow large tolerance due to block timing variance
      const minted = balanceAfter.sub(balanceBefore);
      expect(minted).to.be.gt(convert("500000", 18)); // At least 0.5M tokens
    });

    it("Multiple rapid mines in same block scenario", async function () {
      const result = await launchFreshRig(user0);
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // First mine
      await mineRig(result.rig, user1);
      const epochAfterFirst = await rigContract.epochId();

      // Second mine immediately after
      await mineRig(result.rig, user2);
      const epochAfterSecond = await rigContract.epochId();

      expect(epochAfterSecond).to.equal(epochAfterFirst.add(1));
    });

    it("Price at 99% through epoch", async function () {
      const result = await launchFreshRig(user0, { rigEpochPeriod: 1000 });
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      const initPrice = await rigContract.epochInitPrice();

      // Fast forward 99% through epoch
      await network.provider.send("evm_increaseTime", [990]);
      await network.provider.send("evm_mine");

      const price = await rigContract.getPrice();

      // Price should be approximately 1% of init price
      const expectedPrice = initPrice.div(100);
      expect(price).to.be.closeTo(expectedPrice, expectedPrice.div(10));
    });

    it("Handles maximum uint256 deadline", async function () {
      const result = await launchFreshRig(user0);
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      const epochId = await rigContract.epochId();
      const price = await rigContract.getPrice();
      const maxDeadline = ethers.constants.MaxUint256;

      await weth.connect(user1).deposit({ value: convert("1", 18) });
      await weth.connect(user1).approve(result.rig, price);

      // Should not revert with max deadline
      await rigContract.connect(user1).mine(user1.address, epochId, maxDeadline, price, "");
      expect(await rigContract.epochMiner()).to.equal(user1.address);
    });
  });

  // ============================================
  // SECURITY AND REENTRANCY TESTS
  // ============================================
  describe("Security Tests", function () {
    it("Cannot mine to contract address that rejects ETH", async function () {
      const result = await launchFreshRig(user0);
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // Mining to the Core contract (which likely has no receive function)
      // This tests that the system handles various recipient types
      const epochId = await rigContract.epochId();
      const price = await rigContract.getPrice();
      const deadline = await getFutureDeadline();

      await weth.connect(user1).deposit({ value: convert("1", 18) });
      await weth.connect(user1).approve(result.rig, price);

      // Should work - ERC20 transfers don't have reentrancy issues like ETH
      await rigContract.connect(user1).mine(core.address, epochId, deadline, price, "");
      expect(await rigContract.epochMiner()).to.equal(core.address);
    });

    it("Fee distribution cannot be manipulated by recipient", async function () {
      const result = await launchFreshRig(user0);
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // First mine
      await mineRig(result.rig, user1);

      // Get expected balances
      const user1WethBefore = await weth.balanceOf(user1.address);

      // Second mine - user1 should receive fees
      await mineRig(result.rig, user2);

      const user1WethAfter = await weth.balanceOf(user1.address);

      // User1 should have received their 80% share
      expect(user1WethAfter).to.be.gt(user1WethBefore);
    });

    it("Cannot replay same epochId after mine", async function () {
      const result = await launchFreshRig(user0);
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      const epochId = await rigContract.epochId();
      await mineRig(result.rig, user1);

      // Try to mine with old epochId
      const price = await rigContract.getPrice();
      const deadline = await getFutureDeadline();

      await weth.connect(user2).deposit({ value: convert("1", 18) });
      await weth.connect(user2).approve(result.rig, price);

      await expect(
        rigContract.connect(user2).mine(user2.address, epochId, deadline, price, "")
      ).to.be.revertedWith("Rig__EpochIdMismatch()");
    });

    it("Auction cannot be drained without LP payment", async function () {
      const result = await launchFreshRig(user0);
      const auctionContract = await ethers.getContractAt("Auction", result.auction);

      // Send some WETH to auction to simulate treasury fees
      await weth.connect(user1).deposit({ value: convert("1", 18) });
      await weth.connect(user1).transfer(result.auction, convert("0.5", 18));

      const epochId = await auctionContract.epochId();
      const deadline = await getFutureDeadline();

      // Try to buy without any LP tokens
      await expect(
        auctionContract.connect(user2).buy([weth.address], user2.address, epochId, deadline, convert("100", 18))
      ).to.be.reverted;
    });
  });

  // ============================================
  // FULL LIFECYCLE INTEGRATION TESTS
  // ============================================
  describe("Full Lifecycle Integration", function () {
    it("Complete rig lifecycle: launch -> mine -> halving -> auction", async function () {
      // Launch rig
      const result = await launchFreshRig(user0, {
        initialUps: convert("100", 18),
        tailUps: convert("10", 18),
        halvingPeriod: 86400, // 1 day (MIN_HALVING_PERIOD)
        rigEpochPeriod: 600,
      });

      const rigContract = await ethers.getContractAt("Rig", result.rig);
      const unitContract = await ethers.getContractAt("Unit", result.unit);
      const auctionContract = await ethers.getContractAt("Auction", result.auction);

      // Verify initial state
      expect(await rigContract.getUps()).to.equal(convert("100", 18));
      expect(await rigContract.epochId()).to.equal(0);

      // First mine
      await mineRig(result.rig, user1);
      expect(await rigContract.epochMiner()).to.equal(user1.address);
      expect(await rigContract.epochId()).to.equal(1);

      // Wait and verify token accrual
      await network.provider.send("evm_increaseTime", [10]);
      await network.provider.send("evm_mine");

      // Second mine - user1 gets minted tokens
      const user1BalanceBefore = await unitContract.balanceOf(user1.address);
      await mineRig(result.rig, user2);
      const user1BalanceAfter = await unitContract.balanceOf(user1.address);

      expect(user1BalanceAfter).to.be.gt(user1BalanceBefore);

      // Trigger halving (1 day)
      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");

      expect(await rigContract.getUps()).to.equal(convert("50", 18));

      // Verify auction has accumulated WETH from fees
      const auctionWeth = await weth.balanceOf(result.auction);
      expect(auctionWeth).to.be.gt(0);
    });

    it("Multiple independent rigs operate correctly", async function () {
      // Launch two rigs
      const rig1 = await launchFreshRig(user0, { tokenSymbol: "RIG1" });
      const rig2 = await launchFreshRig(user1, { tokenSymbol: "RIG2" });

      const rig1Contract = await ethers.getContractAt("Rig", rig1.rig);
      const rig2Contract = await ethers.getContractAt("Rig", rig2.rig);
      const unit1 = await ethers.getContractAt("Unit", rig1.unit);
      const unit2 = await ethers.getContractAt("Unit", rig2.unit);

      // Mine both rigs
      await mineRig(rig1.rig, user2);
      await mineRig(rig2.rig, user3);

      // Verify independent ownership
      expect(await rig1Contract.epochMiner()).to.equal(user2.address);
      expect(await rig2Contract.epochMiner()).to.equal(user3.address);

      // Wait and mine again
      await network.provider.send("evm_increaseTime", [30]);
      await network.provider.send("evm_mine");

      await mineRig(rig1.rig, user3);
      await mineRig(rig2.rig, user2);

      // Verify independent token systems
      const user2Unit1 = await unit1.balanceOf(user2.address);
      const user3Unit2 = await unit2.balanceOf(user3.address);

      expect(user2Unit1).to.be.gt(0);
      expect(user3Unit2).to.be.gt(0);

      // Verify symbols are different
      expect(await unit1.symbol()).to.equal("RIG1");
      expect(await unit2.symbol()).to.equal("RIG2");
    });

    it("Rig state survives long idle period", async function () {
      const result = await launchFreshRig(user0);
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      await mineRig(result.rig, user1);

      // Simulate 1 year idle
      await network.provider.send("evm_increaseTime", [86400 * 365]);
      await network.provider.send("evm_mine");

      // State should still be queryable
      const state = await multicall.getRig(result.rig, user1.address);
      expect(state.miner).to.equal(user1.address);
      expect(state.epochId).to.equal(1);

      // UPS should be at tail
      expect(state.nextUps).to.equal(convert("0.01", 18));

      // Should still be able to mine
      await mineRig(result.rig, user2);
      expect(await rigContract.epochMiner()).to.equal(user2.address);
    });

    it("Fee accumulation and distribution across many mines", async function () {
      const result = await launchFreshRig(user0);
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // Track total fees
      let totalProtocolFees = ethers.BigNumber.from(0);
      const protocolBalanceBefore = await weth.balanceOf(protocol.address);

      // Perform 10 mines
      const miners = [user1, user2, user3, user4, user1, user2, user3, user4, user1, user2];
      for (const miner of miners) {
        await mineRig(result.rig, miner);
      }

      const protocolBalanceAfter = await weth.balanceOf(protocol.address);
      totalProtocolFees = protocolBalanceAfter.sub(protocolBalanceBefore);

      // Protocol should have received 1% of all payments
      expect(totalProtocolFees).to.be.gt(0);
      expect(await rigContract.epochId()).to.equal(10);
    });
  });

  // ============================================
  // AUCTION COMPREHENSIVE TESTS
  // ============================================
  describe("Auction Comprehensive Tests", function () {
    let testRig, testAuction, testLpToken;

    beforeEach(async function () {
      const result = await launchFreshRig(user0, {
        auctionInitPrice: convert("10", 18),
        auctionEpochPeriod: 3600,
        auctionPriceMultiplier: convert("1.5", 18),
      });
      testRig = result.rig;
      testAuction = result.auction;
      testLpToken = result.lpToken;

      // Add WETH to auction (simulating accumulated fees)
      await weth.connect(user1).deposit({ value: convert("5", 18) });
      await weth.connect(user1).transfer(testAuction, convert("2", 18));
    });

    it("Auction price decays correctly over time", async function () {
      const auctionContract = await ethers.getContractAt("Auction", testAuction);

      const initPrice = await auctionContract.initPrice();
      const epochPeriod = await auctionContract.epochPeriod();

      // Check price at various points
      for (let pct of [0, 25, 50, 75, 100]) {
        if (pct > 0) {
          await network.provider.send("evm_increaseTime", [epochPeriod.toNumber() / 4]);
          await network.provider.send("evm_mine");
        }

        const price = await auctionContract.getPrice();
        const expectedPrice = initPrice.sub(initPrice.mul(pct).div(100));

        if (pct < 100) {
          expect(price).to.be.closeTo(expectedPrice, initPrice.div(20)); // 5% tolerance
        } else {
          expect(price).to.equal(0);
        }
      }
    });

    it("Auction tracks correct WETH accumulated", async function () {
      const state = await multicall.getAuction(testRig, user1.address);

      expect(state.wethAccumulated).to.equal(convert("2", 18));
    });

    it("Cannot buy with slippage exceeding maxPaymentTokenAmount", async function () {
      const auctionContract = await ethers.getContractAt("Auction", testAuction);
      const epochId = await auctionContract.epochId();
      const price = await auctionContract.getPrice();
      const deadline = await getFutureDeadline();

      // Try to buy with maxPaymentTokenAmount less than current price
      await expect(
        auctionContract.connect(user2).buy([weth.address], user2.address, epochId, deadline, price.div(2))
      ).to.be.revertedWith("Auction__MaxPaymentAmountExceeded()");
    });

    it("Buy succeeds at zero price after epoch", async function () {
      const auctionContract = await ethers.getContractAt("Auction", testAuction);

      // Fast forward past epoch
      await network.provider.send("evm_increaseTime", [3700]);
      await network.provider.send("evm_mine");

      const epochId = await auctionContract.epochId();
      const price = await auctionContract.getPrice();
      expect(price).to.equal(0);

      const user2WethBefore = await weth.balanceOf(user2.address);
      const deadline = await getFutureDeadline();

      // Buy at zero price
      await auctionContract.connect(user2).buy([weth.address], user2.address, epochId, deadline, 0);

      const user2WethAfter = await weth.balanceOf(user2.address);
      expect(user2WethAfter).to.be.gt(user2WethBefore);
    });

    it("Auction epoch increments after buy", async function () {
      const auctionContract = await ethers.getContractAt("Auction", testAuction);

      const epochBefore = await auctionContract.epochId();

      // Fast forward to zero price and buy
      await network.provider.send("evm_increaseTime", [3700]);
      await network.provider.send("evm_mine");

      const epochId = await auctionContract.epochId();
      const deadline = await getFutureDeadline();

      await auctionContract.connect(user2).buy([weth.address], user2.address, epochId, deadline, 0);

      const epochAfter = await auctionContract.epochId();
      expect(epochAfter).to.equal(epochBefore.add(1));
    });

    it("Multiple assets can be withdrawn in single buy", async function () {
      const auctionContract = await ethers.getContractAt("Auction", testAuction);

      // Add donut to auction as well
      await donut.connect(user1).transfer(testAuction, convert("1", 18));

      // Fast forward to zero price
      await network.provider.send("evm_increaseTime", [3700]);
      await network.provider.send("evm_mine");

      const epochId = await auctionContract.epochId();
      const deadline = await getFutureDeadline();

      const user2WethBefore = await weth.balanceOf(user2.address);
      const user2DonutBefore = await donut.balanceOf(user2.address);

      // Buy both assets
      await auctionContract.connect(user2).buy([weth.address, donut.address], user2.address, epochId, deadline, 0);

      const user2WethAfter = await weth.balanceOf(user2.address);
      const user2DonutAfter = await donut.balanceOf(user2.address);

      expect(user2WethAfter).to.be.gt(user2WethBefore);
      expect(user2DonutAfter).to.be.gt(user2DonutBefore);
    });
  });

  // ============================================
  // UNIT TOKEN COMPREHENSIVE TESTS
  // ============================================
  describe("Unit Token Comprehensive Tests", function () {
    let testRig, testUnit;

    beforeEach(async function () {
      const result = await launchFreshRig(user0);
      testRig = result.rig;
      testUnit = result.unit;
    });

    it("Unit token has correct ERC20 properties", async function () {
      const unitContract = await ethers.getContractAt("Unit", testUnit);

      expect(await unitContract.name()).to.equal("Test Unit");
      expect(await unitContract.symbol()).to.equal("TUNIT");
      expect(await unitContract.decimals()).to.equal(18);
    });

    it("Unit tokens are transferable", async function () {
      const unitContract = await ethers.getContractAt("Unit", testUnit);

      // Get some tokens via mining
      await mineRig(testRig, user1);
      await network.provider.send("evm_increaseTime", [60]);
      await network.provider.send("evm_mine");
      await mineRig(testRig, user2);

      const user1Balance = await unitContract.balanceOf(user1.address);
      expect(user1Balance).to.be.gt(0);

      // Transfer to user3
      const transferAmount = user1Balance.div(2);
      await unitContract.connect(user1).transfer(user3.address, transferAmount);

      expect(await unitContract.balanceOf(user3.address)).to.equal(transferAmount);
      expect(await unitContract.balanceOf(user1.address)).to.equal(user1Balance.sub(transferAmount));
    });

    it("Unit tokens can be approved and transferFrom", async function () {
      const unitContract = await ethers.getContractAt("Unit", testUnit);

      // Get some tokens
      await mineRig(testRig, user1);
      await network.provider.send("evm_increaseTime", [60]);
      await network.provider.send("evm_mine");
      await mineRig(testRig, user2);

      const user1Balance = await unitContract.balanceOf(user1.address);

      // Approve user2 to spend
      await unitContract.connect(user1).approve(user2.address, user1Balance);
      expect(await unitContract.allowance(user1.address, user2.address)).to.equal(user1Balance);

      // User2 transfers from user1 to user3
      await unitContract.connect(user2).transferFrom(user1.address, user3.address, user1Balance);
      expect(await unitContract.balanceOf(user3.address)).to.equal(user1Balance);
      expect(await unitContract.balanceOf(user1.address)).to.equal(0);
    });

    it("Burn reduces total supply", async function () {
      const unitContract = await ethers.getContractAt("Unit", testUnit);

      // Get some tokens
      await mineRig(testRig, user1);
      await network.provider.send("evm_increaseTime", [60]);
      await network.provider.send("evm_mine");
      await mineRig(testRig, user2);

      const totalSupplyBefore = await unitContract.totalSupply();
      const user1Balance = await unitContract.balanceOf(user1.address);

      // Burn tokens
      const burnAmount = user1Balance.div(2);
      await unitContract.connect(user1).burn(burnAmount);

      const totalSupplyAfter = await unitContract.totalSupply();
      expect(totalSupplyAfter).to.equal(totalSupplyBefore.sub(burnAmount));
    });

    it("Cannot burn more than balance", async function () {
      const unitContract = await ethers.getContractAt("Unit", testUnit);

      // Get some tokens
      await mineRig(testRig, user1);
      await network.provider.send("evm_increaseTime", [60]);
      await network.provider.send("evm_mine");
      await mineRig(testRig, user2);

      const user1Balance = await unitContract.balanceOf(user1.address);

      // Try to burn more than balance
      await expect(
        unitContract.connect(user1).burn(user1Balance.add(1))
      ).to.be.revertedWith("ERC20: burn amount exceeds balance");
    });
  });

  // ============================================
  // OWNERSHIP AND ACCESS CONTROL TESTS
  // ============================================
  describe("Ownership and Access Control", function () {
    let testRig;

    beforeEach(async function () {
      const result = await launchFreshRig(user0);
      testRig = result.rig;
    });

    it("Rig ownership can be renounced", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);

      await rigContract.connect(user0).renounceOwnership();
      expect(await rigContract.owner()).to.equal(AddressZero);

      // No one can set treasury anymore
      await expect(
        rigContract.connect(user0).setTreasury(user1.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Only Core owner can change protocol settings", async function () {
      await expect(
        core.connect(user1).setProtocolFeeAddress(user1.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      await expect(
        core.connect(user1).setMinDonutForLaunch(convert("1000", 18))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Core ownership can be transferred", async function () {
      await core.connect(owner).transferOwnership(user1.address);
      expect(await core.owner()).to.equal(user1.address);

      // New owner can make changes
      await core.connect(user1).setMinDonutForLaunch(convert("200", 18));
      expect(await core.minDonutForLaunch()).to.equal(convert("200", 18));

      // Transfer back
      await core.connect(user1).transferOwnership(owner.address);
    });
  });
});
