// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./SafEthStrategyCore.sol";
import "../AbstractStrategy.sol";
import "../../external_interfaces/ISafEth.sol";
import "hardhat/console.sol";

contract SafEthStrategy is AbstractStrategy, SafEthStrategyCore {
    event WithdrawRequest(
        address indexed account,
        uint256 amount,
        uint256 withdrawId
    );

    event Withdraw(
        address indexed account,
        uint256 safEthAmount,
        uint256 ethAmount
    );

    uint256 latestWithdrawId;

    mapping(uint256 => uint256) public withdrawIdToAmount;

    /**
     * @notice Deposit ETH into the strategy
     * @return mintAmount Amount of safEth minted
     */
    function deposit()
        external
        payable
        virtual
        override
        returns (uint256 mintAmount)
    {
        mintAmount = ISafEth(safEthAddress).stake{value: msg.value}(
            0 // handled via afEth
        );
        _mint(msg.sender, mintAmount);
    }

    /**
     * @notice Request a withdraw of safEth
     * @param _amount Amount of safEth to withdraw
     */
    function requestWithdraw(
        uint256 _amount
    ) external virtual override returns (uint256 withdrawId) {
        _burn(msg.sender, _amount);
        latestWithdrawId++;
        emit WithdrawRequest(msg.sender, _amount, latestWithdrawId);
        withdrawIdToAmount[latestWithdrawId] = _amount;
        return latestWithdrawId;
    }

    /**
     * @notice Withdraw safEth
     * @param _withdrawId Id of the withdraw request
     */
    function withdraw(uint256 _withdrawId) external virtual override {
        uint256 withdrawAmount = withdrawIdToAmount[_withdrawId];

        uint256 ethBalanceBefore = address(this).balance;

        ISafEth(safEthAddress).unstake(
            withdrawAmount,
            0 // this is handled at the afEth level
        );
        uint256 ethBalanceAfter = address(this).balance;
        uint256 ethReceived = ethBalanceAfter - ethBalanceBefore;

        // solhint-disable-next-line
        (bool sent, ) = msg.sender.call{value: ethReceived}("");
        if (!sent) revert FailedToSend();

        emit Withdraw(msg.sender, withdrawAmount, ethReceived);
    }

    /**
     * @notice Get the price of safEth
     * @return Price of safEth
     */
    function price() external view virtual override returns (uint256) {
        return ISafEth(safEthAddress).approxPrice(false);
    }

    /**
     * @notice Checks whether or not position can be withdrawn
     * @param _withdrawId Id of position to withdraw
     */
    function canWithdraw(
        uint256 _withdrawId
    ) external view virtual override returns (bool) {
        return withdrawIdToAmount[_withdrawId] > 0;
    }

    /**
     * @notice Checks what time an amount can be withdrawn
     */
    function withdrawTime(
        uint256
    ) external view virtual override returns (uint256) {
        return block.timestamp;
    }
}
