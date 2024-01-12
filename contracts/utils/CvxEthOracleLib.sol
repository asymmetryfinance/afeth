// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";

/// @author philogy <https://github.com/philogy>
library CvxEthOracleLib {
    using FixedPointMathLib for uint256;

    AggregatorV3Interface internal constant CVX_ETH_ORACLE =
        AggregatorV3Interface(0xC9CbF687f43176B302F03f5e58470b77D07c61c6);

    error InvalidOracleData();
    error OracleDataStale();

    /// @dev Heartbeat of CVX-ETH oracle is 24h according to [Chainlink](https://data.chain.link/ethereum/mainnet/crypto-eth/cvx-eth)
    uint256 internal constant ORACLE_STALENESS_WINDOW = 25 hours;

    /// @dev For reference purposes, assumed to remain constant
    uint256 internal constant ORACLE_DECIMALs = 18;

    /**
     * @notice Returns the ETH/CVX price
     * @return ETH/CVX Price denominated in {ORACLE_DECIMALs} decimals.
     */
    function ethCvxPrice() internal view returns (uint256) {
        (uint80 roundId, int256 answer, /* startedAt */, uint256 updatedAt, /* answeredInRound */ ) =
            CVX_ETH_ORACLE.latestRoundData();

        if (roundId == 0 || answer < 0 || updatedAt == 0) revert InvalidOracleData();

        if (block.timestamp - updatedAt > ORACLE_STALENESS_WINDOW) revert OracleDataStale();

        return uint256(answer);
    }

    function convertToCvx(uint256 ethAmount) internal view returns (uint256) {
        return ethAmount.divWad(ethCvxPrice());
    }

    function convertToEth(uint256 cvxAmount) internal view returns (uint256) {
        // Can use Solady because oracle decimals are 18 (WAD).
        return cvxAmount.mulWad(ethCvxPrice());
    }
}
