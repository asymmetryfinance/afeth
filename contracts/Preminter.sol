// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./external_interfaces/IAfEth.sol";

contract Preminter is Initializable, OwnableUpgradeable {

    address constant afEthAddress = 0x5F10B16F0959AaC2E33bEdc9b0A4229Bb9a83590;

    uint256 preminterEthBalance;
    uint256 preminterAfEthBalance;
    
    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
        @notice - Initialize values for the contracts
        @dev - This replaces the constructor for upgradeable contracts
    */
    function initialize() external initializer {
        _transferOwnership(msg.sender);
    }

    /**
     * @notice Allow owner to withdraw from Preminter
     * @param withdrawAfEth if true, withdraw afEth instead of eth
     */
    function ownerWithdraw(bool withdrawAfEth) public onlyOwner {
        // TODO
    }

    /**
     * @notice Allow owner to deposit into Preminter
     * @param mintAfEth if true, mint afEth with eth instead of depositing it
     */
    function ownerDeposit(bool mintAfEth) public payable onlyOwner {
        // TODO
    }

    /**
     * @notice Buy afEth from Preminter
     * @param _minOut minimum afEth to receive or revert
     */
    function buy(uint256 _minOut) public {
        // TODO
    }

    /**
     * Sell afEth to preminter
     * @param _amount amount of afEth to sell
     * @param _minOut minimum eth to receive or revert
     */
    function sell(uint256 _amount, uint256 _minOut) public {
        // TODO
    }

    /**
     * @notice Price to buy afEth from preminter
     */
    function buyPrice() public view returns (uint256) {
        // TODO
    }

    /**
     * @notice Price to sell afEth to preminter
     */
    function sellPrice() public view returns (uint256) {
        // TODO
    }
}
