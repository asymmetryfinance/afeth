// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IAfEth {
    function applyStrategyReward(address) external payable;

    function depositRewards(uint256 _amount) external payable;
}
