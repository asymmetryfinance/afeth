// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IAfEth {
    function deposit(uint256, uint256) external payable returns (uint256);

    function depositRewards(uint256 safEthMinOut, uint256 cvxMinOut, uint256 deadline) external payable;
}
