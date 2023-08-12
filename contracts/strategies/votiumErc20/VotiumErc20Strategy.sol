// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../AbstractErc20Strategy.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import './VotiumErc20StrategyCore.sol';
contract VotiumErc20Strategy is VotiumErc20StrategyCore, AbstractErc20Strategy {
    function mint() public payable override {
        uint256 cvxAmount = buyCvx(msg.value);
        IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmount);
        ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmount, 0);
        _mint(address(this), cvxAmount);
    }

    function burn(uint256 _amount) public override {
        queueSize++;
        unlockQueue[queueSize] = UnlockQueuePosition({
            owner: msg.sender,
            afEthToBurn: _amount,
            afEthBurned: 0
        });
        cvxToLeaveUnlocked+=_amount;
        _burn(msg.sender, _amount);
    }

    //  public function anyone can call to process the unlock queue
    function processWithdrawQueue() public view override {

    }
}
