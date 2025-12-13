// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title ICore
 * @notice Interface for the Core launchpad contract.
 */
interface ICore {
    function protocolFeeAddress() external view returns (address);
    function donutToken() external view returns (address);
    function uniswapV2Factory() external view returns (address);
    function uniswapV2Router() external view returns (address);
    function weth() external view returns (address);
    function minDonutForLaunch() external view returns (uint256);
    function initialUnitMintAmount() external view returns (uint256);
    function isDeployedRig(address rig) external view returns (bool);
    function rigToLauncher(address rig) external view returns (address);
    function rigToUnit(address rig) external view returns (address);
    function rigToAuction(address rig) external view returns (address);
    function rigToLP(address rig) external view returns (address);
    function deployedRigsLength() external view returns (uint256);
    function deployedRigs(uint256 index) external view returns (address);
}
