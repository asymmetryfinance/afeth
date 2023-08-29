// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "./strategies/votiumErc20/VotiumErc20Strategy.sol";
import "./strategies/safEth/SafEthStrategy.sol";
import "./strategies/AbstractErc20Strategy.sol";

// AfEth is the strategy manager for safEth and votium strategies
contract AfEth is Initializable, OwnableUpgradeable, AbstractErc20Strategy {
    address[] public strategies;
    uint256 public tokenCount;

    error InvalidRatios();

    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
        @notice - Function to initialize values for the contracts
        @dev - This replaces the constructor for upgradeable contracts
    */
    function initialize() external initializer {
        _transferOwnership(msg.sender);
    }

    /**
        @notice - Function to add strategies to the strategies array
        @param _strategy - Address of the strategy contract
    */
    function addStrategy(address _strategy) external onlyOwner {
        strategies.push(_strategy);
    }

    receive() external payable {}

    function deposit() external payable virtual override {}

    function requestWithdraw(uint256 _amount) external virtual override {}

    function withdraw(uint256 epochToWithdraw) external virtual override {}
}
