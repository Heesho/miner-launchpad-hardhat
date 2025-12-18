const { ethers } = require("hardhat");
const hre = require("hardhat");

// Constants
const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);
const divDec = (amount, decimals = 18) => amount / 10 ** decimals;

// =============================================================================
// CONFIGURATION - UPDATE THESE FOR YOUR DEPLOYMENT
// =============================================================================

// Base Mainnet addresses
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const DONUT_ADDRESS = "0xae4a37d554c6d6f3e398546d8566b25052e0169c"; // TODO: Set DONUT token address
const UNISWAP_V2_FACTORY = "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6";
const UNISWAP_V2_ROUTER = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24";

// Protocol settings
const PROTOCOL_FEE_ADDRESS = "0xbA366c82815983fF130C23CED78bD95E1F2c18EA"; // TODO: Set protocol fee recipient
const MULTISIG_ADDRESS = "0xeE0CB49D2805DA6bC0A979ddAd87bb793fbB765E";
const MIN_DONUT_FOR_LAUNCH = convert("1000", 18); // 1000 DONUT minimum

// Deployed Contract Addresses (paste after deployment)
const UNIT_FACTORY = "0xBe569151312c41d1927322705EB96933fe4911A5";
const RIG_FACTORY = "0x74748d7BeEDC9Cb503294ce97C85ae6Dc9Bd2bD6";
const AUCTION_FACTORY = "0x856c88cDD4fFd6E922b9C9A468504A738026418d";
const CORE = "0xA35588D152F45C95f5b152e099647f081BD9F5AB";
const MULTICALL = "0x5D16A5EB8Ac507eF417A44b8d767104dC52EFa87";

// Contract Variables
let unitFactory, rigFactory, auctionFactory, core, multicall;

// =============================================================================
// GET CONTRACTS
// =============================================================================

async function getContracts() {
  if (UNIT_FACTORY) {
    unitFactory = await ethers.getContractAt(
      "contracts/UnitFactory.sol:UnitFactory",
      UNIT_FACTORY
    );
  }

  if (RIG_FACTORY) {
    rigFactory = await ethers.getContractAt(
      "contracts/RigFactory.sol:RigFactory",
      RIG_FACTORY
    );
  }

  if (AUCTION_FACTORY) {
    auctionFactory = await ethers.getContractAt(
      "contracts/AuctionFactory.sol:AuctionFactory",
      AUCTION_FACTORY
    );
  }

  if (CORE) {
    core = await ethers.getContractAt("contracts/Core.sol:Core", CORE);
  }

  if (MULTICALL) {
    multicall = await ethers.getContractAt(
      "contracts/Multicall.sol:Multicall",
      MULTICALL
    );
  }

  console.log("Contracts Retrieved");
}

// =============================================================================
// DEPLOY FUNCTIONS
// =============================================================================

async function deployUnitFactory() {
  console.log("Starting UnitFactory Deployment");
  const artifact = await ethers.getContractFactory("UnitFactory");
  const contract = await artifact.deploy({ gasPrice: ethers.gasPrice });
  unitFactory = await contract.deployed();
  await sleep(5000);
  console.log("UnitFactory Deployed at:", unitFactory.address);
}

async function deployRigFactory() {
  console.log("Starting RigFactory Deployment");
  const artifact = await ethers.getContractFactory("RigFactory");
  const contract = await artifact.deploy({ gasPrice: ethers.gasPrice });
  rigFactory = await contract.deployed();
  await sleep(5000);
  console.log("RigFactory Deployed at:", rigFactory.address);
}

async function deployAuctionFactory() {
  console.log("Starting AuctionFactory Deployment");
  const artifact = await ethers.getContractFactory("AuctionFactory");
  const contract = await artifact.deploy({ gasPrice: ethers.gasPrice });
  auctionFactory = await contract.deployed();
  await sleep(5000);
  console.log("AuctionFactory Deployed at:", auctionFactory.address);
}

async function deployCore() {
  console.log("Starting Core Deployment");

  if (!PROTOCOL_FEE_ADDRESS) {
    throw new Error("PROTOCOL_FEE_ADDRESS must be set before deployment");
  }
  if (!DONUT_ADDRESS) {
    throw new Error("DONUT_ADDRESS must be set before deployment");
  }

  const artifact = await ethers.getContractFactory("Core");
  const contract = await artifact.deploy(
    WETH_ADDRESS,
    DONUT_ADDRESS,
    UNISWAP_V2_FACTORY,
    UNISWAP_V2_ROUTER,
    unitFactory.address,
    rigFactory.address,
    auctionFactory.address,
    PROTOCOL_FEE_ADDRESS,
    MIN_DONUT_FOR_LAUNCH,
    { gasPrice: ethers.gasPrice }
  );
  core = await contract.deployed();
  await sleep(5000);
  console.log("Core Deployed at:", core.address);
}

async function deployMulticall() {
  console.log("Starting Multicall Deployment");
  const artifact = await ethers.getContractFactory("Multicall");
  const contract = await artifact.deploy(
    core.address,
    WETH_ADDRESS,
    DONUT_ADDRESS,
    {
      gasPrice: ethers.gasPrice,
    }
  );
  multicall = await contract.deployed();
  await sleep(5000);
  console.log("Multicall Deployed at:", multicall.address);
}

// =============================================================================
// VERIFY FUNCTIONS
// =============================================================================

async function verifyUnitFactory() {
  console.log("Starting UnitFactory Verification");
  await hre.run("verify:verify", {
    address: unitFactory?.address || UNIT_FACTORY,
    contract: "contracts/UnitFactory.sol:UnitFactory",
    constructorArguments: [],
  });
  console.log("UnitFactory Verified");
}

async function verifyRigFactory() {
  console.log("Starting RigFactory Verification");
  await hre.run("verify:verify", {
    address: rigFactory?.address || RIG_FACTORY,
    contract: "contracts/RigFactory.sol:RigFactory",
    constructorArguments: [],
  });
  console.log("RigFactory Verified");
}

async function verifyAuctionFactory() {
  console.log("Starting AuctionFactory Verification");
  await hre.run("verify:verify", {
    address: auctionFactory?.address || AUCTION_FACTORY,
    contract: "contracts/AuctionFactory.sol:AuctionFactory",
    constructorArguments: [],
  });
  console.log("AuctionFactory Verified");
}

async function verifyCore() {
  console.log("Starting Core Verification");
  await hre.run("verify:verify", {
    address: core?.address || CORE,
    contract: "contracts/Core.sol:Core",
    constructorArguments: [
      WETH_ADDRESS,
      DONUT_ADDRESS,
      UNISWAP_V2_FACTORY,
      UNISWAP_V2_ROUTER,
      unitFactory?.address || UNIT_FACTORY,
      rigFactory?.address || RIG_FACTORY,
      auctionFactory?.address || AUCTION_FACTORY,
      PROTOCOL_FEE_ADDRESS,
      MIN_DONUT_FOR_LAUNCH,
    ],
  });
  console.log("Core Verified");
}

async function verifyMulticall() {
  console.log("Starting Multicall Verification");
  await hre.run("verify:verify", {
    address: multicall?.address || MULTICALL,
    contract: "contracts/Multicall.sol:Multicall",
    constructorArguments: [core?.address || CORE, WETH_ADDRESS, DONUT_ADDRESS],
  });
  console.log("Multicall Verified");
}

async function verifyUnitByRigIndex(rigIndex) {
  const rigAddress = await core.deployedRigs(rigIndex);
  const unitAddress = await core.rigToUnit(rigAddress);
  const unit = await ethers.getContractAt(
    "contracts/Unit.sol:Unit",
    unitAddress
  );

  const name = await unit.name();
  const symbol = await unit.symbol();

  console.log("Starting Unit Verification for:", unitAddress);
  console.log("  Name:", name);
  console.log("  Symbol:", symbol);

  await hre.run("verify:verify", {
    address: unitAddress,
    contract: "contracts/Unit.sol:Unit",
    constructorArguments: [name, symbol],
  });
  console.log("Unit Verified:", unitAddress);
}

async function getUnitVerificationInfo(rigIndex) {
  const rigAddress = await core.deployedRigs(rigIndex);
  const unitAddress = await core.rigToUnit(rigAddress);
  const unit = await ethers.getContractAt(
    "contracts/Unit.sol:Unit",
    unitAddress
  );

  const name = await unit.name();
  const symbol = await unit.symbol();

  // ABI encode the constructor arguments
  const abiCoder = new ethers.utils.AbiCoder();
  const encodedArgs = abiCoder.encode(["string", "string"], [name, symbol]);
  // Remove '0x' prefix for BaseScan
  const encodedArgsNoPrefix = encodedArgs.slice(2);

  console.log("\n=== Unit Verification Info ===\n");
  console.log("Unit Address:", unitAddress);
  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("\nABI-Encoded Constructor Arguments (for BaseScan):");
  console.log(encodedArgsNoPrefix);
  console.log("\n==============================\n");

  return { unitAddress, name, symbol, encodedArgs: encodedArgsNoPrefix };
}

async function verifyRigByIndex(rigIndex) {
  const rigAddress = await core.deployedRigs(rigIndex);
  const rig = await ethers.getContractAt("contracts/Rig.sol:Rig", rigAddress);

  // Read all constructor args from the deployed contract
  const unitAddress = await rig.unit();
  const quoteAddress = await rig.quote();
  const treasury = await rig.treasury();
  const team = await rig.team();
  const coreAddress = await rig.core();
  const uri = await rig.uri();
  const initialUps = await rig.initialUps();
  const tailUps = await rig.tailUps();
  const halvingPeriod = await rig.halvingPeriod();
  const epochPeriod = await rig.epochPeriod();
  const priceMultiplier = await rig.priceMultiplier();
  const minInitPrice = await rig.minInitPrice();

  console.log("Starting Rig Verification for:", rigAddress);
  console.log("  Unit:", unitAddress);
  console.log("  Quote:", quoteAddress);
  console.log("  Treasury:", treasury);
  console.log("  Team:", team);
  console.log("  Core:", coreAddress);
  console.log("  URI:", uri);
  console.log("  Initial UPS:", initialUps.toString());
  console.log("  Tail UPS:", tailUps.toString());
  console.log("  Halving Period:", halvingPeriod.toString());
  console.log("  Epoch Period:", epochPeriod.toString());
  console.log("  Price Multiplier:", priceMultiplier.toString());
  console.log("  Min Init Price:", minInitPrice.toString());

  await hre.run("verify:verify", {
    address: rigAddress,
    contract: "contracts/Rig.sol:Rig",
    constructorArguments: [
      unitAddress,
      quoteAddress,
      treasury,
      team,
      coreAddress,
      uri,
      initialUps,
      tailUps,
      halvingPeriod,
      epochPeriod,
      priceMultiplier,
      minInitPrice,
    ],
  });
  console.log("Rig Verified:", rigAddress);
}

async function verifyAuctionByRigIndex(rigIndex) {
  const rigAddress = await core.deployedRigs(rigIndex);
  const auctionAddress = await core.rigToAuction(rigAddress);
  const auction = await ethers.getContractAt(
    "contracts/Auction.sol:Auction",
    auctionAddress
  );

  // Read constructor args from the deployed contract
  const paymentToken = await auction.paymentToken();
  const paymentReceiver = await auction.paymentReceiver();
  const epochPeriod = await auction.epochPeriod();
  const priceMultiplier = await auction.priceMultiplier();
  const minInitPrice = await auction.minInitPrice();

  // Read current initPrice - this equals the constructor arg if epochId is still 0
  // If someone has already bought, you may need to pass the original initPrice manually
  const epochId = await auction.epochId();
  const currentInitPrice = await auction.initPrice();
  const initPrice = epochId.eq(0) ? currentInitPrice : minInitPrice;

  if (!epochId.eq(0)) {
    console.log(
      "  WARNING: Auction has been used (epochId > 0). Using minInitPrice as initPrice."
    );
    console.log(
      "  If verification fails, you may need to find the original auctionInitPrice from launch event."
    );
  }

  console.log("Starting Auction Verification for:", auctionAddress);
  console.log("  Init Price:", initPrice.toString());
  console.log("  Payment Token:", paymentToken);
  console.log("  Payment Receiver:", paymentReceiver);
  console.log("  Epoch Period:", epochPeriod.toString());
  console.log("  Price Multiplier:", priceMultiplier.toString());
  console.log("  Min Init Price:", minInitPrice.toString());

  await hre.run("verify:verify", {
    address: auctionAddress,
    contract: "contracts/Auction.sol:Auction",
    constructorArguments: [
      initPrice,
      paymentToken,
      paymentReceiver,
      epochPeriod,
      priceMultiplier,
      minInitPrice,
    ],
  });
  console.log("Auction Verified:", auctionAddress);
}

// =============================================================================
// CONFIGURATION FUNCTIONS
// =============================================================================

async function setProtocolFeeAddress(newAddress) {
  console.log("Setting Protocol Fee Address to:", newAddress);
  const tx = await core.setProtocolFeeAddress(newAddress);
  await tx.wait();
  console.log("Protocol Fee Address updated");
}

async function setMinDonutForLaunch(amount) {
  console.log("Setting Min DONUT for Launch to:", divDec(amount));
  const tx = await core.setMinDonutForLaunch(amount);
  await tx.wait();
  console.log("Min DONUT updated");
}

async function transferCoreOwnership(newOwner) {
  console.log("Transferring Core ownership to:", newOwner);
  const tx = await core.transferOwnership(newOwner);
  await tx.wait();
  console.log("Core ownership transferred");
}

// =============================================================================
// PRINT FUNCTIONS
// =============================================================================

async function printDeployment() {
  console.log("\n==================== DEPLOYMENT ====================\n");

  console.log("--- Configuration ---");
  console.log("WETH:                ", WETH_ADDRESS);
  console.log("DONUT:               ", DONUT_ADDRESS || "NOT SET");
  console.log("Uniswap V2 Factory:  ", UNISWAP_V2_FACTORY);
  console.log("Uniswap V2 Router:   ", UNISWAP_V2_ROUTER);
  console.log("Protocol Fee Address:", PROTOCOL_FEE_ADDRESS || "NOT SET");
  console.log("Min DONUT for Launch:", divDec(MIN_DONUT_FOR_LAUNCH));

  console.log("\n--- Deployed Contracts ---");
  console.log(
    "UnitFactory:         ",
    unitFactory?.address || UNIT_FACTORY || "NOT DEPLOYED"
  );
  console.log(
    "RigFactory:          ",
    rigFactory?.address || RIG_FACTORY || "NOT DEPLOYED"
  );
  console.log(
    "AuctionFactory:      ",
    auctionFactory?.address || AUCTION_FACTORY || "NOT DEPLOYED"
  );
  console.log("Core:                ", core?.address || CORE || "NOT DEPLOYED");
  console.log(
    "Multicall:           ",
    multicall?.address || MULTICALL || "NOT DEPLOYED"
  );

  if (core) {
    console.log("\n--- Core State ---");
    console.log("Owner:               ", await core.owner());
    console.log("Protocol Fee Address:", await core.protocolFeeAddress());
    console.log(
      "Min DONUT:           ",
      divDec(await core.minDonutForLaunch())
    );
    console.log(
      "Deployed Rigs:       ",
      (await core.deployedRigsLength()).toString()
    );
  }

  console.log("\n====================================================\n");
}

async function printCoreState() {
  console.log("\n--- Core State ---");
  console.log("Owner:               ", await core.owner());
  console.log("Protocol Fee Address:", await core.protocolFeeAddress());
  console.log("WETH:                ", await core.weth());
  console.log("DONUT:               ", await core.donutToken());
  console.log("Min DONUT:           ", divDec(await core.minDonutForLaunch()));
  console.log("Unit Factory:        ", await core.unitFactory());
  console.log("Rig Factory:         ", await core.rigFactory());
  console.log("Auction Factory:     ", await core.auctionFactory());
  console.log(
    "Deployed Rigs:       ",
    (await core.deployedRigsLength()).toString()
  );
  console.log("");
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const [wallet] = await ethers.getSigners();
  console.log("Using wallet:", wallet.address);
  console.log(
    "Account balance:",
    ethers.utils.formatEther(await wallet.getBalance()),
    "ETH"
  );
  console.log("");

  await getContracts();

  //===================================================================
  // 1. Deploy System
  //===================================================================

  // console.log("Starting Deployment...");
  // await deployUnitFactory();
  // await deployRigFactory();
  // await deployAuctionFactory();
  // await deployCore();
  // await deployMulticall();

  //===================================================================
  // 2. Verify Contracts
  //===================================================================

  // console.log("Starting Verification...");
  // await verifyUnitFactory();
  // await sleep(5000);
  // await verifyRigFactory();
  // await sleep(5000);
  // await verifyAuctionFactory();
  // await sleep(5000);
  // await verifyCore();
  // await sleep(5000);
  // await verifyMulticall();

  // Get Unit verification info for manual verification
  // await getUnitVerificationInfo(0);

  // await verifyUnitByRigIndex(0);
  // await sleep(5000);
  // await verifyRigByIndex(0);
  // await sleep(5000);
  // await verifyAuctionByRigIndex(0);
  // await sleep(5000);

  //===================================================================
  // 3. Configuration (optional)
  //===================================================================

  // await setProtocolFeeAddress(PROTOCOL_FEE_ADDRESS);
  // console.log("Protocol Fee Address updated");

  // await setMinDonutForLaunch(MIN_DONUT_FOR_LAUNCH);
  // console.log("Min DONUT for Launch updated");

  //===================================================================
  // 4. Transfer Ownership (optional)
  //===================================================================

  // await transferCoreOwnership(MULTISIG_ADDRESS);
  // console.log("Core ownership transferred to:", MULTISIG_ADDRESS);

  //===================================================================
  // Print Deployment
  //===================================================================

  await printDeployment();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
