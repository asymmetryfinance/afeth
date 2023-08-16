// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../AbstractErc20Strategy.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./VotiumErc20StrategyCore.sol";

// TODO rename things from afEth to something else
import "hardhat/console.sol";

contract VotiumErc20Strategy is VotiumErc20StrategyCore, AbstractErc20Strategy {
    function mint() public payable override {
        uint256 priceBefore = price();
        uint256 cvxAmount = buyCvx(msg.value);
        IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmount);
        ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmount, 0);
        _mint(msg.sender, ((cvxAmount * 1e18) / priceBefore));
    }

    function requestWithdraw(uint256 _amount) public override {
        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(
            block.timestamp
        );

        (
            ,
            uint256 unlockable,
            ,
            ILockedCvx.LockedBalance[] memory lockedBalances
        ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(address(this));

        afEthUnlockObligations += _amount;

        uint256 totalLockedBalancePlusUnlockable = unlockable;

        for (uint256 i = 0; i < lockedBalances.length; i++) {
            totalLockedBalancePlusUnlockable += lockedBalances[i].amount;
            // we found the epoch at which there is enough to unlock this position
            if (totalLockedBalancePlusUnlockable >= afEthUnlockObligations) {
                (, uint32 currentEpochStartingTime) = ILockedCvx(VLCVX_ADDRESS).epochs(currentEpoch);
                uint256 timeDifference = lockedBalances[i].unlockTime - currentEpochStartingTime;
                uint256 epochOffset = timeDifference / ILockedCvx(VLCVX_ADDRESS).rewardsDuration();
                uint256 previousAfEthOwed = unlockQueues[msg.sender][currentEpoch + epochOffset].afEthOwed;
                unlockQueues[msg.sender][currentEpoch + epochOffset] = 
                    UnlockQueuePosition({
                        afEthOwed: previousAfEthOwed + _amount,
                        priceWhenRequested: price()
                });
            }
        }
        console.log('shit6');
       _transfer(msg.sender, address(this), _amount);
    }

    function withdraw(
    ) external       override
{
        console.log('fuck1');
        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(
            block.timestamp
        );

        UnlockQueuePosition memory positionToWithdraw =  unlockQueues[msg.sender][currentEpoch];
        console.log('fuck2');

        require(positionToWithdraw.afEthOwed > 0, "Nothing to withdraw");   

        uint256 startingPrice = unlockQueues[msg.sender][currentEpoch].priceWhenRequested;
        uint256 endingPrice = priceAtEpoch[currentEpoch];
        uint256 averagePrice = (startingPrice + endingPrice) / 2;
        console.log('fuck3');

        (, uint256 unlockable, , ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );
        if (unlockable == 0) return;  

        ILockedCvx(VLCVX_ADDRESS).processExpiredLocks(false);
        console.log('fuck4 averagePrice', averagePrice);

        uint256 cvxToWithdraw = (positionToWithdraw.afEthOwed * averagePrice) / 1e18;

        uint256 cvxUnlockObligations = (afEthUnlockObligations * averagePrice)  / 1e18;

        uint256 cvxAmountToRelock = cvxToWithdraw - cvxUnlockObligations;
        console.log('fuck5', cvxToWithdraw, cvxUnlockObligations);
        // relock everything minus unlock queue obligations
        if(cvxAmountToRelock > 0) {
            IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmountToRelock);
            ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmountToRelock, 0);
        }
        console.log('fuck6');

        _burn(address(this), positionToWithdraw.afEthOwed);
                console.log('fuck7');

        sellCvx(cvxToWithdraw);
        // use call to send eth instead
        payable(msg.sender).transfer(address(this).balance);
    }

    // // TODO look into gas costs of this
    // function processWithdrawQueue(uint _maxIterations) public override {
    //     (, uint256 unlockable, , ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
    //         address(this)
    //     );
    //     if (unlockable == 0) return;

    //     // get price before nlocking change the prices
    //     uint256 priceBeforeUnlock = price();

    //     // unlock all (theres no way to unlock individual locks)
    //     ILockedCvx(VLCVX_ADDRESS).processExpiredLocks(false);
    //     uint256 unlockedCvxBalance = IERC20(CVX_ADDRESS).balanceOf(
    //         address(this)
    //     );
    //     require(unlockedCvxBalance > 0, "No unlocked CVX to process queue");

    //     uint256 cvxUnlockObligations = afEthUnlockObligations * priceBeforeUnlock;

    //     // relock everything minus unlock queue obligations
    //     uint256 cvxAmountToRelock = cvxUnlockObligations > unlockedCvxBalance ? 0 : unlockedCvxBalance - cvxUnlockObligations;
    //     if(cvxAmountToRelock > 0) {
    //         IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmountToRelock);
    //         ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmountToRelock, 0);
    //     }
    //     uint256 i;

    //     for (i = nextQueuePositionToProcess; i < queueSize; i++) {
    //         if(unlockedCvxBalance == 0) return;
    //         if(_maxIterations == 0) break;
    //         _maxIterations--;

    //         UnlockQueuePosition storage position = unlockQueue[i];

    //         // look into precision loss here, why does it become inexact?
    //         uint256 remainingCvxToWithdrawFromPosition = ((position.afEthOwed -
    //             position.afEthWithdrawn) * priceBeforeUnlock) / 1e18;

    //         if (remainingCvxToWithdrawFromPosition == 0) continue;

    //         uint256 cvxToSell = remainingCvxToWithdrawFromPosition >=
    //             unlockedCvxBalance
    //             ? unlockedCvxBalance
    //             : remainingCvxToWithdrawFromPosition;
    //         // fix edge case where roundoff error can made it higher than balance on edge case
    //         cvxToSell = unlockedCvxBalance > cvxToSell ? cvxToSell : unlockedCvxBalance;

    //         uint256 afEthToBurn = (cvxToSell * 1e18) / priceBeforeUnlock;

    //         // fixes roundoff error bug that can cause underflow edge case
    //         afEthToBurn = afEthToBurn > address(this).balance ? address(this).balance : afEthToBurn;
    //         unlockedCvxBalance -= cvxToSell;
    //         afEthUnlockObligations -= afEthToBurn;
    //         position.afEthWithdrawn += afEthToBurn;
    //         _burn(msg.sender, afEthToBurn);
    //         sellCvx(cvxToSell);

    //         // use call to send eth instead
    //         payable(position.owner).transfer(address(this).balance);
    //     }
    //     nextQueuePositionToProcess = i;
    // }
}
