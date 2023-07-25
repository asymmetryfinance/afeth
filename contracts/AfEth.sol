// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./strategies/votium/VotiumStrategy.sol";
import "./strategies/safEth/SafEthStrategy.sol";

// AfEth is the strategy manager for safEth and votium strategies
contract AfEth {
    AbstractNftStrategy votium;
    AbstractNftStrategy safEth;
    AbstractNftStrategy[] strategies;

    error InvalidRatios();

    // TODO wrap safEth and votium strategies to mint afEth nfts
    constructor() {
        votium = new VotiumStrategy();
        safEth = new SafEthStrategy();
        strategies = [votium, safEth];
    }

    function stake(uint256 _amount, uint256[] memory _ratios) external payable {
        uint256 totalRatio;
        for (uint256 i = 0; i < _ratios.length; i++) {
            totalRatio += _ratios[i];
        }
        if (totalRatio != 100) {
            revert InvalidRatios();
        }

        for (uint256 i = 0; i < strategies.length; i++) {
            strategies[i].mint{value: _amount * (_ratios[i] / 100)}(); // TODO: fix broken math
        }
    }

    function unstake(
        uint256 _amount,
        uint256[] memory _ratios
    ) external payable {
        uint256 totalRatio;
        for (uint256 i = 0; i < _ratios.length; i++) {
            totalRatio += _ratios[i];
        }
        if (totalRatio != 100) {
            revert InvalidRatios();
        }

        for (uint256 i = 0; i < strategies.length; i++) {
            // strategies[i].requestClose{value: _amount * (_ratios[i] / 100)}();
        }
    }

    function claim() external {}
}
