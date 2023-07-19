import "./SafEthStrategyCore.sol";
import "../../AbstractNftStrategy.sol";

// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

contract SafEthStrategy is AbstractNftStrategy, SafEthStrategyCore {
    function mint() external payable override returns (uint256) {
    }

    function requestClose(uint256 positionId) external override {

    }

    function burn(uint256 positionId) external override {

    }

    function claimRewards(uint256 positionId) external override {

    }

    function claimableNow(
        uint256 positionId
    ) external view override returns (uint256 ethAmount) {
    }

    function lockedValue(
        uint256 positionId
    ) external view override returns (uint256 ethValue) {
    }
}
