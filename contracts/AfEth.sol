// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./strategies/votium/VotiumStrategy.sol";
import "./strategies/safEth/SafEthStrategy.sol";

// AfEth is the strategy manager for safEth and votium strategies
contract AfEth {
    VotiumStrategy votium;
    SafEthStrategy safEth;
    // TODO wrap safEth and votium strategies to mint afEth nfts

    constructor() {
        votium = new VotiumStrategy();
        safEth = new SafEthStrategy();
    }

    function stake(uint256 amount) external payable {
        // TODO
    }

    function unstake(uint256 amount) external payable {
        // TODO
    }
}
