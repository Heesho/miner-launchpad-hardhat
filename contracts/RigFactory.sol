// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Rig} from "./Rig.sol";

/**
 * @title RigFactory
 * @author heesho
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
     * @param _uri Metadata URI for the rig
     * @param _initialUps Starting units per second
     * @param _tailUps Minimum units per second
     * @param _halvingPeriod Time between halvings
     * @param _epochPeriod Duration of each epoch
     * @param _priceMultiplier Price multiplier for next epoch
     * @param _minInitPrice Minimum starting price
     * @return Address of the newly deployed Rig
     */
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
    ) external returns (address) {
        Rig rig = new Rig(
            _unit,
            _quote,
            _treasury,
            _team,
            _core,
            _uri,
            _initialUps,
            _tailUps,
            _halvingPeriod,
            _epochPeriod,
            _priceMultiplier,
            _minInitPrice
        );
        rig.transferOwnership(msg.sender);
        return address(rig);
    }
}
