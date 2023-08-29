// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./SafEthStrategyCore.sol";
import "../AbstractErc20Strategy.sol";
import "../../external_interfaces/ISafEth.sol";

contract SafEthStrategy is AbstractErc20Strategy, SafEthStrategyCore {
    function deposit() external payable virtual override {
        uint256 mintAmount = ISafEth(safEthAddress).stake{value: msg.value}(
            0 // TODO: set minAmount
        );
        _mint(msg.sender, mintAmount);
    }

    function requestWithdraw(uint256 _amount) external virtual override {
        /// noop
    }

    function withdraw(uint256) external virtual override {
        uint256 amount = balanceOf(msg.sender);
        _burn(msg.sender, amount);

        uint256 ethBalanceBefore = address(this).balance;

        ISafEth(safEthAddress).unstake(
            amount,
            0 // TODO: set minAmount
        );
        uint256 ethBalanceAfter = address(this).balance;
        uint256 ethReceived = ethBalanceAfter - ethBalanceBefore;

        // solhint-disable-next-line
        (bool sent, ) = msg.sender.call{value: ethReceived}("");
        require(sent, "Failed to send Ether");
    }
}
