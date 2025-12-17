// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IRigFactory
 * @author heesho
 * @notice Interface for the RigFactory contract.
 */
interface IRigFactory {
    function deploy(
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
    ) external returns (address);
}
