// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

IClaimZap constant ZAP_CLAIM = IClaimZap(0x3f29cB4111CbdA8081642DA1f75B3c12DECf2516);

interface IClaimZap {
    function claimRewards(
        address[] calldata rewardContracts,
        address[] calldata extraRewardContracts,
        address[] calldata tokenRewardContracts,
        address[] calldata tokenRewardTokens,
        uint256 depositCrvMaxAmount,
        uint256 minAmountOut,
        uint256 depositCvxMaxAmount,
        uint256 spendCvxAmount,
        uint256 options
    ) external;
}
