// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../AbstractErc20Strategy.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./VotiumErc20StrategyCore.sol";
import "hardhat/console.sol";

contract VotiumErc20Strategy is VotiumErc20StrategyCore, AbstractErc20Strategy {
    function price() public view override returns (uint256) {
        uint256 supply = totalSupply();
        if(supply == 0) return 1e18;
        (, , uint256 locked, ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );
        return (locked * 1e18) / supply;
    }

    function mint() public payable override {
        uint256 cvxAmount = buyCvx(msg.value);
        IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmount);
        ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmount, 0);
        _mint(msg.sender, ((cvxAmount * 1e18) / price()));
    }

    function burn(uint256 _amount) public override {
        unlockQueue[queueSize] = UnlockQueuePosition({
            owner: msg.sender,
            cvxOwed: (_amount * price()) / 1e18,
            cvxWithdrawn: 0
        });
        cvxUnlockObligations += unlockQueue[queueSize].cvxOwed;
        _burn(msg.sender, _amount);
        queueSize++;
    }

    //  public function anyone can call to process the unlock queue
    function processWithdrawQueue() public override {
        (, uint256 unlockable, , ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );

        if (unlockable == 0) return;
        // unlock all (theres no way to unlock individual locks)
        ILockedCvx(VLCVX_ADDRESS).processExpiredLocks(false);

        uint256 unlockedCvxBalance = IERC20(CVX_ADDRESS).balanceOf(
            address(this)
        );

        require(unlockedCvxBalance > 0, "No unlocked CVX to process queue");

        for (uint256 i = nextQueuePositionToProcess; i <= queueSize; i++) {
            UnlockQueuePosition storage position = unlockQueue[i];
            uint256 remainingCvxToWithdrawFromPosition = position.cvxOwed -
                position.cvxWithdrawn;
            if (remainingCvxToWithdrawFromPosition == 0) continue;
            uint256 cvxToSell = remainingCvxToWithdrawFromPosition >=
                unlockedCvxBalance
                ? unlockedCvxBalance
                : remainingCvxToWithdrawFromPosition;
            unlockedCvxBalance -= cvxToSell;
            cvxUnlockObligations -= cvxToSell;
            position.cvxWithdrawn += cvxToSell;
            sellCvx(cvxToSell);
            payable(position.owner).transfer(address(this).balance);
        }
        nextQueuePositionToProcess = queueSize;
    }
}
