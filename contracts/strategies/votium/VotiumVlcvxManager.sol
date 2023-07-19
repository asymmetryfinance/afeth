// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../../external_interfaces/ILockedCvx.sol";
import "../../external_interfaces/ISnapshotDelegationRegistry.sol";
import "../../external_interfaces/IVotiumMerkleStash.sol";
import "../../external_interfaces/IClaimZap.sol";

/// Handles logic related to locking and unlocking the underlying cvx
contract VotiumVlcvxManager {
    address public constant SNAPSHOT_DELEGATE_REGISTRY =
        0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446;
    address constant CVX = 0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B;
    address constant vlCVX = 0x72a19342e8F1838460eBFCCEf09F6585e32db86E;

    // last epoch in which relock was called
    uint256 public lastRelockEpoch;

    // cvx amount we cant relock because users have closed the positions and can now withdraw
    uint256 public cvxToLeaveUnlocked;

    // how much total rewards was claimed by the lock manager on each epoch
    mapping(uint256 => uint256) public rewardsClaimedPerEpoch;

    // what is the last epoch for which rewards have been fully claimed
    uint256 public lastRewardEpochClaimed;

    struct VlCvxPosition {
        address owner;
        uint256 cvxAmount; // amount of cvx locked in this position
        uint256 firstRelockEpoch; // first epoch in which funds are automatically relocked or eligible for unlock (if previously requested)
        uint256 firstRewardEpoch; // first epoch that will earn votium rewards for this locked position
        uint256 lastRewardEpochClaimed; // last epoch that rewards were claimed for this position
    }

    mapping(uint256 => VlCvxPosition) public vlCvxPositions;

    // epoch at which amount should be unlocked
    mapping(uint256 => uint256) public unlockSchedule;

        error SwapFailed(uint256 index);

    struct SwapData {
        address sellToken;
        address buyToken;
        address spender;
        address swapTarget;
        bytes swapCallData;
    }

    function initializeLockManager() internal {
        bytes32 VotiumVoteDelegationId = 0x6376782e65746800000000000000000000000000000000000000000000000000;
        address DelegationRegistry = 0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446;
        address votiumVoteProxyAddress = 0xde1E6A7ED0ad3F61D531a8a78E83CcDdbd6E0c49;
        ISnapshotDelegationRegistry(DelegationRegistry).setDelegate(
            VotiumVoteDelegationId,
            votiumVoteProxyAddress
        );
        lastRelockEpoch = ILockedCvx(vlCVX).findEpochId(block.timestamp);
    }

    function lockCvx(
        uint256 cvxAmount,
        uint256 positionId,
        address owner
    ) internal {
        uint256 currentEpoch = ILockedCvx(vlCVX).findEpochId(block.timestamp);
        vlCvxPositions[positionId].owner = owner;
        vlCvxPositions[positionId].cvxAmount = cvxAmount;
        vlCvxPositions[positionId].firstRelockEpoch = currentEpoch + 17;
        vlCvxPositions[positionId].firstRewardEpoch = currentEpoch % 2 == 0
            ? currentEpoch + 2
            : currentEpoch + 1;

        IERC20(CVX).approve(vlCVX, cvxAmount);
        ILockedCvx(vlCVX).lock(address(this), cvxAmount, 0);
    }

    /// Called by our oracle at the beginning of each new epoch
    /// relocks cvx and claim rewards if possible
    ///
    /// this should be called around the same time each epoch
    /// because vlCvx rewards are constant it would be unfair/inconsistent to claim at different times the way it distributes rewards into epochs
    /// its also not a huge deal because vlCvx is a much smaller part of the overall rewards
    function oracleUpdateAll(IVotiumMerkleStash.ClaimParam[] calldata claimProofs, SwapData[] calldata swapsData) public {
        oracleRelockCvx();
        oracleClaimRewards(claimProofs);
        oracleSellRewards(swapsData);
    }

    /// sell any number of erc20's via 0x in a single tx
    function oracleSellRewards(
        SwapData[] calldata swapsData
    ) public returns (uint256 ethReceived) {
        uint256 ethBalanceBefore = address(this).balance;
        for (uint256 i = 0; i < swapsData.length; i++) {
            IERC20(swapsData[i].sellToken).approve(
                address(swapsData[i].spender),
                type(uint256).max
            );
            (bool success, ) = swapsData[i].swapTarget.call(
                swapsData[i].swapCallData
            );
            // TODO this line will cause them all to fail. look into how to handle this
            if (!success) revert SwapFailed(i);
        }
        uint256 ethBalanceAfter = address(this).balance;
        ethReceived = ethBalanceAfter - ethBalanceBefore;
    }

    function oracleClaimVotiumRewards(IVotiumMerkleStash.ClaimParam[] calldata claimProofs) public {
        IVotiumMerkleStash(0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A)
            .claimMulti(address(this), claimProofs);
    }

    function oracleClaimvlCvxRewards() public {
        address[] memory emptyArray;
        IClaimZap(0x3f29cB4111CbdA8081642DA1f75B3c12DECf2516).claimRewards(
            emptyArray,
            emptyArray,
            emptyArray,
            emptyArray,
            0,
            0,
            0,
            0,
            8
        );
    }

    function oracleClaimRewards(IVotiumMerkleStash.ClaimParam[] calldata claimProofs) public {
        uint256 currentEpoch = ILockedCvx(vlCVX).findEpochId(block.timestamp);

        if(lastRewardEpochClaimed == currentEpoch - 1) revert("already called claim");

        uint256 balanceBeforeClaim = address(this).balance;
        oracleClaimVotiumRewards(claimProofs);
        oracleClaimvlCvxRewards();
        uint256 balanceAfterClaim = address(this).balance;

        uint256 claimed = (balanceAfterClaim - balanceBeforeClaim);

        uint256 unclaimedEpochCount = currentEpoch - lastRewardEpochClaimed - 1;
        uint256 rewardsPerCompletedEpoch = claimed / unclaimedEpochCount;

        for (uint256 i = lastRewardEpochClaimed + 1; i < currentEpoch; i++) {
            rewardsClaimedPerEpoch[i] = rewardsPerCompletedEpoch;
        }

        lastRewardEpochClaimed = currentEpoch - 1;
    }

    /// Called by our oracle at the beginning of each new epoch
    /// Leaves cvx unlocked for any that have requested to close their position
    /// Relocks any unlocked cvx from positions that have not requested to close
    function oracleRelockCvx() private {
        uint256 currentEpoch = ILockedCvx(vlCVX).findEpochId(block.timestamp);
        if (lastRelockEpoch == currentEpoch) return;

        (, uint256 unlockable, , ) = ILockedCvx(vlCVX).lockedBalances(
            address(this)
        );

        if (unlockable == 0) return;
        // unlock all (theres no way to unlock individual locks)
        ILockedCvx(vlCVX).processExpiredLocks(false);

        uint256 unlockedCvxBalance = IERC20(CVX).balanceOf(address(this));

        // nothing to relock
        if (unlockedCvxBalance == 0) return;

        uint256 toUnlock = 0;
        // we overlap with the previous relock by 1 epoch
        // to make sure we dont miss any if they requested an unlock on the same epoch but after relockCvx() was called
        // TODO put more tests around this logic
        for (uint256 i = currentEpoch; i > lastRelockEpoch - 1; i--) {
            toUnlock += unlockSchedule[i];
            unlockSchedule[i] = 0;
        }
        cvxToLeaveUnlocked += toUnlock;

        // relock everything minus unlocked obligations
        uint256 cvxAmountToRelock = unlockedCvxBalance - cvxToLeaveUnlocked;

        // nothing to relock
        if (cvxAmountToRelock == 0) return;

        IERC20(CVX).approve(vlCVX, cvxAmountToRelock);
        ILockedCvx(vlCVX).lock(address(this), cvxAmountToRelock, 0);
        lastRelockEpoch = currentEpoch;
    }

}