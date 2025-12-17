// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IAuctionFactory
 * @author heesho
 * @notice Interface for the AuctionFactory contract.
 */
interface IAuctionFactory {
    function deploy(
        uint256 _initPrice,
        address _paymentToken,
        address _paymentReceiver,
        uint256 _epochPeriod,
        uint256 _priceMultiplier,
        uint256 _minInitPrice
    ) external returns (address);
}
