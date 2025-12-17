// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Unit} from "./Unit.sol";

/**
 * @title UnitFactory
 * @author heesho
 * @notice Factory contract for deploying new Unit token instances.
 * @dev Called by Core during the launch process to create new Unit tokens.
 *      The deployer (Core) becomes the initial rig and can mint tokens for LP seeding.
 */
contract UnitFactory {
    /**
     * @notice Deploy a new Unit token.
     * @param _tokenName Name for the Unit token
     * @param _tokenSymbol Symbol for the Unit token
     * @return Address of the newly deployed Unit token
     */
    function deploy(string memory _tokenName, string memory _tokenSymbol) external returns (address) {
        Unit unit = new Unit(_tokenName, _tokenSymbol);
        unit.setRig(msg.sender);
        return address(unit);
    }
}
