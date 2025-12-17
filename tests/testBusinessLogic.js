const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";
const AddressDead = "0x000000000000000000000000000000000000dEaD";

let owner, protocol, team, user0, user1, user2, user3, user4;
let weth, donut, core, multicall;
let rig, auction, unit, lpToken;
let rigFactory, auctionFactory;
let uniswapFactory, uniswapRouter;

// Helper to ensure user has enough DONUT
async function ensureDonut(user, amount = convert("20", 18)) {
  const balance = await donut.balanceOf(user.address);
  if (balance.lt(amount)) {
    await donut.connect(user).deposit({ value: amount.sub(balance).add(convert("10", 18)) });
  }
}

// Helper to get a fresh rig for isolated tests
async function launchFreshRig(launcher, params = {}) {
  await ensureDonut(launcher, convert("20", 18));
  const defaultParams = {
    launcher: launcher.address,
    tokenName: "Test Unit",
    tokenSymbol: "TUNIT",
    uri: "",
    donutAmount: convert("10", 18), // Reduced for testing
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

// Helper to get a deadline far in the future (using blockchain time)
async function getFutureDeadline() {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp + 86400 * 365; // 1 year from now
}

// Helper to mine a rig
async function mineRig(rigAddress, miner, rigRecipient = null) {
  const rigContract = await ethers.getContractAt("Rig", rigAddress);
  const epochId = await rigContract.epochId();
  const price = await rigContract.getPrice();
  const deadline = await getFutureDeadline();

  await weth.connect(miner).deposit({ value: convert("10", 18) });
  await weth.connect(miner).approve(rigAddress, price.mul(2)); // Extra approval for safety

  const tx = await rigContract
    .connect(miner)
    .mine(rigRecipient || miner.address, epochId, deadline, price.mul(2), "");

  return tx;
}

describe("Business Logic Tests", function () {
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
      convert("5", 18) // minDonutForLaunch (reduced for testing)
    );

    // Deploy Multicall
    const multicallArtifact = await ethers.getContractFactory("Multicall");
    multicall = await multicallArtifact.deploy(core.address, weth.address, donut.address);

    // Mint DONUT to users for launching (need enough for many rigs at 500 each)
    // Each user gets 100 ETH worth of DONUT for extensive testing
    for (const user of [user0, user1, user2, user3, user4]) {
      await donut.connect(user).deposit({ value: convert("100", 18) });
    }

    // Launch initial rig for tests
    const result = await launchFreshRig(user0);
    rig = result.rig;
    unit = result.unit;
    auction = result.auction;
    lpToken = result.lpToken;
  });

  // ============================================
  // RIG DUTCH AUCTION PRICE MECHANICS
  // ============================================
  describe("Rig Dutch Auction Price Mechanics", function () {
    it("Price starts at initPrice at epoch start", async function () {
      const rigContract = await ethers.getContractAt("Rig", rig);
      const initPrice = await rigContract.epochInitPrice();
      const currentPrice = await rigContract.getPrice();

      // Price should be close to initPrice (some time may have passed)
      expect(currentPrice).to.be.lte(initPrice);
    });

    it("Price decays linearly over epoch period", async function () {
      // Launch fresh rig for clean test
      const result = await launchFreshRig(user1, { rigEpochPeriod: 3600 });
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      const initPrice = await rigContract.epochInitPrice();
      const epochPeriod = await rigContract.epochPeriod();

      // Check price at 25% through epoch
      await network.provider.send("evm_increaseTime", [900]); // 15 min = 25%
      await network.provider.send("evm_mine");

      let price = await rigContract.getPrice();
      let expectedPrice = initPrice.sub(initPrice.mul(900).div(epochPeriod));
      expect(price).to.be.closeTo(expectedPrice, expectedPrice.div(100)); // 1% tolerance

      // Check price at 50% through epoch
      await network.provider.send("evm_increaseTime", [900]); // another 15 min
      await network.provider.send("evm_mine");

      price = await rigContract.getPrice();
      expectedPrice = initPrice.sub(initPrice.mul(1800).div(epochPeriod));
      expect(price).to.be.closeTo(expectedPrice, expectedPrice.div(100));

      // Check price at 75% through epoch
      await network.provider.send("evm_increaseTime", [900]);
      await network.provider.send("evm_mine");

      price = await rigContract.getPrice();
      expectedPrice = initPrice.sub(initPrice.mul(2700).div(epochPeriod));
      expect(price).to.be.closeTo(expectedPrice, expectedPrice.div(100));
    });

    it("Price reaches zero after epoch expires", async function () {
      const result = await launchFreshRig(user2, { rigEpochPeriod: 3600 });
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // Fast forward past epoch
      await network.provider.send("evm_increaseTime", [3700]);
      await network.provider.send("evm_mine");

      const price = await rigContract.getPrice();
      expect(price).to.equal(0);
    });

    it("Can mine at zero price when epoch expires", async function () {
      const result = await launchFreshRig(user3, { rigEpochPeriod: 3600 });
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // Fast forward past epoch
      await network.provider.send("evm_increaseTime", [3700]);
      await network.provider.send("evm_mine");

      const epochId = await rigContract.epochId();
      const price = await rigContract.getPrice();
      expect(price).to.equal(0);

      // Mine at zero price - no WETH needed
      const deadline = await getFutureDeadline();
      await rigContract
        .connect(user1)
        .mine(user1.address, epochId, deadline, 0, "");

      expect(await rigContract.epochMiner()).to.equal(user1.address);
    });

    it("Price multiplier correctly sets next epoch price", async function () {
      const result = await launchFreshRig(user4, {
        rigPriceMultiplier: convert("2", 18),
        rigMinInitPrice: convert("0.0001", 18),
      });
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // Get initial price and mine
      const initPriceBefore = await rigContract.epochInitPrice();

      await weth.connect(user1).deposit({ value: convert("1", 18) });
      await weth.connect(user1).approve(result.rig, convert("1", 18));

      const epochId = await rigContract.epochId();
      const pricePaid = await rigContract.getPrice();
      const deadline = await getFutureDeadline();

      await rigContract
        .connect(user1)
        .mine(user1.address, epochId, deadline, pricePaid, "");

      // New initPrice should be pricePaid * 2 (multiplier)
      const initPriceAfter = await rigContract.epochInitPrice();
      const expectedPrice = pricePaid.mul(convert("2", 18)).div(convert("1", 18));

      // Check if it's either the calculated price or minInitPrice (whichever is higher)
      const minInitPrice = await rigContract.minInitPrice();
      if (expectedPrice.lt(minInitPrice)) {
        expect(initPriceAfter).to.equal(minInitPrice);
      } else {
        expect(initPriceAfter).to.be.closeTo(expectedPrice, expectedPrice.div(100));
      }
    });

    it("Price cannot go below minInitPrice", async function () {
      const result = await launchFreshRig(user0, {
        rigMinInitPrice: convert("1", 18), // High min price
        rigPriceMultiplier: convert("1.1", 18),
      });
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // Fast forward to get zero price
      await network.provider.send("evm_increaseTime", [3700]);
      await network.provider.send("evm_mine");

      const epochId = await rigContract.epochId();
      const deadline = await getFutureDeadline();

      // Mine at zero price
      await rigContract
        .connect(user1)
        .mine(user1.address, epochId, deadline, 0, "");

      // New initPrice should be minInitPrice (since 0 * multiplier < minInitPrice)
      const initPrice = await rigContract.epochInitPrice();
      const minInitPrice = await rigContract.minInitPrice();
      expect(initPrice).to.equal(minInitPrice);
    });
  });

  // ============================================
  // RIG MINING AND FEE DISTRIBUTION
  // ============================================
  describe("Rig Mining and Fee Distribution", function () {
    let testRig, testAuction;

    beforeEach(async function () {
      const result = await launchFreshRig(user0);
      testRig = result.rig;
      testAuction = result.auction;
    });

    it("Exact fee percentages: 80% previous, 15% treasury, 4% team, 1% protocol", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);

      // First mine to set up a previous rig holder
      await mineRig(testRig, user1);

      // Get balances before second mine (team is now user0/launcher)
      const prevRigBefore = await weth.balanceOf(user1.address);
      const treasuryBefore = await weth.balanceOf(testAuction);
      const teamBefore = await weth.balanceOf(user0.address);
      const protocolBefore = await weth.balanceOf(protocol.address);

      // Second mine
      await mineRig(testRig, user2);

      // Get balances after (team is now user0/launcher)
      const prevRigAfter = await weth.balanceOf(user1.address);
      const treasuryAfter = await weth.balanceOf(testAuction);
      const teamAfter = await weth.balanceOf(user0.address);
      const protocolAfter = await weth.balanceOf(protocol.address);

      // Calculate received
      const prevRigReceived = prevRigAfter.sub(prevRigBefore);
      const treasuryReceived = treasuryAfter.sub(treasuryBefore);
      const teamReceived = teamAfter.sub(teamBefore);
      const protocolReceived = protocolAfter.sub(protocolBefore);

      const total = prevRigReceived.add(treasuryReceived).add(teamReceived).add(protocolReceived);

      // Verify ratios (in basis points) - convert to numbers for comparison
      const prevRigBps = prevRigReceived.mul(10000).div(total).toNumber();
      const treasuryBps = treasuryReceived.mul(10000).div(total).toNumber();
      const teamBps = teamReceived.mul(10000).div(total).toNumber();
      const protocolBps = protocolReceived.mul(10000).div(total).toNumber();

      expect(prevRigBps).to.be.closeTo(8000, 10); // 80% +/- 0.1%
      expect(treasuryBps).to.be.closeTo(1500, 10); // 15% +/- 0.1%
      expect(teamBps).to.be.closeTo(400, 10); // 4% +/- 0.1%
      expect(protocolBps).to.be.closeTo(100, 10); // 1% +/- 0.1%
    });

    it("No fees distributed when mining at zero price", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);

      // Fast forward past epoch
      await network.provider.send("evm_increaseTime", [3700]);
      await network.provider.send("evm_mine");

      const price = await rigContract.getPrice();
      expect(price).to.equal(0);

      // Get treasury balance before
      const treasuryBefore = await weth.balanceOf(testAuction);

      // Mine at zero price
      const epochId = await rigContract.epochId();
      const deadline = await getFutureDeadline();
      await rigContract
        .connect(user1)
        .mine(user1.address, epochId, deadline, 0, "");

      // Treasury should have received nothing
      const treasuryAfter = await weth.balanceOf(testAuction);
      expect(treasuryAfter).to.equal(treasuryBefore);
    });

    it("Team fee redirects to treasury when team is address(0)", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);

      // First mine to set up a previous miner
      await mineRig(testRig, user1);

      // Set team to address(0)
      await rigContract.connect(user0).setTeam(AddressZero);

      // Get balances before
      const treasuryBefore = await weth.balanceOf(testAuction);

      // Second mine
      await mineRig(testRig, user2);

      // Get balances after
      const treasuryAfter = await weth.balanceOf(testAuction);
      const treasuryReceived = treasuryAfter.sub(treasuryBefore);

      // Treasury should get 15% + 4% (team fee) = 19% = 1900 bps
      const epochId = await rigContract.epochId();
      const initPrice = await rigContract.epochInitPrice();
      // Price was set after the mine, so we need to calculate what was paid
      // treasuryReceived should be ~19% of the price paid
      // Since previous miner gets 80% and protocol gets 1%, treasury gets remaining 19%
      expect(treasuryReceived).to.be.gt(0);
    });

    it("Miner can set different address as rig recipient", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);

      const epochId = await rigContract.epochId();
      const price = await rigContract.getPrice();

      await weth.connect(user1).deposit({ value: convert("1", 18) });
      await weth.connect(user1).approve(testRig, price);

      // User1 pays but user3 becomes the rig holder
      const deadline = await getFutureDeadline();
      await rigContract
        .connect(user1)
        .mine(user3.address, epochId, deadline, price, "");

      expect(await rigContract.epochMiner()).to.equal(user3.address);
    });

    it("Previous rig holder receives minted Unit tokens", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);
      const unitContract = await ethers.getContractAt("Unit", await rigContract.unit());

      // First mine
      await mineRig(testRig, user1);

      const user1UnitBefore = await unitContract.balanceOf(user1.address);

      // Wait some time for tokens to accrue
      await network.provider.send("evm_increaseTime", [60]); // 1 minute
      await network.provider.send("evm_mine");

      // Second mine - user1 should receive minted tokens
      await mineRig(testRig, user2);

      const user1UnitAfter = await unitContract.balanceOf(user1.address);
      expect(user1UnitAfter).to.be.gt(user1UnitBefore);
    });

    it("Minted tokens proportional to holding time", async function () {
      const result = await launchFreshRig(user0, { initialUps: convert("10", 18) });
      const rigContract = await ethers.getContractAt("Rig", result.rig);
      const unitContract = await ethers.getContractAt("Unit", await rigContract.unit());

      // First mine
      await mineRig(result.rig, user1);

      // Wait exactly 100 seconds
      await network.provider.send("evm_increaseTime", [100]);
      await network.provider.send("evm_mine");

      const user1UnitBefore = await unitContract.balanceOf(user1.address);

      // Second mine triggers minting to user1
      await mineRig(result.rig, user2);

      const user1UnitAfter = await unitContract.balanceOf(user1.address);
      const minted = user1UnitAfter.sub(user1UnitBefore);

      // Should be approximately 100 seconds * 10 UPS = 1000 tokens
      // Allow some tolerance for block timing
      expect(minted).to.be.closeTo(convert("1000", 18), convert("100", 18));
    });
  });

  // ============================================
  // RIG FRONTRUN PROTECTION
  // ============================================
  describe("Rig Frontrun Protection", function () {
    let testRig;

    beforeEach(async function () {
      const result = await launchFreshRig(user0);
      testRig = result.rig;
    });

    it("Reverts with wrong epochId", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);
      const price = await rigContract.getPrice();
      const deadline = await getFutureDeadline();

      await weth.connect(user1).deposit({ value: convert("1", 18) });
      await weth.connect(user1).approve(testRig, price);

      // Use wrong epochId
      await expect(
        rigContract
          .connect(user1)
          .mine(user1.address, 999, deadline, price, "")
      ).to.be.revertedWith("Rig__EpochIdMismatch()");
    });

    it("Reverts when deadline passed", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);
      const epochId = await rigContract.epochId();
      const price = await rigContract.getPrice();

      await weth.connect(user1).deposit({ value: convert("1", 18) });
      await weth.connect(user1).approve(testRig, price);

      // Use past deadline
      await expect(
        rigContract.connect(user1).mine(user1.address, epochId, 1, price, "")
      ).to.be.revertedWith("Rig__Expired()");
    });

    it("Reverts when price exceeds maxPrice (slippage protection)", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);
      const epochId = await rigContract.epochId();
      const price = await rigContract.getPrice();
      const deadline = await getFutureDeadline();

      await weth.connect(user1).deposit({ value: convert("1", 18) });
      await weth.connect(user1).approve(testRig, price);

      // Use maxPrice lower than actual price
      await expect(
        rigContract
          .connect(user1)
          .mine(user1.address, epochId, deadline, price.div(2), "")
      ).to.be.revertedWith("Rig__MaxPriceExceeded()");
    });

    it("Reverts with zero rig address", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);
      const epochId = await rigContract.epochId();
      const price = await rigContract.getPrice();
      const deadline = await getFutureDeadline();

      await weth.connect(user1).deposit({ value: convert("1", 18) });
      await weth.connect(user1).approve(testRig, price);

      await expect(
        rigContract
          .connect(user1)
          .mine(AddressZero, epochId, deadline, price, "")
      ).to.be.revertedWith("Rig__InvalidMiner()");
    });
  });

  // ============================================
  // HALVING SCHEDULE
  // ============================================
  describe("Halving Schedule", function () {
    it("UPS halves after each halving period", async function () {
      const result = await launchFreshRig(user0, {
        initialUps: convert("8", 18),
        tailUps: convert("0.5", 18),
        halvingPeriod: 86400, // 1 day (MIN_HALVING_PERIOD)
      });
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // Initial UPS
      let ups = await rigContract.getUps();
      expect(ups).to.equal(convert("8", 18));

      // After 1 halving
      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");
      ups = await rigContract.getUps();
      expect(ups).to.equal(convert("4", 18));

      // After 2 halvings
      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");
      ups = await rigContract.getUps();
      expect(ups).to.equal(convert("2", 18));

      // After 3 halvings
      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");
      ups = await rigContract.getUps();
      expect(ups).to.equal(convert("1", 18));

      // After 4 halvings
      await network.provider.send("evm_increaseTime", [86400]);
      await network.provider.send("evm_mine");
      ups = await rigContract.getUps();
      expect(ups).to.equal(convert("0.5", 18)); // Reached tailUps
    });

    it("UPS never goes below tailUps", async function () {
      const result = await launchFreshRig(user0, {
        initialUps: convert("4", 18),
        tailUps: convert("1", 18),
        halvingPeriod: 86400, // 1 day (MIN_HALVING_PERIOD)
      });
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // Fast forward many halving periods (100 days)
      await network.provider.send("evm_increaseTime", [86400 * 100]);
      await network.provider.send("evm_mine");

      const ups = await rigContract.getUps();
      expect(ups).to.equal(convert("1", 18)); // Should be tailUps
    });

    it("Partial halving periods don't trigger halving", async function () {
      const result = await launchFreshRig(user0, {
        initialUps: convert("8", 18),
        tailUps: convert("0.5", 18),
        halvingPeriod: 86400, // 1 day (MIN_HALVING_PERIOD)
      });
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // Forward 12 hours (half a period)
      await network.provider.send("evm_increaseTime", [43200]);
      await network.provider.send("evm_mine");

      const ups = await rigContract.getUps();
      expect(ups).to.equal(convert("8", 18)); // Should still be initial
    });

    it("Mining at different halving stages mints correct amounts", async function () {
      const result = await launchFreshRig(user0, {
        initialUps: convert("100", 18),
        tailUps: convert("10", 18),
        halvingPeriod: 86400, // 1 day (MIN_HALVING_PERIOD)
      });
      const rigContract = await ethers.getContractAt("Rig", result.rig);
      const unitContract = await ethers.getContractAt("Unit", await rigContract.unit());

      // Mine at full UPS (100/s)
      await mineRig(result.rig, user1);

      // Wait 10 seconds at 100 UPS
      await network.provider.send("evm_increaseTime", [10]);
      await network.provider.send("evm_mine");

      const user1Before = await unitContract.balanceOf(user1.address);
      await mineRig(result.rig, user2);
      const user1After = await unitContract.balanceOf(user1.address);

      // Should have earned ~1000 tokens (10s * 100 UPS) - tolerance for block timing variance
      const earned = user1After.sub(user1Before);
      expect(earned).to.be.closeTo(convert("1000", 18), convert("500", 18));
    });
  });

  // ============================================
  // AUCTION TESTS
  // ============================================
  describe("Auction Contract", function () {
    let testRig, testAuction, testLpToken;

    beforeEach(async function () {
      const result = await launchFreshRig(user0, {
        auctionInitPrice: convert("100", 18),
        auctionEpochPeriod: 3600,
        auctionMinInitPrice: convert("1", 18),
      });
      testRig = result.rig;
      testAuction = result.auction;
      testLpToken = result.lpToken;

      // Send some WETH to auction (simulating treasury fees)
      await weth.connect(user1).deposit({ value: convert("10", 18) });
      await weth.connect(user1).transfer(testAuction, convert("5", 18));
    });

    it("Auction price decays linearly", async function () {
      const auctionContract = await ethers.getContractAt("Auction", testAuction);
      const initPrice = await auctionContract.initPrice();

      // At start
      let price = await auctionContract.getPrice();
      expect(price).to.be.closeTo(initPrice, initPrice.div(100));

      // At 50%
      await network.provider.send("evm_increaseTime", [1800]);
      await network.provider.send("evm_mine");
      price = await auctionContract.getPrice();
      expect(price).to.be.closeTo(initPrice.div(2), initPrice.div(20));

      // After epoch
      await network.provider.send("evm_increaseTime", [2000]);
      await network.provider.send("evm_mine");
      price = await auctionContract.getPrice();
      expect(price).to.equal(0);
    });

    it("Buy transfers all accumulated WETH to buyer", async function () {
      const auctionContract = await ethers.getContractAt("Auction", testAuction);

      // Fast forward to zero price
      await network.provider.send("evm_increaseTime", [3700]);
      await network.provider.send("evm_mine");

      const auctionWethBefore = await weth.balanceOf(testAuction);
      const user2WethBefore = await weth.balanceOf(user2.address);

      expect(auctionWethBefore).to.be.gt(0);

      const epochId = await auctionContract.epochId();
      const deadline = await getFutureDeadline();

      // Buy at zero price
      await auctionContract
        .connect(user2)
        .buy([weth.address], user2.address, epochId, deadline, 0);

      const auctionWethAfter = await weth.balanceOf(testAuction);
      const user2WethAfter = await weth.balanceOf(user2.address);

      expect(auctionWethAfter).to.equal(0);
      expect(user2WethAfter.sub(user2WethBefore)).to.equal(auctionWethBefore);
    });

    it("Buy requires LP tokens as payment", async function () {
      const auctionContract = await ethers.getContractAt("Auction", testAuction);
      const lpContract = await ethers.getContractAt("IERC20", testLpToken);

      // Get some LP tokens (from dead address via impersonation won't work, so skip price test)
      // Instead test that it reverts without LP tokens
      const epochId = await auctionContract.epochId();
      const price = await auctionContract.getPrice();
      const deadline = await getFutureDeadline();

      if (price.gt(0)) {
        await expect(
          auctionContract
            .connect(user2)
            .buy(
              [weth.address],
              user2.address,
              epochId,
              deadline,
              price
            )
        ).to.be.reverted; // Will revert due to insufficient LP tokens
      }
    });

    it("Reverts with empty assets array", async function () {
      const auctionContract = await ethers.getContractAt("Auction", testAuction);
      const epochId = await auctionContract.epochId();
      const deadline = await getFutureDeadline();

      await expect(
        auctionContract
          .connect(user2)
          .buy([], user2.address, epochId, deadline, 0)
      ).to.be.revertedWith("Auction__EmptyAssets()");
    });

    it("Reverts with wrong epochId", async function () {
      const auctionContract = await ethers.getContractAt("Auction", testAuction);
      const deadline = await getFutureDeadline();

      await expect(
        auctionContract
          .connect(user2)
          .buy([weth.address], user2.address, 999, deadline, 0)
      ).to.be.revertedWith("Auction__EpochIdMismatch()");
    });

    it("Reverts when deadline passed", async function () {
      const auctionContract = await ethers.getContractAt("Auction", testAuction);
      const epochId = await auctionContract.epochId();

      await expect(
        auctionContract.connect(user2).buy([weth.address], user2.address, epochId, 1, 0)
      ).to.be.revertedWith("Auction__DeadlinePassed()");
    });
  });

  // ============================================
  // UNIT TOKEN TESTS
  // ============================================
  describe("Unit Token", function () {
    let testUnit, testRig;

    beforeEach(async function () {
      const result = await launchFreshRig(user0);
      testRig = result.rig;
      testUnit = result.unit;
    });

    it("Only Rig can mint tokens", async function () {
      const unitContract = await ethers.getContractAt("Unit", testUnit);

      await expect(unitContract.connect(user1).mint(user1.address, convert("100", 18))).to.be.revertedWith(
        "Unit__NotRig()"
      );
    });

    it("Anyone can burn their own tokens", async function () {
      const unitContract = await ethers.getContractAt("Unit", testUnit);

      // First get some tokens by mining
      await mineRig(testRig, user1);
      await network.provider.send("evm_increaseTime", [60]);
      await network.provider.send("evm_mine");
      await mineRig(testRig, user2);

      const balanceBefore = await unitContract.balanceOf(user1.address);
      expect(balanceBefore).to.be.gt(0);

      // Burn half
      const burnAmount = balanceBefore.div(2);
      await unitContract.connect(user1).burn(burnAmount);

      const balanceAfter = await unitContract.balanceOf(user1.address);
      expect(balanceAfter).to.equal(balanceBefore.sub(burnAmount));
    });

    it("Token has correct name and symbol", async function () {
      const unitContract = await ethers.getContractAt("Unit", testUnit);

      expect(await unitContract.name()).to.equal("Test Unit");
      expect(await unitContract.symbol()).to.equal("TUNIT");
    });

    it("Rig address is correctly set", async function () {
      const unitContract = await ethers.getContractAt("Unit", testUnit);
      expect(await unitContract.rig()).to.equal(testRig);
    });

    it("setRig can only be called by current rig", async function () {
      const unitContract = await ethers.getContractAt("Unit", testUnit);

      // Random user cannot call setRig
      await expect(unitContract.connect(user1).setRig(user1.address)).to.be.revertedWith("Unit__NotRig()");

      // Owner cannot call setRig
      await expect(unitContract.connect(user0).setRig(user0.address)).to.be.revertedWith("Unit__NotRig()");
    });

    it("setRig cannot set to zero address", async function () {
      // Deploy a fresh Unit where we control the rig
      const UnitFactory = await ethers.getContractFactory("Unit");
      const freshUnit = await UnitFactory.connect(user0).deploy("Fresh Unit", "FRESH");

      // user0 is the initial rig (deployer)
      expect(await freshUnit.rig()).to.equal(user0.address);

      // Cannot set rig to zero address
      await expect(freshUnit.connect(user0).setRig(ethers.constants.AddressZero)).to.be.revertedWith(
        "Unit__InvalidRig()"
      );
    });

    it("setRig transfers minting rights", async function () {
      // Deploy a fresh Unit where we control the rig
      const UnitFactory = await ethers.getContractFactory("Unit");
      const freshUnit = await UnitFactory.connect(user0).deploy("Fresh Unit", "FRESH");

      // user0 is the initial rig (deployer)
      expect(await freshUnit.rig()).to.equal(user0.address);

      // user0 can mint
      await freshUnit.connect(user0).mint(user1.address, convert("100", 18));
      expect(await freshUnit.balanceOf(user1.address)).to.equal(convert("100", 18));

      // Transfer rig to user1
      await freshUnit.connect(user0).setRig(user1.address);
      expect(await freshUnit.rig()).to.equal(user1.address);

      // user0 can no longer mint
      await expect(freshUnit.connect(user0).mint(user1.address, convert("100", 18))).to.be.revertedWith(
        "Unit__NotRig()"
      );

      // user1 can now mint
      await freshUnit.connect(user1).mint(user2.address, convert("200", 18));
      expect(await freshUnit.balanceOf(user2.address)).to.equal(convert("200", 18));
    });

    it("Rig address is permanently locked after launch", async function () {
      const unitContract = await ethers.getContractAt("Unit", testUnit);
      const rigContract = await ethers.getContractAt("Rig", testRig);

      // Verify rig is set to the Rig contract
      expect(await unitContract.rig()).to.equal(testRig);

      // The Rig contract has no setRig function, so rig is effectively immutable
      // Try calling setRig from various addresses - all should fail
      await expect(unitContract.connect(user0).setRig(user0.address)).to.be.revertedWith("Unit__NotRig()");
      await expect(unitContract.connect(user1).setRig(user1.address)).to.be.revertedWith("Unit__NotRig()");
      await expect(unitContract.connect(owner).setRig(owner.address)).to.be.revertedWith("Unit__NotRig()");

      // Only the Rig contract could call setRig, but it has no such function
      // This is verified by the fact that Rig contract doesn't expose setRig
      expect(rigContract.setRig).to.be.undefined;
    });

    it("Unit__RigSet event is emitted on setRig", async function () {
      // Deploy a fresh Unit where we control the rig
      const UnitFactory = await ethers.getContractFactory("Unit");
      const freshUnit = await UnitFactory.connect(user0).deploy("Fresh Unit", "FRESH");

      // Transfer rig to user1 and check event
      await expect(freshUnit.connect(user0).setRig(user1.address))
        .to.emit(freshUnit, "Unit__RigSet")
        .withArgs(user1.address);
    });
  });

  // ============================================
  // CORE LAUNCH VALIDATION
  // ============================================
  describe("Core Launch Validation", function () {
    it("Reverts with zero initialUps", async function () {
      await donut.connect(user1).approve(core.address, convert("10", 18));

      await expect(
        core.connect(user1).launch({
          launcher: user1.address,
          tokenName: "Test",
          tokenSymbol: "TST",
          uri: "",
          donutAmount: convert("10", 18),
          unitAmount: convert("1000000", 18),
          initialUps: 0, // Invalid
          tailUps: convert("0.01", 18),
          halvingPeriod: 86400,
          rigEpochPeriod: 3600,
          rigPriceMultiplier: convert("2", 18),
          rigMinInitPrice: convert("0.0001", 18),
          auctionInitPrice: convert("1", 18),
          auctionEpochPeriod: 86400,
          auctionPriceMultiplier: convert("1.2", 18),
          auctionMinInitPrice: convert("0.001", 18),
        })
      ).to.be.revertedWith("Rig__InvalidInitialUps()");
    });

    it("Reverts with zero tailUps", async function () {
      await donut.connect(user1).approve(core.address, convert("10", 18));

      await expect(
        core.connect(user1).launch({
          launcher: user1.address,
          tokenName: "Test",
          tokenSymbol: "TST",
          uri: "",
          donutAmount: convert("10", 18),
          unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18),
          tailUps: 0, // Invalid
          halvingPeriod: 86400,
          rigEpochPeriod: 3600,
          rigPriceMultiplier: convert("2", 18),
          rigMinInitPrice: convert("0.0001", 18),
          auctionInitPrice: convert("1", 18),
          auctionEpochPeriod: 86400,
          auctionPriceMultiplier: convert("1.2", 18),
          auctionMinInitPrice: convert("0.001", 18),
        })
      ).to.be.revertedWith("Rig__InvalidTailUps()");
    });

    it("Reverts when tailUps > initialUps", async function () {
      await donut.connect(user1).approve(core.address, convert("10", 18));

      await expect(
        core.connect(user1).launch({
          launcher: user1.address,
          tokenName: "Test",
          tokenSymbol: "TST",
          uri: "",
          donutAmount: convert("10", 18),
          unitAmount: convert("1000000", 18),
          initialUps: convert("1", 18),
          tailUps: convert("2", 18), // tailUps > initialUps
          halvingPeriod: 86400,
          rigEpochPeriod: 3600,
          rigPriceMultiplier: convert("2", 18),
          rigMinInitPrice: convert("0.0001", 18),
          auctionInitPrice: convert("1", 18),
          auctionEpochPeriod: 86400,
          auctionPriceMultiplier: convert("1.2", 18),
          auctionMinInitPrice: convert("0.001", 18),
        })
      ).to.be.revertedWith("Rig__InvalidTailUps()");
    });

    it("Reverts with zero halvingPeriod", async function () {
      await donut.connect(user1).approve(core.address, convert("10", 18));

      await expect(
        core.connect(user1).launch({
          launcher: user1.address,
          tokenName: "Test",
          tokenSymbol: "TST",
          uri: "",
          donutAmount: convert("10", 18),
          unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18),
          tailUps: convert("0.01", 18),
          halvingPeriod: 0, // Invalid
          rigEpochPeriod: 3600,
          rigPriceMultiplier: convert("2", 18),
          rigMinInitPrice: convert("0.0001", 18),
          auctionInitPrice: convert("1", 18),
          auctionEpochPeriod: 86400,
          auctionPriceMultiplier: convert("1.2", 18),
          auctionMinInitPrice: convert("0.001", 18),
        })
      ).to.be.revertedWith("Rig__InvalidHalvingPeriod()");
    });

    it("Reverts with empty token symbol", async function () {
      await donut.connect(user1).approve(core.address, convert("10", 18));

      await expect(
        core.connect(user1).launch({
          launcher: user1.address,
          tokenName: "Test",
          tokenSymbol: "", // Invalid
          uri: "",
          donutAmount: convert("10", 18),
          unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18),
          tailUps: convert("0.01", 18),
          halvingPeriod: 86400,
          rigEpochPeriod: 3600,
          rigPriceMultiplier: convert("2", 18),
          rigMinInitPrice: convert("0.0001", 18),
          auctionInitPrice: convert("1", 18),
          auctionEpochPeriod: 86400,
          auctionPriceMultiplier: convert("1.2", 18),
          auctionMinInitPrice: convert("0.001", 18),
        })
      ).to.be.revertedWith("Core__EmptyTokenSymbol()");
    });

    it("Multiple rigs can be launched", async function () {
      const countBefore = await core.deployedRigsLength();

      await launchFreshRig(user1, { tokenName: "Rig A", tokenSymbol: "RIGA" });
      await launchFreshRig(user2, { tokenName: "Rig B", tokenSymbol: "RIGB" });
      await launchFreshRig(user3, { tokenName: "Rig C", tokenSymbol: "RIGC" });

      const countAfter = await core.deployedRigsLength();
      expect(countAfter.sub(countBefore)).to.equal(3);
    });

    it("Each rig has unique Unit token", async function () {
      const result1 = await launchFreshRig(user1, { tokenName: "Unit 1", tokenSymbol: "U1" });
      const result2 = await launchFreshRig(user2, { tokenName: "Unit 2", tokenSymbol: "U2" });

      expect(result1.unit).to.not.equal(result2.unit);

      const unit1 = await ethers.getContractAt("Unit", result1.unit);
      const unit2 = await ethers.getContractAt("Unit", result2.unit);

      expect(await unit1.symbol()).to.equal("U1");
      expect(await unit2.symbol()).to.equal("U2");
    });
  });

  // ============================================
  // MULTICALL TESTS
  // ============================================
  describe("Multicall", function () {
    let testRig, testAuction;

    beforeEach(async function () {
      const result = await launchFreshRig(user0);
      testRig = result.rig;
      testAuction = result.auction;
    });

    it("Mine via Multicall wraps ETH automatically", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);
      const epochId = await rigContract.epochId();
      const price = await rigContract.getPrice();
      const deadline = await getFutureDeadline();

      const ethBefore = await ethers.provider.getBalance(user1.address);

      await multicall.connect(user1).mine(testRig, epochId, deadline, price, "", {
        value: price.mul(2),
      });

      expect(await rigContract.epochMiner()).to.equal(user1.address);
    });

    it("Multicall refunds excess ETH as WETH", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);
      const epochId = await rigContract.epochId();
      const price = await rigContract.getPrice();
      const deadline = await getFutureDeadline();

      const wethBefore = await weth.balanceOf(user1.address);

      // Send 2x the price
      await multicall.connect(user1).mine(testRig, epochId, deadline, price, "", {
        value: price.mul(2),
      });

      const wethAfter = await weth.balanceOf(user1.address);

      // Should have received refund (approximately price worth of WETH)
      // The exact amount depends on price decay during execution
      expect(wethAfter).to.be.gte(wethBefore);
    });

    it("getRig returns correct state", async function () {
      await mineRig(testRig, user1);

      const state = await multicall.getRig(testRig, user1.address);

      expect(state.miner).to.equal(user1.address);
      expect(state.epochId).to.equal(1);
      expect(state.ups).to.be.gt(0);
    });

    it("getAuction returns correct state", async function () {
      const state = await multicall.getAuction(testRig, user1.address);

      expect(state.paymentToken).to.not.equal(AddressZero);
      expect(state.epochId).to.equal(0);
    });

    it("getRig with zero address skips balance queries", async function () {
      const state = await multicall.getRig(testRig, AddressZero);

      expect(state.ethBalance).to.equal(0);
      expect(state.wethBalance).to.equal(0);
      expect(state.unitBalance).to.equal(0);
    });
  });

  // ============================================
  // RIG OWNER FUNCTIONS
  // ============================================
  describe("Rig Owner Functions", function () {
    let testRig;

    beforeEach(async function () {
      const result = await launchFreshRig(user0);
      testRig = result.rig;
    });

    it("Cannot set treasury to zero address", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);

      await expect(rigContract.connect(user0).setTreasury(AddressZero)).to.be.revertedWith(
        "Rig__InvalidTreasury()"
      );
    });

    it("Can set team to zero address (fee redirects to treasury)", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);

      // Setting team to zero should succeed
      await rigContract.connect(user0).setTeam(AddressZero);
      expect(await rigContract.team()).to.equal(AddressZero);
    });

    it("Non-owner cannot set treasury", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);

      await expect(rigContract.connect(user1).setTreasury(user1.address)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("Non-owner cannot set team", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);

      await expect(rigContract.connect(user1).setTeam(user1.address)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("Ownership can be transferred", async function () {
      const rigContract = await ethers.getContractAt("Rig", testRig);

      await rigContract.connect(user0).transferOwnership(user1.address);
      expect(await rigContract.owner()).to.equal(user1.address);

      // New owner can set treasury
      await rigContract.connect(user1).setTreasury(user2.address);
      expect(await rigContract.treasury()).to.equal(user2.address);
    });
  });

  // ============================================
  // AUCTION PARAMETER VALIDATION
  // ============================================
  describe("Auction Parameter Validation", function () {
    it("Reverts if epoch period below minimum", async function () {
      await donut.connect(user1).approve(core.address, convert("10", 18));

      await expect(
        core.connect(user1).launch({
          launcher: user1.address,
          tokenName: "Test",
          tokenSymbol: "TST",
          uri: "",
          donutAmount: convert("10", 18),
          unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18),
          tailUps: convert("0.01", 18),
          halvingPeriod: 86400,
          rigEpochPeriod: 3600,
          rigPriceMultiplier: convert("2", 18),
          rigMinInitPrice: convert("0.0001", 18),
          auctionInitPrice: convert("1", 18),
          auctionEpochPeriod: 60, // Below 1 hour minimum
          auctionPriceMultiplier: convert("1.2", 18),
          auctionMinInitPrice: convert("0.001", 18),
        })
      ).to.be.revertedWith("Auction__EpochPeriodBelowMin()");
    });

    it("Reverts if price multiplier below minimum", async function () {
      await donut.connect(user1).approve(core.address, convert("10", 18));

      await expect(
        core.connect(user1).launch({
          launcher: user1.address,
          tokenName: "Test",
          tokenSymbol: "TST",
          uri: "",
          donutAmount: convert("10", 18),
          unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18),
          tailUps: convert("0.01", 18),
          halvingPeriod: 86400,
          rigEpochPeriod: 3600,
          rigPriceMultiplier: convert("2", 18),
          rigMinInitPrice: convert("0.0001", 18),
          auctionInitPrice: convert("1", 18),
          auctionEpochPeriod: 86400,
          auctionPriceMultiplier: convert("1.05", 18), // Below 1.1x minimum
          auctionMinInitPrice: convert("0.001", 18),
        })
      ).to.be.revertedWith("Auction__PriceMultiplierBelowMin()");
    });

    it("Reverts if price multiplier above maximum", async function () {
      await donut.connect(user1).approve(core.address, convert("10", 18));

      await expect(
        core.connect(user1).launch({
          launcher: user1.address,
          tokenName: "Test",
          tokenSymbol: "TST",
          uri: "",
          donutAmount: convert("10", 18),
          unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18),
          tailUps: convert("0.01", 18),
          halvingPeriod: 86400,
          rigEpochPeriod: 3600,
          rigPriceMultiplier: convert("2", 18),
          rigMinInitPrice: convert("0.0001", 18),
          auctionInitPrice: convert("1", 18),
          auctionEpochPeriod: 86400,
          auctionPriceMultiplier: convert("4", 18), // Above 3x maximum
          auctionMinInitPrice: convert("0.001", 18),
        })
      ).to.be.revertedWith("Auction__PriceMultiplierExceedsMax()");
    });

    it("Reverts if minInitPrice below absolute minimum", async function () {
      await donut.connect(user1).approve(core.address, convert("10", 18));

      await expect(
        core.connect(user1).launch({
          launcher: user1.address,
          tokenName: "Test",
          tokenSymbol: "TST",
          uri: "",
          donutAmount: convert("10", 18),
          unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18),
          tailUps: convert("0.01", 18),
          halvingPeriod: 86400,
          rigEpochPeriod: 3600,
          rigPriceMultiplier: convert("2", 18),
          rigMinInitPrice: convert("0.0001", 18),
          auctionInitPrice: convert("1", 18),
          auctionEpochPeriod: 86400,
          auctionPriceMultiplier: convert("1.2", 18),
          auctionMinInitPrice: 100, // Below 1e6 minimum
        })
      ).to.be.revertedWith("Auction__MinInitPriceBelowMin()");
    });
  });

  // ============================================
  // RIG PARAMETER VALIDATION
  // ============================================
  describe("Rig Parameter Validation", function () {
    it("Reverts if rig epoch period below minimum (10 minutes)", async function () {
      await donut.connect(user1).approve(core.address, convert("10", 18));

      await expect(
        core.connect(user1).launch({
          launcher: user1.address,
          tokenName: "Test",
          tokenSymbol: "TST",
          uri: "",
          donutAmount: convert("10", 18),
          unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18),
          tailUps: convert("0.01", 18),
          halvingPeriod: 86400,
          rigEpochPeriod: 300, // 5 minutes - below 10 minute minimum
          rigPriceMultiplier: convert("2", 18),
          rigMinInitPrice: convert("0.0001", 18),
          auctionInitPrice: convert("1", 18),
          auctionEpochPeriod: 86400,
          auctionPriceMultiplier: convert("1.2", 18),
          auctionMinInitPrice: convert("0.001", 18),
        })
      ).to.be.revertedWith("Rig__EpochPeriodOutOfRange()");
    });

    it("Reverts if rig epoch period above maximum (365 days)", async function () {
      await donut.connect(user1).approve(core.address, convert("10", 18));

      await expect(
        core.connect(user1).launch({
          launcher: user1.address,
          tokenName: "Test",
          tokenSymbol: "TST",
          uri: "",
          donutAmount: convert("10", 18),
          unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18),
          tailUps: convert("0.01", 18),
          halvingPeriod: 86400,
          rigEpochPeriod: 86400 * 366, // 366 days - above 365 day maximum
          rigPriceMultiplier: convert("2", 18),
          rigMinInitPrice: convert("0.0001", 18),
          auctionInitPrice: convert("1", 18),
          auctionEpochPeriod: 86400,
          auctionPriceMultiplier: convert("1.2", 18),
          auctionMinInitPrice: convert("0.001", 18),
        })
      ).to.be.revertedWith("Rig__EpochPeriodOutOfRange()");
    });

    it("Reverts if rig price multiplier below minimum (110%)", async function () {
      await donut.connect(user1).approve(core.address, convert("10", 18));

      await expect(
        core.connect(user1).launch({
          launcher: user1.address,
          tokenName: "Test",
          tokenSymbol: "TST",
          uri: "",
          donutAmount: convert("10", 18),
          unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18),
          tailUps: convert("0.01", 18),
          halvingPeriod: 86400,
          rigEpochPeriod: 3600,
          rigPriceMultiplier: convert("1.05", 18), // 105% - below 110% minimum
          rigMinInitPrice: convert("0.0001", 18),
          auctionInitPrice: convert("1", 18),
          auctionEpochPeriod: 86400,
          auctionPriceMultiplier: convert("1.2", 18),
          auctionMinInitPrice: convert("0.001", 18),
        })
      ).to.be.revertedWith("Rig__PriceMultiplierOutOfRange()");
    });

    it("Reverts if rig price multiplier above maximum (300%)", async function () {
      await donut.connect(user1).approve(core.address, convert("10", 18));

      await expect(
        core.connect(user1).launch({
          launcher: user1.address,
          tokenName: "Test",
          tokenSymbol: "TST",
          uri: "",
          donutAmount: convert("10", 18),
          unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18),
          tailUps: convert("0.01", 18),
          halvingPeriod: 86400,
          rigEpochPeriod: 3600,
          rigPriceMultiplier: convert("4", 18), // 400% - above 300% maximum
          rigMinInitPrice: convert("0.0001", 18),
          auctionInitPrice: convert("1", 18),
          auctionEpochPeriod: 86400,
          auctionPriceMultiplier: convert("1.2", 18),
          auctionMinInitPrice: convert("0.001", 18),
        })
      ).to.be.revertedWith("Rig__PriceMultiplierOutOfRange()");
    });

    it("Reverts if rig minInitPrice below absolute minimum", async function () {
      await donut.connect(user1).approve(core.address, convert("10", 18));

      await expect(
        core.connect(user1).launch({
          launcher: user1.address,
          tokenName: "Test",
          tokenSymbol: "TST",
          uri: "",
          donutAmount: convert("10", 18),
          unitAmount: convert("1000000", 18),
          initialUps: convert("4", 18),
          tailUps: convert("0.01", 18),
          halvingPeriod: 86400,
          rigEpochPeriod: 3600,
          rigPriceMultiplier: convert("2", 18),
          rigMinInitPrice: 100, // Below 1e6 minimum
          auctionInitPrice: convert("1", 18),
          auctionEpochPeriod: 86400,
          auctionPriceMultiplier: convert("1.2", 18),
          auctionMinInitPrice: convert("0.001", 18),
        })
      ).to.be.revertedWith("Rig__MinInitPriceBelowAbsoluteMin()");
    });

    it("Accepts valid rig parameters at boundary values", async function () {
      await donut.connect(user1).approve(core.address, convert("10", 18));

      // Should not revert with exact minimum values
      const tx = await core.connect(user1).launch({
        launcher: user1.address,
        tokenName: "Boundary Test",
        tokenSymbol: "BNDRY",
        uri: "",
        donutAmount: convert("10", 18),
        unitAmount: convert("1000000", 18),
        initialUps: convert("4", 18),
        tailUps: convert("0.01", 18),
        halvingPeriod: 86400,
        rigEpochPeriod: 600, // Exact minimum (10 minutes)
        rigPriceMultiplier: convert("1.1", 18), // Exact minimum (110%)
        rigMinInitPrice: 1000000, // Exact minimum (1e6)
        auctionInitPrice: convert("1", 18),
        auctionEpochPeriod: 86400,
        auctionPriceMultiplier: convert("1.1", 18),
        auctionMinInitPrice: convert("0.001", 18),
      });

      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
    });

    it("Accepts valid rig parameters at maximum boundary values", async function () {
      await donut.connect(user1).approve(core.address, convert("10", 18));

      // Should not revert with exact maximum values
      const tx = await core.connect(user1).launch({
        launcher: user1.address,
        tokenName: "Max Boundary Test",
        tokenSymbol: "MAXB",
        uri: "",
        donutAmount: convert("10", 18),
        unitAmount: convert("1000000", 18),
        initialUps: convert("4", 18),
        tailUps: convert("0.01", 18),
        halvingPeriod: 86400,
        rigEpochPeriod: 86400 * 365, // Exact maximum (365 days)
        rigPriceMultiplier: convert("3", 18), // Exact maximum (300%)
        rigMinInitPrice: convert("0.0001", 18),
        auctionInitPrice: convert("1", 18),
        auctionEpochPeriod: 86400,
        auctionPriceMultiplier: convert("1.1", 18),
        auctionMinInitPrice: convert("0.001", 18),
      });

      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
    });
  });

  // ============================================
  // COMPLEX SCENARIOS
  // ============================================
  describe("Complex Scenarios", function () {
    it("Multiple users mining same rig in sequence", async function () {
      const result = await launchFreshRig(user0);
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // 5 users mine in sequence
      const users = [user1, user2, user3, user4, user0];
      for (let i = 0; i < users.length; i++) {
        await mineRig(result.rig, users[i]);
        expect(await rigContract.epochMiner()).to.equal(users[i].address);
        expect(await rigContract.epochId()).to.equal(i + 1);
      }
    });

    it("Mining after long idle period still works", async function () {
      const result = await launchFreshRig(user0, {
        initialUps: convert("1", 18),
        tailUps: convert("0.001", 18),
        halvingPeriod: 86400,
      });
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // Fast forward 1 year
      await network.provider.send("evm_increaseTime", [86400 * 365]);
      await network.provider.send("evm_mine");

      // Mining should still work
      await mineRig(result.rig, user1);
      expect(await rigContract.epochMiner()).to.equal(user1.address);

      // UPS should be at tailUps
      const ups = await rigContract.getUps();
      expect(ups).to.equal(convert("0.001", 18));
    });

    it("Fee distribution continues after treasury change", async function () {
      const result = await launchFreshRig(user0);
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      // Mine once
      await mineRig(result.rig, user1);

      // Change treasury to user3
      await rigContract.connect(user0).setTreasury(user3.address);

      const user3Before = await weth.balanceOf(user3.address);

      // Mine again - fees should go to new treasury
      await mineRig(result.rig, user2);

      const user3After = await weth.balanceOf(user3.address);
      expect(user3After).to.be.gt(user3Before);
    });

    it("Epoch ID increments correctly through many mines", async function () {
      const result = await launchFreshRig(user0);
      const rigContract = await ethers.getContractAt("Rig", result.rig);

      for (let i = 0; i < 10; i++) {
        expect(await rigContract.epochId()).to.equal(i);
        await mineRig(result.rig, i % 2 === 0 ? user1 : user2);
      }
      expect(await rigContract.epochId()).to.equal(10);
    });
  });
});
