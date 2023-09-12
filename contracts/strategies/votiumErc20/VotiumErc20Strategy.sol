// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../AbstractErc20Strategy.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./VotiumErc20StrategyCore.sol";

contract VotiumErc20Strategy is VotiumErc20StrategyCore, AbstractErc20Strategy {
    event WithdrawRequest(
        address indexed user,
        uint256 amount,
        uint256 withdrawId
    );
    event Withdraw(
        address indexed user,
        uint256 cvxAmount,
        uint256 unlockEpoch,
        uint256 ethAmount
    );

    struct WithdrawRequestInfo {
        uint256 cvxOwed;
        bool withdrawn;
        uint256 epoch;
        address owner;
    }

    mapping(uint256 => WithdrawRequestInfo)
        public withdrawIdToWithdrawRequestInfo;

    function price() external view override returns (uint256) {
        return (cvxPerVotium() * ethPerCvx()) / 1e18;
    }

    function deposit() public payable override returns (uint256 mintAmount) {
        uint256 priceBefore = cvxPerVotium();
        uint256 cvxAmount = buyCvx(msg.value);
        IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmount);
        ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmount, 0);
        mintAmount = ((cvxAmount * 1e18) / priceBefore);
        _mint(msg.sender, mintAmount);
    }

    function requestWithdraw(
        uint256 _amount
    ) public override returns (uint256 withdrawId) {
        latestWithdrawId++;
        uint256 _priceInCvx = cvxPerVotium();

        _burn(msg.sender, _amount);

        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(
            block.timestamp
        );
        (
            ,
            uint256 unlockable,
            ,
            ILockedCvx.LockedBalance[] memory lockedBalances
        ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(address(this));
        uint256 cvxAmount = (_amount * _priceInCvx) / 1e18;
        cvxUnlockObligations += cvxAmount;

        uint256 totalLockedBalancePlusUnlockable = unlockable +
            IERC20(CVX_ADDRESS).balanceOf(address(this));

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
                withdrawIdToWithdrawRequestInfo[
                    latestWithdrawId
                ] = WithdrawRequestInfo({
                    cvxOwed: cvxAmount,
                    withdrawn: false,
                    epoch: withdrawEpoch,
                    owner: msg.sender
                });

                emit WithdrawRequest(msg.sender, cvxAmount, latestWithdrawId);
                return latestWithdrawId;
            }
        }
        revert("Invalid Locked Amount");
    }

    function withdraw(uint256 withdrawId) external override {
        require(
            withdrawIdToWithdrawRequestInfo[withdrawId].owner == msg.sender,
            "Not withdraw request owner"
        );
        uint256 cvxWithdrawAmount = withdrawIdToWithdrawRequestInfo[withdrawId]
            .cvxOwed;

        require(
            this.canWithdraw(withdrawId),
            "Can't withdraw from future epoch"
        );

        require(
            !withdrawIdToWithdrawRequestInfo[withdrawId].withdrawn,
            "already withdrawn"
        );

        withdrawIdToWithdrawRequestInfo[withdrawId].withdrawn = true;

        (, uint256 unlockable, , ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );

        if (unlockable > 0)
            ILockedCvx(VLCVX_ADDRESS).processExpiredLocks(false);

        uint256 cvxBalance = IERC20(CVX_ADDRESS).balanceOf(address(this));

        uint256 cvxAmountToRelock = cvxBalance > cvxUnlockObligations
            ? cvxBalance - cvxUnlockObligations
            : 0;

        cvxUnlockObligations -= cvxWithdrawAmount;

        // relock everything minus unlock queue obligations
        if (cvxAmountToRelock > 0) {
            IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmountToRelock);
            ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmountToRelock, 0);
        }

        uint256 balanceBefore = address(this).balance;

        sellCvx(cvxWithdrawAmount);

        uint256 balanceAfter = address(this).balance;
        uint256 ethReceived = balanceAfter - balanceBefore;

        // TODO: use call to send eth instead
        payable(msg.sender).transfer(ethReceived);
        emit Withdraw(msg.sender, cvxWithdrawAmount, withdrawId, ethReceived);
    }

    function relock() public {
        (, uint256 unlockable, , ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );
        if (unlockable > 0)
            ILockedCvx(VLCVX_ADDRESS).processExpiredLocks(false);
        uint256 cvxBalance = IERC20(CVX_ADDRESS).balanceOf(address(this));
        uint256 cvxAmountToRelock = cvxBalance > cvxUnlockObligations
            ? cvxBalance - cvxUnlockObligations
            : 0;
        if (cvxAmountToRelock > 0) {
            IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmountToRelock);
            ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmountToRelock, 0);
        }
    }

    function canWithdraw(
        uint256 withdrawId
    ) external view virtual override returns (bool) {
        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(
            block.timestamp
        );
        return
            withdrawIdToWithdrawRequestInfo[withdrawId].epoch <= currentEpoch;
    }
}
