// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title ICore
 * @author heesho
 * @notice Interface for the Core launchpad contract.
 */
interface ICore {
    struct LaunchParams {
        address launcher;
        string tokenName;
        string tokenSymbol;
        string uri;
        uint256 donutAmount;
        uint256 unitAmount;
        uint256 initialUps;
        uint256 tailUps;
        uint256 halvingPeriod;
        uint256 rigEpochPeriod;
        uint256 rigPriceMultiplier;
        uint256 rigMinInitPrice;
        uint256 auctionInitPrice;
        uint256 auctionEpochPeriod;
        uint256 auctionPriceMultiplier;
        uint256 auctionMinInitPrice;
    }

    function launch(LaunchParams calldata params)
        external
        returns (address unit, address rig, address auction, address lpToken);
    function protocolFeeAddress() external view returns (address);
    function weth() external view returns (address);
    function donutToken() external view returns (address);
    function uniswapV2Factory() external view returns (address);
    function uniswapV2Router() external view returns (address);
    function minDonutForLaunch() external view returns (uint256);
    function isDeployedRig(address rig) external view returns (bool);
    function rigToLauncher(address rig) external view returns (address);
    function rigToUnit(address rig) external view returns (address);
    function rigToAuction(address rig) external view returns (address);
    function rigToLP(address rig) external view returns (address);
    function deployedRigsLength() external view returns (uint256);
    function deployedRigs(uint256 index) external view returns (address);
}
