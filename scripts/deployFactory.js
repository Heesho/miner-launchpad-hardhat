const { ethers } = require("hardhat");
const hre = require("hardhat");
const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
const convert = (amount, decimals) => ethers.utils.parseUnits(amount, decimals);

/*===================================================================*/
/*===========================  SETTINGS  ============================*/

// Base Mainnet addresses
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const DONUT_ADDRESS = "0x0000000000000000000000000000000000000000"; // TODO: Set actual DONUT address
const UNISWAP_V2_FACTORY = "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6";
const UNISWAP_V2_ROUTER = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24";

// Protocol settings
const PROTOCOL_FEE_ADDRESS = "0x0000000000000000000000000000000000000000"; // TODO: Set protocol fee recipient
const MIN_DONUT_FOR_LAUNCH = convert("100", 18); // 100 DONUT minimum
const INITIAL_UNIT_MINT_AMOUNT = convert("1000000", 18); // 1M UNIT tokens for LP

/*===========================  END SETTINGS  ========================*/
/*===================================================================*/

let rigFactory, auctionFactory, core, multicall;

async function deployRigFactory() {
  console.log("Starting RigFactory Deployment");
  const artifact = await ethers.getContractFactory("RigFactory");
  const contract = await artifact.deploy({
    gasPrice: ethers.gasPrice,
  });
  rigFactory = await contract.deployed();
  await sleep(5000);
  console.log("RigFactory Deployed at:", rigFactory.address);
}

async function deployAuctionFactory() {
  console.log("Starting AuctionFactory Deployment");
  const artifact = await ethers.getContractFactory("AuctionFactory");
  const contract = await artifact.deploy({
    gasPrice: ethers.gasPrice,
  });
  auctionFactory = await contract.deployed();
  await sleep(5000);
  console.log("AuctionFactory Deployed at:", auctionFactory.address);
}

async function deployCore() {
  console.log("Starting Core Deployment");
  const coreArtifact = await ethers.getContractFactory("Core");
  const coreContract = await coreArtifact.deploy(
    PROTOCOL_FEE_ADDRESS,
    DONUT_ADDRESS,
    UNISWAP_V2_FACTORY,
    UNISWAP_V2_ROUTER,
    WETH_ADDRESS,
    MIN_DONUT_FOR_LAUNCH,
    INITIAL_UNIT_MINT_AMOUNT,
    rigFactory.address,
    auctionFactory.address,
    {
      gasPrice: ethers.gasPrice,
    }
  );
  core = await coreContract.deployed();
  await sleep(5000);
  console.log("Core Deployed at:", core.address);
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
      rigFactory.address,
      auctionFactory.address,
    ],
  });
  console.log("Core Verified");
}

async function deployMulticall() {
  console.log("Starting Multicall Deployment");
  const multicallArtifact = await ethers.getContractFactory("Multicall");
  const multicallContract = await multicallArtifact.deploy(
    core.address,
    WETH_ADDRESS,
    {
      gasPrice: ethers.gasPrice,
    }
  );
  multicall = await multicallContract.deployed();
  await sleep(5000);
  console.log("Multicall Deployed at:", multicall.address);
}

async function verifyMulticall() {
  console.log("Starting Multicall Verification");
  await hre.run("verify:verify", {
    address: multicall.address,
    contract: "contracts/Multicall.sol:Multicall",
    constructorArguments: [core.address, WETH_ADDRESS],
  });
  console.log("Multicall Verified");
}

async function printDeployment() {
  console.log("**************************************************************");
  console.log("RigFactory: ", rigFactory.address);
  console.log("AuctionFactory: ", auctionFactory.address);
  console.log("Core: ", core.address);
  console.log("Multicall: ", multicall.address);
  console.log("**************************************************************");
}

async function main() {
  const [wallet] = await ethers.getSigners();
  console.log("Using wallet: ", wallet.address);

  //===================================================================
  // Deploy System
  //===================================================================

  console.log("Starting System Deployment");
  await deployRigFactory();
  await deployAuctionFactory();
  await deployCore();
  await deployMulticall();
  await printDeployment();

  /*********** UPDATE addresses above after deployment *************/

  //===================================================================
  // Verify System
  //===================================================================

  // console.log("Starting System Verification");
  // await verifyRigFactory();
  // await sleep(5000);
  // await verifyAuctionFactory();
  // await sleep(5000);
  // await verifyCore();
  // await sleep(5000);
  // await verifyMulticall();
  // await sleep(5000);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
