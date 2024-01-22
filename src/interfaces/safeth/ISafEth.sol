// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISafEth {
    function stake(uint256 minOut) external payable returns (uint256 mintedAmount);

    function unstake(uint256 safEthAmount, uint256 minOut) external;

    function approxPrice(bool validate) external view returns (uint256);

    function balanceOf(address account) external view returns (uint256);

    function totalSupply() external view returns (uint256);
}
