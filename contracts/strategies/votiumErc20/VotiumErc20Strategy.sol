// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../AbstractErc20Strategy.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./VotiumErc20StrategyCore.sol";

// TODO rename things from afEth to something else
import "hardhat/console.sol";

contract VotiumErc20Strategy is VotiumErc20StrategyCore, AbstractErc20Strategy {
    function price() public view override returns (uint256) {
        uint256 supply = totalSupply();
        if(supply == 0) return 1e18;
        (, , uint256 locked, ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );
        if(locked == 0) return 1e18;
        return (locked * 1e18) / supply;
    }

    function mint() public payable override {
        uint256 priceBefore = price();
        uint256 cvxAmount = buyCvx(msg.value);
        IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmount);
        ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmount, 0);
        _mint(msg.sender, ((cvxAmount * 1e18) / priceBefore));
    }

    function requestWithdraw(uint256 _amount) public override {
        unlockQueue[queueSize] = UnlockQueuePosition({
            owner: msg.sender,
            afEthOwed: (_amount),
            afEthWithdrawn: 0
        });
        afEthUnlockObligations += unlockQueue[queueSize].afEthOwed;
        queueSize++;
    }

    // TODO look into gas costs of this
    function processWithdrawQueue(uint _maxIterations) public override {
        (, uint256 unlockable, , ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );
        if (unlockable == 0) return;

        // get price before nlocking change the prices
        uint256 priceBeforeUnlock = price();
 
        // unlock all (theres no way to unlock individual locks)
        ILockedCvx(VLCVX_ADDRESS).processExpiredLocks(false);
        uint256 unlockedCvxBalance = IERC20(CVX_ADDRESS).balanceOf(
            address(this)
        );
        require(unlockedCvxBalance > 0, "No unlocked CVX to process queue");

        uint256 cvxUnlockObligations = afEthUnlockObligations * priceBeforeUnlock;

        // relock everything minus unlock queue obligations
        uint256 cvxAmountToRelock = cvxUnlockObligations > unlockedCvxBalance ? 0 : unlockedCvxBalance - cvxUnlockObligations;
        if(cvxAmountToRelock > 0) {
            IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmountToRelock);
            ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmountToRelock, 0);
        }
        uint256 i;

        for (i = nextQueuePositionToProcess; i < queueSize; i++) {
            if(unlockedCvxBalance == 0) return;
            if(_maxIterations == 0) break;
            _maxIterations--;
            
            UnlockQueuePosition storage position = unlockQueue[i];

            // look into precision loss here, why does it become inexact?
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

            unlockedCvxBalance -= cvxToSell;
            afEthUnlockObligations -= afEthToBurn;
            position.afEthWithdrawn += afEthToBurn;
            _burn(msg.sender, afEthToBurn);
            sellCvx(cvxToSell);

            // use call to send eth instead
            payable(position.owner).transfer(address(this).balance);
        }
        nextQueuePositionToProcess = i;
    }
}
