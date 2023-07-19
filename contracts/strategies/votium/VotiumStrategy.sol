import "./VotiumStrategyCore.sol";
import "../../NftStrategy.sol";

// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

contract VotiumStrategy is VotiumStrategyCore, NftStrategy {
    // how many individual tokens to mint per erc1155 position
    uint256 public positionDivisibility = 10e18;

    function mint() external payable override returns (uint256) {
        _mint(msg.sender, positionCount, positionDivisibility, "");
        positionCount++;
        return positionCount;
    }

    function requestClose(uint256 positionId) external override {
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
    

    function burn(uint256 positionId) external override {
        _burn(msg.sender, positionId, balanceOf(msg.sender, positionId));
    }

    function claimRewards(uint256 positionId) external override {
        require(this.claimableNow(positionId) > 0, "nothing to claim");
    }

    function claimableNow(
        uint256 positionId
    ) external view override returns (uint256 ethAmount) {
        return 0;
    }

    function lockedValue(
        uint256 positionId
    ) external view override returns (uint256 ethValue) {
        return 0;
    }
}
