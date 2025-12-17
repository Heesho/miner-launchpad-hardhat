// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IRig
 * @author heesho
 * @notice Interface for the Rig contract.
 */
interface IRig {
    function mine(address miner, uint256 _epochId, uint256 deadline, uint256 maxPrice, string memory _epochUri)
        external
        returns (uint256 price);
    function transferOwnership(address newOwner) external;
    function epochId() external view returns (uint256);
    function epochInitPrice() external view returns (uint256);
    function epochStartTime() external view returns (uint256);
    function epochUps() external view returns (uint256);
    function epochMiner() external view returns (address);
    function epochUri() external view returns (string memory);
    function uri() external view returns (string memory);
    function unit() external view returns (address);
    function getPrice() external view returns (uint256);
    function getUps() external view returns (uint256);
}
