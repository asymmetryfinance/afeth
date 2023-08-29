// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./SafEthStrategyCore.sol";
import "../AbstractErc20Strategy.sol";
import "../../external_interfaces/ISafEth.sol";

contract SafEthStrategy is AbstractErc20Strategy, SafEthStrategyCore {
    function mint() external payable virtual override {
        revert("not implemented");
    }

    function requestWithdraw(uint256 _amount) external virtual override {
        revert("not implemented");
    }

    function withdraw(uint256 epochToWithdraw) external virtual override {
        revert("not implemented");
    }
}
