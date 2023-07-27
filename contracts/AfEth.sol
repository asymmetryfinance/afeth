// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "./strategies/votium/VotiumStrategy.sol";
import "./strategies/safEth/SafEthStrategy.sol";

// AfEth is the strategy manager for safEth and votium strategies
contract AfEth is Initializable {
    AbstractNftStrategy votium;
    AbstractNftStrategy safEth;
    AbstractNftStrategy[] strategies;

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
        votium = new VotiumStrategy();
        safEth = new SafEthStrategy();
        strategies = [votium, safEth];
    }

    /**
        @notice - Mints through each strategy
        @param _amount - Total amount to ming
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
            strategies[i].mint{value: (_amount * _ratios[i]) / 100}();
        }
    }

    /**
        @notice - Burns based on position id
        @dev - This will b
        @param _positionId - Position id to burn
    */
    function burn(uint256 _positionId) external {
        for (uint256 i = 0; i < strategies.length; i++) {
            strategies[i].burn(_positionId);
        }
    }

    function requestClose(uint256 _positionId) external payable {
        for (uint256 i = 0; i < strategies.length; i++) {
            strategies[i].requestClose(_positionId);
        }
    }

    function claimRewards(uint256 _positionId) external {
        for (uint256 i = 0; i < strategies.length; i++) {
            strategies[i].claimRewards(_positionId);
        }
    }
}
