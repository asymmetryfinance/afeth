// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../AbstractErc20Strategy.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./VotiumErc20StrategyCore.sol";

import "hardhat/console.sol";

contract VotiumErc20Strategy is VotiumErc20StrategyCore, AbstractErc20Strategy {
    event WithdrawRequest(
        address indexed user,
        uint256 amount,
        uint256 unlockEpoch
    );
    event Withdraw(
        address indexed user,
        uint256 cvxAmount,
        uint256 unlockEpoch,
        uint256 ethAmount
    );

    function mint() public payable override {
        uint256 priceBefore = price();
        uint256 cvxAmount = buyCvx(msg.value);
        IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmount);
        ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmount, 0);

        uint256 mintAmount = ((cvxAmount * 1e18) / priceBefore);

        console.log("minting amount", mintAmount);
        _mint(msg.sender, mintAmount);
    }

    function requestWithdraw(uint256 _amount) public override {
        console.log("requestWithdraw", _amount);
        uint256 priceBeforeBurn = price();
        _transfer(msg.sender, address(this), _amount);
        console.log("wd0");

        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(
            block.timestamp
        );
        (
            ,
            uint256 unlockable,
            ,
            ILockedCvx.LockedBalance[] memory lockedBalances
        ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(address(this));
        console.log("priceBeforeBurn", priceBeforeBurn);
        uint256 cvxAmount = (_amount * priceBeforeBurn) / 1e18;
        console.log("cvxUnlockObligations0", cvxAmount, cvxUnlockObligations);
        cvxUnlockObligations += cvxAmount;

        uint256 totalLockedBalancePlusUnlockable = unlockable;

        for (uint256 i = 0; i < lockedBalances.length; i++) {
            totalLockedBalancePlusUnlockable += lockedBalances[i].amount;
            // we found the epoch at which there is enough to unlock this position
            console.log(
                "totalLockedBalancePlusUnlockable",
                totalLockedBalancePlusUnlockable
            );
            console.log("cvxUnlockObligations", cvxUnlockObligations);
            if (totalLockedBalancePlusUnlockable >= cvxUnlockObligations) {
                (, uint32 currentEpochStartingTime) = ILockedCvx(VLCVX_ADDRESS)
                    .epochs(currentEpoch);
                uint256 timeDifference = lockedBalances[i].unlockTime -
                    currentEpochStartingTime;
                uint256 epochOffset = timeDifference /
                    ILockedCvx(VLCVX_ADDRESS).rewardsDuration();
                uint256 withdrawEpoch = currentEpoch + epochOffset;
                uint256 previousCvxOwed = unlockQueues[msg.sender][
                    withdrawEpoch
                ].cvxOwed;
                unlockQueues[msg.sender][withdrawEpoch] = UnlockQueuePosition({
                    cvxOwed: previousCvxOwed + cvxAmount,
                    afEthOwed: _amount,
                    priceWhenRequested: priceBeforeBurn
                });
                console.log("wd2");
                emit WithdrawRequest(msg.sender, cvxAmount, withdrawEpoch);
                break;
            }
            console.log("wd3");
        }
    }

    function withdraw(uint256 epochToWithdraw) external override {
        UnlockQueuePosition memory positionToWithdraw = unlockQueues[
            msg.sender
        ][epochToWithdraw];

        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(
            block.timestamp
        );

        require(
            epochToWithdraw <= currentEpoch,
            "Can't withdraw from future epoch"
        );
        require(positionToWithdraw.cvxOwed > 0, "Nothing to withdraw");

        (, uint256 unlockable, , ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );

        console.log("unlockable", unlockable);

        if (unlockable > 0)
            ILockedCvx(VLCVX_ADDRESS).processExpiredLocks(false);

        (, uint256 unlockable2, , ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );
        console.log("locks processed", unlockable2);

        uint256 cvxToWithdraw = positionToWithdraw.cvxOwed;

        uint256 cvxBalance = IERC20(CVX_ADDRESS).balanceOf(address(this));

        console.log(
            "cvxBalance vs cvxToWithdraw before relock",
            cvxBalance,
            cvxToWithdraw,
            cvxUnlockObligations
        );

        uint256 cvxAmountToRelock = cvxBalance > cvxUnlockObligations
            ? cvxBalance - cvxUnlockObligations
            : 0;

        cvxUnlockObligations -= cvxToWithdraw;

        _burn(address(this), positionToWithdraw.afEthOwed);

        console.log("cvxAmountToRelock", cvxAmountToRelock);
        // relock everything minus unlock queue obligations
        if (cvxAmountToRelock > 0) {
            IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmountToRelock);
            ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmountToRelock, 0);
        }

        cvxBalance = IERC20(CVX_ADDRESS).balanceOf(address(this));

        console.log(
            "cvxBalance vs cvxToWithdraw after relock",
            cvxBalance,
            cvxToWithdraw
        );

        unlockQueues[msg.sender][epochToWithdraw].cvxOwed = 0;
        uint256 balanceBefore = address(this).balance;
        console.log("abut to sell cvx", cvxToWithdraw);
        sellCvx(cvxToWithdraw);
        uint256 balanceAfter = address(this).balance;
        uint256 ethReceived = balanceAfter - balanceBefore;
        console.log("ethReceived", ethReceived);
        // TODO: use call to send eth instead
        payable(msg.sender).transfer(ethReceived);
        emit Withdraw(msg.sender, cvxToWithdraw, epochToWithdraw, ethReceived);
    }
}
