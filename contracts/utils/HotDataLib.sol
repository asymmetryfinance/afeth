// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

type HotData is uint96;

using HotDataLib for HotData global;

/// @author philogy <https://github.com/philogy>
library HotDataLib {
    error DoesNotFitIntoBits();

    function setPaused(HotData data, bool pause) internal pure returns (HotData updated) {
        /// @solidity memory-safe-assembly
        assembly {
            updated := or(and(data, 0xfffffffffffffffffffffffe), iszero(iszero(pause)))
        }
    }

    function paused(HotData data) internal pure returns (bool pause) {
        /// @solidity memory-safe-assembly
        assembly {
            pause := and(data, 1)
        }
    }

    function setLastLockedRewards(HotData data, uint256 lastLockedRewards) internal pure returns (HotData updated) {
        uint256 lastLockedRewardsGwei = lastLockedRewards / 1 gwei;
        _validateBitSize(lastLockedRewardsGwei, 63);
        /// @solidity memory-safe-assembly
        assembly {
            updated := or(and(data, 0x1ffffffff), shl(33, lastLockedRewardsGwei))
        }
    }

    function getLastLockedRewards(HotData data) internal pure returns (uint256 lastLockedRewards) {
        /// @solidity memory-safe-assembly
        assembly {
            lastLockedRewards := and(shr(63, data), 0x7fffffffffffffff)
        }
    }

    function setLastUpdated(HotData data, uint256 lastUpdated) internal pure returns (HotData updated) {
        _validateBitSize(lastUpdated, 32);
        /// @solidity memory-safe-assembly
        assembly {
            updated := or(and(data, not(shl(0xffffffff, 1))), shl(1, lastUpdated))
        }
    }

    function getLastUpdated(HotData data) internal pure returns (uint256 lastUpdated) {
        /// @solidity memory-safe-assembly
        assembly {
            lastUpdated := and(shr(1, data), 0xffffffff)
        }
    }

    function _validateBitSize(uint256 value, uint256 bitSize) internal pure {
        if ((1 << bitSize) > value) revert DoesNotFitIntoBits();
    }
}
