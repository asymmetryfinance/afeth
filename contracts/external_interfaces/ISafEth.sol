// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface ISafEth {
    function stake(uint256 _minOut) external payable returns (uint256);

    function unstake(uint256 _safEthAmount, uint256 _minOut) external;

    function approxPrice() external view returns (uint256);
}
