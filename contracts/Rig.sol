// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IUnit} from "./interfaces/IUnit.sol";
import {ICore} from "./interfaces/ICore.sol";

/**
 * @title Rig
 * @author heesho
 * @notice A mining rig contract that implements a Dutch auction mechanism for mining Unit tokens.
 *         Users compete to become the current rig owner by paying a decaying price. The previous
 *         rig owner receives minted Unit tokens proportional to their holding time, plus a share
 *         of the payment from the next miner.
 * @dev Implements a halving schedule for the emission rate (UPS - units per second).
 */
contract Rig is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /*----------  CONSTANTS  --------------------------------------------*/

    uint256 public constant PREVIOUS_MINER_FEE = 8_000; // 80% to previous miner
    uint256 public constant TEAM_FEE = 400; // 4% to team
    uint256 public constant PROTOCOL_FEE = 100; // 1% to protocol
    uint256 public constant DIVISOR = 10_000; // fee divisor (basis points)
    uint256 public constant PRECISION = 1e18; // precision for multiplier calcs

    // Launch parameter bounds
    uint256 public constant MIN_EPOCH_PERIOD = 10 minutes;
    uint256 public constant MAX_EPOCH_PERIOD = 365 days;
    uint256 public constant MIN_PRICE_MULTIPLIER = 1.1e18; // Should at least be 110% of settlement price
    uint256 public constant MAX_PRICE_MULTIPLIER = 3e18; // Should not exceed 300% of settlement price
    uint256 public constant ABS_MIN_INIT_PRICE = 1e6; // Minimum sane value for init price
    uint256 public constant ABS_MAX_INIT_PRICE = type(uint192).max; // chosen so that epochInitPrice * priceMultiplier does not exceed uint256
    uint256 public constant MAX_INITIAL_UPS = 1e24; // 1 million tokens/second max to prevent overflow in minedAmount calculation
    uint256 public constant MIN_HALVING_PERIOD = 1 days; // Minimum halving period to prevent degenerate tokenomics

    /*----------  IMMUTABLES  -------------------------------------------*/

    uint256 public immutable initialUps; // starting units per second
    uint256 public immutable tailUps; // minimum units per second after halvings
    uint256 public immutable halvingPeriod; // time between emission halvings
    uint256 public immutable epochPeriod; // duration of each Dutch auction
    uint256 public immutable priceMultiplier; // multiplier for next epoch's starting price
    uint256 public immutable minInitPrice; // minimum starting price per epoch
    uint256 public immutable startTime; // contract deployment timestamp

    address public immutable unit; // Unit token address
    address public immutable quote; // payment token (e.g., WETH)
    address public immutable core; // Core contract address

    /*----------  STATE  ------------------------------------------------*/

    uint256 public epochId; // current epoch id
    uint256 public epochInitPrice; // current epoch starting price
    uint256 public epochStartTime; // current epoch start timestamp
    uint256 public epochUps; // current epoch units per second

    address public epochMiner; // current epoch miner
    address public treasury; // treasury address
    address public team; // team address

    string public epochUri; // current epoch miner uri
    string public uri; // rig uri

    /*----------  ERRORS  -----------------------------------------------*/

    error Rig__InvalidMiner();
    error Rig__Expired();
    error Rig__EpochIdMismatch();
    error Rig__MaxPriceExceeded();
    error Rig__InvalidUnit();
    error Rig__InvalidQuote();
    error Rig__InvalidTreasury();
    error Rig__InvalidTeam();
    error Rig__InvalidCore();
    error Rig__MinInitPriceBelowAbsoluteMin();
    error Rig__MinInitPriceAboveAbsoluteMax();
    error Rig__EpochPeriodOutOfRange();
    error Rig__PriceMultiplierOutOfRange();
    error Rig__InvalidInitialUps();
    error Rig__InitialUpsExceedsMax();
    error Rig__InvalidTailUps();
    error Rig__InvalidHalvingPeriod();
    error Rig__HalvingPeriodBelowMin();

    /*----------  EVENTS  -----------------------------------------------*/

    event Rig__Mined(address indexed sender, address indexed miner, uint256 price, string uri);
    event Rig__Minted(address indexed miner, uint256 amount);
    event Rig__PreviousMinerFee(address indexed miner, uint256 amount);
    event Rig__TreasuryFee(address indexed treasury, uint256 amount);
    event Rig__TeamFee(address indexed team, uint256 amount);
    event Rig__ProtocolFee(address indexed protocol, uint256 amount);
    event Rig__TreasurySet(address indexed treasury);
    event Rig__TeamSet(address indexed team);
    event Rig__UriSet(string uri);

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploys a new Rig contract.
     * @param _unit Unit token address (deployed separately by Core)
     * @param _quote Payment token address (e.g., WETH)
     * @param _treasury Initial treasury address for fee collection
     * @param _team Team address for fee collection
     * @param _core Core contract address for protocol fee lookups
     * @param _uri Metadata URI for the rig
     * @param _initialUps Starting units per second emission rate
     * @param _tailUps Minimum units per second after halvings
     * @param _halvingPeriod Time between emission halvings
     * @param _epochPeriod Duration of each Dutch auction epoch
     * @param _priceMultiplier Multiplier for next epoch's starting price
     * @param _minInitPrice Minimum starting price per epoch
     */
    constructor(
        address _unit,
        address _quote,
        address _treasury,
        address _team,
        address _core,
        string memory _uri,
        uint256 _initialUps,
        uint256 _tailUps,
        uint256 _halvingPeriod,
        uint256 _epochPeriod,
        uint256 _priceMultiplier,
        uint256 _minInitPrice
    ) {
        if (_unit == address(0)) revert Rig__InvalidUnit();
        if (_quote == address(0)) revert Rig__InvalidQuote();
        if (_treasury == address(0)) revert Rig__InvalidTreasury();
        if (_team == address(0)) revert Rig__InvalidTeam();
        if (_core == address(0)) revert Rig__InvalidCore();
        if (_initialUps == 0) revert Rig__InvalidInitialUps();
        if (_initialUps > MAX_INITIAL_UPS) revert Rig__InitialUpsExceedsMax();
        if (_tailUps == 0 || _tailUps > _initialUps) revert Rig__InvalidTailUps();
        if (_halvingPeriod == 0) revert Rig__InvalidHalvingPeriod();
        if (_halvingPeriod < MIN_HALVING_PERIOD) revert Rig__HalvingPeriodBelowMin();
        if (_minInitPrice < ABS_MIN_INIT_PRICE) revert Rig__MinInitPriceBelowAbsoluteMin();
        if (_minInitPrice > ABS_MAX_INIT_PRICE) revert Rig__MinInitPriceAboveAbsoluteMax();
        if (_epochPeriod < MIN_EPOCH_PERIOD || _epochPeriod > MAX_EPOCH_PERIOD) revert Rig__EpochPeriodOutOfRange();
        if (_priceMultiplier < MIN_PRICE_MULTIPLIER || _priceMultiplier > MAX_PRICE_MULTIPLIER) {
            revert Rig__PriceMultiplierOutOfRange();
        }

        unit = _unit;
        quote = _quote;
        treasury = _treasury;
        team = _team;
        core = _core;
        uri = _uri;
        startTime = block.timestamp;

        initialUps = _initialUps;
        tailUps = _tailUps;
        halvingPeriod = _halvingPeriod;
        epochPeriod = _epochPeriod;
        priceMultiplier = _priceMultiplier;
        minInitPrice = _minInitPrice;

        epochInitPrice = _minInitPrice;
        epochStartTime = block.timestamp;
        epochMiner = _team;
        epochUps = _initialUps;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Mine the rig by paying the current Dutch auction price.
     * @dev Transfers payment to fee recipients, mints Unit tokens to previous holder,
     *      and sets the caller as the new miner.
     * @param miner Address to set as new miner (receives future minted tokens)
     * @param _epochId Expected epoch ID (reverts if mismatched for frontrun protection)
     * @param deadline Transaction deadline timestamp
     * @param maxPrice Maximum price willing to pay (slippage protection)
     * @param _epochUri Metadata URI for this mining action
     * @return price Actual price paid
     */
    function mine(address miner, uint256 _epochId, uint256 deadline, uint256 maxPrice, string calldata _epochUri)
        external
        nonReentrant
        returns (uint256 price)
    {
        if (miner == address(0)) revert Rig__InvalidMiner();
        if (block.timestamp > deadline) revert Rig__Expired();
        if (_epochId != epochId) revert Rig__EpochIdMismatch();

        price = getPrice();
        if (price > maxPrice) revert Rig__MaxPriceExceeded();

        // Distribute payment to fee recipients
        if (price > 0) {
            address protocolFeeAddr = ICore(core).protocolFeeAddress();

            // Calculate fees - team and protocol fees go to treasury if their addresses are zero
            uint256 previousMinerAmount = price * PREVIOUS_MINER_FEE / DIVISOR;
            uint256 teamAmount = team != address(0) ? price * TEAM_FEE / DIVISOR : 0;
            uint256 protocolAmount = protocolFeeAddr != address(0) ? price * PROTOCOL_FEE / DIVISOR : 0;
            uint256 treasuryAmount = price - previousMinerAmount - teamAmount - protocolAmount;

            // Pull payment once, then distribute
            IERC20(quote).safeTransferFrom(msg.sender, address(this), price);

            // Previous miner always gets paid
            IERC20(quote).safeTransfer(epochMiner, previousMinerAmount);
            emit Rig__PreviousMinerFee(epochMiner, previousMinerAmount);

            // Treasury gets base fee + any unclaimed team/protocol fees
            IERC20(quote).safeTransfer(treasury, treasuryAmount);
            emit Rig__TreasuryFee(treasury, treasuryAmount);

            // Team fee only if team address is set
            if (teamAmount > 0) {
                IERC20(quote).safeTransfer(team, teamAmount);
                emit Rig__TeamFee(team, teamAmount);
            }

            // Protocol fee only if protocol address is set
            if (protocolAmount > 0) {
                IERC20(quote).safeTransfer(protocolFeeAddr, protocolAmount);
                emit Rig__ProtocolFee(protocolFeeAddr, protocolAmount);
            }
        }

        // Calculate next epoch's starting price
        uint256 newInitPrice = price * priceMultiplier / PRECISION;
        if (newInitPrice > ABS_MAX_INIT_PRICE) {
            newInitPrice = ABS_MAX_INIT_PRICE;
        } else if (newInitPrice < minInitPrice) {
            newInitPrice = minInitPrice;
        }

        // Mint tokens to previous rig holder based on holding time
        uint256 mineTime = block.timestamp - epochStartTime;
        uint256 minedAmount = mineTime * epochUps;

        IUnit(unit).mint(epochMiner, minedAmount);
        emit Rig__Minted(epochMiner, minedAmount);

        // Update state for new epoch
        unchecked {
            epochId++;
        }
        epochInitPrice = newInitPrice;
        epochStartTime = block.timestamp;
        epochMiner = miner;
        epochUps = _getUpsFromTime(block.timestamp);
        epochUri = _epochUri;

        emit Rig__Mined(msg.sender, miner, price, _epochUri);

        return price;
    }

    /*----------  RESTRICTED FUNCTIONS  ---------------------------------*/

    /**
     * @notice Update the treasury address for fee collection.
     * @param _treasury New treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert Rig__InvalidTreasury();
        treasury = _treasury;
        emit Rig__TreasurySet(_treasury);
    }

    /**
     * @notice Update the team address for fee collection.
     * @dev Can be set to address(0) to disable team fees (redirects to treasury).
     * @param _team New team address
     */
    function setTeam(address _team) external onlyOwner {
        team = _team;
        emit Rig__TeamSet(_team);
    }

    /**
     * @notice Update the metadata URI.
     * @dev Used to set metadata like the unit logo image.
     * @param _uri New metadata URI
     */
    function setUri(string calldata _uri) external onlyOwner {
        uri = _uri;
        emit Rig__UriSet(_uri);
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get the current Dutch auction price.
     * @return Current price (linearly decays from epochInitPrice to 0 over epochPeriod)
     */
    function getPrice() public view returns (uint256) {
        uint256 timePassed = block.timestamp - epochStartTime;
        if (timePassed > epochPeriod) return 0;
        return epochInitPrice - epochInitPrice * timePassed / epochPeriod;
    }

    /**
     * @notice Get the current units-per-second emission rate.
     * @return Current UPS after applying halvings
     */
    function getUps() external view returns (uint256) {
        return _getUpsFromTime(block.timestamp);
    }

    /**
     * @dev Calculate UPS at a given timestamp based on halving schedule.
     */
    function _getUpsFromTime(uint256 time) internal view returns (uint256 ups) {
        uint256 halvings = time <= startTime ? 0 : (time - startTime) / halvingPeriod;
        ups = initialUps >> halvings;
        if (ups < tailUps) ups = tailUps;
        return ups;
    }
}
