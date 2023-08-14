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
        (uint256 total, , , ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );
        if(total == 0) return 1e18;
        return (total * 1e18) / supply;
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
            afEthOwed: (_amount * price()) / 1e18,
            afEthWithdrawn: 0
        });
        cvxUnlockObligations += unlockQueue[queueSize].afEthOwed;
        queueSize++;
    }

    //  public function anyone can call to process the unlock queue
    function processWithdrawQueue(uint _maxIterations) public override {
        (, uint256 unlockable, , ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );
        if (unlockable == 0) return;

        // unlocking changes prices
        uint256 priceBeforeUnlock = price();
 
        // unlock all (theres no way to unlock individual locks)
        ILockedCvx(VLCVX_ADDRESS).processExpiredLocks(false);
        uint256 unlockedCvxBalance = IERC20(CVX_ADDRESS).balanceOf(
            address(this)
        );
        require(unlockedCvxBalance > 0, "No unlocked CVX to process queue");
        uint256 i;

        for (i = nextQueuePositionToProcess; i < queueSize; i++) {
            if(_maxIterations == 0) break;
            _maxIterations--;
            
            UnlockQueuePosition storage position = unlockQueue[i];
            uint256 remainingCvxToWithdrawFromPosition = ((position.afEthOwed -
                position.afEthWithdrawn) * priceBeforeUnlock) / 1e18;
            if (remainingCvxToWithdrawFromPosition == 0) continue;
            uint256 cvxToSell = remainingCvxToWithdrawFromPosition >=
                unlockedCvxBalance
                ? unlockedCvxBalance
                : remainingCvxToWithdrawFromPosition;
            // fix edge case where roundoff error can made it higher than balance on edge case
            cvxToSell = unlockedCvxBalance > cvxToSell ? cvxToSell : unlockedCvxBalance;
            uint256 afEthToBurn = (cvxToSell * 1e18) / priceBeforeUnlock;
            afEthToBurn = afEthToBurn > address(this).balance ? address(this).balance : afEthToBurn;
            unlockedCvxBalance -= cvxToSell;
            // fixes roundoff error bug that can cause underflow edge case
            cvxUnlockObligations -= cvxUnlockObligations > cvxToSell ? cvxToSell : cvxUnlockObligations;
            position.afEthWithdrawn += afEthToBurn;
            _burn(msg.sender, afEthToBurn);
            sellCvx(cvxToSell);
            payable(position.owner).transfer(address(this).balance);
        }
        nextQueuePositionToProcess = i;
    }
}
