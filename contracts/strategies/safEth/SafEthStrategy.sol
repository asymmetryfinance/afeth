// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./SafEthStrategyCore.sol";
import "../AbstractNftStrategy.sol";
import "../../external_interfaces/ISafEth.sol";

import "hardhat/console.sol";

contract SafEthStrategy is AbstractNftStrategy, SafEthStrategyCore {
    function mint() external payable override returns (uint256) {
        uint256 mintAmount = ISafEth(safEthAddress).stake{value: msg.value}(
            0 // TODO: set minAmount
        );
        uint256 newPositionId = positionCount;
        positionCount++;
        _mint(msg.sender, newPositionId);

        // storage of individual balances associated w/ user deposit
        positions[newPositionId] = Position({
            unlockTime: 0,
            ethClaimed: 0,
            ethBurned: 0,
            startingValue: msg.value
        });

        safEthPositions[newPositionId] = SafEthPosition({
            safEthAmount: mintAmount
        });
        return newPositionId;
    }

    function requestClose(uint256 positionId) external override {
        require(ownerOf(positionId) == msg.sender, "Not owner");
        positions[positionId].unlockTime = block.timestamp;
    }

    function burn(uint256 positionId) external override {
        require(positions[positionId].unlockTime != 0, "requestClose() not called");
        address positionOwner = ownerOf(positionId);
        _burn(positionId);
        uint256 ethBalanceBefore = address(this).balance;
        ISafEth(safEthAddress).unstake(safEthPositions[positionId].safEthAmount, 0); // TODO do we need minout here?
        uint256 ethBalanceAfter = address(this).balance;
        uint256 ethReceived = ethBalanceAfter - ethBalanceBefore;

        positions[positionId].ethBurned += ethReceived;
        safEthPositions[positionId].safEthAmount = 0;

        // solhint-disable-next-line
        (bool sent, ) = positionOwner.call{value: ethReceived}(
            ""
        );
        require(sent, "Failed to send Ether");
    }

    function claimRewards(uint256 positionId) external override {
        // noop for safEth. rewards are built accured with price going up between minting and burning
    }

    function claimableNow(
        uint256 positionId
    ) external pure override returns (uint256 ethAmount) {
        return 0; // This strategy gets its rewards from price going up between minting and burning.
    }

    function lockedValue(
        uint256 positionId
    ) external view override returns (uint256 ethValue) {
        return (ISafEth(safEthAddress).approxPrice() * safEthPositions[positionId].safEthAmount) / 1e18;
    }
}
