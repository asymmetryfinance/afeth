// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./SafEthStrategyCore.sol";
import "../AbstractNftStrategy.sol";
import "../../external_interfaces/ISafEth.sol";

import "hardhat/console.sol";

contract SafEthStrategy is AbstractNftStrategy, SafEthStrategyCore {
    function mint() external payable override onlyOwner returns (uint256) {
        uint256 mintAmount = ISafEth(safEthAddress).stake{value: msg.value}(
            0 // TODO: set minAmount
        );
        uint256 newPositionId = positionCount;
        positionCount++;

        // storage of individual balances associated w/ user deposit
        positions[newPositionId] = Position({
            unlockTime: 0,
            ethClaimed: 0,
            ethBurned: 0,
            startingValue: msg.value,
            owner: msg.sender
        });

        safEthPositions[newPositionId] = SafEthPosition({
            safEthAmount: mintAmount
        });
        return newPositionId;
    }

    function requestClose(uint256 _positionId) external override onlyOwner {
        require(positions[_positionId].owner == msg.sender, "Not owner");
        positions[_positionId].unlockTime = block.timestamp;
    }

    function burn(uint256 _positionId) external override onlyOwner {
        require(
            positions[_positionId].unlockTime != 0,
            "requestClose() not called"
        );
        address positionOwner = positions[_positionId].owner;

        uint256 ethBalanceBefore = address(this).balance;
        ISafEth(safEthAddress).unstake(
            safEthPositions[_positionId].safEthAmount,
            0
        ); // TODO do we need minout here?
        uint256 ethBalanceAfter = address(this).balance;
        uint256 ethReceived = ethBalanceAfter - ethBalanceBefore;

        positions[_positionId].ethBurned += ethReceived;
        safEthPositions[_positionId].safEthAmount = 0;

        // solhint-disable-next-line
        (bool sent, ) = positionOwner.call{value: ethReceived}("");
        require(sent, "Failed to send Ether");
    }

    function claimRewards(uint256 _positionId) external override onlyOwner {
        // noop for safEth. rewards are built accured with price going up between minting and burning
    }

    function claimableNow(
        uint256 _positionId
    ) external pure override returns (uint256 ethAmount) {
        return 0; // This strategy gets its rewards from price going up between minting and burning.
    }

    function lockedValue(
        uint256 _positionId
    ) external view override returns (uint256 ethValue) {
        return
            (ISafEth(safEthAddress).approxPrice(false) *
                safEthPositions[_positionId].safEthAmount) / 1e18;
    }
}
