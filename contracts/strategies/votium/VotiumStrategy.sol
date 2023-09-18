// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../AbstractStrategy.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./VotiumStrategyCore.sol";

/// @title Votium Strategy Token
/// @author Asymmetry Finance
contract VotiumStrategy is VotiumStrategyCore, AbstractStrategy {
    event WithdrawRequest(
        address indexed user,
        uint256 amount,
        uint256 withdrawId
    );

    struct WithdrawRequestInfo {
        uint256 cvxOwed;
        bool withdrawn;
        uint256 epoch;
        address owner;
    }

    mapping(uint256 => WithdrawRequestInfo)
        public withdrawIdToWithdrawRequestInfo;

    /**
     * @notice Gets price in eth
     * @return Price of token in eth
     */
    function price() external view override returns (uint256) {
        return (cvxPerVotium() * ethPerCvx(false)) / 1e18;
    }

    /**
     * @notice Deposit eth to mint this token at current price
     * @return mintAmount Amount of tokens minted
     */
    function deposit() public payable override returns (uint256 mintAmount) {
        uint256 priceBefore = cvxPerVotium();
        uint256 cvxAmount = buyCvx(msg.value);
        IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmount);
        ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmount, 0);
        mintAmount = ((cvxAmount * 1e18) / priceBefore);
        _mint(msg.sender, mintAmount);
    }

    /**
     * @notice Request to withdraw from strategy emits event with eligible withdraw epoch
     * @notice Burns afEth tokens and determines equivilent amount of cvx to start unlocking
     * @param _amount Amount to request withdraw
     * @return withdrawId Id of withdraw request
     */
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
        // should never get here
        revert InvalidLockedAmount();
    }

    /**
     * @notice Withdraws from requested withdraw if eligible epoch has passed
     * @param _withdrawId Id of withdraw request
     */
    function withdraw(uint256 _withdrawId) external override {
        if (withdrawIdToWithdrawRequestInfo[_withdrawId].owner != msg.sender)
            revert NotOwner();
        if (!this.canWithdraw(_withdrawId)) revert WithdrawNotReady();

        if (withdrawIdToWithdrawRequestInfo[_withdrawId].withdrawn)
            revert AlreadyWithdrawn();

        relock();

        uint256 cvxWithdrawAmount = withdrawIdToWithdrawRequestInfo[_withdrawId]
            .cvxOwed;

        uint256 ethReceived = sellCvx(cvxWithdrawAmount);
        cvxUnlockObligations -= cvxWithdrawAmount;
        withdrawIdToWithdrawRequestInfo[_withdrawId].withdrawn = true;

        // solhint-disable-next-line
        (bool sent, ) = msg.sender.call{value: ethReceived}("");
        if (!sent) revert FailedToSend();
    }

    /**
     * @notice Relocks cvx while ensuring there is enough to cover all withdraw requests
     * @dev This happens automatically on withdraw but will need to be manually called if no withdraws happen in an epoch where locks are expiring
     */
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

    /**
     * @notice Checks if withdraw request is eligible to be withdrawn
     * @param _withdrawId Id of withdraw request
     */
    function canWithdraw(
        uint256 _withdrawId
    ) external view virtual override returns (bool) {
        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(
            block.timestamp
        );
        return
            withdrawIdToWithdrawRequestInfo[_withdrawId].epoch <= currentEpoch;
    }

    /**
     * @notice Checks how long it will take to withdraw a given amount
     * @param _amount Amount of afEth to check how long it will take to withdraw
     * @return When it would be withdrawable based on the amount
     */
    function withdrawTime(
        uint256 _amount
    ) external view virtual override returns (uint256) {
        uint256 _priceInCvx = cvxPerVotium();
        (
            ,
            uint256 unlockable,
            ,
            ILockedCvx.LockedBalance[] memory lockedBalances
        ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(address(this));
        uint256 cvxAmount = (_amount * _priceInCvx) / 1e18;
        uint256 totalLockedBalancePlusUnlockable = unlockable +
            IERC20(CVX_ADDRESS).balanceOf(address(this));

        for (uint256 i = 0; i < lockedBalances.length; i++) {
            totalLockedBalancePlusUnlockable += lockedBalances[i].amount;
            // we found the epoch at which there is enough to unlock this position
            if (
                totalLockedBalancePlusUnlockable >=
                cvxUnlockObligations + cvxAmount
            ) {
                return lockedBalances[i].unlockTime;
            }
        }
        revert InvalidLockedAmount();
    }
}
