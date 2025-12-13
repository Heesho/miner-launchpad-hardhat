// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRig} from "./interfaces/IRig.sol";
import {IUnit} from "./interfaces/IUnit.sol";
import {IUnitFactory} from "./interfaces/IUnitFactory.sol";
import {IRigFactory} from "./interfaces/IRigFactory.sol";
import {IAuctionFactory} from "./interfaces/IAuctionFactory.sol";
import {IUniswapV2Factory, IUniswapV2Router} from "./interfaces/IUniswapV2.sol";

/**
 * @title Core
 * @notice The main launchpad contract for deploying new Rig and Auction pairs.
 *         Users provide DONUT tokens to launch a new mining rig. The Core contract:
 *         1. Deploys a new Unit token via UnitFactory
 *         2. Mints initial Unit tokens for liquidity
 *         3. Creates a Unit/DONUT liquidity pool on Uniswap V2
 *         4. Burns the initial LP tokens
 *         5. Deploys an Auction contract to collect and auction treasury fees
 *         6. Deploys a new Rig contract via RigFactory
 *         7. Transfers Unit minting rights to the Rig (permanently locked)
 *         8. Transfers ownership of the Rig to the launcher
 */
contract Core is Ownable {
    using SafeERC20 for IERC20;

    /*----------  CONSTANTS  --------------------------------------------*/

    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable donutToken; // token required to launch
    address public immutable uniswapV2Factory; // Uniswap V2 factory
    address public immutable uniswapV2Router; // Uniswap V2 router
    address public immutable weth; // wrapped ETH address
    address public immutable unitFactory; // factory for deploying Unit tokens
    address public immutable rigFactory; // factory for deploying Rigs
    address public immutable auctionFactory; // factory for deploying Auctions

    /*----------  STATE  ------------------------------------------------*/

    address public protocolFeeAddress; // receives protocol fees from rigs
    uint256 public minDonutForLaunch; // minimum DONUT required to launch
    uint256 public initialUnitMintAmount; // Unit tokens minted for initial LP

    address[] public deployedRigs; // array of all deployed rigs
    mapping(address => bool) public isDeployedRig; // rig => is valid
    mapping(address => address) public rigToLauncher; // rig => launcher address
    mapping(address => address) public rigToUnit; // rig => Unit token
    mapping(address => address) public rigToAuction; // rig => Auction contract
    mapping(address => address) public rigToLP; // rig => LP token

    /*----------  STRUCTS  ----------------------------------------------*/

    /**
     * @notice Parameters for launching a new Rig.
     */
    struct LaunchParams {
        address launcher; // address to receive Rig ownership
        string tokenName; // Unit token name
        string tokenSymbol; // Unit token symbol
        string unitUri; // metadata URI for the unit token
        uint256 donutAmount; // DONUT to provide for LP
        address teamAddress; // team fee recipient
        uint256 initialUps; // starting units per second
        uint256 tailUps; // minimum units per second
        uint256 halvingPeriod; // time between halvings
        uint256 rigEpochPeriod; // rig auction epoch duration
        uint256 rigPriceMultiplier; // rig price multiplier
        uint256 rigMinInitPrice; // rig minimum starting price
        uint256 auctionInitPrice; // auction starting price
        uint256 auctionEpochPeriod; // auction epoch duration
        uint256 auctionPriceMultiplier; // auction price multiplier
        uint256 auctionMinInitPrice; // auction minimum starting price
    }

    /*----------  ERRORS  -----------------------------------------------*/

    error Core__InvalidProtocolFeeAddress();
    error Core__InsufficientDonut();
    error Core__InvalidLauncher();
    error Core__InvalidTeamAddress();
    error Core__EmptyTokenName();
    error Core__EmptyTokenSymbol();
    error Core__InvalidInitialUps();
    error Core__InvalidTailUps();
    error Core__InvalidHalvingPeriod();
    error Core__InvalidInitialUnitMintAmount();

    /*----------  EVENTS  -----------------------------------------------*/

    event Core__Launched(
        address indexed launcher,
        address indexed rig,
        address indexed unit,
        address auction,
        address lpToken,
        string tokenName,
        string tokenSymbol
    );
    event Core__ProtocolFeeAddressSet(address indexed protocolFeeAddress);
    event Core__MinDonutForLaunchSet(uint256 minDonutForLaunch);
    event Core__InitialUnitMintAmountSet(uint256 initialUnitMintAmount);

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy the Core launchpad contract.
     * @param _protocolFeeAddress Address to receive protocol fees
     * @param _donutToken DONUT token address
     * @param _uniswapV2Factory Uniswap V2 factory address
     * @param _uniswapV2Router Uniswap V2 router address
     * @param _weth Wrapped ETH address
     * @param _minDonutForLaunch Minimum DONUT required to launch
     * @param _initialUnitMintAmount Unit tokens to mint for initial LP
     * @param _unitFactory UnitFactory contract address
     * @param _rigFactory RigFactory contract address
     * @param _auctionFactory AuctionFactory contract address
     */
    constructor(
        address _protocolFeeAddress,
        address _donutToken,
        address _uniswapV2Factory,
        address _uniswapV2Router,
        address _weth,
        uint256 _minDonutForLaunch,
        uint256 _initialUnitMintAmount,
        address _unitFactory,
        address _rigFactory,
        address _auctionFactory
    ) {
        if (_protocolFeeAddress == address(0)) revert Core__InvalidProtocolFeeAddress();
        if (_initialUnitMintAmount == 0) revert Core__InvalidInitialUnitMintAmount();

        protocolFeeAddress = _protocolFeeAddress;
        donutToken = _donutToken;
        uniswapV2Factory = _uniswapV2Factory;
        uniswapV2Router = _uniswapV2Router;
        weth = _weth;
        minDonutForLaunch = _minDonutForLaunch;
        initialUnitMintAmount = _initialUnitMintAmount;
        unitFactory = _unitFactory;
        rigFactory = _rigFactory;
        auctionFactory = _auctionFactory;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Launch a new Rig with associated Unit token, LP, and Auction.
     * @dev Caller must approve DONUT tokens before calling.
     * @param params Launch parameters struct
     * @return rig Address of deployed Rig contract
     * @return auction Address of deployed Auction contract
     * @return lpToken Address of Unit/DONUT LP token
     */
    function launch(LaunchParams calldata params) external returns (address rig, address auction, address lpToken) {
        // Validate inputs
        if (params.launcher == address(0)) revert Core__InvalidLauncher();
        if (params.donutAmount < minDonutForLaunch) revert Core__InsufficientDonut();
        if (params.teamAddress == address(0)) revert Core__InvalidTeamAddress();
        if (bytes(params.tokenName).length == 0) revert Core__EmptyTokenName();
        if (bytes(params.tokenSymbol).length == 0) revert Core__EmptyTokenSymbol();
        if (params.initialUps == 0) revert Core__InvalidInitialUps();
        if (params.tailUps == 0 || params.tailUps > params.initialUps) revert Core__InvalidTailUps();
        if (params.halvingPeriod == 0) revert Core__InvalidHalvingPeriod();

        // Transfer DONUT from launcher
        IERC20(donutToken).safeTransferFrom(msg.sender, address(this), params.donutAmount);

        // Deploy Unit token via factory (Core becomes initial rig/minter)
        address unitToken = IUnitFactory(unitFactory).deploy(params.tokenName, params.tokenSymbol);

        // Mint initial Unit tokens for LP seeding
        IUnit(unitToken).mint(address(this), initialUnitMintAmount);

        // Create Unit/DONUT LP via Uniswap V2
        IERC20(unitToken).approve(uniswapV2Router, initialUnitMintAmount);
        IERC20(donutToken).approve(uniswapV2Router, params.donutAmount);

        (,, uint256 liquidity) = IUniswapV2Router(uniswapV2Router).addLiquidity(
            unitToken,
            donutToken,
            initialUnitMintAmount,
            params.donutAmount,
            initialUnitMintAmount,
            params.donutAmount,
            address(this),
            block.timestamp + 1
        );

        // Get LP token address and burn initial liquidity
        lpToken = IUniswapV2Factory(uniswapV2Factory).getPair(unitToken, donutToken);
        IERC20(lpToken).safeTransfer(DEAD_ADDRESS, liquidity);

        // Deploy Auction with LP as payment token
        auction = IAuctionFactory(auctionFactory).deploy(
            params.auctionInitPrice,
            lpToken,
            DEAD_ADDRESS,
            params.auctionEpochPeriod,
            params.auctionPriceMultiplier,
            params.auctionMinInitPrice
        );

        // Deploy Rig via factory
        rig = IRigFactory(rigFactory).deploy(
            unitToken,
            weth,
            auction,
            params.teamAddress,
            address(this),
            params.unitUri,
            params.initialUps,
            params.tailUps,
            params.halvingPeriod,
            params.rigEpochPeriod,
            params.rigPriceMultiplier,
            params.rigMinInitPrice
        );

        // Transfer Unit minting rights to Rig (permanently locked since Rig has no setRig function)
        IUnit(unitToken).setRig(rig);

        // Transfer Rig ownership to launcher
        IRig(rig).transferOwnership(params.launcher);

        // Update registry
        deployedRigs.push(rig);
        isDeployedRig[rig] = true;
        rigToLauncher[rig] = params.launcher;
        rigToUnit[rig] = unitToken;
        rigToAuction[rig] = auction;
        rigToLP[rig] = lpToken;

        emit Core__Launched(params.launcher, rig, unitToken, auction, lpToken, params.tokenName, params.tokenSymbol);

        return (rig, auction, lpToken);
    }

    /*----------  RESTRICTED FUNCTIONS  ---------------------------------*/

    /**
     * @notice Update the protocol fee recipient address.
     * @param _protocolFeeAddress New protocol fee address
     */
    function setProtocolFeeAddress(address _protocolFeeAddress) external onlyOwner {
        if (_protocolFeeAddress == address(0)) revert Core__InvalidProtocolFeeAddress();
        protocolFeeAddress = _protocolFeeAddress;
        emit Core__ProtocolFeeAddressSet(_protocolFeeAddress);
    }

    /**
     * @notice Update the minimum DONUT required to launch.
     * @param _minDonutForLaunch New minimum amount
     */
    function setMinDonutForLaunch(uint256 _minDonutForLaunch) external onlyOwner {
        minDonutForLaunch = _minDonutForLaunch;
        emit Core__MinDonutForLaunchSet(_minDonutForLaunch);
    }

    /**
     * @notice Update the amount of Unit tokens minted for initial LP.
     * @param _initialUnitMintAmount New mint amount
     */
    function setInitialUnitMintAmount(uint256 _initialUnitMintAmount) external onlyOwner {
        if (_initialUnitMintAmount == 0) revert Core__InvalidInitialUnitMintAmount();
        initialUnitMintAmount = _initialUnitMintAmount;
        emit Core__InitialUnitMintAmountSet(_initialUnitMintAmount);
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get the total number of deployed rigs.
     * @return Number of rigs launched
     */
    function deployedRigsLength() external view returns (uint256) {
        return deployedRigs.length;
    }
}
