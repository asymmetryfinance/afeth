// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IVotiumStrategy {
    function cvxPerVotium() external view returns (uint256);

    function ethPerCvx() external view returns (uint256);

    function depositRewards(uint256 amount) external payable;
}
