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
const PROTOCOL_FEE_ADDRESS = "0x7a8C895E7826F66e1094532cB435Da725dc3868f"; // TODO: Set protocol fee recipient
const MIN_DONUT_FOR_LAUNCH = convert("1", 18); // 1 DONUT minimum
const INITIAL_UNIT_MINT_AMOUNT = convert("100", 18); // 100 UNIT tokens for LP

// Deployed Contract Addresses (paste after deployment)
const UNIT_FACTORY = "0xa99c32Dc734e0CE1E2D8a2ceb566a9690C0c4850";
const RIG_FACTORY = "0xf98943B18a2Ec71A2d771119bC09A8366171f4BF";
const AUCTION_FACTORY = "0x41740931b0E131d15A400B62DB57F3Cd39D3B8F3";
const CORE = "0xe5BEd743C9B74537861eBD555e282b023c1d6069";
const MULTICALL = "0x21d30a9Fa2Eef611Dc42333C61c47018325531B1";

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
    PROTOCOL_FEE_ADDRESS,
    DONUT_ADDRESS,
    UNISWAP_V2_FACTORY,
    UNISWAP_V2_ROUTER,
    WETH_ADDRESS,
    MIN_DONUT_FOR_LAUNCH,
    INITIAL_UNIT_MINT_AMOUNT,
    unitFactory.address,
    rigFactory.address,
    auctionFactory.address,
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
    address: unitFactory.address,
    contract: "contracts/UnitFactory.sol:UnitFactory",
    constructorArguments: [],
  });
  console.log("UnitFactory Verified");
}

async function verifyRigFactory() {
  console.log("Starting RigFactory Verification");
  await hre.run("verify:verify", {
    address: rigFactory.address,
    contract: "contracts/RigFactory.sol:RigFactory",
    constructorArguments: [],
  });
  console.log("RigFactory Verified");
}

async function verifyAuctionFactory() {
  console.log("Starting AuctionFactory Verification");
  await hre.run("verify:verify", {
    address: auctionFactory.address,
    contract: "contracts/AuctionFactory.sol:AuctionFactory",
    constructorArguments: [],
  });
  console.log("AuctionFactory Verified");
}

async function verifyCore() {
  console.log("Starting Core Verification");
  await hre.run("verify:verify", {
    address: core.address,
    contract: "contracts/Core.sol:Core",
    constructorArguments: [
      PROTOCOL_FEE_ADDRESS,
      DONUT_ADDRESS,
      UNISWAP_V2_FACTORY,
      UNISWAP_V2_ROUTER,
      WETH_ADDRESS,
      MIN_DONUT_FOR_LAUNCH,
      INITIAL_UNIT_MINT_AMOUNT,
      unitFactory.address,
      rigFactory.address,
      auctionFactory.address,
    ],
  });
  console.log("Core Verified");
}

async function verifyMulticall() {
  console.log("Starting Multicall Verification");
  await hre.run("verify:verify", {
    address: multicall.address,
    contract: "contracts/Multicall.sol:Multicall",
    constructorArguments: [core.address, WETH_ADDRESS, DONUT_ADDRESS],
  });
  console.log("Multicall Verified");
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

async function setInitialUnitMintAmount(amount) {
  console.log("Setting Initial Unit Mint Amount to:", divDec(amount));
  const tx = await core.setInitialUnitMintAmount(amount);
  await tx.wait();
  console.log("Initial Unit Mint Amount updated");
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
  console.log("Initial Unit Mint:   ", divDec(INITIAL_UNIT_MINT_AMOUNT));

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
      "Initial Mint Amount: ",
      divDec(await core.initialUnitMintAmount())
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
  console.log("DONUT:               ", await core.donutToken());
  console.log("WETH:                ", await core.weth());
  console.log("Min DONUT:           ", divDec(await core.minDonutForLaunch()));
  console.log(
    "Initial Mint Amount: ",
    divDec(await core.initialUnitMintAmount())
  );
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

  //===================================================================
  // 3. Configuration (optional)
  //===================================================================

  // await setProtocolFeeAddress("0xNEW_ADDRESS");
  // await setMinDonutForLaunch(convert("500", 18));
  // await setInitialUnitMintAmount(convert("2000000", 18));

  //===================================================================
  // 4. Transfer Ownership (optional)
  //===================================================================

  // await transferCoreOwnership("0xMULTISIG_ADDRESS");

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
