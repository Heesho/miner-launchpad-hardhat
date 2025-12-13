// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IAuction
 * @notice Interface for the Auction contract.
 */
interface IAuction {
    function buy(address[] calldata assets, address recipient, uint256 epochId, uint256 deadline, uint256 maxPaymentTokenAmount) external;
    function epochId() external view returns (uint256);
    function initPrice() external view returns (uint256);
    function startTime() external view returns (uint256);
    function paymentToken() external view returns (address);
    function getPrice() external view returns (uint256);
}
