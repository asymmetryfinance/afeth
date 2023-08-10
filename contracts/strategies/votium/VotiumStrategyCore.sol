// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../../external_interfaces/IWETH.sol";
import "../../external_interfaces/ISwapRouter.sol";
import "../../external_interfaces/IVotiumMerkleStash.sol";
import "../../external_interfaces/ISnapshotDelegationRegistry.sol";
import "../../external_interfaces/ILockedCvx.sol";
import "../../external_interfaces/IClaimZap.sol";
import "../../external_interfaces/ICrvEthPool.sol";

/// For private internal functions and anything not exposed via the interface
contract VotiumStrategyCore is Initializable, OwnableUpgradeable {
    address public constant SNAPSHOT_DELEGATE_REGISTRY =
        0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446;
    address constant CVX_ADDRESS = 0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B;
    address constant VLCVX_ADDRESS = 0x72a19342e8F1838460eBFCCEf09F6585e32db86E;

    // last epoch in which expired locks were processed with vlcvx.processExpiredLocks()
    uint256 public lastEpochLocksProcessed;

    // cvx amount we cant relock because users have closed the positions and can now withdraw
    uint256 public cvxToLeaveUnlocked;

    // how much total rewards was claimed by the lock manager on each epoch
    mapping(uint256 => uint256) public rewardsClaimedPerEpoch;

    // what is the last epoch for which rewards have been fully claimed
    uint256 public lastRewardEpochFullyClaimed;

    struct VlCvxPosition {
        uint256 cvxAmount; // amount of cvx locked in this position
        uint256 firstRelockEpoch; // first epoch in which funds are automatically relocked or eligible for unlock (if previously requested)
        uint256 firstRewardEpoch; // first epoch that will earn votium rewards for this locked position
        uint256 lastRewardEpochFullyClaimed; // last epoch that rewards were claimed for this position
    }

    mapping(uint256 => VlCvxPosition) public vlCvxPositions;

    // epoch at which amount should be unlocked
    mapping(uint256 => uint256) public unlockSchedule;

    error SwapFailed(uint256 index);

    struct SwapData {
        address sellToken;
        address spender;
        address swapTarget;
        bytes swapCallData;
    }

    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
        @notice - Function to initialize values for the contracts
        @dev - This replaces the constructor for upgradeable contracts
        @param _manager - Address of the manager contract
    */
    function initialize(address _manager) external initializer {
        _transferOwnership(_manager);

        bytes32 VotiumVoteDelegationId = 0x6376782e65746800000000000000000000000000000000000000000000000000;
        address DelegationRegistry = 0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446;
        address votiumVoteProxyAddress = 0xde1E6A7ED0ad3F61D531a8a78E83CcDdbd6E0c49;
        ISnapshotDelegationRegistry(DelegationRegistry).setDelegate(
            VotiumVoteDelegationId,
            votiumVoteProxyAddress
        );
        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(block.timestamp);
        lastEpochLocksProcessed = currentEpoch;
        lastRewardEpochFullyClaimed = currentEpoch - 1;
    }

    bool readyToSellRewards;
    /// this should be called around the same time every other epoch
    /// because vlCvx rewards are constant it would be unfair/inconsistent to claim at different times the way it distributes rewards into epochs
    /// but its also not a huge deal because vlCvx is a much smaller part of the overall rewards
    function oracleClaimRewards(
        IVotiumMerkleStash.ClaimParam[] calldata _claimProofs
    ) public {
        require(!readyToSellRewards, "already called oracleClaimRewards");
        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(
            block.timestamp
        );

        uint256 unclaimedEpochCount = currentEpoch - lastRewardEpochFullyClaimed - 1;
        require(unclaimedEpochCount > 0, "no unclaimed epochs");

        claimVotiumRewards(_claimProofs);
        claimvlCvxRewards();

        readyToSellRewards = true;
    }

    /// this should be called right after oracleClaimRewards
    /// must be called separately because rewards must first be claimed
    /// so we have belances to generate swap data
    function oracleSellRewards(
        SwapData[] calldata _swapsData
    ) public {
        require(readyToSellRewards, "call oracleClaimRewards first");
        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(
            block.timestamp
        );

        uint256 claimed = sellRewards(_swapsData);

        uint256 unclaimedEpochCount = currentEpoch -
            lastRewardEpochFullyClaimed -
            1;
        uint256 rewardsPerCompletedEpoch = claimed / unclaimedEpochCount;

        for (
            uint256 i = lastRewardEpochFullyClaimed + 1;
            i < currentEpoch;
            i++
        ) {
            rewardsClaimedPerEpoch[i] = rewardsPerCompletedEpoch;
        }

        lastRewardEpochFullyClaimed = currentEpoch - 1;

        readyToSellRewards = false;
    }

    /// Called by our oracle at the beginning of each new epoch
    /// Leaves cvx unlocked for any that have requested to close their position
    /// Relocks any unlocked cvx from positions that have not requested to close
    function oracleRelockCvx() public {
        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(block.timestamp);
        if (lastEpochLocksProcessed == currentEpoch) return;

        (, uint256 unlockable, , ) = ILockedCvx(VLCVX_ADDRESS).lockedBalances(
            address(this)
        );

        if (unlockable == 0) return;
        // unlock all (theres no way to unlock individual locks)
        ILockedCvx(VLCVX_ADDRESS).processExpiredLocks(false);
        lastEpochLocksProcessed = currentEpoch;

        uint256 unlockedCvxBalance = IERC20(CVX_ADDRESS).balanceOf(
            address(this)
        );

        // nothing to relock
        if (unlockedCvxBalance == 0) return;

        uint256 toUnlock = 0;
        // we overlap with the previous relock by 1 epoch
        // to make sure we dont miss any if they requested an unlock on the same epoch but after relockCvx() was called
        // TODO put more tests around this logic
        for (uint256 i = currentEpoch; i > lastEpochLocksProcessed - 1; i--) {
            toUnlock += unlockSchedule[i];
            unlockSchedule[i] = 0;
        }
        cvxToLeaveUnlocked += toUnlock;

        // relock everything minus unlocked obligations
        uint256 cvxAmountToRelock = unlockedCvxBalance - cvxToLeaveUnlocked;

        // nothing to relock
        if (cvxAmountToRelock == 0) return;

        IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmountToRelock);
        ILockedCvx(VLCVX_ADDRESS).lock(address(this), cvxAmountToRelock, 0);
    }

    function lockCvx(uint256 _cvxAmount, uint256 _positionId) internal {
        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(
            block.timestamp
        );
        vlCvxPositions[_positionId].cvxAmount = _cvxAmount;
        vlCvxPositions[_positionId].firstRelockEpoch = currentEpoch + 17;
        vlCvxPositions[_positionId].firstRewardEpoch = currentEpoch % 2 == 0
            ? currentEpoch + 2
            : currentEpoch + 1;

        IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, _cvxAmount);
        ILockedCvx(VLCVX_ADDRESS).lock(address(this), _cvxAmount, 0);
    }

    function buyCvx(
        uint256 _ethAmountIn
    ) internal returns (uint256 cvxAmountOut) {
        address CVX_ETH_CRV_POOL_ADDRESS = 0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4;
        // eth -> cvx
        uint256 cvxBalanceBefore = IERC20(CVX_ADDRESS).balanceOf(address(this));
        ICrvEthPool(CVX_ETH_CRV_POOL_ADDRESS).exchange_underlying{
            value: _ethAmountIn
        }(
            0,
            1,
            _ethAmountIn,
            0 // TODO minout to something
        );
        uint256 cvxBalanceAfter = IERC20(CVX_ADDRESS).balanceOf(address(this));
        cvxAmountOut = cvxBalanceAfter - cvxBalanceBefore;
    }

    function sellCvx(
        uint256 _cvxAmountIn
    ) internal returns (uint256 ethAmountOut) {
        address CVX_ETH_CRV_POOL_ADDRESS = 0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4;
        // cvx -> eth
        uint256 ethBalanceBefore = address(this).balance;
        IERC20(CVX_ADDRESS).approve(CVX_ETH_CRV_POOL_ADDRESS, _cvxAmountIn);
        ICrvEthPool(CVX_ETH_CRV_POOL_ADDRESS).exchange_underlying(
            1,
            0,
            _cvxAmountIn,
            0 // TODO minout to something
        );
        ethAmountOut = address(this).balance - ethBalanceBefore;
    }

    /// sell any number of erc20's via 0x in a single tx
    function sellRewards(
        SwapData[] calldata _swapsData
    ) private returns (uint256 ethReceived) {
        uint256 ethBalanceBefore = address(this).balance;
        for (uint256 i = 0; i < _swapsData.length; i++) {
            IERC20(_swapsData[i].sellToken).approve(
                address(_swapsData[i].spender),
                type(uint256).max
            );
            (bool success, ) = _swapsData[i].swapTarget.call(
                _swapsData[i].swapCallData
            );
            if (!success) {
                // TODO emit an event or something?
                // this causes unsold tokens to build up in the contract, see:
                // https://app.zenhub.com/workspaces/af-engineering-636020e6fe7394001d996825/issues/gh/asymmetryfinance/safeth/478
            }
        }
        uint256 ethBalanceAfter = address(this).balance;
        ethReceived = ethBalanceAfter - ethBalanceBefore;
    }

    function claimVotiumRewards(
        IVotiumMerkleStash.ClaimParam[] calldata _claimProofs
    ) private {
        IVotiumMerkleStash(0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A)
            .claimMulti(address(this), _claimProofs);
    }

    function claimvlCvxRewards() private {
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

    receive() external payable {}
}
