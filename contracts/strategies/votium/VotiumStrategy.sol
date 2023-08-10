// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./VotiumStrategyCore.sol";
import "../AbstractNftStrategy.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract VotiumStrategy is VotiumStrategyCore, AbstractNftStrategy {
    function mint(uint256 _positionId) public payable override onlyOwner {
        require(positions[_positionId].owner == address(0), "Already Exists");
        uint256 cvxAmount = buyCvx(msg.value);
        IERC20(CVX_ADDRESS).approve(VLCVX_ADDRESS, cvxAmount);

        lockCvx(cvxAmount, _positionId);

        // storage of individual balances associated w/ user deposit
        positions[_positionId] = Position({
            unlockTime: 0,
            ethClaimed: 0,
            ethBurned: 0,
            startingValue: msg.value,
            owner: msg.sender
        });
    }

    function requestClose(uint256 _positionId) public override onlyOwner {
        require(positions[_positionId].owner == msg.sender, "Not owner");
        require(
            positions[_positionId].unlockTime == 0,
            "Already requested close"
        );
        uint256 currentEpoch = ILockedCvx(VLCVX_ADDRESS).findEpochId(
            block.timestamp
        );
        uint256 firstRelockEpoch = vlCvxPositions[_positionId].firstRelockEpoch;

        uint256 unlockEpoch;

        // position has been relocked since the originalUnlockEpoch passed
        // calculate its new unlock epoch
        if (currentEpoch >= firstRelockEpoch) {
            uint256 epochDifference = currentEpoch - firstRelockEpoch;
            uint256 extraLockLengths = (epochDifference / 17) + 1;
            unlockEpoch = firstRelockEpoch + extraLockLengths * 17;
        } else {
            unlockEpoch = firstRelockEpoch;
        }

        (, uint256 currentEpochStartingTime) = ILockedCvx(VLCVX_ADDRESS).epochs(
            currentEpoch
        );

        positions[_positionId].unlockTime =
            currentEpochStartingTime +
            (unlockEpoch - currentEpoch) *
            (60 * 60 * 24 * 7);  // TODO: Add comment explaining numbers

        unlockSchedule[unlockEpoch] += vlCvxPositions[_positionId].cvxAmount;
    }

    function burn(uint256 _positionId) public override onlyOwner {
        require(
            positions[_positionId].unlockTime != 0,
            "requestClose() not called"
        );

        require(
            positions[_positionId].unlockTime < block.timestamp,
            "still locked"
        );
        this.claimRewards(_positionId);
        uint256 ethReceived = sellCvx(vlCvxPositions[_positionId].cvxAmount);
        positions[_positionId].ethBurned += ethReceived;
        vlCvxPositions[_positionId].cvxAmount = 0;

        // solhint-disable-next-line
        (bool sent, ) = address(positions[_positionId].owner).call{
            value: ethReceived
        }("");
        require(sent, "Failed to send Ether");
    }

    function claimRewards(uint256 _positionId) public override {
        uint256 claimable = claimableNow(_positionId);
        if(claimable == 0) return;
        vlCvxPositions[_positionId]
            .lastRewardEpochFullyClaimed = lastRewardEpochFullyClaimed;
        // solhint-disable-next-line
        (bool sent, ) = address(positions[_positionId].owner).call{
            value: claimable
        }("");
        require(sent, "Failed to send Ether");
    }

    function claimableNow(
        uint256 _positionId
    ) public view override returns (uint256 ethAmount) {
        uint256 firstPositionRewardEpoch = vlCvxPositions[_positionId]
            .lastRewardEpochFullyClaimed != 0
            ? vlCvxPositions[_positionId].lastRewardEpochFullyClaimed + 1
            : vlCvxPositions[_positionId].firstRewardEpoch;

        if(firstPositionRewardEpoch > lastRewardEpochFullyClaimed) return 0;

        uint256 positionAmount = vlCvxPositions[_positionId].cvxAmount;

        uint256 firstRelockEpoch = vlCvxPositions[_positionId].firstRelockEpoch;
        uint256 claimable = 0;

        // add up total rewards for a position up until the last epoch claimed via the oracle
        for (
            uint256 i = firstPositionRewardEpoch;
            i < lastRewardEpochFullyClaimed + 1;
            i++
        ) {
           if(i > firstRelockEpoch && (i - firstRelockEpoch) % 17 == 0) continue; // skip epochs that were relocked
            uint256 balanceAtEpoch = ILockedCvx(VLCVX_ADDRESS).balanceAtEpochOf(
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
        return claimable;
    }

    function lockedValue(
        uint256 _positionId
    ) public view override returns (uint256 ethValue) {
        AggregatorV3Interface chainLinkCvxEthFeed = AggregatorV3Interface(
            0xC9CbF687f43176B302F03f5e58470b77D07c61c6
        );
        (, int256 chainLinkCvxEthPrice, , , ) = chainLinkCvxEthFeed
            .latestRoundData();
        return
            vlCvxPositions[_positionId].cvxAmount *
            uint256(chainLinkCvxEthPrice);
    }
}
