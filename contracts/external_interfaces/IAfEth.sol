// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IAfEth {
    function applySafEthReward() external payable;
    function applyVotiumReward() external payable;
}
