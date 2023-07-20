import "./VotiumStrategyCore.sol";
import "../../AbstractNftStrategy.sol";

// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

contract VotiumStrategy is VotiumStrategyCore, AbstractNftStrategy {
    function mint() external payable override returns (uint256) {
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

    function requestClose(uint256 positionId) external override onlyPositionOwner(positionId) {
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

        (uint256 _unused2, uint256 unlockEpochStartingTime) = ILockedCvx(vlCVX)
            .epochs(unlockEpoch);

        positions[positionId].unlockTime = unlockEpochStartingTime;
        unlockSchedule[unlockEpoch] += vlCvxPositions[positionId].cvxAmount;
    }
    

    function burn(uint256 positionId) external override onlyPositionOwner(positionId) {
        require(positions[positionId].unlockTime != 0, "requestClose() not called");
        require(positions[positionId].unlockTime > block.timestamp, "still locked");
        require(ownerOf(positionId) == msg.sender, "Not owner");
        _burn(positionId);
        // TODO - sell cvx for eth, claim remaimning rewards and send user eth
    }

    function claimRewards(uint256 positionId) external override onlyPositionOwner(positionId) {
        require(this.claimableNow(positionId) > 0, "nothing to claim");

        uint256 firstRewardEpoch = vlCvxPositions[positionId].lastRewardEpochFullyClaimed != 0 ?  vlCvxPositions[positionId].lastRewardEpochFullyClaimed + 1 : vlCvxPositions[positionId].firstRewardEpoch;

        uint256 unlockEpoch = ILockedCvx(vlCVX).findEpochId(positions[positionId].unlockTime);

        uint256 positionAmount = vlCvxPositions[positionId].cvxAmount;

        uint256 totalRewards = 0;

        // add up total rewards for a position up until unlock epoch -1
        for (uint256 i = firstRewardEpoch; i < unlockEpoch; i++) {
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

        vlCvxPositions[positionId].lastRewardEpochFullyClaimed= unlockEpoch - 1;

        // solhint-disable-next-line
        (bool sent, ) = address(msg.sender).call{value: totalRewards}("");
        require(sent, "Failed to send Ether");
    }

    function claimableNow(
        uint256 positionId
    ) public view override returns (uint256 ethAmount) {
        return 0; // TODO
    }

    function lockedValue(
        uint256 positionId
    ) public view override returns (uint256 ethValue) {
        return 0; // TODO
    }
}
