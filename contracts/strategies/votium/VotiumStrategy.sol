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
        _mint(msg.sender, newPositionId, 1e18, "");

                // storage of individual balances associated w/ user deposit
        positions[newPositionId] = Position({
            owner: msg.sender,
            unlockTime: 0,
            ethClaimed: 0,
            ethBurned: 0,
            startingValue: msg.value
        });
        return newPositionId;
    }

    function requestClose(uint256 positionId) external override onlyPositionOwner(positionId) {
        require(positions[positionId].owner == msg.sender, "Not owner");
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
        _burn(msg.sender, positionId, balanceOf(msg.sender, positionId));
    }

    function claimRewards(uint256 positionId) external override onlyPositionOwner(positionId) {
        require(this.claimableNow(positionId) > 0, "nothing to claim");
    }

    function claimableNow(
        uint256 positionId
    ) public view override returns (uint256 ethAmount) {
        return 0;
    }

    function lockedValue(
        uint256 positionId
    ) public view override returns (uint256 ethValue) {
        return 0;
    }
}
