// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "./strategies/votium/VotiumStrategy.sol";
import "./strategies/safEth/SafEthStrategy.sol";

// AfEth is the strategy manager for safEth and votium strategies
contract AfEth is Initializable, ERC721Upgradeable {
    address votium;
    address safEth;
    address[] strategies;

    error InvalidRatios();

    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
        @notice - Function to initialize values for the contracts
        @dev - This replaces the constructor for upgradeable contracts
        @param _votiumStrategy - Address of the votium strategy contract
        @param _safEthStrategy - Address of the safEth strategy contract
    */
    function initialize(
        address _votiumStrategy,
        address _safEthStrategy
    ) external initializer {
        votium = _votiumStrategy;
        safEth = _safEthStrategy;
        strategies = [votium, safEth];
    }

    /**
        @notice - Mints through each strategy
        @param _amount - Total amount to mint
        @param _ratios - Ratio of each strategy to mint (Must equal 100)
    */
    function mint(uint256 _amount, uint256[] memory _ratios) external payable {
        uint256 totalRatio;
        for (uint256 i = 0; i < _ratios.length; i++) {
            totalRatio += _ratios[i];
        }
        if (totalRatio != 100) {
            revert InvalidRatios();
        }

        for (uint256 i = 0; i < strategies.length; i++) {
            AbstractNftStrategy(strategies[i]).mint{value: (_amount * _ratios[i]) / 100}();
        }
    }

    /**
        @notice - Burns based on position id
        @dev - This will only be able to be burned once the unlock time is completed
        @param _positionId - Position id to burn
    */
    function burn(uint256 _positionId) external {
        for (uint256 i = 0; i < strategies.length; i++) {
            AbstractNftStrategy(strategies[i]).burn(_positionId);
        }
    }

    /**
        @notice - Request to close position
        @param _positionId - Position id to request to close
    */
    function requestClose(uint256 _positionId) external payable {
        for (uint256 i = 0; i < strategies.length; i++) {
            AbstractNftStrategy(strategies[i]).requestClose(_positionId);
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
