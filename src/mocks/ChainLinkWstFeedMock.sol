// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IChainlinkFeed} from "../interfaces/IChainlinkFeed.sol";

contract ChainLinkWstFeedMock is IChainlinkFeed {
    constructor() {}

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (uint80(18446744073709551666), int256(999408541700000000), 0, block.timestamp, 0);
    }
}
