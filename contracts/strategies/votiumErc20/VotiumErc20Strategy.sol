// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../AbstractErc20Strategy.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./VotiumErc20StrategyCore.sol";

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

    function price() public view override returns (uint256) {
        return priceData();
    }

    function deposit() public payable override returns (uint256 mintAmount) {
        uint256 priceBefore = price();
        uint256 cvxAmount = buyCvx(msg.value);
        IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmount);
        ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmount, 0);

        mintAmount = ((cvxAmount * 1e18) / priceBefore);

        _mint(msg.sender, mintAmount);
    }

    function requestWithdraw(
        uint256 _amount
    ) public override returns (uint256 withdrawId) {
        uint256 _price = price();
        _transfer(msg.sender, address(this), _amount);

        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(
            block.timestamp
        );
        (
            ,
            uint256 unlockable,
            ,
            ILockedCvx.LockedBalance[] memory lockedBalances
        ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(address(this));
        uint256 cvxAmount = (_amount * _price) / 1e18;
        cvxUnlockObligations += cvxAmount;

        uint256 totalLockedBalancePlusUnlockable = unlockable;

        for (uint256 i = 0; i < lockedBalances.length; i++) {
            totalLockedBalancePlusUnlockable += lockedBalances[i].amount;
            // we found the epoch at which there is enough to unlock this position
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
                uint256 previousAfEthOwed = unlockQueues[msg.sender][
                    withdrawEpoch
                ].afEthOwed;
                unlockQueues[msg.sender][withdrawEpoch] = UnlockQueuePosition({
                    cvxOwed: previousCvxOwed + cvxAmount,
                    afEthOwed: previousAfEthOwed + _amount,
                    priceWhenRequested: _price
                });
                emit WithdrawRequest(msg.sender, cvxAmount, withdrawEpoch);
                return withdrawEpoch;
            }
        }
    }

    function withdraw(uint256 withdrawId) external override {
        UnlockQueuePosition memory positionToWithdraw = unlockQueues[
            msg.sender
        ][withdrawId];

        require(
            this.canWithdraw(withdrawId),
            "Can't withdraw from future epoch"
        );
        require(positionToWithdraw.cvxOwed > 0, "Nothing to withdraw");

        uint256 cvxToWithdraw = positionToWithdraw.cvxOwed;
        _burn(address(this), positionToWithdraw.afEthOwed);

        unlockQueues[msg.sender][withdrawId].cvxOwed = 0;
        unlockQueues[msg.sender][withdrawId].afEthOwed = 0;

        (, uint256 unlockable, , ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );

        if (unlockable > 0)
            ILockedCvx(VLCVX_ADDRESS).processExpiredLocks(false);

        uint256 cvxBalance = IERC20(CVX_ADDRESS).balanceOf(address(this));

        uint256 cvxAmountToRelock = cvxBalance > cvxUnlockObligations
            ? cvxBalance - cvxUnlockObligations
            : 0;

        cvxUnlockObligations -= cvxToWithdraw;

        // relock everything minus unlock queue obligations
        if (cvxAmountToRelock > 0) {
            IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmountToRelock);
            ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmountToRelock, 0);
        }

        cvxBalance = IERC20(CVX_ADDRESS).balanceOf(address(this));

        uint256 balanceBefore = address(this).balance;
        sellCvx(cvxToWithdraw);
        uint256 balanceAfter = address(this).balance;
        uint256 ethReceived = balanceAfter - balanceBefore;
        // TODO: use call to send eth instead
        payable(msg.sender).transfer(ethReceived);
        emit Withdraw(msg.sender, cvxToWithdraw, withdrawId, ethReceived);
    }

    function canWithdraw(uint256 withdrawId) external virtual override returns (bool) {
        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(
            block.timestamp
        );
        return withdrawId <= currentEpoch;
    }
}
