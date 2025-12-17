// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IUnitFactory
 * @author heesho
 * @notice Interface for the UnitFactory contract.
 */
interface IUnitFactory {
    function deploy(string memory _tokenName, string memory _tokenSymbol) external returns (address);
}
