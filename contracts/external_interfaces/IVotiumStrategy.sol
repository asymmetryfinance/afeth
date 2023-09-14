// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IVotiumStrategy {
    function cvxPerVotium() view external returns (uint256);
    function ethPerCvx() view external returns (uint256);
    function depositRewards(uint256 _amount) external payable;
}
