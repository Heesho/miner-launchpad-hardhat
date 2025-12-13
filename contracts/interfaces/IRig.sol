// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IRig
 * @notice Interface for the Rig contract.
 */
interface IRig {
    struct RigParams {
        uint256 initialUps;
        uint256 tailUps;
        uint256 halvingPeriod;
        uint256 epochPeriod;
        uint256 priceMultiplier;
        uint256 minInitPrice;
    }

    function mine(address _miner, uint256 _epochId, uint256 deadline, uint256 maxPrice, string memory _uri) external returns (uint256 price);
    function transferOwnership(address newOwner) external;
    function epochId() external view returns (uint256);
    function initPrice() external view returns (uint256);
    function epochStartTime() external view returns (uint256);
    function ups() external view returns (uint256);
    function miner() external view returns (address);
    function uri() external view returns (string memory);
    function unitUri() external view returns (string memory);
    function unit() external view returns (address);
    function getPrice() external view returns (uint256);
    function getUps() external view returns (uint256);
}
