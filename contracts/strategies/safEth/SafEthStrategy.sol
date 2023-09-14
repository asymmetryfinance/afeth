// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./SafEthStrategyCore.sol";
import "../AbstractErc20Strategy.sol";
import "../../external_interfaces/ISafEth.sol";
import "hardhat/console.sol";
import "../../external_interfaces/IAfEth.sol";
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

    function deposit() external payable virtual override returns (uint256) {
        uint256 priceBefore = this.safEthPerStrategyToken();
        uint256 safEthMintAmount = ISafEth(safEthAddress).stake{
            value: (msg.value)
        }(
            0 // TODO: set minAmount
        );
        uint256 strategyMintAmount = (safEthMintAmount * 1e18) / priceBefore;
        _mint(msg.sender, strategyMintAmount);
        return strategyMintAmount;
    }

    function safEthPerStrategyToken() external view virtual returns (uint256) {
        uint256 safEthInSystem = IERC20(safEthAddress).balanceOf(address(this));
        uint256 totalSupply = totalSupply();
        if (totalSupply == 0 || safEthInSystem == 0) {
            return 1e18;
        }
        return (safEthInSystem * 1e18) / totalSupply;
    }

    function requestWithdraw(
        uint256 _amount
    ) external virtual override returns (uint256 withdrawId) {
        // solhint-disable-next-line
        console.log("this must be here");
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
        uint256 safEthStrategyBalance = IERC20(safEthAddress).balanceOf(
            address(this)
        );
        uint256 safEthTokenPrice = ISafEth(safEthAddress).approxPrice(false);
        uint256 underlyingValue = (safEthStrategyBalance * safEthTokenPrice);
        uint256 totalSupply = totalSupply();
        if (totalSupply == 0 || underlyingValue == 0) {
            return safEthTokenPrice;
        }
        uint256 p = (underlyingValue) / totalSupply;
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

    function depositRewards(uint256 _amount, bool applyToSelf) public payable override {
        if (!applyToSelf) {
            IAfEth(manager).depositRewards{value: _amount}();
            return;
        }
        ISafEth(safEthAddress).stake{value: (_amount)}(
            0 // TODO: set minAmount
        );
    }
}
