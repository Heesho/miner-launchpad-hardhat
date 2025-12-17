// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Auction} from "./Auction.sol";

/**
 * @title AuctionFactory
 * @author heesho
 * @notice Factory contract for deploying new Auction instances.
 * @dev Called by Core during the launch process to create new Auction contracts.
 */
contract AuctionFactory {
    /**
     * @notice Deploy a new Auction contract.
     * @param _initPrice Starting price for the first epoch
     * @param _paymentToken LP token address used for payments
     * @param _paymentReceiver Address to receive payments (typically burn address)
     * @param _epochPeriod Duration of each auction epoch
     * @param _priceMultiplier Price multiplier for next epoch
     * @param _minInitPrice Minimum allowed starting price
     * @return Address of the newly deployed Auction
     */
    function deploy(
        uint256 _initPrice,
        address _paymentToken,
        address _paymentReceiver,
        uint256 _epochPeriod,
        uint256 _priceMultiplier,
        uint256 _minInitPrice
    ) external returns (address) {
        return address(
            new Auction(_initPrice, _paymentToken, _paymentReceiver, _epochPeriod, _priceMultiplier, _minInitPrice)
        );
    }
}
