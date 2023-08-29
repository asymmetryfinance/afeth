// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../external_interfaces/IChainlinkFeed.sol";

contract ChainLinkRethFeedMock is IChainlinkFeed {
    constructor() {}

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (
            uint80(18446744073709551666),
            int256(1068600000000000000),
            0,
            block.timestamp,
            0
        );
    }
}
