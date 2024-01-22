// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract MockOracle is AggregatorV3Interface {
    uint8 public constant decimals = 18;
    string public constant description = "Mock Oracle";
    uint256 public constant version = 0;

    uint256 internal updatedAt;
    int256 public price;
    uint80 internal roundId = 1;

    function update(int256 newAnswer) external {
        price = newAnswer;
        updatedAt = block.timestamp;
    }

    function update() external {
        updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 timestamp) external {
        updatedAt = timestamp;
    }

    function setRoundId(uint80 newRoundId) external {
        roundId = newRoundId;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, price, 0, updatedAt, 0);
    }

    function getRoundData(uint80) external pure returns (uint80, int256, uint256, uint256, uint80) {
        revert();
    }
}
