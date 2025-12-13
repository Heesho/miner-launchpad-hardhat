// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Rig} from "./Rig.sol";
import {Auction} from "./Auction.sol";
import {Core} from "./Core.sol";
import {ICore} from "./interfaces/ICore.sol";

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/**
 * @title Multicall
 * @notice Helper contract for batched operations and aggregated view functions.
 * @dev Provides ETH wrapping for mining and comprehensive state queries for Rigs and Auctions.
 */
contract Multicall {
    using SafeERC20 for IERC20;

    /*----------  IMMUTABLES  -------------------------------------------*/

    address public immutable core; // Core contract reference
    address public immutable weth; // wrapped ETH address
    address public immutable donut; // DONUT token address

    /*----------  STRUCTS  ----------------------------------------------*/

    /**
     * @notice Aggregated state for a Rig contract.
     */
    struct RigState {
        uint256 epochId; // current epoch
        uint256 initPrice; // epoch starting price
        uint256 epochStartTime; // epoch start timestamp
        uint256 glazed; // tokens earned so far this epoch
        uint256 price; // current Dutch auction price
        uint256 ups; // stored units per second
        uint256 nextUps; // calculated current ups
        uint256 unitPrice; // Unit token price in DONUT
        address miner; // current miner
        string uri; // metadata URI
        uint256 ethBalance; // user's ETH balance
        uint256 wethBalance; // user's WETH balance
        uint256 donutBalance; // user's DONUT balance
        uint256 unitBalance; // user's Unit balance
    }

    /**
     * @notice Aggregated state for an Auction contract.
     */
    struct AuctionState {
        uint256 epochId; // current epoch
        uint256 initPrice; // epoch starting price
        uint256 startTime; // epoch start timestamp
        address paymentToken; // LP token used for payment (Unit-DONUT LP)
        uint256 price; // current Dutch auction price (in LP tokens)
        uint256 paymentTokenPrice; // LP token price in DONUT
        uint256 wethAccumulated; // WETH held by auction (from treasury fees)
        uint256 wethBalance; // user's WETH balance
        uint256 donutBalance; // user's DONUT balance
        uint256 paymentTokenBalance; // user's LP balance
    }

    /*----------  CONSTRUCTOR  ------------------------------------------*/

    /**
     * @notice Deploy the Multicall helper contract.
     * @param _core Core contract address
     * @param _weth Wrapped ETH address
     * @param _donut DONUT token address
     */
    constructor(address _core, address _weth, address _donut) {
        core = _core;
        weth = _weth;
        donut = _donut;
    }

    /*----------  EXTERNAL FUNCTIONS  -----------------------------------*/

    /**
     * @notice Mine a rig using ETH (wraps to WETH automatically).
     * @dev Wraps sent ETH to WETH, approves the rig, and calls mine(). Refunds excess WETH.
     * @param rig Rig contract address
     * @param epochId Expected epoch ID
     * @param deadline Transaction deadline
     * @param maxPrice Maximum price willing to pay
     * @param uri Metadata URI for this mining action
     */
    function mine(address rig, uint256 epochId, uint256 deadline, uint256 maxPrice, string memory uri)
        external
        payable
    {
        IWETH(weth).deposit{value: msg.value}();
        IERC20(weth).safeApprove(rig, 0);
        IERC20(weth).safeApprove(rig, msg.value);
        Rig(rig).mine(msg.sender, epochId, deadline, maxPrice, uri);

        // Refund unused WETH
        uint256 wethBalance = IERC20(weth).balanceOf(address(this));
        if (wethBalance > 0) {
            IERC20(weth).safeTransfer(msg.sender, wethBalance);
        }
    }

    /**
     * @notice Buy from an auction using LP tokens.
     * @dev Transfers LP tokens from caller, approves auction, and executes buy.
     * @param rig Rig contract address (used to look up auction)
     * @param epochId Expected epoch ID
     * @param deadline Transaction deadline
     * @param maxPaymentTokenAmount Maximum LP tokens willing to pay
     */
    function buy(address rig, uint256 epochId, uint256 deadline, uint256 maxPaymentTokenAmount) external {
        address auction = ICore(core).rigToAuction(rig);
        address paymentToken = Auction(auction).paymentToken();
        uint256 price = Auction(auction).getPrice();
        address[] memory assets = new address[](1);
        assets[0] = weth;

        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), price);
        IERC20(paymentToken).safeApprove(auction, 0);
        IERC20(paymentToken).safeApprove(auction, price);
        Auction(auction).buy(assets, msg.sender, epochId, deadline, maxPaymentTokenAmount);
    }

    /**
     * @notice Launch a new rig via Core.
     * @dev Transfers DONUT from caller, approves Core, and calls launch with caller as launcher.
     * @param params Launch parameters (launcher field is overwritten with msg.sender)
     * @return rig Address of deployed Rig contract
     * @return auction Address of deployed Auction contract
     * @return lpToken Address of Unit/DONUT LP token
     */
    function launch(Core.LaunchParams calldata params)
        external
        returns (address rig, address auction, address lpToken)
    {
        // Transfer DONUT from user
        IERC20(donut).safeTransferFrom(msg.sender, address(this), params.donutAmount);
        IERC20(donut).safeApprove(core, 0);
        IERC20(donut).safeApprove(core, params.donutAmount);

        // Build params with msg.sender as launcher
        Core.LaunchParams memory launchParams = Core.LaunchParams({
            launcher: msg.sender,
            tokenName: params.tokenName,
            tokenSymbol: params.tokenSymbol,
            donutAmount: params.donutAmount,
            teamAddress: params.teamAddress,
            initialUps: params.initialUps,
            tailUps: params.tailUps,
            halvingPeriod: params.halvingPeriod,
            rigEpochPeriod: params.rigEpochPeriod,
            rigPriceMultiplier: params.rigPriceMultiplier,
            rigMinInitPrice: params.rigMinInitPrice,
            auctionInitPrice: params.auctionInitPrice,
            auctionEpochPeriod: params.auctionEpochPeriod,
            auctionPriceMultiplier: params.auctionPriceMultiplier,
            auctionMinInitPrice: params.auctionMinInitPrice
        });

        return Core(core).launch(launchParams);
    }

    /*----------  VIEW FUNCTIONS  ---------------------------------------*/

    /**
     * @notice Get aggregated state for a Rig and user balances.
     * @param rig Rig contract address
     * @param account User address (or address(0) to skip balance queries)
     * @return state Aggregated rig state
     */
    function getRig(address rig, address account) external view returns (RigState memory state) {
        state.epochId = Rig(rig).epochId();
        state.initPrice = Rig(rig).initPrice();
        state.epochStartTime = Rig(rig).epochStartTime();
        state.ups = Rig(rig).ups();
        state.glazed = state.ups * (block.timestamp - state.epochStartTime);
        state.price = Rig(rig).getPrice();
        state.nextUps = Rig(rig).getUps();
        state.miner = Rig(rig).miner();
        state.uri = Rig(rig).uri();

        address unitToken = Rig(rig).unit();
        address auction = ICore(core).rigToAuction(rig);

        // Calculate Unit price in DONUT from LP reserves
        if (auction != address(0)) {
            address lpToken = Auction(auction).paymentToken();
            uint256 donutInLP = IERC20(donut).balanceOf(lpToken);
            uint256 unitInLP = IERC20(unitToken).balanceOf(lpToken);
            state.unitPrice = unitInLP == 0 ? 0 : donutInLP * 1e18 / unitInLP;
        }

        // User balances
        state.ethBalance = account == address(0) ? 0 : account.balance;
        state.wethBalance = account == address(0) ? 0 : IERC20(weth).balanceOf(account);
        state.donutBalance = account == address(0) ? 0 : IERC20(donut).balanceOf(account);
        state.unitBalance = account == address(0) ? 0 : IERC20(unitToken).balanceOf(account);

        return state;
    }

    /**
     * @notice Get aggregated state for an Auction and user balances.
     * @param rig Rig contract address (used to look up auction)
     * @param account User address (or address(0) to skip balance queries)
     * @return state Aggregated auction state
     */
    function getAuction(address rig, address account) external view returns (AuctionState memory state) {
        address auction = ICore(core).rigToAuction(rig);

        state.epochId = Auction(auction).epochId();
        state.initPrice = Auction(auction).initPrice();
        state.startTime = Auction(auction).startTime();
        state.paymentToken = Auction(auction).paymentToken();
        state.price = Auction(auction).getPrice();

        // LP price in DONUT = (DONUT in LP * 2) / LP total supply
        uint256 lpTotalSupply = IERC20(state.paymentToken).totalSupply();
        state.paymentTokenPrice =
            lpTotalSupply == 0 ? 0 : IERC20(donut).balanceOf(state.paymentToken) * 2e18 / lpTotalSupply;

        state.wethAccumulated = IERC20(weth).balanceOf(auction);
        state.wethBalance = account == address(0) ? 0 : IERC20(weth).balanceOf(account);
        state.donutBalance = account == address(0) ? 0 : IERC20(donut).balanceOf(account);
        state.paymentTokenBalance = account == address(0) ? 0 : IERC20(state.paymentToken).balanceOf(account);

        return state;
    }
}
