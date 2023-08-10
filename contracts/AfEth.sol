// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "./strategies/votium/VotiumStrategy.sol";
import "./strategies/safEth/SafEthStrategy.sol";

// AfEth is the strategy manager for safEth and votium strategies
contract AfEth is Initializable, ERC721Upgradeable, OwnableUpgradeable {
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

    /**
        @notice - Mints through each strategy
        @param _ratios - Ratio of each strategy to mint (Must equal 100)
    */
    function mint(uint256[] memory _ratios) external payable {
        uint256 totalRatio;
        uint256 amount = msg.value;
        for (uint256 i = 0; i < _ratios.length; i++) {
            totalRatio += _ratios[i];
        }
        if (totalRatio != 1e18) {
            revert InvalidRatios();
        }
        tokenCount++;
        for (uint256 i = 0; i < strategies.length; i++) {
            if (_ratios[i] == 0) continue;
            AbstractNftStrategy strategy = AbstractNftStrategy(strategies[i]);
            strategy.mint{value: (amount * _ratios[i]) / 1e18}(
                tokenCount,
                msg.sender
            );
        }
        _mint(msg.sender, tokenCount);
    }

    /**
        @notice - Burns based on position id
        @dev - This will only be able to be burned once the unlock time is completed
        @param _positionId - Position id to burn
    */
    function burn(uint256 _positionId) external {
        for (uint256 i = 0; i < strategies.length; i++) {
            AbstractNftStrategy strategy = AbstractNftStrategy(strategies[i]);
            strategy.burn(_positionId, msg.sender);
        }
        _burn(_positionId);
    }

    /**
        @notice - Request to close position
        @param _positionId - Position id to request to close
    */
    function requestClose(uint256 _positionId) external payable {
        for (uint256 i = 0; i < strategies.length; i++) {
            AbstractNftStrategy(strategies[i]).requestClose(
                _positionId,
                msg.sender
            );
        }
    }

    /**
        @notice - Claim reward of position
        @param _positionId - Position id to claim reward
    */
    function claimRewards(uint256 _positionId) external {
        for (uint256 i = 0; i < strategies.length; i++) {
            AbstractNftStrategy(strategies[i]).claimRewards(_positionId);
        }
    }
}
