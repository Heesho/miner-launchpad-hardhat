// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Rig} from "./Rig.sol";

/**
 * @title RigFactory
 * @notice Factory contract for deploying new Rig instances.
 * @dev Called by Core during the launch process to create new Rig contracts.
 */
contract RigFactory {
    /**
     * @notice Deploy a new Rig contract.
     * @param _unit Unit token address (deployed separately by Core)
     * @param _quote Payment token address (e.g., WETH)
     * @param _treasury Treasury address for fee collection
     * @param _team Team address for fee collection
     * @param _core Core contract address
     * @param params Rig emission and auction parameters
     * @return Address of the newly deployed Rig
     */
    function deploy(
        address _unit,
        address _quote,
        address _treasury,
        address _team,
        address _core,
        Rig.RigParams memory params
    ) external returns (address) {
        Rig rig = new Rig(_unit, _quote, _treasury, _team, _core, params);
        rig.transferOwnership(msg.sender);
        return address(rig);
    }
}
