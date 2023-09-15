// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../AbstractErc20Strategy.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./VotiumErc20StrategyCore.sol";

/// @title Votium Strategy Token
/// @author Asymmetry Finance
contract VotiumErc20Strategy is VotiumErc20StrategyCore, AbstractErc20Strategy {
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
     * @notice gets price in eth
     * @return price in eth
     */
    function price() external view override returns (uint256) {
        return (cvxPerVotium() * ethPerCvx()) / 1e18;
    }

    /**
     * @notice deposit eth to mint this token at current price
     * @return mintAmount amount of tokens minted
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
     * @notice request to withdraw from strategy emits event with eligible withdraw epoch
     * @notice burns afEth tokens and determines equivilent amount of cvx to start unlocking
     * @param _amount amount to request withdraw
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
        revert("Invalid Locked Amount");
    }

    /**
     * @notice withdraws from requested withdraw if eligble epoch has passed
     * @param withdrawId id of withdraw request
     */
    function withdraw(uint256 withdrawId) external override {
        require(
            withdrawIdToWithdrawRequestInfo[withdrawId].owner == msg.sender,
            "Not withdraw request owner"
        );
        require(
            this.canWithdraw(withdrawId),
            "Can't withdraw from future epoch"
        );

        require(
            !withdrawIdToWithdrawRequestInfo[withdrawId].withdrawn,
            "already withdrawn"
        );

        relock();

        uint256 cvxWithdrawAmount = withdrawIdToWithdrawRequestInfo[withdrawId]
            .cvxOwed;

        uint256 ethReceived = sellCvx(cvxWithdrawAmount);
        cvxUnlockObligations -= cvxWithdrawAmount;
        withdrawIdToWithdrawRequestInfo[withdrawId].withdrawn = true;

        // solhint-disable-next-line
        (bool sent, ) = address(msg.sender).call{value: ethReceived}("");
        if (!sent) revert FailedToSend();
    }

    /**
     * @notice relocks cvx while ensuring there is enough to cover all withdraw requests
     * @notice this happens automatically on withdraw but will need to be manually called if nowithdraws happen in an epoch where locks are expiring
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
     * @notice checks if withdraw request is eligible to be withdrawn
     * @param withdrawId id of withdraw request
     */
    function canWithdraw(
        uint256 withdrawId
    ) external view virtual override returns (bool) {
        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(
            block.timestamp
        );
        return
            withdrawIdToWithdrawRequestInfo[withdrawId].epoch <= currentEpoch;
    }

    /**
     * @notice checks how long it will take to withdraw a given amount
     * @param _amount amount of afEth to check how long it will take to withdraw
     * @return when it would be withdrawable requestWithdraw() is called now
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
        revert("Invalid Locked Amount");
    }
}
