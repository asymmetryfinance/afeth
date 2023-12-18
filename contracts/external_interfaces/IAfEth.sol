// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IAfEth {
    function deposit(uint256, uint256) external payable returns (uint256);

    function applyStrategyReward(address) external payable;

    function depositRewards(
        uint256 _minSafEthAmount,
        uint256 _minCvxAmount
    ) external payable;
}
