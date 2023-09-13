// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./SafEthStrategyCore.sol";
import "../AbstractErc20Strategy.sol";
import "../../external_interfaces/ISafEth.sol";
import "hardhat/console.sol";

contract SafEthStrategy is AbstractErc20Strategy, SafEthStrategyCore {
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

    function deposit()
        external
        payable
        virtual
        override
        returns (uint256)
    {
        uint256 priceBefore = this.price();
        uint256 mintAmount = ISafEth(safEthAddress).stake{value: (msg.value)}(
            0 // TODO: set minAmount
        );
        uint256 mintAmountConverted = (mintAmount * 1e18) / priceBefore;
        _mint(msg.sender, mintAmountConverted);
        return mintAmountConverted;
    }

    function requestWithdraw(
        uint256 _amount
    ) external virtual override returns (uint256 withdrawId) {
        _burn(msg.sender, _amount);
        latestWithdrawId++;
        emit WithdrawRequest(msg.sender, _amount, latestWithdrawId);
        withdrawIdToAmount[latestWithdrawId] = _amount;
        return latestWithdrawId;
    }

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
        require(sent, "Failed to send Ether");

        emit Withdraw(msg.sender, withdrawAmount, ethReceived);
    }

    function price() external view virtual override returns (uint256) {
        uint256 safEthStrategyBalance = IERC20(safEthAddress).balanceOf(address(this));
        uint256 safEthTokenPrice = ISafEth(safEthAddress).approxPrice(false);
        uint256 underlyingValue = (safEthStrategyBalance * safEthTokenPrice);
        uint256 totalSupply = totalSupply();
        if(totalSupply == 0 || underlyingValue == 0) {
            return safEthTokenPrice;
        }
        console.log('*****');
        console.log('safEthAddress', safEthAddress);
        console.log('safEthTokenPrice', safEthTokenPrice);
        console.log('safEth underlyingValue is', underlyingValue);
        console.log('safEth totalSupply is', totalSupply);
        uint256 p = (underlyingValue) / totalSupply;
        console.log('safEth p is', p);
        return p;
    }

    function canWithdraw(
        uint256
    ) external view virtual override returns (bool) {
        return true;
    }

    function withdrawTime(
        uint256
    ) external view virtual override returns (uint256) {
        return block.timestamp;
    }

    function depositRewards(uint256 _amount) public payable override {
        // todo price go up
    }
}
