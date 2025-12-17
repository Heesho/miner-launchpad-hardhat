const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const AddressZero = "0x0000000000000000000000000000000000000000";
const AddressDead = "0x000000000000000000000000000000000000dEaD";

let owner, protocol, team, user0, user1, user2;
let weth, donut, core, multicall;
let rig, auction, unit, lpToken;
let rigFactory, auctionFactory;

// Mock Uniswap V2 contracts for testing
let uniswapFactory, uniswapRouter;

describe("Core Tests", function () {
  before("Initial set up", async function () {
    // Reset network state for test isolation
    await network.provider.send("hardhat_reset");
    console.log("Begin Initialization");

    [owner, protocol, team, user0, user1, user2] = await ethers.getSigners();

    // Deploy WETH
    const wethArtifact = await ethers.getContractFactory("MockWETH");
    weth = await wethArtifact.deploy();
    console.log("- WETH Initialized");

    // Deploy mock DONUT token (using MockWETH as a simple ERC20)
    donut = await wethArtifact.deploy();
    console.log("- DONUT Initialized");

    // Deploy mock Uniswap V2 Factory and Router
    const mockUniswapFactoryArtifact = await ethers.getContractFactory("MockUniswapV2Factory");
    uniswapFactory = await mockUniswapFactoryArtifact.deploy();
    console.log("- Uniswap V2 Factory Initialized");

    const mockUniswapRouterArtifact = await ethers.getContractFactory("MockUniswapV2Router");
    uniswapRouter = await mockUniswapRouterArtifact.deploy(uniswapFactory.address);
    console.log("- Uniswap V2 Router Initialized");

    // Deploy RigFactory
    const rigFactoryArtifact = await ethers.getContractFactory("RigFactory");
    rigFactory = await rigFactoryArtifact.deploy();
    console.log("- RigFactory Initialized");

    // Deploy AuctionFactory
    const auctionFactoryArtifact = await ethers.getContractFactory("AuctionFactory");
    auctionFactory = await auctionFactoryArtifact.deploy();
    console.log("- AuctionFactory Initialized");

    // Deploy UnitFactory
    const unitFactoryArtifact = await ethers.getContractFactory("UnitFactory");
    const unitFactory = await unitFactoryArtifact.deploy();
    console.log("- UnitFactory Initialized");

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
      convert("100", 18) // minDonutForLaunch
    );
    console.log("- Core Initialized");

    // Deploy Multicall
    const multicallArtifact = await ethers.getContractFactory("Multicall");
    multicall = await multicallArtifact.deploy(core.address, weth.address, donut.address);
    console.log("- Multicall Initialized");

    // Mint DONUT to user0 for launching
    await donut.connect(user0).deposit({ value: convert("1000", 18) });
    console.log("- DONUT minted to user0");

    console.log("Initialization Complete");
    console.log();
  });

  it("Core state", async function () {
    console.log("******************************************************");
    console.log("Protocol Fee Address:", await core.protocolFeeAddress());
    console.log("DONUT Token:", await core.donutToken());
    console.log("Min DONUT for Launch:", divDec(await core.minDonutForLaunch()));
    console.log("Deployed Rigs Length:", (await core.deployedRigsLength()).toString());
  });

  it("Launch a new rig", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "Test Unit",
      tokenSymbol: "TUNIT",
      uri: "",
      donutAmount: convert("500", 18),
      unitAmount: convert("1000000", 18),
      initialUps: convert("4", 18),
      tailUps: convert("0.01", 18),
      halvingPeriod: 86400 * 30, // 30 days
      rigEpochPeriod: 3600, // 1 hour
      rigPriceMultiplier: convert("2", 18),
      rigMinInitPrice: convert("0.0001", 18),
      auctionInitPrice: convert("1", 18),
      auctionEpochPeriod: 86400, // 1 day
      auctionPriceMultiplier: convert("1.2", 18),
      auctionMinInitPrice: convert("0.001", 18),
    };

    // Approve DONUT
    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    // Launch
    const tx = await core.connect(user0).launch(launchParams);
    const receipt = await tx.wait();

    // Get deployed addresses from event
    const launchEvent = receipt.events.find((e) => e.event === "Core__Launched");
    rig = launchEvent.args.rig;
    unit = launchEvent.args.unit;
    auction = launchEvent.args.auction;
    lpToken = launchEvent.args.lpToken;

    console.log("Rig deployed at:", rig);
    console.log("Unit token deployed at:", unit);
    console.log("Auction deployed at:", auction);
    console.log("LP Token at:", lpToken);

    // Verify registry
    expect(await core.isDeployedRig(rig)).to.equal(true);
    expect(await core.rigToLauncher(rig)).to.equal(user0.address);
    expect(await core.rigToUnit(rig)).to.equal(unit);
    expect(await core.rigToAuction(rig)).to.equal(auction);
    expect(await core.rigToLP(rig)).to.equal(lpToken);
    expect(await core.deployedRigsLength()).to.equal(1);
  });

  it("Verify rig ownership transferred to launcher", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("Rig", rig);
    expect(await rigContract.owner()).to.equal(user0.address);
    console.log("Rig owner:", await rigContract.owner());
  });

  it("Verify rig parameters", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("Rig", rig);

    console.log("Initial UPS:", divDec(await rigContract.initialUps()));
    console.log("Tail UPS:", divDec(await rigContract.tailUps()));
    console.log("Halving Period:", (await rigContract.halvingPeriod()).toString());
    console.log("Epoch Period:", (await rigContract.epochPeriod()).toString());
    console.log("Treasury:", await rigContract.treasury());
    console.log("Team:", await rigContract.team());
    console.log("Core:", await rigContract.core());

    expect(await rigContract.treasury()).to.equal(auction);
    expect(await rigContract.team()).to.equal(user0.address); // launcher is now team
  });

  it("Verify LP tokens burned", async function () {
    console.log("******************************************************");
    const lpContract = await ethers.getContractAt("IERC20", lpToken);
    const deadBalance = await lpContract.balanceOf(AddressDead);
    console.log("LP tokens burned (in dead address):", divDec(deadBalance));
    expect(deadBalance).to.be.gt(0);
  });

  it("User1 mines", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("Rig", rig);

    // Get current state
    const epochId = await rigContract.epochId();
    const price = await rigContract.getPrice();

    console.log("Current epoch:", epochId.toString());
    console.log("Current price:", divDec(price));

    // Approve WETH and mine
    await weth.connect(user1).deposit({ value: convert("1", 18) });
    await weth.connect(user1).approve(rig, price);

    await rigContract
      .connect(user1)
      .mine(user1.address, epochId, 1961439882, price, "https://example.com");

    console.log("User1 mined successfully");
    expect(await rigContract.epochMiner()).to.equal(user1.address);
  });

  it("Verify fee distribution", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("Rig", rig);

    // Get current state
    const epochId = await rigContract.epochId();
    const price = await rigContract.getPrice();

    // Get balances before (team is now user0/launcher)
    const user1WethBefore = await weth.balanceOf(user1.address);
    const auctionWethBefore = await weth.balanceOf(auction);
    const teamWethBefore = await weth.balanceOf(user0.address);
    const protocolWethBefore = await weth.balanceOf(protocol.address);

    // User2 mines
    await weth.connect(user2).deposit({ value: convert("1", 18) });
    await weth.connect(user2).approve(rig, price);

    await rigContract
      .connect(user2)
      .mine(user2.address, epochId, 1961439882, price, "https://example.com");

    // Get balances after (team is now user0/launcher)
    const user1WethAfter = await weth.balanceOf(user1.address);
    const auctionWethAfter = await weth.balanceOf(auction);
    const teamWethAfter = await weth.balanceOf(user0.address);
    const protocolWethAfter = await weth.balanceOf(protocol.address);

    // Calculate received amounts
    const user1Received = user1WethAfter.sub(user1WethBefore);
    const auctionReceived = auctionWethAfter.sub(auctionWethBefore);
    const teamReceived = teamWethAfter.sub(teamWethBefore);
    const protocolReceived = protocolWethAfter.sub(protocolWethBefore);

    console.log("Price paid:", divDec(price));
    console.log("Previous rig (80%):", divDec(user1Received));
    console.log("Treasury/Auction (15%):", divDec(auctionReceived));
    console.log("Team (4%):", divDec(teamReceived));
    console.log("Protocol (1%):", divDec(protocolReceived));

    // Verify percentages using actual amounts received (accounts for price decay between read and execution)
    const totalReceived = user1Received.add(auctionReceived).add(teamReceived).add(protocolReceived);

    // Verify fee ratios match the expected percentages (80/15/4/1)
    // Using closeTo to account for rounding in basis point calculations
    const tolerance = totalReceived.div(1000); // 0.1% tolerance

    const expectedPreviousRig = totalReceived.mul(8000).div(10000);
    const expectedTreasury = totalReceived.mul(1500).div(10000);
    const expectedTeam = totalReceived.mul(400).div(10000);

    expect(user1Received).to.be.closeTo(expectedPreviousRig, tolerance);
    expect(auctionReceived).to.be.closeTo(expectedTreasury, tolerance);
    expect(teamReceived).to.be.closeTo(expectedTeam, tolerance);
  });

  it("Verify Unit tokens minted to previous rig", async function () {
    console.log("******************************************************");
    const unitContract = await ethers.getContractAt("Unit", unit);
    const user1Balance = await unitContract.balanceOf(user1.address);
    console.log("User1 Unit balance:", divDec(user1Balance));
    expect(user1Balance).to.be.gt(0);
  });

  it("Forward time 30 days - halving", async function () {
    console.log("******************************************************");
    await network.provider.send("evm_increaseTime", [86400 * 30]);
    await network.provider.send("evm_mine");
    console.log("- time forwarded 30 days");

    const rigContract = await ethers.getContractAt("Rig", rig);
    const ups = await rigContract.getUps();
    console.log("UPS after halving:", divDec(ups));
    expect(ups).to.equal(convert("2", 18)); // Should be halved from 4 to 2
  });

  it("Launcher can change treasury", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("Rig", rig);

    // Only owner (launcher) can change treasury
    await expect(
      rigContract.connect(user1).setTreasury(user1.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    // Owner can change treasury
    await rigContract.connect(user0).setTreasury(user0.address);
    expect(await rigContract.treasury()).to.equal(user0.address);
    console.log("Treasury changed to:", await rigContract.treasury());

    // Change back to auction
    await rigContract.connect(user0).setTreasury(auction);
  });

  it("Launcher can change team", async function () {
    console.log("******************************************************");
    const rigContract = await ethers.getContractAt("Rig", rig);

    const newTeam = user1.address;
    await rigContract.connect(user0).setTeam(newTeam);
    expect(await rigContract.team()).to.equal(newTeam);
    console.log("Team changed to:", await rigContract.team());
  });

  it("Protocol owner can change protocol fee address", async function () {
    console.log("******************************************************");

    // Only core owner can change protocol fee address
    await expect(
      core.connect(user0).setProtocolFeeAddress(user0.address)
    ).to.be.revertedWith("Ownable: caller is not the owner");

    // Core owner can change
    await core.connect(owner).setProtocolFeeAddress(user2.address);
    expect(await core.protocolFeeAddress()).to.equal(user2.address);
    console.log("Protocol fee address changed to:", await core.protocolFeeAddress());

    // Change back
    await core.connect(owner).setProtocolFeeAddress(protocol.address);
  });

  it("Protocol owner can change min DONUT for launch", async function () {
    console.log("******************************************************");
    await core.connect(owner).setMinDonutForLaunch(convert("200", 18));
    console.log("Min DONUT for launch:", divDec(await core.minDonutForLaunch()));
  });

  it("Cannot launch with insufficient DONUT", async function () {
    console.log("******************************************************");

    const launchParams = {
      launcher: user0.address,
      tokenName: "Test Unit 2",
      tokenSymbol: "TUNIT2",
      uri: "",
      donutAmount: convert("100", 18), // Less than minDonutForLaunch (200)
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

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "Core__InsufficientDonut()"
    );
    console.log("Launch correctly reverted with insufficient DONUT");
  });

  it("Cannot launch with invalid parameters", async function () {
    console.log("******************************************************");

    // Test empty token name
    let launchParams = {
      launcher: user0.address,
      tokenName: "",
      tokenSymbol: "TUNIT2",
      uri: "",
      donutAmount: convert("500", 18),
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

    await donut.connect(user0).approve(core.address, launchParams.donutAmount);

    await expect(core.connect(user0).launch(launchParams)).to.be.revertedWith(
      "Core__EmptyTokenName()"
    );

    console.log("Launch correctly reverted with invalid parameters");
  });

  it("Multicall getRig", async function () {
    console.log("******************************************************");
    const state = await multicall.getRig(rig, user1.address);
    console.log("Epoch ID:", state.epochId.toString());
    console.log("Init Price:", divDec(state.initPrice));
    console.log("Current Price:", divDec(state.price));
    console.log("UPS:", divDec(state.ups));
    console.log("Next UPS:", divDec(state.nextUps));
    console.log("Current Miner:", state.miner);
    console.log("User1 Unit Balance:", divDec(state.unitBalance));
  });

  it("Multicall getAuction", async function () {
    console.log("******************************************************");
    const state = await multicall.getAuction(rig, user1.address);
    console.log("Epoch ID:", state.epochId.toString());
    console.log("Init Price:", divDec(state.initPrice));
    console.log("Current Price:", divDec(state.price));
    console.log("Payment Token:", state.paymentToken);
    console.log("WETH Accumulated:", divDec(state.wethAccumulated));
  });
});
