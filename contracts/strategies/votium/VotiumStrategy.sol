// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./VotiumStrategyCore.sol";
import "../AbstractNftStrategy.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract VotiumStrategy is VotiumStrategyCore, AbstractNftStrategy {
    function mint() public payable override returns (uint256) {
        uint256 cvxAmount = buyCvx(msg.value);
        IERC20(CVX).approve(vlCVX, cvxAmount);
        uint256 newPositionId = positionCount;
        positionCount++;
        lockCvx(cvxAmount, newPositionId);
        _mint(msg.sender, newPositionId);

        // storage of individual balances associated w/ user deposit
        positions[newPositionId] = Position({
            unlockTime: 0,
            ethClaimed: 0,
            ethBurned: 0,
            startingValue: msg.value
        });
        return newPositionId;
    }

    function requestClose(uint256 positionId) public override {
        require(ownerOf(positionId) == msg.sender, "Not owner");
        require(positions[positionId].unlockTime != 0, "Not open");
        uint256 currentEpoch = ILockedCvx(vlCVX).findEpochId(block.timestamp);

        uint256 firstRelockEpoch = vlCvxPositions[positionId].firstRelockEpoch;

        uint256 unlockEpoch;

        // position has been relocked since the originalUnlockEpoch passed
        // calculate its new unlock epoch
        if (currentEpoch >= firstRelockEpoch) {
            uint256 epochDifference = currentEpoch - firstRelockEpoch;
            uint256 extraLockLengths = (epochDifference / 16) + 1;
            unlockEpoch = firstRelockEpoch + extraLockLengths * 16;
        } else {
            unlockEpoch = firstRelockEpoch;
        }

        (, uint256 unlockEpochStartingTime) = ILockedCvx(vlCVX)
            .epochs(unlockEpoch);

        positions[positionId].unlockTime = unlockEpochStartingTime;
        unlockSchedule[unlockEpoch] += vlCvxPositions[positionId].cvxAmount;
    }

    function burn(uint256 positionId) public override {
        require(
            positions[positionId].unlockTime != 0,
            "requestClose() not called"
        );
        require(
            positions[positionId].unlockTime > block.timestamp,
            "still locked"
        );
        _burn(positionId);
        this.claimRewards(positionId);
        uint256 ethReceived = sellCvx(vlCvxPositions[positionId].cvxAmount);
        // solhint-disable-next-line
        (bool sent, ) = address(ownerOf(positionId)).call{value: ethReceived}(
            ""
        );
        require(sent, "Failed to send Ether");
    }

    function claimRewards(uint256 positionId) public override {
        uint256 firstRewardEpoch = vlCvxPositions[positionId]
            .lastRewardEpochFullyClaimed != 0
            ? vlCvxPositions[positionId].lastRewardEpochFullyClaimed + 1
            : vlCvxPositions[positionId].firstRewardEpoch;
        require(
            firstRewardEpoch <= lastRewardEpochFullyClaimed,
            "call claim on oracle"
        );

        uint256 positionAmount = vlCvxPositions[positionId].cvxAmount;

        uint256 claimable = 0;

        // add up total rewards for a position up until the last epoch claimed via the oracle
        for (
            uint256 i = firstRewardEpoch;
            i < lastRewardEpochFullyClaimed + 1;
            i++
        ) {
            uint256 balanceAtEpoch = ILockedCvx(vlCVX).balanceAtEpochOf(
                i,
                address(this)
            );
            if (balanceAtEpoch == 0) continue;
            uint256 positionLockRatio = (positionAmount * 10 ** 18) /
                balanceAtEpoch;

            uint256 claimed = (positionLockRatio * rewardsClaimedPerEpoch[i]) /
                10 ** 18;
            claimable += claimed;
        }

        require(claimable > 0, "no rewards to claim");

        vlCvxPositions[positionId]
            .lastRewardEpochFullyClaimed = lastRewardEpochFullyClaimed;
        // solhint-disable-next-line
        (bool sent, ) = address(ownerOf(positionId)).call{value: claimable}("");
        require(sent, "Failed to send Ether");
    }

    function claimableNow(
        uint256 positionId
    ) public view override returns (uint256 ethAmount) {
        uint256 firstRewardEpoch = vlCvxPositions[positionId]
            .lastRewardEpochFullyClaimed != 0
            ? vlCvxPositions[positionId].lastRewardEpochFullyClaimed + 1
            : vlCvxPositions[positionId].firstRewardEpoch;

        if (firstRewardEpoch > lastRewardEpochFullyClaimed) return 0;

        uint256 positionAmount = vlCvxPositions[positionId].cvxAmount;

        uint256 totalRewards = 0;

        // add up total rewards for a position up until unlock epoch -1
        for (
            uint256 i = firstRewardEpoch;
            i < lastRewardEpochFullyClaimed + 1;
            i++
        ) {
            uint256 balanceAtEpoch = ILockedCvx(vlCVX).balanceAtEpochOf(
                i,
                address(this)
            );
            if (balanceAtEpoch == 0) continue;
            uint256 positionLockRatio = (positionAmount * 10 ** 18) /
                balanceAtEpoch;

            uint256 claimed = (positionLockRatio * rewardsClaimedPerEpoch[i]) /
                10 ** 18;
            totalRewards += claimed;
        }
        return totalRewards;
    }

    function lockedValue(
        uint256 positionId
    ) public view override returns (uint256 ethValue) {
        AggregatorV3Interface chainLinkCvxEthFeed = AggregatorV3Interface(
            0xC9CbF687f43176B302F03f5e58470b77D07c61c6
        );
        (, int256 chainLinkCvxEthPrice, , , ) = chainLinkCvxEthFeed
            .latestRoundData();
        return
            vlCvxPositions[positionId].cvxAmount *
            uint256(chainLinkCvxEthPrice); // TODO does this need to be divided by 1 e18?
    }
}
