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
        fullyUnlockedCvx+=_amount;
        _burn(msg.sender, _amount);
    }

    //  public function anyone can call to process the unlock queue
    function processWithdrawQueue() public override {
        require(fullyUnlockedCvx > 0, 'No cvx to withdraw');
        for(uint256 i=nextQueuePositionToProcess;i<=queueSize;i++){
            UnlockQueuePosition storage position = unlockQueue[i];
            uint256 remainingCvxToWithdrawFromPosition = position.afEthToBurn - position.afEthBurned;
            if(remainingCvxToWithdrawFromPosition >= fullyUnlockedCvx) {
                remainingCvxToWithdrawFromPosition -= fullyUnlockedCvx;
                sellCvx(fullyUnlockedCvx);
                fullyUnlockedCvx = 0;
                position.afEthBurned += fullyUnlockedCvx;
                payable(position.owner).transfer(address(this).balance);
                return;
            }else {
                sellCvx(remainingCvxToWithdrawFromPosition);
                fullyUnlockedCvx -= remainingCvxToWithdrawFromPosition;
                position.afEthBurned += remainingCvxToWithdrawFromPosition;
                payable(position.owner).transfer(address(this).balance);
            }
        }
    }
}
