// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../../external_interfaces/ILockedCvx.sol";
import "../../external_interfaces/ISnapshotDelegationRegistry.sol";

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

    struct VlCvxPosition {
        address owner;
        uint256 cvxAmount; // amount of cvx locked in this position
        uint256 firstRelockEpoch; // first epoch in which funds are relocked or eligible for unlock (if previously requested)
    }

    mapping(uint256 => VlCvxPosition) public vlCvxPositions;

    // epoch at which amount should be unlocked
    mapping(uint256 => uint256) public unlockSchedule;

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
        vlCvxPositions[positionId].owner = owner;
        vlCvxPositions[positionId].cvxAmount = cvxAmount;
        vlCvxPositions[positionId].firstRelockEpoch = ILockedCvx(vlCVX).findEpochId(block.timestamp) + 17;
        IERC20(CVX).approve(vlCVX, cvxAmount);
        ILockedCvx(vlCVX).lock(address(this), cvxAmount, 0);
    }

    /// Called by our oracle at the beginning of each new epoch
    /// relocks cvx and claim rewards if possible
    function oracleUpdate() public {
        relockCvx();
        claimRewards();
    }

    function claimRewards() private {

    }

    /// Called by our oracle at the beginning of each new epoch
    /// Leaves cvx unlocked for any that have requested to close their position
    /// Relocks any unlocked cvx from positions that have not requested to close
    function relockCvx() private {
        uint256 currentEpoch = ILockedCvx(vlCVX).findEpochId(block.timestamp);
        if (lastRelockEpoch == currentEpoch) return;

        (, uint256 unlockable, , ) = ILockedCvx(vlCVX).lockedBalances(
            address(this)
        );

        // nothing to unlock
        if (unlockable == 0) return;
        // unlock all
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
