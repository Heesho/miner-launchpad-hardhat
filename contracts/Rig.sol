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
    uint256 public constant TREASURY_FEE = 1_500; // 15% to treasury
    uint256 public constant TEAM_FEE = 400; // 4% to team
    uint256 public constant PROTOCOL_FEE = 100; // 1% to protocol
    uint256 public constant DIVISOR = 10_000; // fee divisor (basis points)
    uint256 public constant PRECISION = 1e18; // precision for multiplier calcs
    uint256 public constant ABS_MAX_INIT_PRICE = type(uint256).max;
    uint256 public constant ABS_MIN_INIT_PRICE = 1e6; // absolute minimum init price

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

    uint256 public epochId; // current epoch counter
    uint256 public initPrice; // starting price for current epoch
    uint256 public epochStartTime; // timestamp when current epoch began
    uint256 public ups; // current units per second rate

    address public miner; // address receiving minted tokens
    address public treasury; // treasury fee recipient
    address public team; // team fee recipient

    string public uri; // metadata URI set by current miner
    string public unitUri; // metadata URI for the unit token (set by owner)

    /*----------  ERRORS  -----------------------------------------------*/

    error Rig__InvalidMiner();
    error Rig__Expired();
    error Rig__EpochIdMismatch();
    error Rig__MaxPriceExceeded();
    error Rig__InvalidTreasury();
    error Rig__MinInitPriceBelowAbsoluteMin();

    /*----------  EVENTS  -----------------------------------------------*/

    event Rig__Mined(address indexed sender, address indexed miner, uint256 price, string uri);
    event Rig__Minted(address indexed miner, uint256 amount);
    event Rig__PreviousMinerFee(address indexed miner, uint256 amount);
    event Rig__TreasuryFee(address indexed treasury, uint256 amount);
    event Rig__TeamFee(address indexed team, uint256 amount);
    event Rig__ProtocolFee(address indexed protocol, uint256 amount);
    event Rig__TreasurySet(address indexed treasury);
    event Rig__TeamSet(address indexed team);
    event Rig__UnitUriSet(string uri);

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploys a new Rig contract.
     * @param _unit Unit token address (deployed separately by Core)
     * @param _quote Payment token address (e.g., WETH)
     * @param _treasury Initial treasury address for fee collection
     * @param _team Team address for fee collection
     * @param _core Core contract address for protocol fee lookups
     * @param _unitUri Metadata URI for the unit token
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
        string memory _unitUri,
        uint256 _initialUps,
        uint256 _tailUps,
        uint256 _halvingPeriod,
        uint256 _epochPeriod,
        uint256 _priceMultiplier,
        uint256 _minInitPrice
    ) {
        if (_treasury == address(0)) revert Rig__InvalidTreasury();
        if (_minInitPrice < ABS_MIN_INIT_PRICE) revert Rig__MinInitPriceBelowAbsoluteMin();

        unit = _unit;
        quote = _quote;
        treasury = _treasury;
        team = _team;
        core = _core;
        unitUri = _unitUri;
        startTime = block.timestamp;

        initialUps = _initialUps;
        tailUps = _tailUps;
        halvingPeriod = _halvingPeriod;
        epochPeriod = _epochPeriod;
        priceMultiplier = _priceMultiplier;
        minInitPrice = _minInitPrice;

        initPrice = _minInitPrice;
        epochStartTime = block.timestamp;
        miner = _team;
        ups = _initialUps;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Mine the rig by paying the current Dutch auction price.
     * @dev Transfers payment to fee recipients, mints Unit tokens to previous holder,
     *      and sets the caller as the new miner.
     * @param _miner Address to set as new miner (receives future minted tokens)
     * @param _epochId Expected epoch ID (reverts if mismatched for frontrun protection)
     * @param deadline Transaction deadline timestamp
     * @param maxPrice Maximum price willing to pay (slippage protection)
     * @param _uri Metadata URI for this mining action
     * @return price Actual price paid
     */
    function mine(address _miner, uint256 _epochId, uint256 deadline, uint256 maxPrice, string memory _uri)
        external
        nonReentrant
        returns (uint256 price)
    {
        if (_miner == address(0)) revert Rig__InvalidMiner();
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

            // Previous miner always gets paid
            IERC20(quote).safeTransferFrom(msg.sender, miner, previousMinerAmount);
            emit Rig__PreviousMinerFee(miner, previousMinerAmount);

            // Treasury gets base fee + any unclaimed team/protocol fees
            IERC20(quote).safeTransferFrom(msg.sender, treasury, treasuryAmount);
            emit Rig__TreasuryFee(treasury, treasuryAmount);

            // Team fee only if team address is set
            if (teamAmount > 0) {
                IERC20(quote).safeTransferFrom(msg.sender, team, teamAmount);
                emit Rig__TeamFee(team, teamAmount);
            }

            // Protocol fee only if protocol address is set
            if (protocolAmount > 0) {
                IERC20(quote).safeTransferFrom(msg.sender, protocolFeeAddr, protocolAmount);
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
        uint256 minedAmount = mineTime * ups;

        IUnit(unit).mint(miner, minedAmount);
        emit Rig__Minted(miner, minedAmount);

        // Update state for new epoch
        unchecked {
            epochId++;
        }
        initPrice = newInitPrice;
        epochStartTime = block.timestamp;
        miner = _miner;
        ups = _getUpsFromTime(block.timestamp);
        uri = _uri;

        emit Rig__Mined(msg.sender, _miner, price, _uri);

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
     * @notice Update the unit metadata URI.
     * @dev Used to set metadata like the unit logo image.
     * @param _unitUri New metadata URI
     */
    function setUnitUri(string memory _unitUri) external onlyOwner {
        unitUri = _unitUri;
        emit Rig__UnitUriSet(_unitUri);
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get the current Dutch auction price.
     * @return Current price (linearly decays from initPrice to 0 over epochPeriod)
     */
    function getPrice() public view returns (uint256) {
        uint256 timePassed = block.timestamp - epochStartTime;
        if (timePassed > epochPeriod) return 0;
        return initPrice - initPrice * timePassed / epochPeriod;
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
    function _getUpsFromTime(uint256 time) internal view returns (uint256 _ups) {
        uint256 halvings = time <= startTime ? 0 : (time - startTime) / halvingPeriod;
        _ups = initialUps >> halvings;
        if (_ups < tailUps) _ups = tailUps;
        return _ups;
    }

    function getEpochId() external view returns (uint256) {
        return epochId;
    }

    function getInitPrice() external view returns (uint256) {
        return initPrice;
    }

    function getEpochStartTime() external view returns (uint256) {
        return epochStartTime;
    }

    function getMiner() external view returns (address) {
        return miner;
    }

    function getUri() external view returns (string memory) {
        return uri;
    }

    function getUnitUri() external view returns (string memory) {
        return unitUri;
    }
}
