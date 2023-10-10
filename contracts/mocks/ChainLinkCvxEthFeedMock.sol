// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../external_interfaces/IChainlinkFeed.sol";

contract ChainLinkCvxEthFeedMock is IChainlinkFeed {
    int80 roundId;
    int256 answer;

    constructor() {
        roundId = 18446744073709551666;
        answer = 1696463979959848;
    }

    function setLatestRoundData(int80 _roundId, int256 _answer) external {
        roundId = _roundId;
        answer = _answer;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (
            uint80(roundId),
            int256(answer),
            0,
            block.timestamp,
            0
        );
    }
}
